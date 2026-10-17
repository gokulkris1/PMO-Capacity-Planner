/**
 * Jira sync v2 routes (JI-01..JI-07): mappings, calibration, sync jobs, health, delivery rows.
 */
import { z } from 'zod';
import type {
  IdentityMappingDTO,
  JiraProjectMappingDTO,
  SyncJobDTO,
  TribeCalibrationDTO,
} from '../../../../shared/contracts/dto';
import type { Ctx } from '../api';
import { auditCtx, parseWith, reply, requireActor } from '../api';
import { audit } from '../audit';
import type { WorkspaceAccess } from '../authz';
import { requireWorkspace } from '../authz';
import type { Queryable } from '../db';
import { iso, json, one, withTx } from '../db';
import { planningOf, userRef } from '../dto';
import { badRequest, conflict, notFound } from '../errors';
import { staleOrMissing } from '../entity';
import { jiraConfigured, jiraCreds, loadStored } from '../integrationsStore';
import { DEFAULT_CALIBRATION } from '../jira/aggregate';
import { jiraFetch } from '../jira/client';
import { SYNC_JOB_COLUMNS, enqueueJob, loadJob, runStep, syncJobDTO } from '../jira/sync';
import { deliveryRows, syncHealth, type GroupBy } from '../jira/summary';
import type { Params } from '../router';

// ── Mappings (JI-02, JI-03) ────────────────────────────────────────────────

async function mappingResponse(
  q: Queryable,
  wsId: string,
): Promise<{ projects: JiraProjectMappingDTO[]; people: IdentityMappingDTO[] }> {
  const stored = await loadStored(q, wsId);
  const rows = await q.query(
    `SELECT external_key, external_name, board_ids, project_id, tribe_id, match_method, confirmed FROM integration_mappings
     WHERE workspace_id = $1 AND provider = 'jira'`,
    [wsId],
  );
  const seen = await q.query<{ k: string }>(
    `SELECT DISTINCT jira_project_key AS k FROM delivery_snapshots WHERE workspace_id = $1`,
    [wsId],
  );
  const keys = new Set<string>([
    ...(stored.jira?.config.projectKeys ?? []),
    ...rows.map((r) => String(r.external_key)),
    ...seen.map((s) => s.k),
  ]);
  const projects: JiraProjectMappingDTO[] = [...keys].sort().map((k) => {
    const r = rows.find((x) => String(x.external_key) === k);
    return {
      jiraKey: k,
      jiraName: r?.external_name ? String(r.external_name) : k,
      boardIds: Array.isArray(r?.board_ids) ? (r.board_ids as unknown[]).map(Number) : [],
      projectId: r?.project_id ? String(r.project_id) : null,
      tribeId: r?.tribe_id ? String(r.tribe_id) : null,
      matchMethod: (r?.match_method as JiraProjectMappingDTO['matchMethod']) ?? 'none',
      confirmed: !!r?.confirmed,
    };
  });
  const ids = await q.query(
    `SELECT provider, external_id, display_name, email, person_id, match_method, confirmed, last_seen_at FROM external_identities
     WHERE workspace_id = $1 AND provider = 'jira' AND (last_seen_at IS NULL OR last_seen_at > now() - interval '90 days')
     ORDER BY lower(display_name)`,
    [wsId],
  );
  const people: IdentityMappingDTO[] = ids.map((r) => ({
    provider: 'jira',
    externalId: String(r.external_id),
    displayName: String(r.display_name ?? ''),
    email: r.email ? String(r.email) : null,
    personId: r.person_id ? String(r.person_id) : null,
    matchMethod: r.match_method as IdentityMappingDTO['matchMethod'],
    confirmed: !!r.confirmed,
    lastSeenAt: iso(r.last_seen_at),
  }));
  return { projects, people };
}

export async function getMappings(ctx: Ctx, p: Params) {
  await requireWorkspace(ctx, p.wsId, 'integrations.view');
  return mappingResponse(ctx.db, p.wsId);
}

export async function autoMatch(ctx: Ctx, p: Params) {
  const access = await requireWorkspace(ctx, p.wsId, 'integrations.run');
  const stored = await loadStored(ctx.db, p.wsId);
  const names = new Map<string, string>();
  if (jiraConfigured(stored)) {
    try {
      const data = (await jiraFetch(jiraCreds(stored), '/rest/api/3/project/search?maxResults=100', {}, 5000)) as {
        values?: Array<{ key?: string; name?: string }>;
      };
      for (const v of data?.values ?? []) if (v.key) names.set(v.key.toUpperCase(), String(v.name ?? v.key));
    } catch {
      // names stay as keys; matching by key still works
    }
  }
  await withTx(async (q) => {
    const current = await mappingResponse(q, p.wsId);
    const keys = new Set([...current.projects.map((x) => x.jiraKey), ...names.keys()]);
    const projects = await q.query<{ id: string; name: string; jira_key: string | null; tribe_id: string | null }>(
      `SELECT id, name, jira_key, tribe_id FROM projects WHERE workspace_id = $1`,
      [p.wsId],
    );
    for (const key of keys) {
      const existing = current.projects.find((x) => x.jiraKey === key);
      if (existing?.confirmed) continue;
      const jiraName = names.get(key) ?? existing?.jiraName ?? key;
      let match = projects.find((x) => (x.jira_key ?? '').toUpperCase() === key);
      let method: JiraProjectMappingDTO['matchMethod'] = match ? 'key' : 'none';
      if (!match) {
        match = projects.find((x) => x.name.trim().toLowerCase() === jiraName.trim().toLowerCase());
        if (match) method = 'name';
      }
      await q.query(
        `INSERT INTO integration_mappings (workspace_id, provider, external_key, external_name, project_id, tribe_id, match_method, confirmed, updated_by)
         VALUES ($1, 'jira', $2, $3, $4, $5, $6, false, $7)
         ON CONFLICT (workspace_id, provider, external_key) DO UPDATE SET external_name = EXCLUDED.external_name, project_id = EXCLUDED.project_id,
           tribe_id = EXCLUDED.tribe_id, match_method = EXCLUDED.match_method, updated_at = now(), updated_by = EXCLUDED.updated_by
         WHERE NOT integration_mappings.confirmed`,
        [p.wsId, key, jiraName, match?.id ?? null, match?.tribe_id ?? null, method, requireActor(ctx).userId],
      );
    }
    await audit(q, auditCtx(ctx), {
      action: 'integration.mapping_auto_match',
      orgId: access.orgId,
      workspaceId: p.wsId,
      targetType: 'jira',
    });
  });
  return mappingResponse(ctx.db, p.wsId);
}

const projectMapSchema = z.array(
  z.object({
    jiraKey: z
      .string()
      .trim()
      .regex(/^[A-Za-z][A-Za-z0-9_]{0,19}$/, 'Invalid Jira key'),
    jiraName: z.string().max(200).optional(),
    boardIds: z.array(z.number().int()).max(50).optional(),
    projectId: z.string().nullable(),
    tribeId: z.string().nullable().optional(),
    confirmed: z.boolean().default(true),
  }),
);

export async function putProjectMappings(ctx: Ctx, p: Params) {
  const access = await requireWorkspace(ctx, p.wsId, 'integrations.run');
  const raw = Array.isArray(ctx.body) ? ctx.body : (ctx.body as { projects?: unknown })?.projects;
  const list = parseWith(projectMapSchema.max(500), raw ?? []);
  await withTx(async (q) => {
    for (const [i, m] of list.entries()) {
      let tribeId = m.tribeId ?? null;
      if (m.projectId) {
        const pr = await one<{ tribe_id: string | null }>(
          q,
          `SELECT tribe_id FROM projects WHERE workspace_id = $1 AND id = $2`,
          [p.wsId, m.projectId],
        );
        if (!pr) throw badRequest('Not in this workspace', { [`${i}.projectId`]: 'Not in this workspace' });
        if (m.tribeId === undefined) tribeId = pr.tribe_id;
      }
      if (
        tribeId &&
        !(await one(q, `SELECT 1 AS x FROM tribes WHERE org_id = $1 AND id = $2`, [access.orgId, tribeId]))
      ) {
        throw badRequest('Unknown tribe', { [`${i}.tribeId`]: 'Unknown tribe' });
      }
      const prev = await one<{ project_id: string | null; match_method: string }>(
        q,
        `SELECT project_id, match_method FROM integration_mappings WHERE workspace_id = $1 AND provider = 'jira' AND external_key = $2`,
        [p.wsId, m.jiraKey.toUpperCase()],
      );
      const method =
        prev && prev.project_id === m.projectId && prev.match_method !== 'none'
          ? prev.match_method
          : m.projectId
            ? 'manual'
            : 'none';
      await q.query(
        `INSERT INTO integration_mappings (workspace_id, provider, external_key, external_name, board_ids, project_id, tribe_id, match_method, confirmed, updated_by)
         VALUES ($1, 'jira', $2, $3, $4::int[], $5, $6, $7, $8, $9)
         ON CONFLICT (workspace_id, provider, external_key) DO UPDATE SET external_name = coalesce(EXCLUDED.external_name, integration_mappings.external_name),
           board_ids = EXCLUDED.board_ids, project_id = EXCLUDED.project_id, tribe_id = EXCLUDED.tribe_id, match_method = EXCLUDED.match_method,
           confirmed = EXCLUDED.confirmed, updated_at = now(), updated_by = EXCLUDED.updated_by`,
        [
          p.wsId,
          m.jiraKey.toUpperCase(),
          m.jiraName ?? null,
          m.boardIds ?? [],
          m.projectId,
          tribeId,
          method,
          m.confirmed,
          requireActor(ctx).userId,
        ],
      );
    }
    await audit(q, auditCtx(ctx), {
      action: 'integration.mapping_update',
      orgId: access.orgId,
      workspaceId: p.wsId,
      targetType: 'jira_projects',
      after: list,
    });
  });
  return mappingResponse(ctx.db, p.wsId);
}

const peopleMapSchema = z.array(
  z.object({
    externalId: z.string().min(1).max(200),
    personId: z.string().nullable(),
    confirmed: z.boolean().default(true),
  }),
);

export async function putPeopleMappings(ctx: Ctx, p: Params) {
  const access = await requireWorkspace(ctx, p.wsId, 'integrations.run');
  const raw = Array.isArray(ctx.body) ? ctx.body : (ctx.body as { people?: unknown })?.people;
  const list = parseWith(peopleMapSchema.max(2000), raw ?? []);
  await withTx(async (q) => {
    for (const [i, m] of list.entries()) {
      if (
        m.personId &&
        !(await one(q, `SELECT 1 AS x FROM resources WHERE workspace_id = $1 AND id = $2`, [p.wsId, m.personId]))
      ) {
        throw badRequest('Not in this workspace', { [`${i}.personId`]: 'Not in this workspace' });
      }
      const prev = await one<{ person_id: string | null; match_method: string }>(
        q,
        `SELECT person_id, match_method FROM external_identities WHERE workspace_id = $1 AND provider = 'jira' AND external_id = $2`,
        [p.wsId, m.externalId],
      );
      if (!prev) throw notFound(`Unknown Jira account ${m.externalId}`);
      const method = prev.person_id === m.personId ? prev.match_method : m.personId ? 'manual' : 'none';
      await q.query(
        `UPDATE external_identities SET person_id = $3, match_method = $4, confirmed = $5, updated_at = now()
         WHERE workspace_id = $1 AND provider = 'jira' AND external_id = $2`,
        [p.wsId, m.externalId, m.personId, method, m.confirmed && !!m.personId],
      );
    }
    await audit(q, auditCtx(ctx), {
      action: 'integration.mapping_update',
      orgId: access.orgId,
      workspaceId: p.wsId,
      targetType: 'jira_people',
      after: list,
    });
  });
  return mappingResponse(ctx.db, p.wsId);
}

// ── Calibration (JI-04) ────────────────────────────────────────────────────

async function calibrationList(
  q: Queryable,
  access: WorkspaceAccess,
  tribeId?: string,
): Promise<TribeCalibrationDTO[]> {
  const stored = await loadStored(q, access.workspaceId);
  const def = stored.settings?.config.calibration['*'] ?? {
    ...DEFAULT_CALIBRATION,
    sprintLengthDays: planningOf(access.org.planning).sprintLengthDays,
  };
  const rows = await q.query(
    `SELECT t.id AS tribe_id, c.points_per_sprint_per_fte::float8 AS pps, c.sprint_length_days, c.suggested_value::float8 AS suggested,
            c.suggested_basis, c.is_default, c.note, c.version, c.updated_at, c.updated_by, ub.name AS updated_by_name
     FROM tribes t
     LEFT JOIN tribe_calibrations c ON c.tribe_id = t.id AND c.workspace_id = $1
     LEFT JOIN users ub ON ub.id = c.updated_by
     WHERE t.org_id = $2 ${tribeId ? 'AND t.id = $3' : ''} ORDER BY lower(t.name)`,
    tribeId ? [access.workspaceId, access.orgId, tribeId] : [access.workspaceId, access.orgId],
  );
  return rows.map((r) => {
    const exists = r.version !== null && r.version !== undefined;
    const isDefault = !exists || !!r.is_default;
    return {
      tribeId: String(r.tribe_id),
      pointsPerSprintPerFte: isDefault ? def.pointsPerSprintPerFte : Number(r.pps),
      sprintLengthDays: isDefault ? def.sprintLengthDays : Number(r.sprint_length_days),
      isDefault,
      suggestedValue: r.suggested === null || r.suggested === undefined ? null : Number(r.suggested),
      suggestedBasis: json<TribeCalibrationDTO['suggestedBasis']>(r.suggested_basis, null),
      note: r.note ? String(r.note) : null,
      version: exists ? Number(r.version) : 0,
      updatedAt: iso(r.updated_at) ?? new Date(0).toISOString(),
      updatedBy: userRef(r.updated_by, r.updated_by_name),
    };
  });
}

export async function getCalibration(ctx: Ctx, p: Params) {
  const access = await requireWorkspace(ctx, p.wsId, 'integrations.view');
  return calibrationList(ctx.db, access);
}

const calibrationSchema = z.object({
  pointsPerSprintPerFte: z.number().gt(0).max(1000),
  sprintLengthDays: z.number().int().min(1).max(60),
  note: z.string().trim().max(1000).nullable().optional(),
  version: z.number().int().min(0),
});

export async function putCalibration(ctx: Ctx, p: Params) {
  const access = await requireWorkspace(ctx, p.wsId, 'integrations.run');
  const body = parseWith(calibrationSchema, ctx.body);
  if (!body.note) throw badRequest('Why are you changing this?', { note: 'Required' });
  const actor = requireActor(ctx);
  return withTx(async (q) => {
    const [before] = await calibrationList(q, access, p.tribeId);
    if (!before) throw notFound('Tribe not found');
    if (before.version !== body.version) await staleOrMissing(async () => before, 'calibration');
    const rows = await q.query(
      `INSERT INTO tribe_calibrations (workspace_id, tribe_id, points_per_sprint_per_fte, sprint_length_days, note, is_default, version, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, false, 1, $6, now())
       ON CONFLICT (workspace_id, tribe_id) DO UPDATE SET points_per_sprint_per_fte = EXCLUDED.points_per_sprint_per_fte,
         sprint_length_days = EXCLUDED.sprint_length_days, note = EXCLUDED.note, is_default = false,
         version = tribe_calibrations.version + 1, updated_by = EXCLUDED.updated_by, updated_at = now()
       WHERE tribe_calibrations.version = $7 RETURNING version`,
      [p.wsId, p.tribeId, body.pointsPerSprintPerFte, body.sprintLengthDays, body.note, actor.userId, body.version],
    );
    if (!rows.length)
      await staleOrMissing(async () => (await calibrationList(q, access, p.tribeId))[0] ?? null, 'calibration');
    const [after] = await calibrationList(q, access, p.tribeId);
    await audit(q, auditCtx(ctx), {
      action: 'calibration.change',
      orgId: access.orgId,
      workspaceId: p.wsId,
      targetType: 'tribe',
      targetId: p.tribeId,
      before,
      after,
    });
    return after;
  });
}

// ── Sync jobs, health, delivery ────────────────────────────────────────────

export async function startJiraSync(ctx: Ctx, p: Params) {
  const access = await requireWorkspace(ctx, p.wsId, 'integrations.run');
  if (!jiraConfigured(await loadStored(ctx.db, p.wsId))) throw conflict('Jira is not configured for this workspace.');
  const { job } = await enqueueJob(ctx.db, access.orgId, p.wsId, 'manual', requireActor(ctx).userId);
  return reply(202, { job });
}

export async function stepJob(ctx: Ctx, p: Params): Promise<{ job: SyncJobDTO }> {
  await requireWorkspace(ctx, p.wsId, 'integrations.run');
  const job = await loadJob(ctx.db, p.wsId, p.jobId);
  if (!job) throw notFound('Sync job not found');
  if (job.status === 'queued' || job.status === 'running') await runStep(ctx.db, p.jobId, Date.now() + 7000);
  return { job: (await loadJob(ctx.db, p.wsId, p.jobId)) as SyncJobDTO };
}

export async function listJobs(ctx: Ctx, p: Params): Promise<SyncJobDTO[]> {
  await requireWorkspace(ctx, p.wsId, 'integrations.view');
  const rows = await ctx.db.query(
    `SELECT ${SYNC_JOB_COLUMNS} FROM sync_jobs j LEFT JOIN users rb ON rb.id = j.requested_by WHERE j.workspace_id = $1
     ORDER BY j.created_at DESC LIMIT 20`,
    [p.wsId],
  );
  return rows.map(syncJobDTO);
}

export async function getSyncHealth(ctx: Ctx, p: Params) {
  await requireWorkspace(ctx, p.wsId, 'data.read');
  return syncHealth(ctx.db, p.wsId);
}

export async function getDelivery(ctx: Ctx, p: Params) {
  await requireWorkspace(ctx, p.wsId, 'data.read');
  const groupBy = (
    ['tribe', 'project', 'sprint', 'person'].includes(ctx.query.groupBy ?? '') ? ctx.query.groupBy : 'tribe'
  ) as GroupBy;
  for (const k of ['from', 'to'] as const) {
    const v = ctx.query[k];
    if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw badRequest(`Invalid ${k}`, { [k]: 'Use YYYY-MM-DD' });
  }
  return deliveryRows(ctx.db, p.wsId, {
    groupBy,
    tribeId: ctx.query.tribeId || undefined,
    projectId: ctx.query.projectId || undefined,
    from: ctx.query.from || undefined,
    to: ctx.query.to || undefined,
  });
}
