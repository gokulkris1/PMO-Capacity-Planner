/**
 * In-memory implementation of every route in BACKLOG §4.3 (API route table) for DemoTransport:
 * same paths, request/response shapes, permission checks (`shared/permissions.ts`), entitlement
 * and feature checks, and status codes (400 with `fields`, 401, 403 forbidden / entitlement /
 * feature_disabled, 404, 409 version conflicts with `current`/`changedBy`/`changedAt`, 410, 413).
 *
 * Handlers mutate the `DemoDb` directly; DemoTransport makes each request atomic (it restores the
 * database when a handler throws). Pure: no React, DOM, Node or Netlify imports.
 */
import type * as D from '../../../shared/contracts/dto';
import { QUARTER_KEY_RE } from '../../../shared/contracts/dto';
import type {
  AllocationOp,
  ApiError,
  AuditEventDTO,
  DemandOp,
  InvitationRequest,
  MemberDTO,
  MemberPatch,
  NewAllocation,
  NewDemandLine,
  NewPerson,
  NewProject,
  PeopleBulkRequest,
  PeopleImportRequest,
  PeopleImportResponse,
  ProposeRequest,
  RespondRequest,
} from '../../../shared/contracts/api';
import { entitlementsFor, entitled, withinLimit } from '../../../shared/entitlements';
import { resolveFeatures } from '../../../shared/features';
import { permissionsFor, type Permission } from '../../../shared/permissions';
import { resolveCraftRef, unknownCraftMessage } from '../../../shared/peopleImport';
import { validateThresholds } from '../../../shared/utilisation';
import { toCsv } from '../../../utils/csv';
import { isIsoDate, quarterKeyOf, rollingQuarterViews } from '../../../utils/quarters';
import { today } from '../../../utils/clock';
import { buildHome } from '../../../utils/viewModels';
import { applyAllocationOps, isUuid, MAX_BATCH_OPS, MAX_CELL_PCT } from '../../../utils/viewModels/allocationOps';
import { errorFromResponse } from '../errors';
import { DEMO_OTP, seedWorkspaceData, type DemoDb, type DemoUser, type DemoWorkspace } from './seed';
import { GLOSSARY, PAGE_GUIDE, SHELL_GUIDE } from '../../../shared/help/guide';

/* ── plumbing ──────────────────────────────────────────────────────────────────────── */

export interface DemoRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
}

interface Ctx extends DemoRequest {
  db: DemoDb;
  now: D.ISODateTime;
  params: Record<string, string>;
  newId: () => D.ID;
  acceptAnyPassword: boolean;
}

type Handler = (c: Ctx) => unknown;

export function fail(status: number, code: ApiError['code'], error: string, extra: Partial<ApiError> = {}): never {
  throw errorFromResponse(status, {
    error,
    code,
    requestId: `demo-${Math.random().toString(36).slice(2, 10)}`,
    ...extra,
  });
}
function badRequest(fields: Record<string, string>, error = 'Some details need correcting.'): never {
  return fail(400, 'bad_request', error, { fields });
}
function forbidden(error = "You don't have permission to do that."): never {
  return fail(403, 'forbidden', error);
}
function notFound(what: string): never {
  return fail(404, 'not_found', `${what} not found.`);
}

const obj = (b: unknown): Record<string, unknown> =>
  b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function userRef(u: DemoUser | null): D.UserRef | null {
  return u ? { id: u.id, name: u.name } : null;
}

/* ── identity and permissions ──────────────────────────────────────────────────────── */

function currentUser(c: Ctx): DemoUser | null {
  return c.db.users.find((u) => u.id === c.db.sessionUserId) ?? null;
}
function requireUser(c: Ctx): DemoUser {
  const u = currentUser(c);
  if (!u) fail(401, 'unauthorized', 'Please sign in.');
  return u;
}

interface WsAccess {
  user: DemoUser;
  ws: DemoWorkspace;
  role: D.WorkspaceRole;
  implicit: boolean;
  perms: Set<Permission>;
  linkedPersonId: D.ID | null;
}

function workspaceRoleFor(
  db: DemoDb,
  u: DemoUser,
  wsId: D.ID,
): { role: D.WorkspaceRole; implicit: boolean; linked: D.ID | null } | null {
  const m = db.memberships.find((x) => x.userId === u.id && x.workspaceId === wsId);
  if (u.orgRole === 'ORG_ADMIN') return { role: 'WORKSPACE_ADMIN', implicit: !m, linked: m?.linkedPersonId ?? null };
  if (m) return { role: m.role, implicit: false, linked: m.linkedPersonId };
  if (u.orgRole && db.org.defaultWorkspaceVisibility === 'org') return { role: 'VIEWER', implicit: true, linked: null };
  return null;
}

function permsFor(u: DemoUser, role: D.WorkspaceRole | null): Set<Permission> {
  return new Set(permissionsFor({ isPlatformAdmin: u.isPlatformAdmin, orgRole: u.orgRole, workspaceRole: role }));
}

function access(c: Ctx, wsId = c.params.wsId): WsAccess {
  const user = requireUser(c);
  const ws = c.db.workspaces[wsId];
  if (!ws) notFound('Workspace');
  const r = workspaceRoleFor(c.db, user, wsId);
  if (!r) forbidden("You don't have access to this workspace.");
  return { user, ws, role: r.role, implicit: r.implicit, perms: permsFor(user, r.role), linkedPersonId: r.linked };
}

function need(a: { perms: Set<Permission> }, p: Permission): void {
  if (!a.perms.has(p)) forbidden();
}
function needOwnOr(a: WsAccess, any: Permission, own: Permission, personId: D.ID): void {
  if (a.perms.has(any)) return;
  if (a.perms.has(own) && a.linkedPersonId === personId) return;
  forbidden();
}

/** Org-level permissions: the union over the user's workspaces plus org role (structure.write, members). */
function orgPerms(c: Ctx, orgId = c.params.orgId): { user: DemoUser; perms: Set<Permission> } {
  const user = requireUser(c);
  if (orgId !== c.db.org.id || !user.orgRole) notFound('Organisation');
  const perms = permsFor(user, user.orgRole === 'ORG_ADMIN' ? 'WORKSPACE_ADMIN' : null);
  for (const wsId of Object.keys(c.db.workspaces)) {
    const r = workspaceRoleFor(c.db, user, wsId);
    if (r) permsFor(user, r.role).forEach((p) => perms.add(p));
  }
  return { user, perms };
}

function entitlements(db: DemoDb): D.Entitlements {
  return entitlementsFor(db.org.plan, db.appMode);
}

/* ── writes: versions, audit, data version ─────────────────────────────────────────── */

const SERVER_KEYS = ['id', 'version', 'updatedAt', 'updatedBy', 'createdAt'];
function cleanPatch(p: unknown): Record<string, unknown> {
  const out = { ...obj(p) };
  for (const k of SERVER_KEYS) delete out[k];
  return out;
}

function checkVersion<T extends D.Versioned>(entity: T, version: unknown): void {
  if (!isNum(version)) badRequest({ version: 'Required' });
  if (version !== entity.version) {
    fail(409, 'conflict', 'This record changed since you loaded it.', {
      current: entity,
      changedBy: entity.updatedBy ?? { id: 'unknown', name: 'Someone' },
      changedAt: entity.updatedAt,
    });
  }
}

function patched<T extends D.Versioned>(c: Ctx, entity: T, patch: Record<string, unknown>): T {
  return { ...entity, ...patch, version: entity.version + 1, updatedAt: c.now, updatedBy: userRef(currentUser(c)) };
}

function audit(
  c: Ctx,
  action: string,
  target: { type: string | null; id: string | null; workspaceId?: D.ID | null },
  before: unknown = null,
  after: unknown = null,
): void {
  const actor = currentUser(c);
  const ev: AuditEventDTO = {
    id: c.newId(),
    occurredAt: c.now,
    actor: userRef(actor),
    actorType: actor ? 'user' : 'anonymous',
    action,
    workspaceId: target.workspaceId ?? null,
    targetType: target.type,
    targetId: target.id,
    before,
    after,
    requestId: null,
  };
  c.db.audit.unshift(ev);
  if (c.db.audit.length > 500) c.db.audit.length = 500;
}

function touch(ws: DemoWorkspace): void {
  ws.workspace.dataVersion += 1;
}

/* ── read models ───────────────────────────────────────────────────────────────────── */

export function buildMe(db: DemoDb, u: DemoUser): D.MeResponse {
  const workspaces: D.MeWorkspace[] = [];
  for (const ws of Object.values(db.workspaces)) {
    const r = workspaceRoleFor(db, u, ws.workspace.id);
    if (!r) continue;
    workspaces.push({
      id: ws.workspace.id,
      name: ws.workspace.name,
      role: r.role,
      implicit: r.implicit,
      permissions: [...permsFor(u, r.role)],
      linkedPersonId: r.linked,
    });
  }
  const o = db.org;
  return {
    user: {
      id: u.id,
      email: u.email,
      name: u.name,
      isPlatformAdmin: u.isPlatformAdmin,
      emailVerified: u.emailVerified,
      twoFactorEnabled: u.twoFactorEnabled,
    },
    org: u.orgRole
      ? {
          id: o.id,
          name: o.name,
          slug: o.slug,
          logoUrl: o.logoUrl,
          role: u.orgRole,
          plan: o.plan,
          features: resolveFeatures(o.features),
          planning: o.planning,
        }
      : null,
    workspaces,
    entitlements: entitlements(db),
    appMode: db.appMode,
  };
}

function syncHealth(ws: DemoWorkspace): D.SyncHealthDTO {
  const jobs = [...ws.syncJobs].sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''));
  const lastJob = jobs[0] ?? null;
  const lastSuccess = jobs.find((j) => j.status === 'succeeded');
  const state: D.SyncHealthDTO['state'] = !ws.jiraConfigured
    ? 'never'
    : !lastJob
      ? 'never'
      : lastJob.status === 'running' || lastJob.status === 'queued'
        ? 'running'
        : lastJob.status === 'failed'
          ? 'failed'
          : 'ok';
  return {
    provider: 'jira',
    configured: ws.jiraConfigured,
    state,
    lastSuccessAt: lastSuccess?.finishedAt ?? null,
    lastJob,
    recentJobs: jobs.slice(0, 10),
  };
}

function deliverySummary(db: DemoDb, ws: DemoWorkspace): D.DeliverySummaryDTO | null {
  if (!ws.jiraConfigured) return null;
  const [q1] = rollingQuarterViews(today(), db.org.planning.fiscalYearStartMonth);
  const mapped = ws.jiraProjects.filter((m) => m.confirmed && m.projectId);
  return {
    health: syncHealth(ws),
    byProjectQbr1: mapped.map((m) => {
      const rows = ws.deliveryRows
        .filter((r) => r.projectId === m.projectId)
        .sort((a, b) => b.to.localeCompare(a.to))
        .slice(0, 3);
      const implied = rows.length ? rows.reduce((x, r) => x + r.impliedFte, 0) / rows.length : 0;
      const project = ws.projects.find((p) => p.id === m.projectId);
      const planned =
        ws.allocations
          .filter((a) => a.projectId === m.projectId && a.state !== 'declined')
          .reduce((x, a) => {
            const s = a.startDate ?? project?.startDate ?? null;
            const e = a.endDate ?? project?.endDate ?? null;
            const active = (s === null || s <= q1.end) && (e === null || e >= q1.start);
            return x + (active ? a.percentage : 0);
          }, 0) / 100;
      return {
        projectId: m.projectId!,
        plannedFte: Math.round(planned * 100) / 100,
        impliedFte: Math.round(implied * 100) / 100,
      };
    }),
  };
}

function snapshot(c: Ctx, a: WsAccess): D.WorkspaceSnapshot {
  const { ws } = a;
  const craftRequests = a.perms.has('craftProfile.approve')
    ? ws.craftRequests
    : a.perms.has('people.write.own')
      ? ws.craftRequests.filter((r) => r.personId === a.linkedPersonId)
      : [];
  return {
    org: { ...c.db.org, features: resolveFeatures(c.db.org.features) },
    workspace: ws.workspace,
    people: ws.people,
    projects: ws.projects,
    allocations: ws.allocations,
    demand: ws.demand,
    tribes: c.db.tribes,
    chapters: c.db.chapters,
    teams: c.db.teams,
    crafts: c.db.crafts,
    offers: ws.offers,
    craftRequests,
    delivery: deliverySummary(c.db, ws),
    serverTime: c.now,
  };
}

/* ── validation ────────────────────────────────────────────────────────────────────── */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validatePerson(c: Ctx, p: Record<string, unknown>, creating: boolean): void {
  const f: Record<string, string> = {};
  if (creating || 'name' in p) if (!str(p.name)) f.name = 'Enter a name';
  if (p.email !== undefined && p.email !== null && !EMAIL_RE.test(str(p.email))) f.email = 'Enter a valid email';
  if (p.targetUtil !== undefined && (!isNum(p.targetUtil) || p.targetUtil < 0 || p.targetUtil > 150))
    f.targetUtil = 'Target must be 0–150';
  if (p.totalCapacity !== undefined && (!isNum(p.totalCapacity) || p.totalCapacity < 0 || p.totalCapacity > 200))
    f.totalCapacity = 'Capacity must be 0–200';
  if (p.type !== undefined && !['Permanent', 'Contractor', 'Part-Time'].includes(String(p.type)))
    f.type = 'Choose a type';
  const craftIds = new Set(c.db.crafts.map((x) => x.id));
  if (p.primaryCraft !== undefined && p.primaryCraft !== null && !craftIds.has(String(p.primaryCraft)))
    f.primaryCraft = 'Unknown craft';
  if (p.chapterId && !c.db.chapters.some((x) => x.id === p.chapterId)) f.chapterId = 'Unknown chapter';
  if (p.teamId && !c.db.teams.some((x) => x.id === p.teamId)) f.teamId = 'Unknown team';
  if (p.homeTribeId && !c.db.tribes.some((x) => x.id === p.homeTribeId)) f.homeTribeId = 'Unknown tribe';
  if (p.secondaryCrafts !== undefined) {
    if (!Array.isArray(p.secondaryCrafts)) f.secondaryCrafts = 'Invalid crafts';
    else
      validateSecondary(
        c,
        p.secondaryCrafts as D.SecondaryCraftDTO[],
        (p.primaryCraft as string | null | undefined) ?? null,
        f,
      );
  }
  if (Object.keys(f).length) badRequest(f);
}

function validateSecondary(
  c: Ctx,
  list: D.SecondaryCraftDTO[],
  primary: string | null,
  f: Record<string, string>,
): void {
  const seen = new Set<string>();
  list.forEach((s, i) => {
    const k = `secondaryCrafts.${i}`;
    if (!c.db.crafts.some((x) => x.id === s?.craftId)) f[k] = 'Unknown craft';
    else if (primary && s.craftId === primary) f[k] = 'Already their above-the-table craft';
    else if (seen.has(s.craftId)) f[k] = 'Listed twice';
    else if (![1, 2, 3].includes(s.proficiency)) f[k] = 'Choose L1, L2 or L3';
    else if (!isNum(s.maxPct) || s.maxPct < 0 || s.maxPct > 100) f[k] = 'Cap must be 0–100%';
    if (s?.craftId) seen.add(s.craftId);
  });
}

function validateProject(c: Ctx, p: Record<string, unknown>, creating: boolean): void {
  const f: Record<string, string> = {};
  if ((creating || 'name' in p) && !str(p.name)) f.name = 'Enter a name';
  if (creating || 'tribeId' in p) {
    if (!p.tribeId) f.tribeId = 'Choose a tribe';
    else if (!c.db.tribes.some((t) => t.id === p.tribeId)) f.tribeId = 'Unknown tribe';
  }
  for (const k of ['startDate', 'endDate', 'initiatedOn'] as const) {
    if (p[k] !== undefined && p[k] !== null && !isIsoDate(p[k])) f[k] = 'Enter a date';
  }
  if (isIsoDate(p.startDate) && isIsoDate(p.endDate) && p.endDate < p.startDate)
    f.endDate = 'End date must be on or after the start date';
  if (Object.keys(f).length) badRequest(f);
}

function validateDemand(
  c: Ctx,
  ws: DemoWorkspace,
  l: Record<string, unknown>,
  creating: boolean,
): Record<string, string> {
  const f: Record<string, string> = {};
  if (creating || 'quarterKey' in l)
    if (typeof l.quarterKey !== 'string' || !QUARTER_KEY_RE.test(l.quarterKey))
      f.quarterKey = 'Use a quarter like 2027-Q1';
  if (creating || 'fte' in l) if (!isNum(l.fte) || l.fte < 0 || l.fte > 50) f.fte = 'Enter 0–50 FTE';
  if (creating || 'craftId' in l) {
    const craft = c.db.crafts.find((x) => x.id === l.craftId);
    if (!craft) f.craftId = 'Choose a craft';
    else if (craft.archived) f.craftId = 'This craft is archived';
  }
  if (creating || 'projectId' in l)
    if (!ws.projects.some((p) => p.id === l.projectId)) f.projectId = 'Choose a project';
  if ((creating || 'status' in l) && l.status !== undefined && !['Forecast', 'Confirmed'].includes(String(l.status)))
    f.status = 'Choose Forecast or Confirmed';
  return f;
}

function validateAllocation(
  c: Ctx,
  ws: DemoWorkspace,
  a: Record<string, unknown>,
  creating: boolean,
): Record<string, string> {
  const f: Record<string, string> = {};
  if (creating || 'resourceId' in a)
    if (!ws.people.some((p) => p.id === a.resourceId)) f.resourceId = 'Choose a person';
  if (creating || 'projectId' in a)
    if (!ws.projects.some((p) => p.id === a.projectId)) f.projectId = 'Choose a project';
  if (creating || 'percentage' in a)
    if (!isNum(a.percentage) || a.percentage < 0 || a.percentage > MAX_CELL_PCT) f.percentage = 'Enter 0–200';
  if (a.craftId !== undefined && a.craftId !== null && !c.db.crafts.some((x) => x.id === a.craftId))
    f.craftId = 'Unknown craft';
  for (const k of ['startDate', 'endDate'] as const)
    if (a[k] !== undefined && a[k] !== null && !isIsoDate(a[k])) f[k] = 'Enter a date';
  if (isIsoDate(a.startDate) && isIsoDate(a.endDate) && a.endDate < a.startDate)
    f.endDate = 'End date must be on or after the start date';
  if (a.state !== undefined && !['tentative', 'confirmed', 'declined'].includes(String(a.state)))
    f.state = 'Invalid state';
  if (a.source !== undefined && !['manual', 'marketplace', 'planview', 'jira'].includes(String(a.source)))
    f.source = 'Invalid source';
  if (a.id !== undefined && (typeof a.id !== 'string' || !isUuid(a.id))) f.id = 'Must be a UUID';
  return f;
}

function checkClientId(id: unknown): void {
  if (id !== undefined && (typeof id !== 'string' || !isUuid(id))) badRequest({ id: 'Must be a UUID' });
}

/* ── handlers ──────────────────────────────────────────────────────────────────────── */

const auth: Record<string, Handler> = {
  login(c) {
    const b = obj(c.body);
    const email = str(b.email).toLowerCase();
    let user = c.db.users.find((u) => u.email.toLowerCase() === email);
    if (!user && c.acceptAnyPassword) user = c.db.users[0];
    if (!user || (!c.acceptAnyPassword && b.password !== user.password))
      fail(401, 'unauthorized', 'Email or password is incorrect.');
    if (user.twoFactorEnabled) {
      if (!b.otp) return { require2FA: true, email: user.email };
      if (b.otp !== DEMO_OTP) fail(401, 'unauthorized', 'That code is incorrect or expired.');
    }
    c.db.sessionUserId = user.id;
    user.lastSignInAt = c.now;
    audit(c, 'auth.login', { type: 'user', id: user.id });
    return { user: buildMe(c.db, user).user };
  },
  register(c) {
    if (c.db.appMode === 'internal') forbidden('Sign-up is by invitation only.');
    const b = obj(c.body);
    const f: Record<string, string> = {};
    if (!EMAIL_RE.test(str(b.email))) f.email = 'Enter a valid email';
    if (str(b.password).length < 10) f.password = 'Use at least 10 characters';
    if (!str(b.name)) f.name = 'Enter your name';
    if (Object.keys(f).length) badRequest(f);
    if (!c.db.users.some((u) => u.email.toLowerCase() === str(b.email).toLowerCase())) {
      c.db.users.push({
        id: c.newId(),
        email: str(b.email),
        name: str(b.name),
        password: str(b.password),
        isPlatformAdmin: false,
        emailVerified: false,
        twoFactorEnabled: false,
        orgRole: null,
        lastSignInAt: null,
      });
    }
    return { emailVerificationRequired: true };
  },
  logout(c) {
    c.db.sessionUserId = null;
    return undefined;
  },
  refresh(c) {
    requireUser(c);
    return { ok: true };
  },
  session() {
    return fail(401, 'unauthorized', 'Please sign in again.');
  },
  resetSend() {
    return { sent: true };
  },
  resetConfirm(c) {
    const b = obj(c.body);
    if (b.otp !== DEMO_OTP) badRequest({ otp: 'That code is incorrect or expired.' });
    if (str(b.newPassword).length < 10) badRequest({ newPassword: 'Use at least 10 characters' });
    const u = c.db.users.find((x) => x.email.toLowerCase() === str(b.email).toLowerCase());
    if (u) u.password = str(b.newPassword);
    return { success: true };
  },
  twoFactor(c) {
    const u = requireUser(c);
    const b = obj(c.body);
    if (!c.acceptAnyPassword && b.password !== u.password) badRequest({ password: 'Password is incorrect' });
    u.twoFactorEnabled = !!b.enabled;
    audit(c, 'auth.2fa_change', { type: 'user', id: u.id });
    return { ok: true };
  },
  password(c) {
    const u = requireUser(c);
    const b = obj(c.body);
    if (!c.acceptAnyPassword && b.currentPassword !== u.password)
      badRequest({ currentPassword: 'Password is incorrect' });
    if (str(b.newPassword).length < 10) badRequest({ newPassword: 'Use at least 10 characters' });
    u.password = str(b.newPassword);
    return { ok: true };
  },
  verifySend(c) {
    if (!str(obj(c.body).email)) requireUser(c);
    return { sent: true };
  },
  verifyCheck(c) {
    const email = str(obj(c.body).email).toLowerCase();
    const u = (email && c.db.users.find((x) => x.email.toLowerCase() === email)) || requireUser(c);
    if (obj(c.body).code !== DEMO_OTP) badRequest({ code: 'That code is incorrect or expired.' });
    u.emailVerified = true;
    return { verified: true };
  },
  health() {
    return { ok: true, schemaVersion: 'demo', env: { database: false, email: false, jwt: false } };
  },
  me(c) {
    return buildMe(c.db, requireUser(c));
  },
  ai(c) {
    const b = obj(c.body);
    const a = access(c, str(b.wsId));
    if (!resolveFeatures(c.db.org.features).aiAssistant)
      fail(403, 'feature_disabled', 'Ask Tom is turned off for your organisation.');
    need(a, 'ai.use');
    const q = str(b.question);
    if (!q || q.length > 2000) badRequest({ question: 'Ask a question of up to 2,000 characters' });
    const limit = entitlements(c.db).aiQueriesPerMonth;
    if (limit !== null && c.db.aiQueriesThisMonth >= limit)
      fail(429, 'rate_limited', `Your organisation has used this month's ${limit} AI questions.`);
    c.db.aiQueriesThisMonth += 1;
    const s = snapshot(c, a);
    const quarters = rollingQuarterViews(today(), c.db.org.planning.fiscalYearStartMonth);
    const home = buildHome(s, quarters, { kind: 'quarter', key: quarters[0].key }, c.db.org.planning.thresholds, null);
    audit(c, 'ai.query', { type: 'workspace', id: a.ws.workspace.id, workspaceId: a.ws.workspace.id });
    // How-to questions: answer from the product guide entry the question names (the live Tom reads the same guide).
    const lower = q.toLowerCase();
    const page = [...PAGE_GUIDE, ...SHELL_GUIDE].find((g) => lower.includes(g.title.toLowerCase()));
    const term = GLOSSARY.find(([t]) => lower.includes(t.toLowerCase().split(' ')[0]) && lower.includes(t.toLowerCase()));
    if (term) return { answer: `${term[0]}: ${term[1]}` };
    if (page && /\b(how|where|what|can i|do i)\b/.test(lower))
      return { answer: [`${page.title}: ${page.summary}`, ...page.howTo.map((h) => `- ${h}`)].join('\n') };
    return {
      answer:
        `Demo answer. In ${quarters[0].label} the squad is at ${home.kpis.utilisationPct}% of target, ` +
        `${home.kpis.overCount} people are over capacity, ${home.kpis.availableCount} are available and ` +
        `${home.kpis.unstaffedFte} FTE of demand is unstaffed.`,
    };
  },
};

const orgs: Record<string, Handler> = {
  create(c) {
    const u = requireUser(c);
    if (u.orgRole) fail(409, 'conflict', 'You already belong to an organisation.');
    if (!u.emailVerified) forbidden('Verify your email first');
    const b = obj(c.body);
    if (!str(b.name)) badRequest({ name: 'Enter a name' });
    u.orgRole = 'ORG_ADMIN';
    const ws = newWorkspace(c, str(b.workspaceName) || 'PMO');
    c.db.memberships.push({
      userId: u.id,
      workspaceId: ws.workspace.id,
      role: 'WORKSPACE_ADMIN',
      linkedPersonId: null,
    });
    return { org: c.db.org, workspace: ws.workspace };
  },
  get(c) {
    const { perms } = orgPerms(c);
    if (!perms.has('org.view')) forbidden();
    return c.db.org;
  },
  update(c) {
    const { perms } = orgPerms(c);
    if (!perms.has('org.manage')) forbidden();
    const b = obj(c.body);
    checkVersion(c.db.org, b.version);
    const patch = cleanPatch(b.patch);
    delete patch.plan;
    delete patch.slug;
    const f: Record<string, string> = {};
    if ('name' in patch && !str(patch.name)) f.name = 'Enter a name';
    if (patch.logoUrl !== undefined && patch.logoUrl !== null && !/^https:\/\//.test(str(patch.logoUrl)))
      f.logoUrl = 'Use an https:// address';
    if (
      patch.defaultWorkspaceVisibility !== undefined &&
      !['org', 'members'].includes(String(patch.defaultWorkspaceVisibility))
    )
      f.defaultWorkspaceVisibility = 'Choose a visibility';
    if (patch.planning !== undefined) {
      const pl = { ...c.db.org.planning, ...obj(patch.planning) } as D.PlanningSettings;
      if (![1, 4, 7, 10].includes(pl.fiscalYearStartMonth))
        f['planning.fiscalYearStartMonth'] = 'Choose January, April, July or October';
      const msg = validateThresholds(pl.thresholds);
      if (msg) f['planning.thresholds'] = msg;
      if (!isNum(pl.defaultTargetUtil) || pl.defaultTargetUtil < 0 || pl.defaultTargetUtil > 150)
        f['planning.defaultTargetUtil'] = 'Target must be 0–150';
      if (!isNum(pl.sprintLengthDays) || pl.sprintLengthDays < 1 || pl.sprintLengthDays > 60)
        f['planning.sprintLengthDays'] = 'Enter 1–60 days';
      if (!['locked', 'overridable'].includes(pl.planviewOwnership)) f['planning.planviewOwnership'] = 'Choose a rule';
      if (Object.keys(f).length === 0) patch.planning = pl;
    }
    if (patch.features !== undefined)
      patch.features = resolveFeatures({ ...c.db.org.features, ...obj(patch.features) });
    if (Object.keys(f).length) badRequest(f, f['planning.thresholds'] ?? 'Some details need correcting.');
    const before = c.db.org;
    c.db.org = patched(c, c.db.org, patch);
    audit(c, patch.features ? 'org.feature_change' : 'org.update', { type: 'org', id: c.db.org.id }, before, c.db.org);
    return c.db.org;
  },
  createWorkspace(c) {
    const { user, perms } = orgPerms(c);
    if (!perms.has('workspace.manage')) forbidden();
    const name = str(obj(c.body).name);
    if (!name) badRequest({ name: 'Enter a name' });
    if (!withinLimit(entitlements(c.db), 'maxWorkspaces', Object.keys(c.db.workspaces).length + 1))
      fail(
        403,
        'entitlement',
        `Your ${c.db.org.plan} plan allows up to ${entitlements(c.db).maxWorkspaces} workspaces.`,
      );
    const ws = newWorkspace(c, name);
    c.db.memberships.push({
      userId: user.id,
      workspaceId: ws.workspace.id,
      role: 'WORKSPACE_ADMIN',
      linkedPersonId: null,
    });
    audit(c, 'workspace.create', { type: 'workspace', id: ws.workspace.id, workspaceId: ws.workspace.id });
    return ws.workspace;
  },
  renameWorkspace(c) {
    const a = access(c);
    if (!orgPerms(c, c.db.org.id).perms.has('workspace.manage')) forbidden();
    const name = str(obj(c.body).name);
    if (!name) badRequest({ name: 'Enter a name' });
    a.ws.workspace = { ...a.ws.workspace, name };
    audit(c, 'workspace.update', { type: 'workspace', id: a.ws.workspace.id, workspaceId: a.ws.workspace.id });
    return a.ws.workspace;
  },
  deleteWorkspace(c) {
    const a = access(c);
    if (!orgPerms(c, c.db.org.id).perms.has('workspace.manage')) forbidden();
    if (c.query.confirmName !== a.ws.workspace.name) badRequest({ confirmName: 'Type the workspace name to confirm' });
    delete c.db.workspaces[a.ws.workspace.id];
    c.db.memberships = c.db.memberships.filter((m) => m.workspaceId !== a.ws.workspace.id);
    audit(c, 'workspace.delete', { type: 'workspace', id: a.ws.workspace.id });
    return undefined;
  },
  audit(c) {
    const { perms } = orgPerms(c);
    const wsId = c.query.workspaceId;
    if (!perms.has('org.audit.view')) {
      if (!wsId || !access(c, wsId).perms.has('workspace.audit.view')) forbidden();
    }
    const events = c.db.audit.filter(
      (e) =>
        (!wsId || e.workspaceId === wsId) &&
        (!c.query.action || e.action === c.query.action) &&
        (!c.query.from || e.occurredAt >= c.query.from) &&
        (!c.query.to || e.occurredAt <= c.query.to),
    );
    if (c.query.format === 'csv') {
      return toCsv(events, [
        { header: 'occurred_at', value: (e) => e.occurredAt },
        { header: 'actor', value: (e) => e.actor?.name },
        { header: 'action', value: (e) => e.action },
        { header: 'workspace_id', value: (e) => e.workspaceId },
        { header: 'target_type', value: (e) => e.targetType },
        { header: 'target_id', value: (e) => e.targetId },
      ]);
    }
    return { events, next: null };
  },
};

function newWorkspace(c: Ctx, name: string): DemoWorkspace {
  const id = c.newId();
  const ws: DemoWorkspace = {
    workspace: { id, orgId: c.db.org.id, name, dataVersion: 1, createdAt: c.now },
    people: [],
    projects: [],
    allocations: [],
    demand: [],
    offers: [],
    craftRequests: [],
    calibrations: [],
    jiraConfigured: false,
    jiraProjects: [],
    identities: [],
    syncJobs: [],
    deliveryRows: [],
    planviewConfigured: false,
    planviewSource: { projects: [], assignments: [] },
    previews: [],
  };
  c.db.workspaces[id] = ws;
  return ws;
}

type Kind = 'tribes' | 'chapters' | 'teams' | 'crafts';
const KIND_DEFAULTS: Record<Kind, Record<string, unknown>> = {
  tribes: { leadName: null, archived: false },
  chapters: { craftId: null, leadPersonId: null, archived: false },
  teams: { archived: false },
  crafts: { description: null, family: null, archived: false },
};

function structureList(c: Ctx, kind: Kind): Array<D.Versioned & { id: D.ID; name: string; archived: boolean }> {
  return c.db[kind] as unknown as Array<D.Versioned & { id: D.ID; name: string; archived: boolean }>;
}

function validateStructure(c: Ctx, kind: Kind, e: Record<string, unknown>, id: D.ID | null): void {
  const list = structureList(c, kind);
  const f: Record<string, string> = {};
  if ('name' in e || id === null) {
    const name = str(e.name);
    if (!name) f.name = 'Enter a name';
    else if (list.some((x) => x.id !== id && x.name.trim().toLowerCase() === name.toLowerCase())) {
      fail(409, 'conflict', 'Already exists', { fields: { name: 'Already exists' } });
    }
  }
  if (kind === 'crafts' && ('short' in e || id === null)) {
    const short = str(e.short);
    if (!/^[A-Z0-9]{2,4}$/.test(short)) f.short = 'Use 2–4 capital letters or digits';
    else if (c.db.crafts.some((x) => x.id !== id && x.short === short)) f.short = 'Already used by another craft';
  }
  if (kind === 'chapters' && e.craftId && !c.db.crafts.some((x) => x.id === e.craftId)) f.craftId = 'Unknown craft';
  if (Object.keys(f).length) badRequest(f);
}

function usageCount(c: Ctx, kind: Kind, id: D.ID): number {
  let n = 0;
  for (const ws of Object.values(c.db.workspaces)) {
    if (kind === 'crafts') {
      n += ws.people.filter((p) => p.primaryCraft === id || p.secondaryCrafts.some((s) => s.craftId === id)).length;
      n += ws.demand.filter((l) => l.craftId === id).length + ws.allocations.filter((a) => a.craftId === id).length;
    } else if (kind === 'tribes') {
      n += ws.projects.filter((p) => p.tribeId === id).length;
      n += ws.people.filter((p) => p.homeTribeId === id || p.tribeAffinity.includes(id)).length;
    } else if (kind === 'chapters') n += ws.people.filter((p) => p.chapterId === id).length;
    else n += ws.people.filter((p) => p.teamId === id).length;
  }
  if (kind === 'crafts') n += c.db.chapters.filter((ch) => ch.craftId === id).length;
  return n;
}

const structure: Record<string, Handler> = {
  list(c) {
    const { perms } = orgPerms(c);
    if (!perms.has('org.view')) forbidden();
    return c.db[c.params.kind as Kind];
  },
  create(c) {
    const kind = c.params.kind as Kind;
    const { perms } = orgPerms(c);
    if (!perms.has('structure.write')) forbidden();
    const e = cleanPatch(c.body);
    const rawId = obj(c.body).id;
    validateStructure(c, kind, e, null);
    const list = structureList(c, kind);
    let id = typeof rawId === 'string' && rawId ? rawId : c.newId();
    if (kind === 'crafts' && !rawId)
      id =
        str(e.name)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '') || id;
    if (list.some((x) => x.id === id)) fail(409, 'conflict', 'Already exists', { fields: { id: 'Already exists' } });
    const entity = {
      ...KIND_DEFAULTS[kind],
      ...(kind === 'crafts' ? { sortOrder: list.length } : {}),
      ...e,
      name: str(e.name),
      id,
      version: 1,
      updatedAt: c.now,
      updatedBy: userRef(currentUser(c)),
    };
    list.push(entity as never);
    audit(c, `${kind.slice(0, -1)}.create`, { type: kind.slice(0, -1), id });
    Object.values(c.db.workspaces).forEach(touch);
    return entity;
  },
  update(c) {
    const kind = c.params.kind as Kind;
    const { perms } = orgPerms(c);
    if (!perms.has('structure.write')) forbidden();
    const list = structureList(c, kind);
    const i = list.findIndex((x) => x.id === c.params.id);
    if (i < 0) notFound(kind.slice(0, -1));
    const b = obj(c.body);
    checkVersion(list[i], b.version);
    const patch = cleanPatch(b.patch);
    validateStructure(c, kind, patch, list[i].id);
    const before = list[i];
    list[i] = patched(c, list[i], patch);
    audit(c, `${kind.slice(0, -1)}.update`, { type: kind.slice(0, -1), id: before.id }, before, list[i]);
    Object.values(c.db.workspaces).forEach(touch);
    return list[i];
  },
  remove(c) {
    const kind = c.params.kind as Kind;
    const { perms } = orgPerms(c);
    if (!perms.has('structure.write')) forbidden();
    const list = structureList(c, kind);
    const i = list.findIndex((x) => x.id === c.params.id);
    if (i < 0) notFound(kind.slice(0, -1));
    if (c.query.version !== undefined) checkVersion(list[i], Number(c.query.version));
    const n = usageCount(c, kind, list[i].id);
    if (n > 0) fail(409, 'conflict', `In use by ${n} records. Archive it instead.`);
    const [gone] = list.splice(i, 1);
    audit(c, `${kind.slice(0, -1)}.delete`, { type: kind.slice(0, -1), id: gone.id }, gone, null);
    return undefined;
  },
};

function memberDto(c: Ctx, u: DemoUser): MemberDTO {
  const ms = c.db.memberships.filter((m) => m.userId === u.id);
  return {
    userId: u.id,
    name: u.name,
    email: u.email,
    orgRole: u.orgRole ?? 'MEMBER',
    workspaces: ms.map((m) => ({ workspaceId: m.workspaceId, role: m.role })),
    linkedPersonIds: ms.map((m) => m.linkedPersonId).filter((x): x is string => !!x),
    lastSignInAt: u.lastSignInAt,
  };
}

function adminWorkspaces(c: Ctx, user: DemoUser): Set<D.ID> {
  return new Set(
    Object.keys(c.db.workspaces).filter((id) => {
      const r = workspaceRoleFor(c.db, user, id);
      return r && permsFor(user, r.role).has('workspace.members.manage');
    }),
  );
}

const members: Record<string, Handler> = {
  list(c) {
    const { user, perms } = orgPerms(c);
    const inOrg = c.db.users.filter((u) => u.orgRole);
    if (perms.has('org.members.manage')) return inOrg.map((u) => memberDto(c, u));
    const mine = adminWorkspaces(c, user);
    if (mine.size === 0) forbidden();
    return inOrg
      .filter((u) => c.db.memberships.some((m) => m.userId === u.id && mine.has(m.workspaceId)))
      .map((u) => {
        const m = memberDto(c, u);
        return { ...m, workspaces: m.workspaces.filter((w) => mine.has(w.workspaceId)) };
      });
  },
  update(c) {
    const { user, perms } = orgPerms(c);
    const target = c.db.users.find((u) => u.id === c.params.userId && u.orgRole);
    if (!target) notFound('Member');
    const b = obj(c.body);
    if ('plan' in b) badRequest({ plan: 'Plan is managed by billing.' });
    if ('isPlatformAdmin' in b || (b as { role?: unknown }).role === 'SUPERUSER') badRequest({ role: 'Not allowed' });
    const p = b as MemberPatch;
    const mine = adminWorkspaces(c, user);
    if (!perms.has('org.members.manage')) {
      if (p.orgRole !== undefined) forbidden('Only an Org Admin can change organisation roles.');
      if ((p.workspaces ?? []).some((w) => !mine.has(w.workspaceId))) forbidden();
    }
    if (p.orgRole && p.orgRole !== target.orgRole) {
      if (
        target.orgRole === 'ORG_ADMIN' &&
        p.orgRole !== 'ORG_ADMIN' &&
        c.db.users.filter((u) => u.orgRole === 'ORG_ADMIN').length <= 1
      )
        fail(409, 'conflict', 'An organisation needs at least one Org Admin.');
      target.orgRole = p.orgRole;
    }
    for (const w of p.workspaces ?? []) {
      if (!c.db.workspaces[w.workspaceId]) badRequest({ workspaces: 'Unknown workspace' });
      const i = c.db.memberships.findIndex((m) => m.userId === target.id && m.workspaceId === w.workspaceId);
      if (w.role === null) {
        if (i >= 0) c.db.memberships.splice(i, 1);
      } else if (i >= 0) c.db.memberships[i] = { ...c.db.memberships[i], role: w.role };
      else c.db.memberships.push({ userId: target.id, workspaceId: w.workspaceId, role: w.role, linkedPersonId: null });
    }
    audit(c, 'role.change', { type: 'user', id: target.id });
    return memberDto(c, target);
  },
  remove(c) {
    const { perms } = orgPerms(c);
    if (!perms.has('org.members.manage')) forbidden();
    const target = c.db.users.find((u) => u.id === c.params.userId && u.orgRole);
    if (!target) notFound('Member');
    if (target.orgRole === 'ORG_ADMIN' && c.db.users.filter((u) => u.orgRole === 'ORG_ADMIN').length <= 1)
      fail(409, 'conflict', 'An organisation needs at least one Org Admin.');
    target.orgRole = null;
    c.db.memberships = c.db.memberships.filter((m) => m.userId !== target.id);
    if (c.db.sessionUserId === target.id) c.db.sessionUserId = null;
    audit(c, 'member.remove', { type: 'user', id: target.id });
    return undefined;
  },
  setWorkspaceRole(c) {
    const a = access(c);
    need(a, 'workspace.members.manage');
    const role = obj(c.body).role as D.WorkspaceRole;
    if (!['WORKSPACE_ADMIN', 'PLANNER', 'CONTRIBUTOR', 'VIEWER'].includes(role)) badRequest({ role: 'Choose a role' });
    const target = c.db.users.find((u) => u.id === c.params.userId && u.orgRole);
    if (!target) notFound('Member');
    const i = c.db.memberships.findIndex((m) => m.userId === target.id && m.workspaceId === a.ws.workspace.id);
    if (i >= 0) c.db.memberships[i] = { ...c.db.memberships[i], role };
    else c.db.memberships.push({ userId: target.id, workspaceId: a.ws.workspace.id, role, linkedPersonId: null });
    audit(c, 'role.change', { type: 'user', id: target.id, workspaceId: a.ws.workspace.id });
    return memberDto(c, target);
  },
  removeFromWorkspace(c) {
    const a = access(c);
    need(a, 'workspace.members.manage');
    c.db.memberships = c.db.memberships.filter(
      (m) => !(m.userId === c.params.userId && m.workspaceId === a.ws.workspace.id),
    );
    audit(c, 'member.remove', { type: 'user', id: c.params.userId, workspaceId: a.ws.workspace.id });
    return undefined;
  },
};

const invitations: Record<string, Handler> = {
  create(c) {
    const { user, perms } = orgPerms(c);
    const b = obj(c.body);
    if ('isPlatformAdmin' in b || b.role === 'SUPERUSER') badRequest({ role: 'Not allowed' });
    if (b.orgId !== undefined && b.orgId !== c.params.orgId) forbidden();
    const r = b as unknown as InvitationRequest;
    if (!EMAIL_RE.test(str(r.email))) badRequest({ email: 'Enter a valid email' });
    const mine = adminWorkspaces(c, user);
    if (!perms.has('org.members.manage')) {
      if (mine.size === 0) forbidden();
      if (r.orgRole === 'ORG_ADMIN') forbidden('Only an Org Admin can invite Org Admins.');
      if ((r.workspaces ?? []).some((w) => !mine.has(w.workspaceId))) forbidden();
    }
    for (const w of r.workspaces ?? [])
      if (!c.db.workspaces[w.workspaceId]) badRequest({ workspaces: 'Unknown workspace' });
    const existing = c.db.users.find((u) => u.email.toLowerCase() === str(r.email).toLowerCase());
    if (existing && existing.orgRole) {
      for (const w of r.workspaces ?? []) {
        const i = c.db.memberships.findIndex((m) => m.userId === existing.id && m.workspaceId === w.workspaceId);
        if (i >= 0) c.db.memberships[i] = { ...c.db.memberships[i], role: w.role };
        else
          c.db.memberships.push({
            userId: existing.id,
            workspaceId: w.workspaceId,
            role: w.role,
            linkedPersonId: null,
          });
      }
    }
    const inv = {
      id: c.newId(),
      token: c.newId().replace(/-/g, ''),
      email: str(r.email),
      orgRole: perms.has('org.members.manage') ? (r.orgRole ?? 'MEMBER') : 'MEMBER',
      workspaces: r.workspaces ?? [],
      invitedBy: user.id,
      expiresAt: new Date(Date.parse(c.now) + 7 * 86_400_000).toISOString(),
      acceptedAt: existing?.orgRole ? c.now : null,
      revokedAt: null,
    };
    c.db.invitations.push(inv);
    audit(c, 'member.invite', { type: 'invitation', id: inv.id });
    return {
      invitation: { id: inv.id, email: inv.email, expiresAt: inv.expiresAt },
      inviteUrl: `/invite/${inv.token}`,
      emailSent: false,
    };
  },
  list(c) {
    const { perms, user } = orgPerms(c);
    if (!perms.has('org.members.manage') && adminWorkspaces(c, user).size === 0) forbidden();
    return c.db.invitations
      .filter((i) => !i.acceptedAt && !i.revokedAt)
      .map((i) => ({ id: i.id, email: i.email, expiresAt: i.expiresAt, orgRole: i.orgRole, workspaces: i.workspaces }));
  },
  revoke(c) {
    const { perms, user } = orgPerms(c);
    if (!perms.has('org.members.manage') && adminWorkspaces(c, user).size === 0) forbidden();
    const inv = c.db.invitations.find((i) => i.id === c.params.id);
    if (!inv) notFound('Invitation');
    inv.revokedAt = c.now;
    audit(c, 'member.invite_revoke', { type: 'invitation', id: inv.id });
    return undefined;
  },
  lookup(c) {
    const inv = c.db.invitations.find((i) => i.token === c.params.token);
    if (!inv) notFound('Invitation');
    if (inv.acceptedAt || inv.revokedAt || inv.expiresAt < c.now)
      fail(410, 'gone', 'This invitation link has expired or was already used. Ask your admin for a new one.');
    return {
      email: inv.email,
      orgName: c.db.org.name,
      workspaces: inv.workspaces.map((w) => ({
        id: w.workspaceId,
        name: c.db.workspaces[w.workspaceId]?.workspace.name ?? '',
        role: w.role,
      })),
      expiresAt: inv.expiresAt,
      existingUser: c.db.users.some((u) => u.email.toLowerCase() === inv.email.toLowerCase()),
    };
  },
  accept(c) {
    invitations.lookup(c);
    const inv = c.db.invitations.find((i) => i.token === c.params.token)!;
    const b = obj(c.body);
    let u = c.db.users.find((x) => x.email.toLowerCase() === inv.email.toLowerCase());
    if (!u) {
      const f: Record<string, string> = {};
      if (!str(b.name)) f.name = 'Enter your name';
      if (str(b.password).length < 10) f.password = 'Use at least 10 characters';
      if (Object.keys(f).length) badRequest(f);
      u = {
        id: c.newId(),
        email: inv.email,
        name: str(b.name),
        password: str(b.password),
        isPlatformAdmin: false,
        emailVerified: true,
        twoFactorEnabled: false,
        orgRole: null,
        lastSignInAt: c.now,
      };
      c.db.users.push(u);
    }
    u.orgRole = u.orgRole === 'ORG_ADMIN' ? 'ORG_ADMIN' : inv.orgRole;
    for (const w of inv.workspaces) {
      if (!c.db.memberships.some((m) => m.userId === u.id && m.workspaceId === w.workspaceId))
        c.db.memberships.push({ userId: u.id, workspaceId: w.workspaceId, role: w.role, linkedPersonId: null });
    }
    inv.acceptedAt = c.now;
    c.db.sessionUserId = u.id;
    audit(c, 'member.invite_accept', { type: 'invitation', id: inv.id });
    return { user: buildMe(c.db, u).user };
  },
};

/* ── workspace data ────────────────────────────────────────────────────────────────── */

function findIn<T extends { id: D.ID }>(list: T[], id: D.ID, what: string): number {
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) notFound(what);
  return i;
}

function newPerson(c: Ctx, p: NewPerson): D.PersonDTO {
  return {
    email: null,
    role: '',
    type: 'Permanent',
    department: '',
    location: null,
    totalCapacity: 100,
    dailyRate: null,
    teamId: null,
    chapterId: null,
    homeTribeId: null,
    linkedUserId: null,
    primaryCraft: null,
    secondaryCrafts: [],
    tribeAffinity: [],
    skills: [],
    targetUtil: c.db.org.planning.defaultTargetUtil,
    ...(cleanPatch(p) as Partial<D.PersonDTO>),
    name: str(p.name),
    id: p.id ?? c.newId(),
    version: 1,
    updatedAt: c.now,
    updatedBy: userRef(currentUser(c)),
  };
}

const workspace: Record<string, Handler> = {
  snapshot(c) {
    const a = access(c);
    need(a, 'data.read');
    return snapshot(c, a);
  },
  sampleData(c) {
    const a = access(c);
    need(a, 'people.write');
    if (a.ws.people.length || a.ws.projects.length) fail(409, 'conflict', 'This workspace already has data.');
    Object.assign(a.ws, seedWorkspaceData(c.db.tribes, c.newId));
    touch(a.ws);
    audit(c, 'workspace.sample_data', { type: 'workspace', id: a.ws.workspace.id, workspaceId: a.ws.workspace.id });
    return snapshot(c, a);
  },
  exportAudit(c) {
    const a = access(c);
    need(a, 'export');
    const b = obj(c.body);
    if (!['pdf', 'csv'].includes(String(b.kind))) badRequest({ kind: 'Choose pdf or csv' });
    audit(c, `export.${b.kind}`, { type: 'report', id: str(b.report) || null, workspaceId: a.ws.workspace.id });
    return undefined;
  },
};

const people: Record<string, Handler> = {
  create(c) {
    const a = access(c);
    need(a, 'people.write');
    const p = obj(c.body);
    checkClientId(p.id);
    validatePerson(c, p, true);
    if (!withinLimit(entitlements(c.db), 'maxPeople', a.ws.people.length + 1))
      fail(403, 'entitlement', `Your ${c.db.org.plan} plan allows up to ${entitlements(c.db).maxPeople} people.`);
    const person = newPerson(c, p as NewPerson);
    a.ws.people.push(person);
    touch(a.ws);
    audit(c, 'person.create', { type: 'person', id: person.id, workspaceId: a.ws.workspace.id }, null, person);
    return person;
  },
  update(c) {
    const a = access(c);
    needOwnOr(a, 'people.write', 'people.write.own', c.params.id);
    const i = findIn(a.ws.people, c.params.id, 'Person');
    const b = obj(c.body);
    checkVersion(a.ws.people[i], b.version);
    const patch = cleanPatch(b.patch);
    if (!a.perms.has('people.write')) {
      // Squad members change their own below-the-table crafts through craft change requests (PPL-06).
      const allowed = ['location', 'skills'];
      if (Object.keys(patch).some((k) => !allowed.includes(k))) forbidden();
    }
    validatePerson(
      c,
      { ...patch, primaryCraft: 'primaryCraft' in patch ? patch.primaryCraft : a.ws.people[i].primaryCraft },
      false,
    );
    const before = a.ws.people[i];
    a.ws.people[i] = patched(c, before, patch);
    touch(a.ws);
    audit(
      c,
      'person.update',
      { type: 'person', id: before.id, workspaceId: a.ws.workspace.id },
      before,
      a.ws.people[i],
    );
    return a.ws.people[i];
  },
  remove(c) {
    const a = access(c);
    need(a, 'people.write');
    const i = findIn(a.ws.people, c.params.id, 'Person');
    if (c.query.version !== undefined) checkVersion(a.ws.people[i], Number(c.query.version));
    const [gone] = a.ws.people.splice(i, 1);
    a.ws.allocations = a.ws.allocations.filter((x) => x.resourceId !== gone.id);
    a.ws.offers = a.ws.offers.filter((x) => x.personId !== gone.id);
    a.ws.craftRequests = a.ws.craftRequests.filter((x) => x.personId !== gone.id);
    touch(a.ws);
    audit(c, 'person.delete', { type: 'person', id: gone.id, workspaceId: a.ws.workspace.id }, gone, null);
    return undefined;
  },
  bulk(c) {
    const a = access(c);
    need(a, 'people.write');
    const r = obj(c.body) as unknown as PeopleBulkRequest;
    if (!Array.isArray(r.ids) || r.ids.length === 0) badRequest({ ids: 'Select people' });
    const stale: Record<string, string> = {};
    for (const id of r.ids) {
      const p = a.ws.people.find((x) => x.id === id);
      if (!p) notFound('Person');
      if (r.versions?.[id] !== p.version) stale[id] = 'Changed since you loaded the page';
    }
    if (Object.keys(stale).length) {
      const n = Object.keys(stale).length;
      fail(
        409,
        'conflict',
        `${n} ${n === 1 ? 'person' : 'people'} changed since you loaded the page. Reload and try again.`,
        { fields: stale },
      );
    }
    const { addSecondaryCraft, ...fields } = obj(r.patch) as PeopleBulkRequest['patch'];
    validatePerson(c, fields, false);
    if (addSecondaryCraft) {
      const f: Record<string, string> = {};
      validateSecondary(c, [addSecondaryCraft], null, f);
      if (Object.keys(f).length) badRequest(f);
    }
    const out: D.PersonDTO[] = [];
    a.ws.people = a.ws.people.map((p) => {
      if (!r.ids.includes(p.id)) return p;
      const secondaryCrafts =
        addSecondaryCraft && addSecondaryCraft.craftId !== p.primaryCraft
          ? [...p.secondaryCrafts.filter((s) => s.craftId !== addSecondaryCraft.craftId), addSecondaryCraft]
          : p.secondaryCrafts;
      const next = patched(c, p, { ...fields, secondaryCrafts });
      out.push(next);
      return next;
    });
    touch(a.ws);
    audit(c, 'person.bulk_update', { type: 'person', id: null, workspaceId: a.ws.workspace.id }, null, {
      ids: r.ids,
      patch: r.patch,
    });
    return { people: out };
  },
  import(c) {
    const a = access(c);
    need(a, 'import.csv');
    if (!entitled(entitlements(c.db), 'csvImport'))
      fail(403, 'entitlement', `Your ${c.db.org.plan} plan doesn't include CSV import.`);
    const r = obj(c.body) as unknown as PeopleImportRequest;
    const res: PeopleImportResponse = { created: 0, updated: 0, skipped: 0, errors: [] };
    const byName = <T extends { name: string }>(list: T[], name: string | undefined) =>
      name ? list.find((x) => x.name.trim().toLowerCase() === name.trim().toLowerCase()) : undefined;
    const ensure = (kind: 'chapters' | 'teams' | 'tribes', name: string | undefined): D.ID | null | undefined => {
      if (!name) return undefined;
      const found = byName(c.db[kind] as Array<{ id: D.ID; name: string }>, name);
      if (found) return found.id;
      if (!r.createMissingStructure) return null;
      const id = c.newId();
      const base = {
        id,
        name: name.trim(),
        archived: false,
        version: 1,
        updatedAt: c.now,
        updatedBy: userRef(currentUser(c)),
      };
      if (kind === 'chapters') c.db.chapters.push({ ...base, craftId: null, leadPersonId: null });
      else if (kind === 'teams') c.db.teams.push(base);
      else c.db.tribes.push({ ...base, leadName: null });
      return id;
    };
    (r.rows ?? []).forEach((row, i) => {
      const n = i + 1;
      if (!str(row.name)) {
        res.errors.push({ row: n, message: 'Name is required' });
        res.skipped++;
        return;
      }
      // The same catalogue rule as the API (shared/peopleImport, QA-005): id or short code, any case.
      const aboveRef = str(row.aboveCraft);
      const craftId = resolveCraftRef(c.db.crafts, aboveRef);
      const badBelow = (row.belowCrafts ?? []).find((b) => !resolveCraftRef(c.db.crafts, b?.craftId));
      if ((aboveRef && !craftId) || badBelow) {
        res.errors.push({ row: n, message: unknownCraftMessage(aboveRef && !craftId ? aboveRef : badBelow!.craftId) });
        res.skipped++;
        return;
      }
      const belowCrafts = row.belowCrafts?.map((b) => ({ ...b, craftId: resolveCraftRef(c.db.crafts, b.craftId)! }));
      const craft = craftId ? { id: craftId } : undefined;
      const chapterId = ensure('chapters', row.chapter);
      const teamId = ensure('teams', row.team);
      const homeTribeId = ensure('tribes', row.homeTribe);
      const missing = [
        chapterId === null && `chapter '${row.chapter}'`,
        teamId === null && `team '${row.team}'`,
        homeTribeId === null && `tribe '${row.homeTribe}'`,
      ].filter(Boolean);
      if (missing.length) {
        res.errors.push({ row: n, message: `Unknown ${missing.join(', ')}` });
        res.skipped++;
        return;
      }
      const fields: Partial<D.PersonDTO> = {
        name: str(row.name),
        ...(row.email !== undefined && { email: row.email || null }),
        ...(row.jobTitle !== undefined && { role: row.jobTitle }),
        ...(row.type !== undefined && { type: row.type }),
        ...(row.location !== undefined && { location: row.location }),
        ...(chapterId && { chapterId }),
        ...(teamId && { teamId }),
        ...(homeTribeId && { homeTribeId }),
        ...(row.targetPct !== undefined && { targetUtil: row.targetPct }),
        ...(craft && { primaryCraft: craft.id }),
        ...(belowCrafts !== undefined && { secondaryCrafts: belowCrafts }),
        ...(row.skills !== undefined && { skills: row.skills }),
      };
      try {
        validatePerson(c, fields as Record<string, unknown>, true);
      } catch (e) {
        res.errors.push({
          row: n,
          message: Object.values((e as { fields?: Record<string, string> }).fields ?? {}).join('; ') || 'Invalid row',
        });
        res.skipped++;
        return;
      }
      const match =
        (row.email && a.ws.people.find((p) => p.email?.toLowerCase() === row.email!.toLowerCase())) ||
        a.ws.people.find((p) => p.name.toLowerCase() === str(row.name).toLowerCase());
      if (match) {
        a.ws.people = a.ws.people.map((p) => (p === match ? patched(c, p, fields) : p));
        res.updated++;
      } else {
        if (!withinLimit(entitlements(c.db), 'maxPeople', a.ws.people.length + 1)) {
          res.errors.push({ row: n, message: `Your plan allows up to ${entitlements(c.db).maxPeople} people.` });
          res.skipped++;
          return;
        }
        a.ws.people.push(newPerson(c, { ...fields, name: str(row.name) }));
        res.created++;
      }
    });
    touch(a.ws);
    audit(c, 'person.import', { type: 'person', id: null, workspaceId: a.ws.workspace.id }, null, res);
    return res;
  },
  requestCraftChange(c) {
    const a = access(c);
    needOwnOr(a, 'people.write', 'people.write.own', c.params.id);
    const person = a.ws.people[findIn(a.ws.people, c.params.id, 'Person')];
    const b = obj(c.body);
    if ('primaryCraft' in b || 'targetUtil' in b)
      badRequest({ secondaryCrafts: 'Only below-the-table crafts can be changed here' });
    if (!Array.isArray(b.secondaryCrafts)) badRequest({ secondaryCrafts: 'Required' });
    const f: Record<string, string> = {};
    validateSecondary(c, b.secondaryCrafts as D.SecondaryCraftDTO[], person.primaryCraft, f);
    if (Object.keys(f).length) badRequest(f);
    const user = requireUser(c);
    const existing = a.ws.craftRequests.find((r) => r.personId === person.id && r.status === 'pending');
    const req: D.CraftChangeRequestDTO = {
      id: existing?.id ?? c.newId(),
      personId: person.id,
      current: person.secondaryCrafts,
      proposed: b.secondaryCrafts as D.SecondaryCraftDTO[],
      status: 'pending',
      submittedBy: { id: user.id, name: user.name },
      submittedAt: c.now,
      decidedBy: null,
      decidedAt: null,
      reason: null,
    };
    a.ws.craftRequests = [...a.ws.craftRequests.filter((r) => r.id !== req.id), req];
    touch(a.ws);
    audit(c, 'craft.request', { type: 'person', id: person.id, workspaceId: a.ws.workspace.id }, null, req);
    return req;
  },
  listCraftRequests(c) {
    const a = access(c);
    need(a, 'data.read');
    return snapshot(c, a).craftRequests;
  },
  decideCraftRequest(c) {
    const a = access(c);
    need(a, 'craftProfile.approve');
    const i = findIn(a.ws.craftRequests, c.params.id, 'Request');
    const cur = a.ws.craftRequests[i];
    if (cur.status !== 'pending') fail(409, 'conflict', 'This request was already decided.');
    const reason = str(obj(c.body).reason) || null;
    const approve = c.params.decision === 'approve';
    if (!approve && !reason) badRequest({ reason: 'Give a reason' });
    const user = requireUser(c);
    const next: D.CraftChangeRequestDTO = {
      ...cur,
      status: approve ? 'approved' : 'rejected',
      decidedBy: { id: user.id, name: user.name },
      decidedAt: c.now,
      reason,
    };
    a.ws.craftRequests[i] = next;
    if (approve) {
      const pi = a.ws.people.findIndex((p) => p.id === cur.personId);
      if (pi >= 0) a.ws.people[pi] = patched(c, a.ws.people[pi], { secondaryCrafts: cur.proposed });
    }
    touch(a.ws);
    audit(
      c,
      approve ? 'craft.approve' : 'craft.reject',
      { type: 'person', id: cur.personId, workspaceId: a.ws.workspace.id },
      cur,
      next,
    );
    return next;
  },
};

const projects: Record<string, Handler> = {
  create(c) {
    const a = access(c);
    need(a, 'projects.write');
    const p = obj(c.body);
    checkClientId(p.id);
    validateProject(c, p, true);
    if (!withinLimit(entitlements(c.db), 'maxProjects', a.ws.projects.length + 1))
      fail(403, 'entitlement', `Your ${c.db.org.plan} plan allows up to ${entitlements(c.db).maxProjects} projects.`);
    const project: D.ProjectDTO = {
      status: 'Planning',
      priority: 'Medium',
      description: '',
      startDate: null,
      endDate: null,
      budget: null,
      tribeId: null,
      stage: null,
      initiatedOn: null,
      ownerUserId: null,
      jiraKey: null,
      planviewId: null,
      source: 'manual',
      ...(cleanPatch(p) as Partial<D.ProjectDTO>),
      name: str(p.name),
      id: (p as NewProject).id ?? c.newId(),
      version: 1,
      updatedAt: c.now,
      updatedBy: userRef(currentUser(c)),
    };
    a.ws.projects.push(project);
    touch(a.ws);
    audit(c, 'project.create', { type: 'project', id: project.id, workspaceId: a.ws.workspace.id }, null, project);
    return project;
  },
  update(c) {
    const a = access(c);
    need(a, 'projects.write');
    const i = findIn(a.ws.projects, c.params.id, 'Project');
    const b = obj(c.body);
    checkVersion(a.ws.projects[i], b.version);
    const patch = cleanPatch(b.patch);
    validateProject(c, patch, false);
    const before = a.ws.projects[i];
    a.ws.projects[i] = patched(c, before, patch);
    touch(a.ws);
    audit(
      c,
      'project.update',
      { type: 'project', id: before.id, workspaceId: a.ws.workspace.id },
      before,
      a.ws.projects[i],
    );
    return a.ws.projects[i];
  },
  remove(c) {
    const a = access(c);
    need(a, 'projects.write');
    const i = findIn(a.ws.projects, c.params.id, 'Project');
    if (c.query.version !== undefined) checkVersion(a.ws.projects[i], Number(c.query.version));
    const [gone] = a.ws.projects.splice(i, 1);
    a.ws.allocations = a.ws.allocations.filter((x) => x.projectId !== gone.id);
    a.ws.demand = a.ws.demand.filter((x) => x.projectId !== gone.id);
    touch(a.ws);
    audit(c, 'project.delete', { type: 'project', id: gone.id, workspaceId: a.ws.workspace.id }, gone, null);
    return undefined;
  },
};

function createDemandLine(c: Ctx, ws: DemoWorkspace, l: NewDemandLine): D.DemandLineDTO {
  const f = validateDemand(c, ws, l as unknown as Record<string, unknown>, true);
  if (Object.keys(f).length) badRequest(f);
  if (ws.demand.some((x) => x.projectId === l.projectId && x.quarterKey === l.quarterKey && x.craftId === l.craftId))
    fail(409, 'conflict', 'Already captured for this quarter', {
      fields: { craftId: 'Already captured for this quarter' },
    });
  const project = ws.projects.find((p) => p.id === l.projectId);
  return {
    status: project?.stage === 'In Flight' || project?.stage === 'Mobilising' ? 'Confirmed' : 'Forecast',
    ownerUserId: null,
    note: null,
    ...(cleanPatch(l) as Partial<D.DemandLineDTO>),
    projectId: l.projectId,
    quarterKey: l.quarterKey,
    craftId: l.craftId,
    fte: l.fte,
    id: l.id ?? c.newId(),
    createdAt: c.now,
    version: 1,
    updatedAt: c.now,
    updatedBy: userRef(currentUser(c)),
  };
}

const demand: Record<string, Handler> = {
  create(c) {
    const a = access(c);
    need(a, 'demand.write');
    checkClientId(obj(c.body).id);
    const line = createDemandLine(c, a.ws, obj(c.body) as unknown as NewDemandLine);
    a.ws.demand.push(line);
    touch(a.ws);
    audit(c, 'demand.create', { type: 'demand', id: line.id, workspaceId: a.ws.workspace.id }, null, line);
    return line;
  },
  update(c) {
    const a = access(c);
    need(a, 'demand.write');
    const i = findIn(a.ws.demand, c.params.id, 'Demand line');
    const b = obj(c.body);
    checkVersion(a.ws.demand[i], b.version);
    const patch = cleanPatch(b.patch);
    const f = validateDemand(c, a.ws, patch, false);
    if (Object.keys(f).length) badRequest(f);
    const before = a.ws.demand[i];
    a.ws.demand[i] = patched(c, before, patch);
    touch(a.ws);
    audit(
      c,
      'demand.update',
      { type: 'demand', id: before.id, workspaceId: a.ws.workspace.id },
      before,
      a.ws.demand[i],
    );
    return a.ws.demand[i];
  },
  remove(c) {
    const a = access(c);
    need(a, 'demand.write');
    const i = findIn(a.ws.demand, c.params.id, 'Demand line');
    if (c.query.version !== undefined) checkVersion(a.ws.demand[i], Number(c.query.version));
    const [gone] = a.ws.demand.splice(i, 1);
    touch(a.ws);
    audit(c, 'demand.delete', { type: 'demand', id: gone.id, workspaceId: a.ws.workspace.id }, gone, null);
    return undefined;
  },
  batch(c) {
    const a = access(c);
    need(a, 'demand.write');
    const ops = (obj(c.body).ops ?? []) as DemandOp[];
    if (!Array.isArray(ops)) badRequest({ ops: 'Required' });
    if (ops.length > MAX_BATCH_OPS)
      fail(413, 'payload_too_large', `A batch can hold at most ${MAX_BATCH_OPS} operations.`);
    const upserted: D.DemandLineDTO[] = [];
    const deleted: D.ID[] = [];
    ops.forEach((op, i) => {
      try {
        if (op.op === 'create') {
          const line = createDemandLine(c, a.ws, op.line);
          a.ws.demand.push(line);
          upserted.push(line);
        } else {
          const j = findIn(a.ws.demand, op.id, 'Demand line');
          checkVersion(a.ws.demand[j], op.version);
          if (op.op === 'delete') {
            a.ws.demand.splice(j, 1);
            deleted.push(op.id);
          } else {
            const patch = cleanPatch(op.patch);
            const f = validateDemand(c, a.ws, patch, false);
            if (Object.keys(f).length) badRequest(f);
            a.ws.demand[j] = patched(c, a.ws.demand[j], patch);
            upserted.push(a.ws.demand[j]);
          }
        }
      } catch (e) {
        throw withOpIndex(e, i);
      }
    });
    touch(a.ws);
    audit(c, 'demand.batch', { type: 'demand', id: null, workspaceId: a.ws.workspace.id }, null, { ops: ops.length });
    return { upserted, deleted };
  },
};

/** Re-throws an op error with the failing op index in `fields` (PL-04#AC4). */
function withOpIndex(e: unknown, i: number): unknown {
  const err = e as {
    status?: number;
    code?: string;
    message?: string;
    fields?: Record<string, string>;
    body?: unknown;
  };
  if (!err || typeof err.status !== 'number') return e;
  const body = (err.body && typeof err.body === 'object' ? err.body : {}) as ApiError;
  const fields = { [`ops.${i}`]: err.message ?? 'Invalid operation', ...(err.fields ?? {}) };
  return errorFromResponse(err.status, {
    ...body,
    error: err.message ?? 'Invalid operation',
    code: (err.code ?? 'bad_request') as ApiError['code'],
    fields,
  });
}

/** Shared by single and batch writes: validates every op first, then applies all (atomic). */
function allocationBatch(c: Ctx, a: WsAccess, single: boolean): unknown {
  const b = obj(c.body);
  const ops = b.ops as AllocationOp[];
  if (!Array.isArray(ops)) badRequest({ ops: 'Required' });
  if (ops.length > MAX_BATCH_OPS)
    fail(413, 'payload_too_large', `A batch can hold at most ${MAX_BATCH_OPS} operations.`);
  const overridable = c.db.org.planning.planviewOwnership === 'overridable';
  const prepared: AllocationOp[] = ops.map((op, i) => {
    try {
      if (op.op === 'create') {
        const f = validateAllocation(c, a.ws, obj(op.allocation), true);
        if (Object.keys(f).length) badRequest(f);
        if (op.allocation.id && a.ws.allocations.some((x) => x.id === op.allocation.id))
          fail(409, 'conflict', 'Already exists', { fields: { id: 'Already exists' } });
        return op;
      }
      const cur = a.ws.allocations[findIn(a.ws.allocations, op.id, 'Booking')];
      checkVersion(cur, op.version);
      if (op.op === 'delete') {
        if (lockedByPlanview(c, cur)) fail(409, 'conflict', 'Locked: sourced from Planview');
        return op;
      }
      const patch = cleanPatch(op.patch) as Partial<NewAllocation>;
      const changes = (Object.keys(patch) as Array<keyof NewAllocation>).some(
        (k) => patch[k] !== undefined && patch[k] !== cur[k as keyof D.AllocationDTO],
      );
      if (lockedByPlanview(c, cur) && changes) fail(409, 'conflict', 'Locked: sourced from Planview');
      // Same rule as the API (QA-003): provenance is recorded by the system and read-only on update.
      for (const k of ['source', 'externalRef'] as const)
        if (patch[k] !== undefined && patch[k] !== cur[k])
          fail(400, 'bad_request', 'Where a booking came from is recorded by the system and cannot be changed.', {
            fields: { [k]: 'Not allowed' },
          });
      const f = validateAllocation(c, a.ws, { ...cur, ...patch, id: undefined }, false);
      if (Object.keys(f).length) badRequest(f);
      const changesBooking = (
        ['resourceId', 'projectId', 'percentage', 'startDate', 'endDate', 'craftId'] as const
      ).some((k) => patch[k] !== undefined && patch[k] !== cur[k]);
      if (cur.source === 'planview' && overridable && changesBooking) patch.source = 'manual';
      return { ...op, patch };
    } catch (e) {
      throw single ? e : withOpIndex(e, i);
    }
  });
  const before = new Map(a.ws.allocations.map((x) => [x.id, x]));
  const user = userRef(currentUser(c));
  const next = applyAllocationOps(a.ws.allocations, prepared, { newId: c.newId, now: c.now, user });
  const deleted = prepared.filter((op) => op.op === 'delete').map((op) => (op as { id: D.ID }).id);
  const upserted = next.filter((x) => before.get(x.id) !== x);
  a.ws.allocations = next;
  touch(a.ws);
  audit(c, 'allocation.batch', { type: 'allocation', id: null, workspaceId: a.ws.workspace.id }, null, {
    label: typeof b.label === 'string' ? b.label : null,
    ops: ops.length,
  });
  if (single) {
    const op = prepared[0];
    return op.op === 'delete' ? undefined : (upserted[0] ?? null);
  }
  return { upserted, deleted, dataVersion: a.ws.workspace.dataVersion };
}

function lockedByPlanview(c: Ctx, a: D.AllocationDTO): boolean {
  return a.source === 'planview' && c.db.org.planning.planviewOwnership === 'locked';
}

const allocations: Record<string, Handler> = {
  create(c) {
    const a = access(c);
    need(a, 'allocations.write');
    return allocationBatch(
      { ...c, body: { ops: [{ op: 'create', allocation: obj(c.body) }], label: 'Add booking' } },
      a,
      true,
    );
  },
  update(c) {
    const a = access(c);
    need(a, 'allocations.write');
    const b = obj(c.body);
    return allocationBatch(
      {
        ...c,
        body: { ops: [{ op: 'update', id: c.params.id, version: b.version, patch: b.patch }], label: 'Edit booking' },
      },
      a,
      true,
    );
  },
  remove(c) {
    const a = access(c);
    need(a, 'allocations.write');
    const cur = a.ws.allocations[findIn(a.ws.allocations, c.params.id, 'Booking')];
    const version = c.query.version !== undefined ? Number(c.query.version) : cur.version;
    allocationBatch(
      { ...c, body: { ops: [{ op: 'delete', id: c.params.id, version }], label: 'Delete booking' } },
      a,
      true,
    );
    return undefined;
  },
  batch(c) {
    const a = access(c);
    need(a, 'allocations.write');
    return allocationBatch(c, a, false);
  },
  respond(c) {
    const a = access(c);
    const i = findIn(a.ws.allocations, c.params.id, 'Booking');
    const cur = a.ws.allocations[i];
    needOwnOr(a, 'allocations.write', 'allocations.respond.own', cur.resourceId);
    if (cur.state !== 'tentative') fail(409, 'conflict', 'This booking is no longer pending.');
    const r = obj(c.body) as unknown as RespondRequest;
    if (r.decision !== 'accept' && r.decision !== 'decline') badRequest({ decision: 'Choose accept or decline' });
    const reason = str(r.reason);
    a.ws.allocations[i] = patched(c, cur, {
      state: r.decision === 'accept' ? 'confirmed' : 'declined',
      respondedAt: c.now,
      notes: reason ? reason : cur.notes,
    });
    touch(a.ws);
    audit(
      c,
      r.decision === 'accept' ? 'allocation.accept' : 'allocation.decline',
      { type: 'allocation', id: cur.id, workspaceId: a.ws.workspace.id },
      cur,
      a.ws.allocations[i],
    );
    return a.ws.allocations[i];
  },
  propose(c) {
    const a = access(c);
    need(a, 'allocations.propose');
    const r = obj(c.body) as unknown as ProposeRequest;
    const f = validateAllocation(c, a.ws, { ...r, craftId: r.craftId }, true);
    if (!r.craftId) f.craftId = 'Choose a craft';
    if (typeof r.quarterKey !== 'string' || !QUARTER_KEY_RE.test(r.quarterKey))
      f.quarterKey = 'Use a quarter like 2027-Q1';
    if (!(r.percentage > 0)) f.percentage = 'Enter 1–200';
    if (!isIsoDate(r.startDate)) f.startDate = 'Enter a date';
    if (!isIsoDate(r.endDate)) f.endDate = 'Enter a date';
    if (r.demandLineId && !a.ws.demand.some((l) => l.id === r.demandLineId)) f.demandLineId = 'Unknown demand line';
    if (Object.keys(f).length) badRequest(f);
    const dup = a.ws.allocations.some(
      (x) =>
        x.state === 'tentative' &&
        x.resourceId === r.resourceId &&
        x.projectId === r.projectId &&
        x.craftId === r.craftId &&
        quarterKeyOf(x.startDate ?? r.startDate) === r.quarterKey,
    );
    if (dup) fail(409, 'conflict', 'This person is already proposed for this demand.');
    const user = requireUser(c);
    const alloc: D.AllocationDTO = {
      id: c.newId(),
      resourceId: r.resourceId,
      projectId: r.projectId,
      percentage: r.percentage,
      startDate: r.startDate,
      endDate: r.endDate,
      craftId: r.craftId,
      source: 'marketplace',
      state: 'tentative',
      notes: null,
      externalRef: null,
      demandLineId: r.demandLineId,
      proposedAt: c.now,
      proposedBy: { id: user.id, name: user.name },
      respondedAt: null,
      version: 1,
      updatedAt: c.now,
      updatedBy: { id: user.id, name: user.name },
    };
    a.ws.allocations.push(alloc);
    touch(a.ws);
    audit(c, 'allocation.propose', { type: 'allocation', id: alloc.id, workspaceId: a.ws.workspace.id }, null, alloc);
    return alloc;
  },
};

const offers: Record<string, Handler> = {
  put(c) {
    const a = access(c);
    needOwnOr(a, 'offers.write', 'offers.write.own', c.params.personId);
    findIn(a.ws.people, c.params.personId, 'Person');
    if (!QUARTER_KEY_RE.test(c.params.quarterKey)) badRequest({ quarterKey: 'Use a quarter like 2027-Q1' });
    const b = obj(c.body);
    const f: Record<string, string> = {};
    if (!isNum(b.pct) || b.pct <= 0 || b.pct > 100) f.pct = 'Enter 1–100';
    if (!Array.isArray(b.craftIds) || b.craftIds.some((id) => !c.db.crafts.some((x) => x.id === id)))
      f.craftIds = 'Choose crafts';
    if (Object.keys(f).length) badRequest(f);
    const user = requireUser(c);
    const offer: D.MarketplaceOfferDTO = {
      personId: c.params.personId,
      quarterKey: c.params.quarterKey,
      pct: b.pct as number,
      craftIds: b.craftIds as D.ID[],
      note: str(b.note) || null,
      createdBy: { id: user.id, name: user.name },
      createdAt: c.now,
    };
    a.ws.offers = [
      ...a.ws.offers.filter((o) => !(o.personId === offer.personId && o.quarterKey === offer.quarterKey)),
      offer,
    ];
    touch(a.ws);
    audit(c, 'offer.set', { type: 'person', id: offer.personId, workspaceId: a.ws.workspace.id }, null, offer);
    return offer;
  },
  remove(c) {
    const a = access(c);
    needOwnOr(a, 'offers.write', 'offers.write.own', c.params.personId);
    a.ws.offers = a.ws.offers.filter(
      (o) => !(o.personId === c.params.personId && o.quarterKey === c.params.quarterKey),
    );
    touch(a.ws);
    audit(c, 'offer.withdraw', { type: 'person', id: c.params.personId, workspaceId: a.ws.workspace.id });
    return undefined;
  },
};

/* ── integrations: Jira mappings, calibration, sync, delivery, Planview ────────────── */

function jiraMappings(a: WsAccess) {
  return { projects: a.ws.jiraProjects, people: a.ws.identities };
}

const jira: Record<string, Handler> = {
  mappings(c) {
    const a = access(c);
    need(a, 'integrations.view');
    return jiraMappings(a);
  },
  autoMatch(c) {
    const a = access(c);
    need(a, 'integrations.run');
    a.ws.jiraProjects = a.ws.jiraProjects.map((m) => {
      if (m.confirmed) return m;
      const byKey = a.ws.projects.find((p) => p.jiraKey && p.jiraKey.toLowerCase() === m.jiraKey.toLowerCase());
      const byName = byKey
        ? undefined
        : a.ws.projects.find((p) => p.name.trim().toLowerCase() === m.jiraName.trim().toLowerCase());
      const p = byKey ?? byName;
      return {
        ...m,
        projectId: p?.id ?? null,
        tribeId: p?.tribeId ?? null,
        matchMethod: byKey ? 'key' : byName ? 'name' : 'none',
        confirmed: false,
      };
    });
    return jiraMappings(a);
  },
  saveProjects(c) {
    const a = access(c);
    need(a, 'integrations.run');
    const list = obj(c.body).projects as D.JiraProjectMappingDTO[];
    if (!Array.isArray(list)) badRequest({ projects: 'Required' });
    list.forEach((m, i) => {
      if (m.projectId && !a.ws.projects.some((p) => p.id === m.projectId))
        badRequest({ [`projects.${i}.projectId`]: 'Unknown project' });
      if (m.tribeId && !c.db.tribes.some((t) => t.id === m.tribeId))
        badRequest({ [`projects.${i}.tribeId`]: 'Unknown tribe' });
      const j = a.ws.jiraProjects.findIndex((x) => x.jiraKey === m.jiraKey);
      if (j >= 0) a.ws.jiraProjects[j] = { ...a.ws.jiraProjects[j], ...m };
      else a.ws.jiraProjects.push(m);
    });
    audit(c, 'integration.mapping', { type: 'jira', id: null, workspaceId: a.ws.workspace.id });
    return jiraMappings(a);
  },
  savePeople(c) {
    const a = access(c);
    need(a, 'integrations.run');
    const list = obj(c.body).people as D.IdentityMappingDTO[];
    if (!Array.isArray(list)) badRequest({ people: 'Required' });
    list.forEach((m, i) => {
      if (m.personId && !a.ws.people.some((p) => p.id === m.personId))
        badRequest({ [`people.${i}.personId`]: 'Unknown person' });
      const j = a.ws.identities.findIndex((x) => x.provider === m.provider && x.externalId === m.externalId);
      if (j >= 0) a.ws.identities[j] = { ...a.ws.identities[j], ...m };
      else a.ws.identities.push(m);
    });
    audit(c, 'integration.mapping', { type: 'identity', id: null, workspaceId: a.ws.workspace.id });
    return jiraMappings(a);
  },
};

function defaultCalibration(c: Ctx, tribeId: D.ID): D.TribeCalibrationDTO {
  return {
    tribeId,
    pointsPerSprintPerFte: 10,
    sprintLengthDays: c.db.org.planning.sprintLengthDays,
    isDefault: true,
    suggestedValue: null,
    suggestedBasis: null,
    note: null,
    version: 0,
    updatedAt: c.db.org.updatedAt,
    updatedBy: null,
  };
}

const calibration: Record<string, Handler> = {
  list(c) {
    const a = access(c);
    need(a, 'integrations.view');
    return c.db.tribes
      .filter((t) => !t.archived)
      .map((t) => a.ws.calibrations.find((x) => x.tribeId === t.id) ?? defaultCalibration(c, t.id));
  },
  save(c) {
    const a = access(c);
    need(a, 'integrations.run');
    const tribeId = c.params.tribeId;
    if (!c.db.tribes.some((t) => t.id === tribeId)) notFound('Tribe');
    const b = obj(c.body);
    const i = a.ws.calibrations.findIndex((x) => x.tribeId === tribeId);
    const cur = i >= 0 ? a.ws.calibrations[i] : defaultCalibration(c, tribeId);
    checkVersion(cur, b.version);
    const f: Record<string, string> = {};
    if (!str(b.note)) f.note = 'Why are you changing this?';
    if (!isNum(b.pointsPerSprintPerFte) || b.pointsPerSprintPerFte <= 0 || b.pointsPerSprintPerFte > 500)
      f.pointsPerSprintPerFte = 'Enter a positive number';
    if (!isNum(b.sprintLengthDays) || b.sprintLengthDays < 1 || b.sprintLengthDays > 60)
      f.sprintLengthDays = 'Enter 1–60 days';
    if (Object.keys(f).length) badRequest(f, f.note ?? 'Some details need correcting.');
    const next = patched(c, cur, {
      pointsPerSprintPerFte: b.pointsPerSprintPerFte,
      sprintLengthDays: b.sprintLengthDays,
      note: str(b.note),
      isDefault: false,
    });
    if (i >= 0) a.ws.calibrations[i] = next;
    else a.ws.calibrations.push(next);
    audit(c, 'calibration.change', { type: 'tribe', id: tribeId, workspaceId: a.ws.workspace.id }, cur, next);
    return next;
  },
};

const sync: Record<string, Handler> = {
  start(c) {
    const a = access(c);
    need(a, 'integrations.run');
    if (!a.ws.jiraConfigured) fail(409, 'conflict', 'Jira is not configured.');
    const running = a.ws.syncJobs.find((j) => j.status === 'running' || j.status === 'queued');
    if (running) return { job: running };
    const user = requireUser(c);
    const job: D.SyncJobDTO = {
      id: c.newId(),
      provider: 'jira',
      trigger: 'manual',
      status: 'queued',
      pagesDone: 0,
      issuesSeen: 0,
      error: null,
      rateLimitedUntil: null,
      startedAt: c.now,
      finishedAt: null,
      requestedBy: { id: user.id, name: user.name },
    };
    a.ws.syncJobs.unshift(job);
    audit(c, 'sync.start', { type: 'sync_job', id: job.id, workspaceId: a.ws.workspace.id });
    return { job };
  },
  step(c) {
    const a = access(c);
    need(a, 'integrations.run');
    const i = findIn(a.ws.syncJobs, c.params.jobId, 'Sync job');
    const job = { ...a.ws.syncJobs[i] };
    if (job.status === 'queued' || job.status === 'running') {
      job.status = 'running';
      job.pagesDone += 1;
      job.issuesSeen += 37;
      if (job.pagesDone >= 3) {
        job.status = 'succeeded';
        job.finishedAt = c.now;
      }
      a.ws.syncJobs[i] = job;
    }
    return { job };
  },
  jobs(c) {
    const a = access(c);
    need(a, 'integrations.view');
    return syncHealth(a.ws).recentJobs;
  },
  health(c) {
    const a = access(c);
    need(a, 'data.read');
    return syncHealth(a.ws);
  },
  delivery(c) {
    const a = access(c);
    need(a, 'data.read');
    const q = c.query;
    let rows = a.ws.deliveryRows.filter(
      (r) =>
        (!q.tribeId || r.tribeId === q.tribeId) &&
        (!q.projectId || r.projectId === q.projectId) &&
        (!q.from || r.to >= q.from) &&
        (!q.to || r.from <= q.to),
    );
    if (q.groupBy === 'tribe') {
      const byKey = new Map<string, D.DeliveryRowDTO>();
      for (const r of rows) {
        const k = `${r.tribeId}|${r.sprintName}`;
        const prev = byKey.get(k);
        byKey.set(
          k,
          prev
            ? {
                ...prev,
                pointsTotal: prev.pointsTotal + r.pointsTotal,
                pointsDone: prev.pointsDone + r.pointsDone,
                issuesDone: prev.issuesDone + r.issuesDone,
                impliedFte: Math.round((prev.impliedFte + r.impliedFte) * 100) / 100,
                plannedFte: Math.round((prev.plannedFte + r.plannedFte) * 100) / 100,
              }
            : {
                ...r,
                key: `${r.tribeId}-${r.sprintName}`,
                label: c.db.tribes.find((t) => t.id === r.tribeId)?.name ?? '',
                projectId: null,
              },
        );
      }
      rows = [...byKey.values()];
    } else if (q.groupBy === 'person') rows = [];
    return rows;
  },
};

function planviewPreview(c: Ctx, a: WsAccess): D.PlanviewPreviewDTO {
  const src = a.ws.planviewSource;
  const projectsByPv = new Map(a.ws.projects.filter((p) => p.planviewId).map((p) => [p.planviewId!, p]));
  const diff = (pairs: Array<[string, string | number | null, string | number | null]>) =>
    pairs
      .filter(([, from, to]) => String(from ?? '') !== String(to ?? ''))
      .map(([field, from, to]) => ({
        field,
        from: from === null ? null : String(from),
        to: to === null ? null : String(to),
      }));
  const projects: D.PlanviewPreviewDTO['projects'] = { new: [], changed: [], removed: [] };
  for (const sp of src.projects) {
    const cur = projectsByPv.get(sp.externalId);
    if (!cur)
      projects.new.push({
        externalId: sp.externalId,
        name: sp.name,
        projectId: null,
        changes: diff([
          ['name', null, sp.name],
          ['startDate', null, sp.startDate],
          ['endDate', null, sp.endDate],
          ['status', null, sp.status],
        ]),
      });
    else {
      const changes = diff([
        ['name', cur.name, sp.name],
        ['startDate', cur.startDate, sp.startDate],
        ['endDate', cur.endDate, sp.endDate],
        ['status', cur.status, sp.status],
      ]);
      if (changes.length)
        projects.changed.push({ externalId: sp.externalId, name: sp.name, projectId: cur.id, changes });
    }
  }
  for (const [pvId, p] of projectsByPv)
    if (!src.projects.some((x) => x.externalId === pvId))
      projects.removed.push({ externalId: pvId, name: p.name, projectId: p.id, changes: [] });

  const assignments: D.PlanviewPreviewDTO['assignments'] = { new: [], changed: [], removed: [], unmatchedPeople: [] };
  const allocsByRef = new Map(
    a.ws.allocations.filter((x) => x.source === 'planview' && x.externalRef).map((x) => [x.externalRef!, x]),
  );
  for (const sa of src.assignments) {
    const person = matchPlanviewPerson(a.ws, sa);
    const projectId = projectsByPv.get(sa.projectExternalId)?.id ?? null;
    const cur = allocsByRef.get(sa.externalId);
    const base = {
      externalId: sa.externalId,
      projectExternalId: sa.projectExternalId,
      personExternalId: sa.personExternalId,
      personName: sa.personName,
      projectId,
      personId: person?.id ?? null,
    };
    if (!cur) {
      assignments.new.push({
        ...base,
        changes: diff([
          ['percentage', null, sa.percentage],
          ['startDate', null, sa.startDate],
          ['endDate', null, sa.endDate],
        ]),
      });
      if (!person) {
        const suggestion = a.ws.people.find(
          (p) => p.name.split(' ')[0].toLowerCase() === sa.personName.split(' ')[0].toLowerCase(),
        );
        assignments.unmatchedPeople.push({
          externalId: sa.personExternalId,
          name: sa.personName,
          email: sa.email,
          suggestedPersonId: suggestion?.id ?? null,
        });
      }
    } else {
      const changes = diff([
        ['percentage', cur.percentage, sa.percentage],
        ['startDate', cur.startDate, sa.startDate],
        ['endDate', cur.endDate, sa.endDate],
      ]);
      if (changes.length) assignments.changed.push({ ...base, changes });
    }
  }
  for (const [ref, x] of allocsByRef)
    if (!src.assignments.some((s) => s.externalId === ref))
      assignments.removed.push({
        externalId: ref,
        projectExternalId: '',
        personExternalId: '',
        personName: a.ws.people.find((p) => p.id === x.resourceId)?.name ?? '',
        projectId: x.projectId,
        personId: x.resourceId,
        changes: [],
      });

  return {
    previewId: c.newId(),
    expiresAt: new Date(Date.parse(c.now) + 30 * 60_000).toISOString(),
    partial: false,
    projects,
    assignments,
  };
}

function matchPlanviewPerson(
  ws: DemoWorkspace,
  sa: { personExternalId: string; email: string | null; personName: string },
): D.PersonDTO | undefined {
  const ident = ws.identities.find(
    (i) => i.provider === 'planview' && i.externalId === sa.personExternalId && i.personId,
  );
  if (ident) return ws.people.find((p) => p.id === ident.personId);
  if (sa.email) {
    const byEmail = ws.people.find((p) => p.email?.toLowerCase() === sa.email!.toLowerCase());
    if (byEmail) return byEmail;
  }
  return ws.people.find((p) => p.name.toLowerCase() === sa.personName.toLowerCase());
}

const planview: Record<string, Handler> = {
  preview(c) {
    const a = access(c);
    need(a, 'integrations.run');
    if (!a.ws.planviewConfigured) fail(409, 'conflict', 'Planview is not configured.');
    const preview = planviewPreview(c, a);
    a.ws.previews = [...a.ws.previews.filter((p) => p.preview.expiresAt > c.now), { preview, createdAt: c.now }];
    return preview;
  },
  apply(c) {
    const a = access(c);
    need(a, 'integrations.run');
    const b = obj(c.body);
    const stored = a.ws.previews.find((p) => p.preview.previewId === b.previewId);
    if (!stored || stored.preview.expiresAt <= c.now) fail(409, 'conflict', 'This preview expired. Run it again.');
    const accept = obj(b.accept) as { projects?: string[]; assignments?: string[] };
    const personMatches = obj(b.personMatches) as Record<string, D.ID>;
    const res = { created: 0, updated: 0, skipped: 0 };
    const src = a.ws.planviewSource;
    for (const [externalId, personId] of Object.entries(personMatches)) {
      if (!a.ws.people.some((p) => p.id === personId))
        badRequest({ [`personMatches.${externalId}`]: 'Unknown person' });
      const sa = src.assignments.find((x) => x.personExternalId === externalId);
      a.ws.identities = [
        ...a.ws.identities.filter((i) => !(i.provider === 'planview' && i.externalId === externalId)),
        {
          provider: 'planview',
          externalId,
          displayName: sa?.personName ?? externalId,
          email: sa?.email ?? null,
          personId,
          matchMethod: 'manual',
          confirmed: true,
          lastSeenAt: c.now,
        },
      ];
    }
    const user = userRef(currentUser(c));
    for (const id of accept.projects ?? []) {
      const sp = src.projects.find((p) => p.externalId === id);
      if (!sp) continue;
      const i = a.ws.projects.findIndex((p) => p.planviewId === id);
      if (i >= 0) {
        a.ws.projects[i] = patched(c, a.ws.projects[i], {
          name: sp.name,
          startDate: sp.startDate,
          endDate: sp.endDate,
          status: sp.status,
        });
        res.updated++;
      } else {
        a.ws.projects.push({
          id: c.newId(),
          name: sp.name,
          status: sp.status,
          priority: 'Medium',
          description: '',
          startDate: sp.startDate,
          endDate: sp.endDate,
          budget: null,
          tribeId: null,
          stage: 'Pipeline',
          initiatedOn: null,
          ownerUserId: null,
          jiraKey: null,
          planviewId: sp.externalId,
          source: 'planview',
          version: 1,
          updatedAt: c.now,
          updatedBy: user,
        });
        res.created++;
      }
    }
    for (const id of accept.assignments ?? []) {
      const sa = src.assignments.find((x) => x.externalId === id);
      const person = sa && matchPlanviewPerson(a.ws, sa);
      const project = sa && a.ws.projects.find((p) => p.planviewId === sa.projectExternalId);
      if (!sa || !person || !project) {
        res.skipped++;
        continue;
      }
      const i = a.ws.allocations.findIndex((x) => x.source === 'planview' && x.externalRef === id);
      if (i >= 0) {
        a.ws.allocations[i] = patched(c, a.ws.allocations[i], {
          percentage: sa.percentage,
          startDate: sa.startDate,
          endDate: sa.endDate,
        });
        res.updated++;
      } else {
        a.ws.allocations.push({
          id: c.newId(),
          resourceId: person.id,
          projectId: project.id,
          percentage: sa.percentage,
          startDate: sa.startDate,
          endDate: sa.endDate,
          craftId: null,
          source: 'planview',
          state: 'confirmed',
          notes: null,
          externalRef: sa.externalId,
          demandLineId: null,
          proposedAt: null,
          proposedBy: null,
          respondedAt: null,
          version: 1,
          updatedAt: c.now,
          updatedBy: user,
        });
        res.created++;
      }
    }
    a.ws.previews = a.ws.previews.filter((p) => p !== stored);
    touch(a.ws);
    audit(
      c,
      'integration.import',
      { type: 'planview', id: String(b.previewId), workspaceId: a.ws.workspace.id },
      null,
      res,
    );
    return res;
  },
  testMapping(c) {
    const a = access(c);
    need(a, 'integrations.manage');
    const sp = a.ws.planviewSource.projects[0];
    const sa = a.ws.planviewSource.assignments[0];
    return {
      source: { project: sp ?? null, assignment: sa ?? null },
      mapped: {
        'project.id': sp?.externalId,
        'project.name': sp?.name,
        'project.start': sp?.startDate,
        'project.end': sp?.endDate,
        'assignment.id': sa?.externalId,
        'assignment.percent': sa?.percentage,
      },
      missing: sp ? ['project.manager'] : ['project.id', 'project.name'],
    };
  },
};

/* ── extras: profile, invitation resend, legacy integration settings, checkout, platform ── */

export interface DemoIntegrationSettings {
  jira: {
    domain: string;
    email: string;
    projectKeys: string[];
    boardIds: number[];
    storyPointsFieldId?: string;
    hasSecret: boolean;
  };
  planview: {
    flavour: 'adaptivework' | 'generic';
    baseUrl: string;
    username?: string;
    hasSecret: boolean;
    generic?: { projectsPath: string; assignmentsPath: string; fieldMap: Record<string, string> };
  };
}

function integrationSettings(ws: DemoWorkspace): DemoIntegrationSettings {
  const w = ws as DemoWorkspace & { integrationSettings?: DemoIntegrationSettings };
  w.integrationSettings ??= {
    jira: ws.jiraConfigured
      ? {
          domain: 'demo-pmo.atlassian.net',
          email: 'pmo.integration@example.com',
          projectKeys: ws.jiraProjects.map((m) => m.jiraKey),
          boardIds: ws.jiraProjects.flatMap((m) => m.boardIds),
          storyPointsFieldId: 'customfield_10016',
          hasSecret: true,
        }
      : { domain: '', email: '', projectKeys: [], boardIds: [], hasSecret: false },
    planview: ws.planviewConfigured
      ? {
          flavour: 'generic',
          baseUrl: 'https://planview.example.com',
          username: 'pmo-sync',
          hasSecret: true,
          generic: {
            projectsPath: '/api/projects',
            assignmentsPath: '/api/assignments',
            fieldMap: { 'project.id': 'Id', 'project.name': 'Name', 'assignment.percent': 'Allocation' },
          },
        }
      : { flavour: 'generic', baseUrl: '', hasSecret: false },
  };
  return w.integrationSettings;
}

function legacyConfig(ws: DemoWorkspace) {
  const st = integrationSettings(ws);
  return {
    jira: { ...st.jira, configured: !!(st.jira.domain && st.jira.email && st.jira.hasSecret) },
    planview: { ...st.planview, configured: !!(st.planview.baseUrl && st.planview.hasSecret) },
    settings: { calibration: {}, mappings: { jira: {}, planview: {} } },
  };
}

function legacyWs(c: Ctx): WsAccess {
  if (!c.query.wsId) badRequest({ wsId: 'wsId query parameter is required' });
  return access(c, c.query.wsId);
}

const extras: Record<string, Handler> = {
  updateProfile(c) {
    const u = requireUser(c);
    const name = str(obj(c.body).name);
    if (!name) badRequest({ name: 'Enter your name' });
    u.name = name;
    audit(c, 'user.profile_update', { type: 'user', id: u.id });
    return buildMe(c.db, u);
  },
  resendInvitation(c) {
    const { perms, user } = orgPerms(c);
    if (!perms.has('org.members.manage') && adminWorkspaces(c, user).size === 0) forbidden();
    const inv = c.db.invitations.find((i) => i.id === c.params.id && !i.acceptedAt && !i.revokedAt);
    if (!inv) notFound('Invitation');
    inv.token = c.newId().replace(/-/g, '');
    inv.expiresAt = new Date(Date.parse(c.now) + 7 * 86_400_000).toISOString();
    audit(c, 'member.invite_resend', { type: 'invitation', id: inv.id });
    return {
      invitation: { id: inv.id, email: inv.email, expiresAt: inv.expiresAt },
      inviteUrl: `/invite/${inv.token}`,
      emailSent: false,
    };
  },
  integrationsConfig(c) {
    const a = legacyWs(c);
    need(a, 'integrations.view');
    const cfg = legacyConfig(a.ws);
    return cfg;
  },
  saveIntegrationsConfig(c) {
    const a = legacyWs(c);
    need(a, 'integrations.manage');
    const st = integrationSettings(a.ws);
    const b = obj(c.body);
    if (b.jira !== undefined) {
      const j = obj(b.jira);
      const domain =
        j.domain !== undefined
          ? str(j.domain)
              .replace(/^https?:\/\//, '')
              .replace(/\/.*$/, '')
          : st.jira.domain;
      if (j.domain !== undefined && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain))
        badRequest(
          { 'jira.domain': 'Use a hostname such as your-site.atlassian.net' },
          'jira.domain must be a hostname such as your-site.atlassian.net',
        );
      const changedSite = domain !== st.jira.domain;
      st.jira = {
        domain,
        email: j.email !== undefined ? str(j.email) : st.jira.email,
        projectKeys: Array.isArray(j.projectKeys)
          ? j.projectKeys.map((k) => String(k).toUpperCase())
          : st.jira.projectKeys,
        boardIds: Array.isArray(j.boardIds) ? j.boardIds.map(Number).filter(Number.isFinite) : st.jira.boardIds,
        storyPointsFieldId: changedSite ? undefined : st.jira.storyPointsFieldId,
        // HS-08#AC1: changing the site clears the stored token unless a new one is sent.
        hasSecret: str(j.apiToken) ? true : changedSite ? false : st.jira.hasSecret,
      };
      a.ws.jiraConfigured = !!(st.jira.domain && st.jira.email && st.jira.hasSecret);
    }
    if (b.planview !== undefined) {
      const p = obj(b.planview);
      const baseUrl = p.baseUrl !== undefined ? str(p.baseUrl) : st.planview.baseUrl;
      if (p.baseUrl !== undefined && !/^https:\/\//.test(baseUrl))
        badRequest({ 'planview.baseUrl': 'Use an https:// address' }, 'planview.baseUrl must be an https:// URL');
      const g = obj(p.generic);
      st.planview = {
        flavour:
          p.flavour === 'adaptivework' ? 'adaptivework' : p.flavour === 'generic' ? 'generic' : st.planview.flavour,
        baseUrl,
        username: p.username !== undefined ? str(p.username) || undefined : st.planview.username,
        hasSecret: str(p.secret) ? true : st.planview.hasSecret,
        generic:
          p.generic !== undefined
            ? {
                projectsPath: str(g.projectsPath) || st.planview.generic?.projectsPath || '',
                assignmentsPath: str(g.assignmentsPath) || st.planview.generic?.assignmentsPath || '',
                fieldMap: (g.fieldMap as Record<string, string>) ?? st.planview.generic?.fieldMap ?? {},
              }
            : st.planview.generic,
      };
      a.ws.planviewConfigured = !!(st.planview.baseUrl && st.planview.hasSecret);
    }
    audit(c, 'integration.config', { type: 'workspace', id: a.ws.workspace.id, workspaceId: a.ws.workspace.id });
    return legacyConfig(a.ws);
  },
  testJira(c) {
    const a = legacyWs(c);
    need(a, 'integrations.manage');
    const st = integrationSettings(a.ws);
    // UAT-02: the form's values are tested when given (a typed token, or the saved one for the saved site).
    const form = (c.body ?? {}) as { domain?: string; apiToken?: string };
    const formReady = !!form.domain && (!!form.apiToken || (form.domain === st.jira.domain && st.jira.hasSecret));
    if (!formReady && (!st.jira.domain || !st.jira.hasSecret))
      badRequest({}, 'Jira is not configured for this workspace (domain, email and API token are required)');
    st.jira.storyPointsFieldId ??= 'customfield_10016';
    return {
      ok: true,
      displayName: 'PMO Integration',
      accountId: 'demo-account',
      storyPointsFieldId: st.jira.storyPointsFieldId,
      sprintFieldId: 'customfield_10020',
    };
  },
  testPlanview(c) {
    const a = legacyWs(c);
    need(a, 'integrations.manage');
    const st = integrationSettings(a.ws);
    if (!st.planview.baseUrl || !st.planview.hasSecret)
      badRequest({}, 'Planview is not configured for this workspace (baseUrl and secret are required)');
    return { ok: true, flavour: st.planview.flavour, projectCount: a.ws.planviewSource.projects.length };
  },
  checkout(c) {
    const u = requireUser(c);
    if (c.db.appMode === 'internal') notFound('Billing');
    if (u.orgRole !== 'ORG_ADMIN') forbidden();
    const plan = str(obj(c.body).plan);
    if (!['BASIC', 'PRO', 'MAX'].includes(plan)) badRequest({ plan: 'Invalid plan selected' }, 'Invalid plan selected');
    return { url: `https://checkout.stripe.com/c/pay/demo_${plan.toLowerCase()}` };
  },
  platformOverview(c) {
    const u = requireUser(c);
    if (!u.isPlatformAdmin) notFound('Route');
    const members = c.db.users.filter((x) => x.orgRole).length;
    const signedInWithin = (ms: number) =>
      c.db.users.filter((x) => x.lastSignInAt && Date.parse(c.now) - Date.parse(x.lastSignInAt) < ms).length;
    const workspaces = Object.keys(c.db.workspaces).length;
    return {
      orgs: 1,
      workspaces,
      users: c.db.users.length,
      platformAdmins: c.db.users.filter((x) => x.isPlatformAdmin).length,
      activeSessions: signedInWithin(7 * 86_400_000),
      signInsLast24h: signedInWithin(86_400_000),
      unverifiedUsers: 0,
      syncHealth: {
        queued: 0,
        running: 0,
        stuck: 0,
        succeeded24h: 0,
        failed24h: 0,
        partial24h: 0,
        lastFailureAt: null,
        workspacesWithJira: 0,
      },
      organisations: [
        {
          id: c.db.org.id,
          name: c.db.org.name,
          slug: c.db.org.slug,
          plan: c.db.org.plan,
          members,
          workspaces,
          lastActivityAt: c.db.audit[0]?.occurredAt ?? null,
        },
      ],
      events: c.db.audit.slice(0, 50).map((e) => ({
        id: e.id,
        at: e.occurredAt,
        actor: e.actor?.name ?? 'System',
        action: e.action,
        org: c.db.org.name,
      })),
      generatedAt: c.now,
    };
  },
};

/* ── route table ───────────────────────────────────────────────────────────────────── */

const legacyGone: Handler = () => fail(410, 'gone', 'This endpoint was retired in Release 2.0.');

const R = '([^/?#]+)';
const routes: Array<[string, RegExp, string[], Handler]> = [
  ['POST', /^\/api\/auth\/login$/, [], auth.login],
  ['POST', /^\/api\/auth\/register$/, [], auth.register],
  ['POST', /^\/api\/auth\/logout$/, [], auth.logout],
  ['POST', /^\/api\/auth\/logout-all$/, [], auth.logout],
  ['POST', /^\/api\/auth\/refresh$/, [], auth.refresh],
  ['GET', /^\/api\/auth$/, [], auth.refresh],
  ['POST', /^\/api\/auth\/session$/, [], auth.session],
  ['POST', /^\/api\/auth\/reset\/send-otp$/, [], auth.resetSend],
  ['POST', /^\/api\/auth\/reset\/confirm$/, [], auth.resetConfirm],
  ['POST', /^\/api\/auth\/2fa$/, [], auth.twoFactor],
  ['POST', /^\/api\/auth\/password$/, [], auth.password],
  ['POST', /^\/api\/verify\/send$/, [], auth.verifySend],
  ['POST', /^\/api\/verify\/check$/, [], auth.verifyCheck],
  ['GET', /^\/api\/health$/, [], auth.health],
  ['POST', /^\/api\/ai$/, [], auth.ai],
  ['GET', /^\/api\/v2\/me$/, [], auth.me],
  ['PATCH', /^\/api\/v2\/me$/, [], extras.updateProfile],
  ['GET', /^\/api\/v2\/platform\/overview$/, [], extras.platformOverview],
  ['GET', /^\/api\/integrations\/config$/, [], extras.integrationsConfig],
  ['POST', /^\/api\/integrations\/config$/, [], extras.saveIntegrationsConfig],
  ['POST', /^\/api\/integrations\/jira\/test$/, [], extras.testJira],
  ['POST', /^\/api\/integrations\/planview\/test$/, [], extras.testPlanview],
  ['POST', /^\/api\/checkout$/, [], extras.checkout],
  ['POST', new RegExp(`^/api/v2/orgs/${R}/invitations/${R}/resend$`), ['orgId', 'id'], extras.resendInvitation],
  ['POST', /^\/api\/workspace$/, [], legacyGone],
  ['POST', /^\/api\/auth\/users\/invite$/, [], legacyGone],
  ['PUT', new RegExp(`^/api/auth/users/${R}$`), ['id'], legacyGone],
  ['POST', /^\/api\/auth\/remove-member$/, [], legacyGone],
  ['POST', /^\/api\/org_manage$/, [], legacyGone],

  ['POST', /^\/api\/v2\/orgs$/, [], orgs.create],
  ['GET', new RegExp(`^/api/v2/orgs/${R}$`), ['orgId'], orgs.get],
  ['PATCH', new RegExp(`^/api/v2/orgs/${R}$`), ['orgId'], orgs.update],
  ['POST', new RegExp(`^/api/v2/orgs/${R}/workspaces$`), ['orgId'], orgs.createWorkspace],
  ['GET', new RegExp(`^/api/v2/orgs/${R}/audit$`), ['orgId'], orgs.audit],
  ['GET', new RegExp(`^/api/v2/orgs/${R}/(tribes|chapters|teams|crafts)$`), ['orgId', 'kind'], structure.list],
  ['POST', new RegExp(`^/api/v2/orgs/${R}/(tribes|chapters|teams|crafts)$`), ['orgId', 'kind'], structure.create],
  [
    'PATCH',
    new RegExp(`^/api/v2/orgs/${R}/(tribes|chapters|teams|crafts)/${R}$`),
    ['orgId', 'kind', 'id'],
    structure.update,
  ],
  [
    'DELETE',
    new RegExp(`^/api/v2/orgs/${R}/(tribes|chapters|teams|crafts)/${R}$`),
    ['orgId', 'kind', 'id'],
    structure.remove,
  ],
  ['GET', new RegExp(`^/api/v2/orgs/${R}/members$`), ['orgId'], members.list],
  ['PATCH', new RegExp(`^/api/v2/orgs/${R}/members/${R}$`), ['orgId', 'userId'], members.update],
  ['DELETE', new RegExp(`^/api/v2/orgs/${R}/members/${R}$`), ['orgId', 'userId'], members.remove],
  ['POST', new RegExp(`^/api/v2/orgs/${R}/invitations$`), ['orgId'], invitations.create],
  ['GET', new RegExp(`^/api/v2/orgs/${R}/invitations$`), ['orgId'], invitations.list],
  ['DELETE', new RegExp(`^/api/v2/orgs/${R}/invitations/${R}$`), ['orgId', 'id'], invitations.revoke],
  ['GET', new RegExp(`^/api/v2/invitations/${R}$`), ['token'], invitations.lookup],
  ['POST', new RegExp(`^/api/v2/invitations/${R}/accept$`), ['token'], invitations.accept],

  ['PATCH', new RegExp(`^/api/v2/workspaces/${R}$`), ['wsId'], orgs.renameWorkspace],
  ['DELETE', new RegExp(`^/api/v2/workspaces/${R}$`), ['wsId'], orgs.deleteWorkspace],
  ['PATCH', new RegExp(`^/api/v2/workspaces/${R}/members/${R}$`), ['wsId', 'userId'], members.setWorkspaceRole],
  ['DELETE', new RegExp(`^/api/v2/workspaces/${R}/members/${R}$`), ['wsId', 'userId'], members.removeFromWorkspace],
  ['GET', new RegExp(`^/api/v2/workspaces/${R}/snapshot$`), ['wsId'], workspace.snapshot],
  ['POST', new RegExp(`^/api/v2/workspaces/${R}/sample-data$`), ['wsId'], workspace.sampleData],
  ['POST', new RegExp(`^/api/v2/workspaces/${R}/audit/export$`), ['wsId'], workspace.exportAudit],
  ['POST', new RegExp(`^/api/v2/workspaces/${R}/people$`), ['wsId'], people.create],
  ['POST', new RegExp(`^/api/v2/workspaces/${R}/people/bulk$`), ['wsId'], people.bulk],
  ['POST', new RegExp(`^/api/v2/workspaces/${R}/people/import$`), ['wsId'], people.import],
  [
    'POST',
    new RegExp(`^/api/v2/workspaces/${R}/people/${R}/craft-requests$`),
    ['wsId', 'id'],
    people.requestCraftChange,
  ],
  ['PATCH', new RegExp(`^/api/v2/workspaces/${R}/people/${R}$`), ['wsId', 'id'], people.update],
  ['DELETE', new RegExp(`^/api/v2/workspaces/${R}/people/${R}$`), ['wsId', 'id'], people.remove],
  ['GET', new RegExp(`^/api/v2/workspaces/${R}/craft-requests$`), ['wsId'], people.listCraftRequests],
  [
    'POST',
    new RegExp(`^/api/v2/workspaces/${R}/craft-requests/${R}/(approve|reject)$`),
    ['wsId', 'id', 'decision'],
    people.decideCraftRequest,
  ],
  ['POST', new RegExp(`^/api/v2/workspaces/${R}/projects$`), ['wsId'], projects.create],
  ['PATCH', new RegExp(`^/api/v2/workspaces/${R}/projects/${R}$`), ['wsId', 'id'], projects.update],
  ['DELETE', new RegExp(`^/api/v2/workspaces/${R}/projects/${R}$`), ['wsId', 'id'], projects.remove],
  ['POST', new RegExp(`^/api/v2/workspaces/${R}/demand$`), ['wsId'], demand.create],
  ['POST', new RegExp(`^/api/v2/workspaces/${R}/demand/batch$`), ['wsId'], demand.batch],
  ['PATCH', new RegExp(`^/api/v2/workspaces/${R}/demand/${R}$`), ['wsId', 'id'], demand.update],
  ['DELETE', new RegExp(`^/api/v2/workspaces/${R}/demand/${R}$`), ['wsId', 'id'], demand.remove],
  ['POST', new RegExp(`^/api/v2/workspaces/${R}/allocations$`), ['wsId'], allocations.create],
  ['POST', new RegExp(`^/api/v2/workspaces/${R}/allocations/batch$`), ['wsId'], allocations.batch],
  ['POST', new RegExp(`^/api/v2/workspaces/${R}/allocations/${R}/respond$`), ['wsId', 'id'], allocations.respond],
  ['PATCH', new RegExp(`^/api/v2/workspaces/${R}/allocations/${R}$`), ['wsId', 'id'], allocations.update],
  ['DELETE', new RegExp(`^/api/v2/workspaces/${R}/allocations/${R}$`), ['wsId', 'id'], allocations.remove],
  ['POST', new RegExp(`^/api/v2/workspaces/${R}/marketplace/propose$`), ['wsId'], allocations.propose],
  ['PUT', new RegExp(`^/api/v2/workspaces/${R}/offers/${R}/${R}$`), ['wsId', 'personId', 'quarterKey'], offers.put],
  [
    'DELETE',
    new RegExp(`^/api/v2/workspaces/${R}/offers/${R}/${R}$`),
    ['wsId', 'personId', 'quarterKey'],
    offers.remove,
  ],
  ['GET', new RegExp(`^/api/v2/workspaces/${R}/integrations/jira/mappings$`), ['wsId'], jira.mappings],
  ['POST', new RegExp(`^/api/v2/workspaces/${R}/integrations/jira/mappings/auto-match$`), ['wsId'], jira.autoMatch],
  ['PUT', new RegExp(`^/api/v2/workspaces/${R}/integrations/jira/mappings/projects$`), ['wsId'], jira.saveProjects],
  ['PUT', new RegExp(`^/api/v2/workspaces/${R}/integrations/jira/mappings/people$`), ['wsId'], jira.savePeople],
  ['GET', new RegExp(`^/api/v2/workspaces/${R}/calibration$`), ['wsId'], calibration.list],
  ['PUT', new RegExp(`^/api/v2/workspaces/${R}/calibration/${R}$`), ['wsId', 'tribeId'], calibration.save],
  ['POST', new RegExp(`^/api/v2/workspaces/${R}/sync/jira$`), ['wsId'], sync.start],
  ['POST', new RegExp(`^/api/v2/workspaces/${R}/sync/jobs/${R}/step$`), ['wsId', 'jobId'], sync.step],
  ['GET', new RegExp(`^/api/v2/workspaces/${R}/sync/jobs$`), ['wsId'], sync.jobs],
  ['GET', new RegExp(`^/api/v2/workspaces/${R}/sync/health$`), ['wsId'], sync.health],
  ['GET', new RegExp(`^/api/v2/workspaces/${R}/delivery$`), ['wsId'], sync.delivery],
  ['POST', new RegExp(`^/api/v2/workspaces/${R}/planview/preview$`), ['wsId'], planview.preview],
  ['POST', new RegExp(`^/api/v2/workspaces/${R}/planview/apply$`), ['wsId'], planview.apply],
  ['POST', new RegExp(`^/api/v2/workspaces/${R}/planview/test-mapping$`), ['wsId'], planview.testMapping],
];

/** Routes a request. Throws ApiRequestError like the real API would; returns the response body. */
export function handle(
  db: DemoDb,
  req: DemoRequest,
  env: { now: D.ISODateTime; newId: () => D.ID; acceptAnyPassword: boolean },
): unknown {
  for (const [method, re, names, handler] of routes) {
    if (method !== req.method) continue;
    const m = re.exec(req.path);
    if (!m) continue;
    const params: Record<string, string> = {};
    names.forEach((n, i) => {
      params[n] = decodeURIComponent(m[i + 1]);
    });
    return handler({ ...req, db, params, ...env });
  }
  if (routes.some(([, re]) => re.test(req.path))) return fail(405 as number, 'bad_request', 'Method not allowed.');
  return notFound('Route');
}

/** Number of routes served (used by the contract test to check coverage of the §4.3 table). */
export const DEMO_ROUTE_COUNT = routes.length;
