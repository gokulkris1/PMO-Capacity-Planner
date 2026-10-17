/**
 * Legacy endpoints kept for cached v1.1 bundles (PL-03, AC-02#AC7, ARC-01, PL-09, ST-09):
 * read-only workspace GET by wsId, POST 410, DB-derived my_workspaces / workspace_lookup, platform-only cockpit
 * and audit, retired functions removed.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { handler as workspace } from '../../netlify/functions/workspace';
import { handler as myWorkspaces } from '../../netlify/functions/my_workspaces';
import { handler as lookup } from '../../netlify/functions/workspace_lookup';
import { handler as orgManage } from '../../netlify/functions/org_manage';
import { handler as auditFn } from '../../netlify/functions/audit';
import { handler as jira } from '../../netlify/functions/jira';
import type { PgliteDb } from './helpers/pglite';
import {
  addMember,
  call,
  createOrg,
  createPerson,
  createProject,
  createUser,
  createWorkspace,
  setupDb,
  teardownDb,
  testEnv,
  type TestUser,
} from './helpers/harness';

let db: PgliteDb;
let org: string;
let otherOrg: string;
let wsA: string;
let wsB: string;
let wsOther: string;
let planner: TestUser;
let orgAdmin: TestUser;
let outsider: TestUser;
let platform: TestUser;

beforeAll(async () => {
  db = await setupDb();
  org = await createOrg(db, 'Legacy Org', 'ENTERPRISE', { visibility: 'members' });
  otherOrg = await createOrg(db, 'Other Org');
  wsA = await createWorkspace(db, org, 'Alpha');
  wsB = await createWorkspace(db, org, 'Bravo');
  wsOther = await createWorkspace(db, otherOrg, 'Other');
  planner = await createUser(db, { orgId: org, orgRole: 'MEMBER' });
  orgAdmin = await createUser(db, { orgId: org, orgRole: 'ORG_ADMIN' });
  outsider = await createUser(db, { orgId: otherOrg, orgRole: 'ORG_ADMIN' });
  platform = await createUser(db, { platformAdmin: true });
  await addMember(db, planner.id, wsA, 'PLANNER');
  await addMember(db, planner.id, wsB, 'VIEWER');
  const pa = await createPerson(db, wsA, { name: 'Alice A' });
  const pb = await createPerson(db, wsB, { name: 'Bob B' });
  const prA = await createProject(db, wsA, { name: 'Project A' });
  const prB = await createProject(db, wsB, { name: 'Project B' });
  await db.query(
    `INSERT INTO allocations (id, workspace_id, resource_id, project_id, percentage) VALUES ('a-1', $1, $2, $3, 50), ('b-1', $4, $5, $6, 25)`,
    [wsA, pa, prA, wsB, pb, prB],
  );
  await createPerson(db, wsOther, { name: 'Other person' });
});
afterAll(() => teardownDb(db));
beforeEach(() => testEnv());

describe('GET /api/workspace (PL-03)', () => {
  it('loads the workspace named by wsId with the v1.1 shape', async () => {
    const r = await call(workspace, 'GET', `/api/workspace?wsId=${wsB}`, { token: planner.token });
    expect(r.status).toBe(200);
    expect((r.json.resources as Array<{ name: string }>).map((x) => x.name)).toEqual(['Bob B']);
    expect((r.json.allocations as Array<{ id: string; percentage: number }>)[0]).toMatchObject({
      id: 'b-1',
      percentage: 25,
    });
    expect(r.json).toMatchObject({
      workspaceName: 'Bravo',
      orgName: 'Legacy Org',
      workspaceRole: 'USER',
      canWrite: false,
    });
  });

  it('falls back to the first accessible workspace in the org, deterministically', async () => {
    const r = await call(workspace, 'GET', '/api/workspace', { token: planner.token });
    expect(r.json.workspaceName).toBe('Alpha');
    expect(r.json.canWrite).toBe(true);
  });

  it('refuses another tenant and non-members of a members-only workspace', async () => {
    expect((await call(workspace, 'GET', `/api/workspace?wsId=${wsA}`, { token: outsider.token })).status).toBe(403);
    const slug = (await db.query(`SELECT slug FROM organizations WHERE id = $1`, [org]))[0].slug;
    expect((await call(workspace, 'GET', `/api/workspace?orgSlug=${slug}`, { token: outsider.token })).status).toBe(
      403,
    );
    expect((await call(workspace, 'GET', `/api/workspace?wsId=${wsA}`)).status).toBe(401);
  });
});

describe('POST /api/workspace is retired (PL-03#AC1, ARC-01)', () => {
  it('answers 410 and leaves workspace B intact after a switch-then-save', async () => {
    await call(workspace, 'GET', `/api/workspace?wsId=${wsA}`, { token: planner.token });
    await call(workspace, 'GET', `/api/workspace?wsId=${wsB}`, { token: planner.token });
    const before = await db.query(`SELECT id, percentage FROM allocations WHERE workspace_id = $1`, [wsB]);
    const r = await call(workspace, 'POST', `/api/workspace?wsId=${wsB}`, {
      token: planner.token,
      body: { resources: [], projects: [], allocations: [] },
    });
    expect(r.status).toBe(410);
    expect(r.json).toMatchObject({ code: 'gone', error: 'PMO Capacity Planner was updated. Reload the page.' });
    expect(await db.query(`SELECT id, percentage FROM allocations WHERE workspace_id = $1`, [wsB])).toEqual(before);
    expect((await db.query(`SELECT count(*)::int AS n FROM resources WHERE workspace_id = $1`, [wsB]))[0].n).toBe(1);
  });
});

describe('membership lookups from the database (AC-02#AC7)', () => {
  it('my_workspaces lists DB memberships; org admins see all org workspaces; platform admins see all', async () => {
    const mine = await call(myWorkspaces, 'GET', '/api/my_workspaces', { token: planner.token });
    expect((mine.json.workspaces as Array<{ name: string; role: string }>).map((w) => [w.name, w.role])).toEqual([
      ['Alpha', 'WORKSPACE_OWNER'], // PLANNER maps to the v1.1 owner role (shared/permissions.ts)
      ['Bravo', 'USER'],
    ]);
    const admin = await call(myWorkspaces, 'GET', '/api/my_workspaces', { token: orgAdmin.token });
    expect((admin.json.workspaces as Array<{ name: string; role: string }>).map((w) => w.role)).toEqual([
      'PMO_ADMIN',
      'PMO_ADMIN',
    ]);
    const all = await call(myWorkspaces, 'GET', '/api/my_workspaces', { token: platform.token });
    expect((all.json.workspaces as unknown[]).length).toBeGreaterThanOrEqual(3);
  });

  it('workspace_lookup returns the caller own org slug, or null', async () => {
    const r = await call(lookup, 'GET', '/api/workspace_lookup', { token: outsider.token });
    expect(r.json.orgSlug).toMatch(/^other-org-/);
    expect((await call(lookup, 'GET', '/api/workspace_lookup', { token: platform.token })).json.orgSlug).toBeNull();
  });
});

describe('platform-only legacy routes (ST-09, AC-10, PL-09)', () => {
  it('org_manage create paths are gone and the cockpit is platform-only and audited', async () => {
    expect(
      (await call(orgManage, 'POST', '/api/org_manage', { token: orgAdmin.token, body: { name: 'X' } })).status,
    ).toBe(410);
    expect((await call(orgManage, 'GET', '/api/org_manage', { token: orgAdmin.token })).status).toBe(403);
    const r = await call(orgManage, 'GET', '/api/org_manage', { token: platform.token });
    expect(r.status).toBe(200);
    expect((r.json.orgs as Array<{ id: string }>).map((o) => o.id)).toEqual(expect.arrayContaining([org, otherOrg]));
    const ev = await db.query(
      `SELECT actor_type FROM audit_events WHERE action = 'support.access' AND target_id = 'orgs'`,
    );
    expect(ev[0].actor_type).toBe('platform_admin');
  });

  it('audit is platform-only', async () => {
    expect((await call(auditFn, 'GET', '/api/audit', { token: orgAdmin.token })).status).toBe(403);
    expect((await call(auditFn, 'GET', '/api/audit', { token: platform.token })).status).toBe(200);
  });

  it('the body-credential Jira proxy is gone', async () => {
    const r = await call(jira, 'POST', '/api/jira', { body: { domain: 'x.atlassian.net', email: 'a', token: 'b' } });
    expect(r.status).toBe(410);
  });

  it('retired functions are removed from the bundle (SEC-17, SEC-21, HS-17)', () => {
    const dir = join(__dirname, '../../netlify/functions');
    for (const f of ['org_create.ts', 'email_receipt.ts', 'theme_extract.ts']) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed repo paths
      expect([f, existsSync(join(dir, f))]).toEqual([f, false]);
    }
  });
});
