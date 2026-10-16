/**
 * PL-12: every /api/v2 route × every role × tenant. The required permission per route is the BACKLOG §4.3 route
 * table; whether a role holds it is computed from `shared/permissions.ts` (never hard-coded per role). A route
 * added to the router without a row here fails the first test.
 *
 * "Allowed" means the authorisation layer let the request through: anything but 401 and 403 `forbidden`
 * (bodies are deliberately empty or ids bogus, so allowed calls typically end in 400/404/409).
 */
import { randomUUID } from 'node:crypto';
import { handler as v2 } from '../../netlify/functions/v2';
import { v2Router } from '../../netlify/functions/_lib/v2routes';
import { permissionsFor, type Permission } from '../../shared/permissions';
import type { WorkspaceRole } from '../../shared/contracts/dto';
import type { PgliteDb } from './helpers/pglite';
import {
  addMember,
  call,
  createOrg,
  createPerson,
  createProject,
  createTribe,
  createUser,
  createWorkspace,
  setupDb,
  teardownDb,
  testEnv,
  type TestUser,
} from './helpers/harness';

jest.setTimeout(120_000);

type Scope = 'ws' | 'org';
/** any-of permissions; 'session' = any signed-in user; 'public' = no auth; 'noOrg' = verified user without an org. */
type Need = Permission[] | 'session' | 'public' | 'noOrg';
interface RouteSpec {
  need: Need;
  scope?: Scope;
}

const ws = (...p: Permission[]): RouteSpec => ({ need: p, scope: 'ws' });
const org = (...p: Permission[]): RouteSpec => ({ need: p, scope: 'org' });

/** BACKLOG §4.3 route table. Keys are `METHOD pattern` exactly as registered in v2Router. */
const TABLE: Record<string, RouteSpec> = {
  'GET /me': { need: 'session' },
  'POST /orgs': { need: 'noOrg' },
  'GET /orgs/:orgId': org('org.view'),
  'PATCH /orgs/:orgId': org('org.manage'),
  'GET /orgs/:orgId/workspaces': org('org.view'),
  'POST /orgs/:orgId/workspaces': org('workspace.manage'),
  'GET /orgs/:orgId/members': org('org.members.manage', 'workspace.members.manage'),
  'PATCH /orgs/:orgId/members/:userId': org('org.members.manage', 'workspace.members.manage'),
  'DELETE /orgs/:orgId/members/:userId': org('org.members.manage'),
  'GET /orgs/:orgId/invitations': org('org.members.manage', 'workspace.members.manage'),
  'POST /orgs/:orgId/invitations': org('org.members.manage', 'workspace.members.manage'),
  'DELETE /orgs/:orgId/invitations/:id': org('org.members.manage', 'workspace.members.manage'),
  'GET /orgs/:orgId/audit': org('org.audit.view', 'workspace.audit.view'),
  'GET /orgs/:orgId/:kind': org('org.view'),
  'POST /orgs/:orgId/:kind': org('structure.write'),
  'PATCH /orgs/:orgId/:kind/:id': org('structure.write'),
  'DELETE /orgs/:orgId/:kind/:id': org('structure.write'),
  'GET /invitations/:token': { need: 'public' },
  'POST /invitations/:token/accept': { need: 'public' },
  'GET /workspaces/:wsId': ws('data.read'),
  'PATCH /workspaces/:wsId': ws('workspace.manage'),
  'DELETE /workspaces/:wsId': ws('workspace.manage'),
  'GET /workspaces/:wsId/members': ws('workspace.members.manage'),
  'PATCH /workspaces/:wsId/members/:userId': ws('workspace.members.manage'),
  'DELETE /workspaces/:wsId/members/:userId': ws('workspace.members.manage'),
  'GET /workspaces/:wsId/snapshot': ws('data.read'),
  'POST /workspaces/:wsId/sample-data': ws('people.write'),
  'POST /workspaces/:wsId/people': ws('people.write'),
  'POST /workspaces/:wsId/people/bulk': ws('people.write'),
  'POST /workspaces/:wsId/people/import': ws('import.csv'),
  // Target is someone else's person, so `people.write.own` does not apply.
  'POST /workspaces/:wsId/people/:personId/craft-requests': ws('people.write'),
  'PATCH /workspaces/:wsId/people/:id': ws('people.write'),
  'DELETE /workspaces/:wsId/people/:id': ws('people.write'),
  'GET /workspaces/:wsId/craft-requests': ws('data.read'),
  'POST /workspaces/:wsId/craft-requests/:id/:decision': ws('craftProfile.approve'),
  'POST /workspaces/:wsId/projects': ws('projects.write'),
  'PATCH /workspaces/:wsId/projects/:id': ws('projects.write'),
  'DELETE /workspaces/:wsId/projects/:id': ws('projects.write'),
  'POST /workspaces/:wsId/demand': ws('demand.write'),
  'POST /workspaces/:wsId/demand/batch': ws('demand.write'),
  'PATCH /workspaces/:wsId/demand/:id': ws('demand.write'),
  'DELETE /workspaces/:wsId/demand/:id': ws('demand.write'),
  'POST /workspaces/:wsId/allocations': ws('allocations.write'),
  'POST /workspaces/:wsId/allocations/batch': ws('allocations.write'),
  // Target allocation belongs to someone else, so `allocations.respond.own` does not apply.
  'POST /workspaces/:wsId/allocations/:id/respond': ws('allocations.write'),
  'PATCH /workspaces/:wsId/allocations/:id': ws('allocations.write'),
  'DELETE /workspaces/:wsId/allocations/:id': ws('allocations.write'),
  'POST /workspaces/:wsId/marketplace/propose': ws('allocations.propose'),
  'PUT /workspaces/:wsId/offers/:personId/:quarterKey': ws('offers.write'),
  'DELETE /workspaces/:wsId/offers/:personId/:quarterKey': ws('offers.write'),
  'POST /workspaces/:wsId/audit/export': ws('export'),
  'GET /workspaces/:wsId/integrations/jira/mappings': ws('integrations.view'),
  'POST /workspaces/:wsId/integrations/jira/mappings/auto-match': ws('integrations.run'),
  'PUT /workspaces/:wsId/integrations/jira/mappings/projects': ws('integrations.run'),
  'PUT /workspaces/:wsId/integrations/jira/mappings/people': ws('integrations.run'),
  'GET /workspaces/:wsId/calibration': ws('integrations.view'),
  'PUT /workspaces/:wsId/calibration/:tribeId': ws('integrations.run'),
  'POST /workspaces/:wsId/sync/jira': ws('integrations.run'),
  'GET /workspaces/:wsId/sync/jobs': ws('integrations.view'),
  'POST /workspaces/:wsId/sync/jobs/:jobId/step': ws('integrations.run'),
  'GET /workspaces/:wsId/sync/health': ws('data.read'),
  'GET /workspaces/:wsId/delivery': ws('data.read'),
  'POST /workspaces/:wsId/planview/preview': ws('integrations.run'),
  'POST /workspaces/:wsId/planview/apply': ws('integrations.run'),
  'POST /workspaces/:wsId/planview/test-mapping': ws('integrations.manage'),
};

type RoleName =
  | 'anonymous'
  | 'VIEWER'
  | 'CONTRIBUTOR'
  | 'PLANNER'
  | 'WORKSPACE_ADMIN'
  | 'ORG_ADMIN'
  | 'OTHER_TENANT_ORG_ADMIN'
  | 'PLATFORM_ADMIN';
const ROLES: RoleName[] = [
  'anonymous',
  'VIEWER',
  'CONTRIBUTOR',
  'PLANNER',
  'WORKSPACE_ADMIN',
  'ORG_ADMIN',
  'OTHER_TENANT_ORG_ADMIN',
  'PLATFORM_ADMIN',
];

/** Platform admins without a membership get read-only support access (AC-10): what `authz.ts` grants them. */
const SUPPORT_READ: Permission[] = ['org.view', 'data.read', 'export', 'org.audit.view'];
/** Org-level permissions a workspace role carries into org routes (filtered to its own workspaces by the handler). */
const ORG_SCOPED_FROM_WORKSPACE: Permission[] = ['structure.write', 'workspace.members.manage', 'workspace.audit.view'];

function heldPermissions(role: RoleName, scope: Scope): Set<Permission> {
  if (role === 'anonymous' || role === 'OTHER_TENANT_ORG_ADMIN') return new Set();
  if (role === 'PLATFORM_ADMIN') return new Set(SUPPORT_READ);
  if (role === 'ORG_ADMIN')
    return new Set(permissionsFor({ isPlatformAdmin: false, orgRole: 'ORG_ADMIN', workspaceRole: null }));
  const perms = permissionsFor({ isPlatformAdmin: false, orgRole: 'MEMBER', workspaceRole: role as WorkspaceRole });
  if (scope === 'ws') return new Set(perms);
  return new Set(perms.filter((p) => p === 'org.view' || ORG_SCOPED_FROM_WORKSPACE.includes(p)));
}

function expected(spec: RouteSpec, role: RoleName): 'allowed' | 'conflict' | 401 | 403 {
  if (spec.need === 'public') return 'allowed';
  if (role === 'anonymous') return 401;
  if (spec.need === 'session') return 'allowed';
  // Everyone but the platform admin already belongs to an org: 409 "You already belong to an organisation."
  if (spec.need === 'noOrg') return role === 'PLATFORM_ADMIN' ? 'allowed' : 'conflict';
  const held = heldPermissions(role, spec.scope ?? 'ws');
  return spec.need.some((p) => held.has(p)) ? 'allowed' : 403;
}

let db: PgliteDb;
let orgId: string;
let wsId: string;
let tribeId: string;
let otherPerson: string;
let otherAllocation: string;
const users: Partial<Record<RoleName, TestUser>> = {};

beforeAll(async () => {
  db = await setupDb();
  orgId = await createOrg(db, 'Matrix Org', 'ENTERPRISE', { visibility: 'members' });
  const otherOrg = await createOrg(db, 'Other Tenant');
  wsId = await createWorkspace(db, orgId);
  await createWorkspace(db, otherOrg);
  tribeId = await createTribe(db, orgId);
  for (const r of ['VIEWER', 'CONTRIBUTOR', 'PLANNER', 'WORKSPACE_ADMIN'] as WorkspaceRole[]) {
    users[r] = await createUser(db, { orgId, orgRole: 'MEMBER' });
    await addMember(db, users[r]!.id, wsId, r);
  }
  users.ORG_ADMIN = await createUser(db, { orgId, orgRole: 'ORG_ADMIN' });
  users.OTHER_TENANT_ORG_ADMIN = await createUser(db, { orgId: otherOrg, orgRole: 'ORG_ADMIN' });
  users.PLATFORM_ADMIN = await createUser(db, { platformAdmin: true });
  await createPerson(db, wsId, { name: 'Contributor self', linkedUserId: users.CONTRIBUTOR!.id });
  otherPerson = await createPerson(db, wsId, { name: 'Someone else' });
  const project = await createProject(db, wsId);
  otherAllocation = 'alloc-matrix-1';
  await db.query(
    `INSERT INTO allocations (id, workspace_id, resource_id, project_id, percentage, state) VALUES ($1, $2, $3, $4, 40, 'tentative')`,
    [otherAllocation, wsId, otherPerson, project],
  );
});
afterAll(() => teardownDb(db));
beforeEach(() => testEnv());

function concretePath(pattern: string): string {
  const values: Record<string, string> = {
    orgId,
    wsId,
    userId: randomUUID(),
    id: randomUUID(),
    personId: otherPerson,
    quarterKey: '2026-Q4',
    kind: 'tribes',
    token: 'no-such-invitation-token',
    decision: 'approve',
    jobId: randomUUID(),
    tribeId,
  };
  let path = pattern.replace(/:(\w+)/g, (_, k: string) => values[k] ?? 'x');
  if (pattern === '/workspaces/:wsId/allocations/:id/respond')
    path = path.replace(/allocations\/[^/]+/, `allocations/${otherAllocation}`);
  // Workspace admins read the org audit log scoped to a workspace they administer.
  if (pattern === '/orgs/:orgId/audit') path += `?workspaceId=${wsId}`;
  return `/api/v2${path}`;
}

describe('authorisation matrix (PL-12#AC1)', () => {
  it('has a table row for every registered v2 route', () => {
    const registered = v2Router.list().map((r) => `${r.method} ${r.pattern}`);
    expect(registered.filter((r) => !TABLE[r])).toEqual([]);
    expect(Object.keys(TABLE).filter((k) => !registered.includes(k))).toEqual([]);
    for (const r of v2Router.list()) {
      expect([r.method, r.pattern, r.auth]).toEqual([
        r.method,
        r.pattern,
        TABLE[`${r.method} ${r.pattern}`].need === 'public' ? 'none' : 'required',
      ]);
    }
  });

  it('returns the expected status for every route × role', async () => {
    const mismatches: string[] = [];
    for (const { method, pattern } of v2Router.list()) {
      const spec = TABLE[`${method} ${pattern}`];
      for (const role of ROLES) {
        const want = expected(spec, role);
        const token = role === 'anonymous' ? null : users[role]!.token;
        const body = method === 'GET' || method === 'DELETE' ? undefined : {};
        const r = await call(v2, method, concretePath(pattern), { token, body });
        const deniedByAuthz = r.status === 401 || (r.status === 403 && r.json.code === 'forbidden');
        const ok =
          want === 'allowed'
            ? !deniedByAuthz && r.status !== 405
            : want === 'conflict'
              ? r.status === 409
              : r.status === want && (want === 401 || r.json.code === 'forbidden');
        if (!ok)
          mismatches.push(
            `${method} ${pattern} as ${role}: expected ${want}, got ${r.status} ${r.json.code ?? ''} ${r.json.error ?? ''}`,
          );
      }
    }
    expect(mismatches).toEqual([]);
  });
});

/*
 * PL-12#AC2 regression set — where each case lives:
 *   SEC-01 no OTP in reset/verify responses ........ auth.test.ts "never returns a code from reset or verify"
 *   SEC-02 no SUPERUSER, other-org user → 409 ...... v2.org.test.ts "never grants platform admin, 409s users of another org"
 *   SEC-03 cross-tenant PATCH → 404 ................ below, and v2.org.test.ts "is tenant scoped"
 *   SEC-04 qbr cross-tenant → 403 .................. qbr.authz.test.ts
 *   ARC-01 switch-then-save leaves B intact ........ legacy.test.ts
 *   SEC-11 domain change clears secret ............. integrations.test.ts
 *   token tv revocation, CSRF, legacy bearer ....... auth.test.ts "sessions"
 */
describe('regression set (PL-12#AC2)', () => {
  it('cross-tenant PATCH of a member is refused (SEC-03)', async () => {
    const victim = users.PLANNER!.id;
    const r = await call(v2, 'PATCH', `/api/v2/orgs/${orgId}/members/${victim}`, {
      token: users.OTHER_TENANT_ORG_ADMIN!.token,
      body: { orgRole: 'ORG_ADMIN' },
    });
    expect(r.status).toBe(403);
    const other = await call(v2, 'PATCH', `/api/v2/orgs/${users.OTHER_TENANT_ORG_ADMIN!.org_id}/members/${victim}`, {
      token: users.OTHER_TENANT_ORG_ADMIN!.token,
      body: { orgRole: 'ORG_ADMIN' },
    });
    expect(other.status).toBe(404);
    expect((await db.query(`SELECT role FROM org_memberships WHERE user_id = $1`, [victim]))[0].role).toBe('MEMBER');
  });

  it('a contributor may respond only to their own allocations and edit only their own offers', async () => {
    const respond = await call(v2, 'POST', `/api/v2/workspaces/${wsId}/allocations/${otherAllocation}/respond`, {
      token: users.CONTRIBUTOR!.token,
      body: { decision: 'accept' },
    });
    expect(respond.status).toBe(403);
    const offer = await call(v2, 'PUT', `/api/v2/workspaces/${wsId}/offers/${otherPerson}/2026-Q4`, {
      token: users.CONTRIBUTOR!.token,
      body: { pct: 20, craftIds: [], note: null },
    });
    expect(offer.status).toBe(403);
  });
});
