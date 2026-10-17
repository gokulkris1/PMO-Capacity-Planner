/**
 * Independent QA (Release 2.0): adversarial API checks against the real handlers on PGlite.
 *
 * Passing tests pin behaviour that QA verified on the live stack and that the developer suite does not cover in this
 * form (CSRF on cookie writes, forged tokens, logout-all revoking v1.1 tokens, IDOR through the caller's own wsId,
 * invitation privilege escalation). Skipped tests carry the QA defect id and fail today:
 *  - QA-001  login response still returns the session token in the JSON body (AC-03#AC1).
 *  - QA-003  a Planner bypasses the Planview lock by patching `source` to "manual" (AL-05#AC2).
 *  - QA-008  changing a member's role does not bump their token_version (AC-06#AC2).
 *  - QA-019  plain sign-out leaves the session JWT valid on the server until it expires (AC-03#AC6 hardening).
 */
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { handler as auth } from '../../netlify/functions/auth';
import { handler as v2 } from '../../netlify/functions/v2';
import { handler as workspaceFn } from '../../netlify/functions/workspace';
import type { PgliteDb } from '../backend/helpers/pglite';
import {
  JWT_SECRET,
  PASSWORD,
  addMember,
  call,
  cookieValue,
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
} from '../backend/helpers/harness';

let db: PgliteDb;
let orgA: string;
let orgB: string;
let wsA: string;
let wsB: string;
let planner: TestUser;
let wsAdmin: TestUser;
let orgAdmin: TestUser;
let otherAdmin: TestUser;
let viewer: TestUser;
let ip = 0;
const headers = () => ({ 'x-nf-client-connection-ip': `192.0.2.${++ip % 250}` });

async function login(email: string) {
  const res = await call(auth, 'POST', '/api/auth/login', { body: { email, password: PASSWORD }, headers: headers() });
  const session = cookieValue(res.cookies, 'pcp_session') ?? '';
  const csrf = cookieValue(res.cookies, 'pcp_csrf') ?? '';
  return { res, cookies: { pcp_session: session, pcp_csrf: csrf }, csrf };
}

beforeAll(async () => {
  db = await setupDb();
  orgA = await createOrg(db, 'Acme QA');
  orgB = await createOrg(db, 'Beta QA');
  wsA = await createWorkspace(db, orgA, 'Main');
  wsB = await createWorkspace(db, orgB, 'Other');
  await createTribe(db, orgA, 'Payments');
  planner = await createUser(db, { orgId: orgA, orgRole: 'MEMBER', email: 'planner@qa.test' });
  wsAdmin = await createUser(db, { orgId: orgA, orgRole: 'MEMBER', email: 'pmo@qa.test' });
  orgAdmin = await createUser(db, { orgId: orgA, orgRole: 'ORG_ADMIN', email: 'admin@qa.test' });
  otherAdmin = await createUser(db, { orgId: orgB, orgRole: 'ORG_ADMIN', email: 'admin@other.test' });
  viewer = await createUser(db, { orgId: orgA, orgRole: 'MEMBER', email: 'viewer@qa.test' });
  await addMember(db, planner.id, wsA, 'PLANNER');
  await addMember(db, wsAdmin.id, wsA, 'WORKSPACE_ADMIN');
  await addMember(db, viewer.id, wsA, 'VIEWER');
  await createPerson(db, wsA, { id: 'p-a', name: 'Alice' });
  await createProject(db, wsA, { id: 'pr-a', name: 'Alpha' });
  await createPerson(db, wsB, { id: 'p-b', name: 'Bob (other tenant)' });
  await createProject(db, wsB, { id: 'pr-b', name: 'Beta' });
  await db.query(
    `INSERT INTO allocations (id, workspace_id, resource_id, project_id, percentage, source, state, external_ref)
     VALUES ('al-pv', $1, 'p-a', 'pr-a', 70, 'planview', 'confirmed', 'PV-ASSIGN-1'),
            ('al-b', $2, 'p-b', 'pr-b', 50, 'manual', 'confirmed', NULL)`,
    [wsA, wsB],
  );
});
afterAll(async () => teardownDb(db));
beforeEach(() => testEnv());

describe('QA: sessions and CSRF', () => {
  it('a cookie-authenticated write without, or with a wrong, X-CSRF-Token is refused', async () => {
    const s = await login(planner.email);
    const body = { version: 1, patch: { location: 'Cork' } };
    const none = await call(v2, 'PATCH', `/api/v2/workspaces/${wsA}/people/p-a`, { cookies: s.cookies, body });
    const wrong = await call(v2, 'PATCH', `/api/v2/workspaces/${wsA}/people/p-a`, {
      cookies: s.cookies,
      headers: { 'x-csrf-token': 'x'.repeat(43) },
      body,
    });
    expect([none.status, none.json.error]).toEqual([403, 'CSRF check failed']);
    expect(wrong.status).toBe(403);
  });

  it('alg:none and foreign-secret tokens are refused', async () => {
    const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const none = `${enc({ alg: 'none', typ: 'JWT' })}.${enc({ sub: planner.id, tv: 0, exp: Date.now() / 1000 + 600 })}.`;
    const forged = jwt.sign({ sub: planner.id, tv: 0 }, 'not-the-secret', { expiresIn: 600 });
    for (const token of [none, forged]) expect((await call(v2, 'GET', '/api/v2/me', { token })).status).toBe(401);
  });

  it('Sign out of all devices revokes a v1.1 bearer token (no tv claim) and every cookie session', async () => {
    const legacy = jwt.sign({ id: viewer.id, email: viewer.email, role: 'USER', org_id: orgA }, JWT_SECRET, {
      expiresIn: '7d',
    });
    expect((await call(v2, 'GET', '/api/v2/me', { token: legacy })).status).toBe(200);
    const s = await login(viewer.email);
    const out = await call(auth, 'POST', '/api/auth/logout-all', {
      cookies: s.cookies,
      headers: { 'x-csrf-token': s.csrf },
    });
    expect(out.status).toBe(204);
    expect((await call(v2, 'GET', '/api/v2/me', { token: legacy })).status).toBe(401);
    expect((await call(v2, 'GET', '/api/v2/me', { cookies: s.cookies })).status).toBe(401);
  });

  // QA-001 (Major): the login JSON still carries the 7-day session JWT, so any script that can call /login (or read
  // its response) gets a bearer token that bypasses the HttpOnly cookie and CSRF. Known deviation (handoff-I §7.1).
  it('QA-001 POST /api/auth/login returns { user } and no token (AC-03#AC1)', async () => {
    const s = await login(planner.email);
    expect(s.res.status).toBe(200);
    expect(s.res.json).not.toHaveProperty('token');
  });

  // QA-019 (Minor): sign-out only clears cookies; a copied pcp_session keeps working until it expires (7 days).
  it.skip('QA-019 a session cookie value stops working after plain sign-out', async () => {
    const s = await login(planner.email);
    await call(auth, 'POST', '/api/auth/logout', { cookies: s.cookies });
    expect((await call(v2, 'GET', '/api/v2/me', { cookies: s.cookies })).status).toBe(401);
  });
});

describe('QA: tenant isolation and privilege escalation', () => {
  it("ids from another tenant are not reachable through the caller's own workspace id", async () => {
    const W = `/api/v2/workspaces/${wsA}`;
    const patch = await call(v2, 'PATCH', `${W}/people/p-b`, {
      token: planner.token,
      body: { version: 1, patch: { name: 'pwned' } },
    });
    const del = await call(v2, 'DELETE', `${W}/allocations/al-b?version=1`, { token: planner.token });
    const create = await call(v2, 'POST', `${W}/allocations`, {
      token: planner.token,
      body: { resourceId: 'p-b', projectId: 'pr-a', percentage: 10 },
    });
    expect([patch.status, del.status, create.status]).toEqual([404, 404, 400]);
    const rows = await db.query(`SELECT name FROM resources WHERE id = 'p-b'`);
    expect(rows[0].name).toBe('Bob (other tenant)');
    expect((await db.query(`SELECT 1 FROM allocations WHERE id = 'al-b'`)).length).toBe(1);
  });

  it('another org admin cannot read the workspace through the legacy GET /api/workspace either', async () => {
    const res = await call(workspaceFn, 'GET', `/api/workspace?wsId=${wsA}`, { token: otherAdmin.token });
    expect(res.status).toBe(403);
    expect(res.body).not.toContain('Alice');
  });

  it("invitations cannot grant platform admin, plant users in another org or pull another org's user", async () => {
    const O = `/api/v2/orgs/${orgA}/invitations`;
    const sup = await call(v2, 'POST', O, {
      token: orgAdmin.token,
      body: { email: 'x@qa.test', orgRole: 'MEMBER', role: 'SUPERUSER', workspaces: [] },
    });
    const foreignWs = await call(v2, 'POST', O, {
      token: orgAdmin.token,
      body: { email: 'y@qa.test', orgRole: 'MEMBER', workspaces: [{ workspaceId: wsB, role: 'PLANNER' }] },
    });
    const otherOrgUser = await call(v2, 'POST', O, {
      token: orgAdmin.token,
      body: { email: otherAdmin.email, orgRole: 'ORG_ADMIN', workspaces: [] },
    });
    const pmoInvitesAdmin = await call(v2, 'POST', O, {
      token: wsAdmin.token,
      body: { email: 'z@qa.test', orgRole: 'ORG_ADMIN', workspaces: [{ workspaceId: wsA, role: 'VIEWER' }] },
    });
    expect([sup.status, foreignWs.status, otherOrgUser.status, pmoInvitesAdmin.status]).toEqual([400, 400, 409, 403]);
    const u = await db.query(`SELECT org_id, is_platform_admin FROM users WHERE id = $1`, [otherAdmin.id]);
    expect(u[0]).toMatchObject({ org_id: orgB, is_platform_admin: false });
  });

  // QA-008 (Minor): AC-06#AC2 says a role change bumps the target's token_version. Authorisation is read from the
  // database on every request, so the demotion itself takes effect immediately, but the AC is not met.
  it.skip("QA-008 changing a member's workspace role bumps their token_version (AC-06#AC2)", async () => {
    const before = await db.query<{ token_version: number }>(`SELECT token_version FROM users WHERE id = $1`, [
      viewer.id,
    ]);
    const res = await call(v2, 'PATCH', `/api/v2/workspaces/${wsA}/members/${viewer.id}`, {
      token: orgAdmin.token,
      body: { role: 'CONTRIBUTOR' },
    });
    expect(res.status).toBe(200);
    const after = await db.query<{ token_version: number }>(`SELECT token_version FROM users WHERE id = $1`, [
      viewer.id,
    ]);
    expect(after[0].token_version).toBe(before[0].token_version + 1);
  });
});

describe('QA: Planview ownership rule (AL-05#AC2)', () => {
  const W = () => `/api/v2/workspaces/${wsA}`;
  const versionOf = async (id: string) =>
    Number((await db.query<{ version: number }>(`SELECT version FROM allocations WHERE id = $1`, [id]))[0].version);

  it('under the default "locked" rule a percentage edit of a Planview booking is refused with 409', async () => {
    const res = await call(v2, 'PATCH', `${W()}/allocations/al-pv`, {
      token: planner.token,
      body: { version: await versionOf('al-pv'), patch: { percentage: 20 } },
    });
    expect([res.status, res.json.error]).toEqual([409, 'Locked: sourced from Planview']);
  });

  // QA-003 (Major): the same Planner can PATCH { source: 'manual' } (200), which unlocks the booking for any later edit
  // or delete, although the org rule says Planview bookings are locked.
  it('QA-003 a Planner cannot unlock a Planview booking by patching its source to manual', async () => {
    const res = await call(v2, 'PATCH', `${W()}/allocations/al-pv`, {
      token: planner.token,
      body: { version: await versionOf('al-pv'), patch: { source: 'manual' } },
    });
    expect(res.status).toBe(409);
    const row = await db.query(`SELECT source FROM allocations WHERE id = 'al-pv'`);
    expect(row[0].source).toBe('planview');
  });

  it('QA-003 every field of a locked Planview booking is refused, provenance included', async () => {
    for (const patch of [{ externalRef: null }, { notes: 'mine now' }, { state: 'tentative' }, { source: 'jira' }]) {
      const res = await call(v2, 'PATCH', `${W()}/allocations/al-pv`, {
        token: planner.token,
        body: { version: await versionOf('al-pv'), patch },
      });
      expect([res.status, res.json.error]).toEqual([409, 'Locked: sourced from Planview']);
    }
    const row = await db.query(`SELECT source, external_ref FROM allocations WHERE id = 'al-pv'`);
    expect(row[0]).toMatchObject({ source: 'planview', external_ref: 'PV-ASSIGN-1' });
  });

  it('QA-003 provenance is read-only on any booking for every role; an override still makes it manual', async () => {
    const id = randomUUID();
    await db.query(
      `INSERT INTO allocations (id, workspace_id, resource_id, project_id, percentage, source, state, external_ref)
       VALUES ($1, $2, 'p-a', 'pr-a', 30, 'marketplace', 'confirmed', NULL)`,
      [id, wsA],
    );
    for (const [who, patch] of [
      [planner, { source: 'manual' }],
      [wsAdmin, { source: 'planview' }],
      [orgAdmin, { externalRef: 'PV-FAKE' }],
    ] as const) {
      const res = await call(v2, 'PATCH', `${W()}/allocations/${id}`, {
        token: who.token,
        body: { version: await versionOf(id), patch },
      });
      expect(res.status).toBe(400);
    }
    // Unchanged provenance in a patch (e.g. an undo that restores the whole row) is fine.
    const same = await call(v2, 'PATCH', `${W()}/allocations/${id}`, {
      token: planner.token,
      body: { version: await versionOf(id), patch: { percentage: 35, source: 'marketplace', externalRef: null } },
    });
    expect(same.status).toBe(200);
    // Under "Overridable" a Planner may edit a Planview booking: it becomes manual and keeps its external_ref.
    await db.query(`UPDATE organizations SET planning = '{"planviewOwnership":"overridable"}' WHERE id = $1`, [orgA]);
    const pvId = randomUUID();
    await db.query(
      `INSERT INTO allocations (id, workspace_id, resource_id, project_id, percentage, source, state, external_ref)
       VALUES ($1, $2, 'p-a', 'pr-a', 30, 'planview', 'confirmed', 'PV-ASSIGN-3')`,
      [pvId, wsA],
    );
    const sourceOnly = await call(v2, 'PATCH', `${W()}/allocations/${pvId}`, {
      token: planner.token,
      body: { version: await versionOf(pvId), patch: { source: 'manual' } },
    });
    expect(sourceOnly.status).toBe(400);
    const edit = await call(v2, 'PATCH', `${W()}/allocations/${pvId}`, {
      token: planner.token,
      body: { version: await versionOf(pvId), patch: { percentage: 40 } },
    });
    expect(edit.status).toBe(200);
    expect(edit.json).toMatchObject({ source: 'manual', externalRef: 'PV-ASSIGN-3', percentage: 40 });
    await db.query(`UPDATE organizations SET planning = '{}' WHERE id = $1`, [orgA]);
  });

  it('a Planner cannot delete a locked Planview booking', async () => {
    const id = randomUUID();
    await db.query(
      `INSERT INTO allocations (id, workspace_id, resource_id, project_id, percentage, source, state, external_ref)
       VALUES ($1, $2, 'p-a', 'pr-a', 30, 'planview', 'confirmed', 'PV-ASSIGN-2')`,
      [id, wsA],
    );
    const res = await call(v2, 'DELETE', `${W()}/allocations/${id}?version=${await versionOf(id)}`, {
      token: planner.token,
    });
    expect(res.status).toBe(409);
  });
});
