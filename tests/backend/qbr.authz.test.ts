/** HS-04 / SEC-04: /api/qbr/* is tenant-isolated, role-checked and transactional. */
import { handler as qbr } from '../../netlify/functions/qbr';
import type { PgliteDb } from './helpers/pglite';
import {
  addMember,
  call,
  createOrg,
  createUser,
  createWorkspace,
  setupDb,
  teardownDb,
  testEnv,
  type TestUser,
} from './helpers/harness';

let db: PgliteDb;
let orgA: string;
let wsA: string;
let wsB: string;
let admin: TestUser;
let planner: TestUser;
let viewer: TestUser;
let stranger: TestUser;
let orgMember: TestUser;
let otherAdmin: TestUser;
let platform: TestUser;
let member: string;
let project: string;
let sprint: string;
let quarter: string;
let bMember: string;
let bQuarter: string;
let offOrgWs: string;

const q = (p: string, ws = wsA) => `/api/qbr${p}${p.includes('?') ? '&' : '?'}wsId=${ws}`;

beforeAll(async () => {
  db = await setupDb();
  orgA = await createOrg(db, 'QBR A', 'ENTERPRISE', { features: { qbrSprintModule: true } });
  const orgB = await createOrg(db, 'QBR B', 'ENTERPRISE', { features: { qbrSprintModule: true } });
  offOrgWs = await createWorkspace(db, await createOrg(db, 'QBR off'));
  wsA = await createWorkspace(db, orgA);
  wsB = await createWorkspace(db, orgB);
  admin = await createUser(db, { orgId: orgA, orgRole: 'MEMBER' });
  planner = await createUser(db, { orgId: orgA, orgRole: 'MEMBER' });
  viewer = await createUser(db, { orgId: orgA, orgRole: 'MEMBER' });
  stranger = await createUser(db, {});
  orgMember = await createUser(db, { orgId: orgA, orgRole: 'MEMBER' });
  otherAdmin = await createUser(db, { orgId: orgB, orgRole: 'ORG_ADMIN' });
  platform = await createUser(db, { platformAdmin: true });
  await addMember(db, admin.id, wsA, 'WORKSPACE_ADMIN');
  await addMember(db, planner.id, wsA, 'PLANNER');
  await addMember(db, viewer.id, wsA, 'VIEWER');

  expect((await call(qbr, 'POST', q('/seed'), { token: admin.token, body: {} })).status).toBe(200);
  expect((await call(qbr, 'POST', q('/seed', wsB), { token: otherAdmin.token, body: {} })).status).toBe(200);
  const pick = async (sql: string, ws: string) => String((await db.query(sql, [ws]))[0].id);
  member = await pick(`SELECT id FROM qbr_members WHERE workspace_id = $1 ORDER BY name LIMIT 1`, wsA);
  project = await pick(`SELECT id FROM qbr_projects WHERE workspace_id = $1 ORDER BY name LIMIT 1`, wsA);
  quarter = await pick(`SELECT id FROM qbr_quarters WHERE workspace_id = $1 ORDER BY start_date LIMIT 1`, wsA);
  sprint = String(
    (await db.query(`SELECT id FROM qbr_sprints WHERE quarter_id = $1 ORDER BY sprint_number LIMIT 1`, [quarter]))[0]
      .id,
  );
  bMember = await pick(`SELECT id FROM qbr_members WHERE workspace_id = $1 LIMIT 1`, wsB);
  bQuarter = await pick(`SELECT id FROM qbr_quarters WHERE workspace_id = $1 LIMIT 1`, wsB);
});
afterAll(() => teardownDb(db));
beforeEach(() => testEnv());

describe('read access (HS-04#AC1, AC3)', () => {
  it('answers 403 feature_disabled while the org has the sprint module off (SH-05#AC3)', async () => {
    const offAdmin = await createUser(db, {
      orgId: String((await db.query(`SELECT org_id FROM workspaces WHERE id = $1`, [offOrgWs]))[0].org_id),
      orgRole: 'ORG_ADMIN',
    });
    const r = await call(qbr, 'GET', q('/overview', offOrgWs), { token: offAdmin.token });
    expect([r.status, r.json.code]).toEqual([403, 'feature_disabled']);
    const w = await call(qbr, 'POST', q('/seed', offOrgWs), { token: offAdmin.token, body: {} });
    expect([w.status, w.json.code]).toEqual([403, 'feature_disabled']);
  });

  it('returns 403 to non-members and other tenants, and 200 to members and the org admin', async () => {
    for (const p of ['/overview', '/members', '/projects', '/okrs', '/squads', '/scenarios']) {
      expect([p, (await call(qbr, 'GET', q(p), { token: stranger.token })).status]).toEqual([p, 403]);
      const other = await call(qbr, 'GET', q(p), { token: otherAdmin.token });
      expect([p, other.status, other.json.code]).toEqual([p, 403, 'forbidden']);
      expect([p, (await call(qbr, 'GET', q(p), { token: viewer.token })).status]).toEqual([p, 200]);
    }
    // AC-09: with org-wide visibility an org member without a membership row reads as VIEWER, but cannot write.
    expect((await call(qbr, 'GET', q('/overview'), { token: orgMember.token })).status).toBe(200);
    expect((await call(qbr, 'POST', q('/booking'), { token: orgMember.token, body: {} })).status).toBe(403);
    expect((await call(qbr, 'GET', q('/overview'))).status).toBe(401);
    expect((await call(qbr, 'GET', '/api/qbr/overview', { token: viewer.token })).status).toBe(400);
  });

  it('ignores a client orgId and scopes data to the workspace', async () => {
    const r = await call(qbr, 'GET', q(`/members?orgId=${otherAdmin.org_id}`), { token: viewer.token });
    const ids = (r.json.members as Array<{ id: string; workspace_id: string }>).map((m) => m.workspace_id);
    expect(new Set(ids)).toEqual(new Set([wsA]));
  });
});

describe('ids from another workspace (HS-04#AC4-5)', () => {
  it('404s on quarter and scenario ids from another workspace', async () => {
    expect((await call(qbr, 'GET', q(`/quarter/${bQuarter}`), { token: viewer.token })).status).toBe(404);
    expect((await call(qbr, 'GET', q(`/quarter/${quarter}`), { token: viewer.token })).status).toBe(200);
    expect((await call(qbr, 'GET', q('/scenario/not-a-uuid'), { token: viewer.token })).status).toBe(404);
  });

  it('rejects booking ids that are not in the workspace with field errors', async () => {
    const r = await call(qbr, 'POST', q('/booking'), {
      token: planner.token,
      body: { memberId: bMember, projectId: project, sprintId: sprint, percentage: 40 },
    });
    expect(r.status).toBe(400);
    expect(r.json).toMatchObject({ code: 'bad_request', fields: { memberId: 'Not in this workspace' } });
  });
});

describe('write roles (HS-04#AC2, AC6, AC7)', () => {
  it('viewers cannot write, planners can book, commit needs PMO Admin', async () => {
    const body = { memberId: member, projectId: project, sprintId: sprint, percentage: 40 };
    expect((await call(qbr, 'POST', q('/booking'), { token: viewer.token, body })).status).toBe(403);
    expect((await call(qbr, 'POST', q('/booking'), { token: otherAdmin.token, body })).status).toBe(403);
    const ok = await call(qbr, 'POST', q('/booking'), { token: planner.token, body });
    expect(ok.status).toBe(200);
    expect((ok.json.booking as { org_id: string }).org_id).toBe(orgA);

    const sc = await call(qbr, 'POST', q('/scenario'), {
      token: planner.token,
      body: { name: 'What if', quarterId: quarter },
    });
    expect(sc.status).toBe(201);
    const scenarioId = (sc.json.scenario as { id: string }).id;
    expect(
      (await call(qbr, 'POST', q(`/scenario/${scenarioId}/commit`), { token: planner.token, body: {} })).status,
    ).toBe(403);
    expect((await call(qbr, 'DELETE', q(`/scenario/${scenarioId}`), { token: viewer.token })).status).toBe(403);
    expect(
      (await call(qbr, 'POST', q(`/scenario/${scenarioId}/commit`), { token: admin.token, body: {} })).status,
    ).toBe(200);
    const ev = await db.query(`SELECT action FROM audit_events WHERE workspace_id = $1 ORDER BY occurred_at`, [wsA]);
    expect(ev.map((e) => e.action)).toEqual(
      expect.arrayContaining(['qbr.booking', 'qbr.scenario_create', 'qbr.scenario_commit']),
    );
  });

  it('refuses seeding in production unless platform admin, and seeding needs PMO Admin', async () => {
    expect((await call(qbr, 'POST', q('/seed'), { token: planner.token, body: {} })).status).toBe(403);
    testEnv({ CONTEXT: 'production' });
    expect((await call(qbr, 'POST', q('/seed'), { token: admin.token, body: {} })).status).toBe(403);
    const r = await call(qbr, 'POST', q('/seed'), { token: platform.token, body: {} });
    expect(r.status).toBe(200);
    const ev = await db.query(`SELECT actor_type FROM audit_events WHERE action = 'qbr.seed' ORDER BY id DESC LIMIT 1`);
    expect(ev[0].actor_type).toBe('platform_admin');
  });

  it('rolls back a scenario commit when a statement fails', async () => {
    // The seed above replaced the demo quarter.
    quarter = String((await db.query(`SELECT id FROM qbr_quarters WHERE workspace_id = $1 LIMIT 1`, [wsA]))[0].id);
    const sc = await call(qbr, 'POST', q('/scenario'), {
      token: planner.token,
      body: { name: 'Rollback', quarterId: quarter },
    });
    const scenarioId = (sc.json.scenario as { id: string }).id;
    const live = await db.query(
      `SELECT count(*)::int AS n FROM qbr_bookings WHERE workspace_id = $1 AND scenario_id IS NULL`,
      [wsA],
    );
    db.failOn = /UPDATE qbr_scenarios SET is_committed/;
    const r = await call(qbr, 'POST', q(`/scenario/${scenarioId}/commit`), { token: admin.token, body: {} });
    db.failOn = null;
    expect(r.status).toBe(500);
    const after = await db.query(
      `SELECT count(*)::int AS n FROM qbr_bookings WHERE workspace_id = $1 AND scenario_id IS NULL`,
      [wsA],
    );
    expect(after[0].n).toBe(live[0].n);
    const still = await db.query(`SELECT count(*)::int AS n FROM qbr_bookings WHERE scenario_id = $1`, [scenarioId]);
    expect(still[0].n).toBeGreaterThan(0);
  });
});
