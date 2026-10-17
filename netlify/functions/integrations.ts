/**
 * /api/integrations/* — Jira Cloud and Planview connection settings (HS-08, HS-09, UAM-07, SEC-11/12).
 * Same request/response shapes as v1.1, with the 2.0 rules:
 * - GET /config: Planner+ (integrations.view), never returns secrets.
 * - POST /config, /jira/test, /jira/projects, /jira/boards, /jira/sprints, /planview/test: PMO Admin (integrations.manage).
 * - POST /jira/usage, GET /planview/projects|assignments: Planner+ (integrations.run); usage only for configured keys.
 * - Changing where a secret is sent without a new secret clears it (`secretCleared`); Jira hosts are Atlassian Cloud
 *   only; Planview must be a public HTTPS host; redirects are never followed; every call is ≤ 8 s.
 */
import type { Ctx } from './_lib/api';
import { auditCtx, withApi } from './_lib/api';
import { audit } from './_lib/audit';
import type { WorkspaceAccess } from './_lib/authz';
import { requireWorkspace, UUID_RE } from './_lib/authz';
import { withTx } from './_lib/db';
import { badRequest, notFound } from './_lib/errors';
import {
  configResponse,
  jiraCreds,
  loadStored,
  planviewCreds,
  saveConfig,
  upsertProvider,
} from './_lib/integrationsStore';
import { JIRA_DOMAIN_MESSAGE, normaliseJiraDomain, outboundHttpError } from './_lib/net';
import { decryptSecret } from './_lib/crypto';
import { aggregateUsage } from './_lib/jira/aggregate';
import { boardSprints, jiraFetch, jiraFields, searchPage } from './_lib/jira/client';
import { detectJiraFields, jqlString } from './_lib/jira/fields';
import {
  adaptiveLogin,
  fetchAssignmentsRaw,
  fetchProjectsRaw,
  normaliseAssignments,
  normaliseProjects,
} from './_lib/planview/client';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

async function config(ctx: Ctx, access: WorkspaceAccess) {
  if (ctx.method === 'GET') return configResponse(await loadStored(ctx.db, access.workspaceId));
  const result = await withTx(async (q) => {
    const stored = await loadStored(q, access.workspaceId);
    const r = await saveConfig(q, access.workspaceId, stored, ctx.body);
    const body = (ctx.body ?? {}) as Record<string, Record<string, unknown> | undefined>;
    const secretChanged = !!(
      body.jira?.apiToken ||
      body.planview?.secret ||
      r.secretCleared.jira ||
      r.secretCleared.planview
    );
    await audit(q, auditCtx(ctx), {
      action: secretChanged ? 'integration.secret_update' : 'integration.config_update',
      orgId: access.orgId,
      workspaceId: access.workspaceId,
      targetType: 'integration',
      targetId: Object.keys(body).join(','),
      after: { providers: Object.keys(body), secretCleared: r.secretCleared },
    });
    return r;
  });
  const out = configResponse(await loadStored(ctx.db, access.workspaceId));
  return {
    ...out,
    secretCleared: result.secretCleared.jira || result.secretCleared.planview,
    secretsCleared: result.secretCleared,
  };
}

/**
 * UAT-02: "Test connection" tests what is in the form (`domain`, `email`, `apiToken` in the body), each field left
 * out falling back to the saved setting, so an admin can test before saving. The saved API token is only used for
 * the saved site and account: testing another site or account needs the token typed in. Detected field ids are
 * stored only when the test ran against the saved site and account. A bare host ("acme.atlassian.net") is accepted.
 */
function jiraTestCreds(stored: Awaited<ReturnType<typeof loadStored>>, body: unknown) {
  const b = (body ?? {}) as Record<string, unknown>;
  const text = (k: string) => (typeof b[k] === 'string' ? (b[k] as string).trim() : '');
  if (!text('domain') && !text('email') && !text('apiToken')) return { creds: jiraCreds(stored), persist: true };
  const saved = stored.jira?.config;
  const domain = text('domain') ? normaliseJiraDomain(text('domain')) : (saved?.domain ?? null);
  if (!domain) throw badRequest(JIRA_DOMAIN_MESSAGE, { domain: JIRA_DOMAIN_MESSAGE });
  const email = text('email') || saved?.email || '';
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) throw badRequest('Enter the Jira account email', { email: 'Required' });
  const same = !!saved && saved.domain === domain && saved.email === email;
  const token = text('apiToken');
  if (!token && !(same && stored.jira?.secretEnc))
    throw badRequest('Enter the API token to test this site and account.', { apiToken: 'Required to test' });
  const config = same && saved ? saved : { domain, email, projectKeys: [], boardIds: [] };
  return {
    creds: { domain, email, apiToken: token || decryptSecret(stored.jira!.secretEnc!), config },
    persist: same,
  };
}

async function jiraTest(ctx: Ctx, access: WorkspaceAccess) {
  const stored = await loadStored(ctx.db, access.workspaceId);
  const { creds, persist } = jiraTestCreds(stored, ctx.body);
  const [me, fields] = await Promise.all([jiraFetch(creds, '/rest/api/3/myself'), jiraFields(creds)]);
  const detected = detectJiraFields(fields, creds.config.storyPointsFieldId);
  if (persist)
    await upsertProvider(
      ctx.db,
      access.workspaceId,
      'jira',
      { ...creds.config, storyPointsFieldId: detected.storyPointsFieldId, sprintFieldId: detected.sprintFieldId },
      undefined,
    );
  const m = (me ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    displayName: String(m.displayName ?? ''),
    accountId: String(m.accountId ?? ''),
    storyPointsFieldId: detected.storyPointsFieldId || null,
    sprintFieldId: detected.sprintFieldId || null,
  };
}

async function jiraUsage(ctx: Ctx, access: WorkspaceAccess) {
  const stored = await loadStored(ctx.db, access.workspaceId);
  const creds = jiraCreds(stored);
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const configured = creds.config.projectKeys;
  const requested = Array.isArray(body.projectKeys) ? body.projectKeys.map((k) => String(k).toUpperCase()) : [];
  // HS-08#AC5: only the projects configured on the connection.
  const keys = requested.length ? requested.filter((k) => configured.includes(k)) : configured;
  let sprintIds = Array.isArray(body.sprintIds) ? body.sprintIds.map(Number).filter(Number.isFinite) : [];
  const from = body.from === undefined ? undefined : String(body.from);
  const to = body.to === undefined ? undefined : String(body.to);
  if (from !== undefined && !ISO.test(from)) throw badRequest('from must be YYYY-MM-DD', { from: 'Use YYYY-MM-DD' });
  if (to !== undefined && !ISO.test(to)) throw badRequest('to must be YYYY-MM-DD', { to: 'Use YYYY-MM-DD' });
  const boardId = Number(body.boardId);
  if (Number.isFinite(boardId) && boardId > 0 && !sprintIds.length) {
    if (creds.config.boardIds.length && !creds.config.boardIds.includes(boardId))
      throw badRequest('Board is not configured', { boardId: 'Not configured' });
    const sprints = await boardSprints(creds, boardId, 'active,future,closed', 3);
    sprintIds = sprints
      .filter((s) => {
        const start = s.startDate?.slice(0, 10) ?? null;
        const end = s.endDate?.slice(0, 10) ?? null;
        return !((from && end && end < from) || (to && start && start > to));
      })
      .map((s) => s.id);
    if (!sprintIds.length) throw badRequest(`Board ${boardId} has no sprints in the requested range`);
  }
  if (!keys.length)
    throw badRequest('No configured Jira projects to report on', { projectKeys: 'Configure project keys first' });
  const clauses = [`project in (${keys.map(jqlString).join(',')})`];
  if (sprintIds.length) clauses.push(`sprint in (${sprintIds.join(',')})`);
  if (from) clauses.push(`updated >= ${jqlString(from)}`);
  if (to) clauses.push(`created <= ${jqlString(to)}`);
  let sp = creds.config.storyPointsFieldId;
  let sprintField = creds.config.sprintFieldId;
  if (!sp || !sprintField) {
    const detected = detectJiraFields(await jiraFields(creds), sp);
    sp = sp ?? detected.storyPointsFieldId;
    sprintField = sprintField ?? detected.sprintFieldId;
  }
  const fields = ['summary', 'status', 'assignee', 'project', 'issuetype', 'resolutiondate', 'created'];
  if (sp) fields.push(sp);
  if (sprintField) fields.push(sprintField);
  const deadline = Date.now() + 7000;
  const issues: Array<{ key?: unknown; fields?: unknown }> = [];
  let token: string | null = null;
  for (let page = 0; page < 10; page++) {
    const remaining = deadline - Date.now();
    if (remaining < 1500) break;
    const res = await searchPage(
      creds,
      `${clauses.join(' AND ')} ORDER BY updated DESC`,
      fields,
      token,
      remaining - 500,
    );
    issues.push(...res.issues);
    token = res.nextPageToken;
    if (!token) break;
  }
  const tribeByProjectKey: Record<string, string> = {};
  for (const [k, v] of Object.entries((body.tribeByProjectKey as Record<string, unknown>) ?? {})) {
    if (typeof v === 'string' && v.trim()) tribeByProjectKey[k] = v.trim();
  }
  const sprintsInRange = Number(body.sprintsInRange) > 0 ? Number(body.sprintsInRange) : 6;
  return aggregateUsage(issues, {
    storyPointsFieldId: sp,
    sprintFieldId: sprintField,
    tribeByProjectKey,
    calibration: stored.settings?.config.calibration ?? {},
    sprintsInRange,
  });
}

async function planviewTest(ctx: Ctx, access: WorkspaceAccess) {
  const pv = planviewCreds(await loadStored(ctx.db, access.workspaceId));
  if (pv.config.flavour === 'adaptivework') {
    await adaptiveLogin(pv);
    return { ok: true, flavour: 'adaptivework' };
  }
  const projects = normaliseProjects(pv, await fetchProjectsRaw(pv));
  return { ok: true, flavour: 'generic', projectCount: projects.length };
}

async function route(ctx: Ctx) {
  const wsId = ctx.query.wsId;
  if (!wsId || !UUID_RE.test(wsId)) throw badRequest('wsId query parameter is required', { wsId: 'Required' });
  const p = ctx.subpath;
  const m = ctx.method;
  const need =
    p === '/config' && m === 'GET'
      ? 'integrations.view'
      : (p === '/jira/usage' && m === 'POST') || (p.startsWith('/planview/') && p !== '/planview/test' && m === 'GET')
        ? 'integrations.run'
        : 'integrations.manage';
  const access = await requireWorkspace(ctx, wsId, need);
  if (p === '/config' && (m === 'GET' || m === 'POST')) return config(ctx, access);
  if (p === '/jira/test' && m === 'POST') return jiraTest(ctx, access);
  if (p === '/jira/projects' && m === 'GET') {
    const data = (await jiraFetch(
      jiraCreds(await loadStored(ctx.db, wsId)),
      '/rest/api/3/project/search?maxResults=100',
    )) as {
      values?: Array<Record<string, unknown>>;
    };
    return {
      projects: (data?.values ?? []).map((x) => ({
        id: String(x.id),
        key: x.key,
        name: x.name,
        projectTypeKey: x.projectTypeKey ?? null,
      })),
    };
  }
  if (p === '/jira/boards' && m === 'GET') {
    const key = (ctx.query.projectKey ?? '').trim();
    if (!key) throw badRequest('projectKey query parameter is required', { projectKey: 'Required' });
    const data = (await jiraFetch(
      jiraCreds(await loadStored(ctx.db, wsId)),
      `/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(key)}&maxResults=50`,
    )) as { values?: Array<Record<string, unknown>> };
    return { boards: (data?.values ?? []).map((b) => ({ id: Number(b.id), name: b.name, type: b.type ?? null })) };
  }
  if (p === '/jira/sprints' && m === 'GET') {
    const boardId = Number(ctx.query.boardId);
    if (!Number.isFinite(boardId) || boardId <= 0)
      throw badRequest('boardId query parameter is required', { boardId: 'Required' });
    const state = (ctx.query.state || 'active,future,closed')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => ['active', 'future', 'closed'].includes(s))
      .join(',');
    if (!state) throw badRequest('state must be a comma list of active, future, closed');
    return { sprints: await boardSprints(jiraCreds(await loadStored(ctx.db, wsId)), boardId, state) };
  }
  if (p === '/jira/usage' && m === 'POST') return jiraUsage(ctx, access);
  if (p === '/planview/test' && m === 'POST') return planviewTest(ctx, access);
  if (p === '/planview/projects' && m === 'GET') {
    const pv = planviewCreds(await loadStored(ctx.db, wsId));
    return { projects: normaliseProjects(pv, await fetchProjectsRaw(pv)) };
  }
  if (p === '/planview/assignments' && m === 'GET') {
    const projectId = (ctx.query.projectId ?? '').trim();
    if (!projectId) throw badRequest('projectId query parameter is required', { projectId: 'Required' });
    const pv = planviewCreds(await loadStored(ctx.db, wsId));
    return { assignments: normaliseAssignments(pv, await fetchAssignmentsRaw(pv, projectId), projectId) };
  }
  throw notFound('Not found');
}

export const handler = withApi({ fn: 'integrations' }, async (ctx) => {
  try {
    return await route(ctx);
  } catch (e) {
    throw outboundHttpError(e) ?? e;
  }
});
