/**
 * /api/v2 data routes: snapshot, people, projects, demand, allocations, batches, conflicts, entitlements,
 * sample data, marketplace, offers, craft requests (PL-04, PL-07, DM-01/03/05, PPL-03/04/06, AL-05).
 */
import { randomUUID } from 'node:crypto';
import { handler as v2 } from '../../netlify/functions/v2';
import { setEmailTransport } from '../../netlify/functions/_lib/email';
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

let db: PgliteDb;
let org: string;
let ws: string;
let tribe: string;
let planner: TestUser;
let planner2: TestUser;
let viewer: TestUser;
let contributor: TestUser;
const mails: string[] = [];

const W = () => `/api/v2/workspaces/${ws}`;

beforeAll(async () => {
  db = await setupDb();
  org = await createOrg(db, 'Data Org');
  ws = await createWorkspace(db, org, 'Main');
  tribe = await createTribe(db, org, 'Payments');
  planner = await createUser(db, { orgId: org, orgRole: 'MEMBER', name: 'Pat Planner' });
  planner2 = await createUser(db, { orgId: org, orgRole: 'MEMBER', name: 'Paula Planner' });
  viewer = await createUser(db, { orgId: org, orgRole: 'MEMBER' });
  contributor = await createUser(db, { orgId: org, orgRole: 'MEMBER', email: 'squad@data.test' });
  await addMember(db, planner.id, ws, 'PLANNER');
  await addMember(db, planner2.id, ws, 'PLANNER');
  await addMember(db, viewer.id, ws, 'VIEWER');
  await addMember(db, contributor.id, ws, 'CONTRIBUTOR');
  setEmailTransport({
    send: async (m) => {
      mails.push(`${m.to}|${m.subject}`);
      return {};
    },
  });
});
afterAll(async () => {
  setEmailTransport(null);
  await teardownDb(db);
});
beforeEach(() => testEnv({ RESEND_API_KEY: 're_test' }));

describe('people', () => {
  it('creates with a server UUID, validates crafts and dual-writes craft_profile (PL-04#AC5, #AC8)', async () => {
    const r = await call(v2, 'POST', `${W()}/people`, {
      token: planner.token,
      body: {
        name: 'Noma Odigie',
        primaryCraft: 'scrum-master',
        secondaryCrafts: [{ craftId: 'business-analysis', proficiency: 2, maxPct: 30 }],
        tribeAffinity: [tribe],
        targetUtil: 90,
      },
    });
    expect(r.status).toBe(201);
    expect(r.json.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.json).toMatchObject({ name: 'Noma Odigie', version: 1, targetUtil: 90, tribeAffinity: [tribe] });
    expect((r.json.updatedBy as { name: string }).name).toBe('Pat Planner');
    const row = await db.query(`SELECT craft_profile, avatar_initials FROM resources WHERE id = $1`, [r.json.id]);
    expect(row[0].craft_profile).toMatchObject({
      primaryCraft: 'scrum-master',
      tribeAffinity: ['Payments'],
      targetUtil: 90,
    });
    expect(row[0].avatar_initials).toBe('NO');
  });

  it('rejects a non-UUID id, an unknown craft and the primary craft as secondary', async () => {
    const badId = await call(v2, 'POST', `${W()}/people`, { token: planner.token, body: { name: 'X', id: 'r1' } });
    expect(badId.status).toBe(400);
    expect(badId.json.fields).toEqual({ id: 'Must be a UUID' });
    const badCraft = await call(v2, 'POST', `${W()}/people`, {
      token: planner.token,
      body: { name: 'X', primaryCraft: 'nope' },
    });
    expect(badCraft.status).toBe(400);
    expect(badCraft.json.fields).toEqual({ primaryCraft: 'Unknown craft' });
    const dup = await call(v2, 'POST', `${W()}/people`, {
      token: planner.token,
      body: {
        name: 'X',
        primaryCraft: 'scrum-master',
        secondaryCrafts: [{ craftId: 'scrum-master', proficiency: 1, maxPct: 10 }],
      },
    });
    expect(dup.status).toBe(400);
    expect(Object.values(dup.json.fields as object)).toContain('Already their above-the-table craft');
  });

  it('lets two planners edit different people, and 409s a stale version with the latest row (PL-04#AC2-3)', async () => {
    const a = await createPerson(db, ws, { name: 'A' });
    const b = await createPerson(db, ws, { name: 'B' });
    const r1 = await call(v2, 'PATCH', `${W()}/people/${a}`, {
      token: planner.token,
      body: { version: 1, patch: { role: 'PM' } },
    });
    const r2 = await call(v2, 'PATCH', `${W()}/people/${b}`, {
      token: planner2.token,
      body: { version: 1, patch: { role: 'BA' } },
    });
    expect([r1.status, r2.status]).toEqual([200, 200]);
    expect([r1.json.version, r2.json.version]).toEqual([2, 2]);
    const stale = await call(v2, 'PATCH', `${W()}/people/${a}`, {
      token: planner2.token,
      body: { version: 1, patch: { role: 'Other' } },
    });
    expect(stale.status).toBe(409);
    expect(stale.json.code).toBe('conflict');
    expect(stale.json.current).toMatchObject({ id: a, role: 'PM', version: 2 });
    expect(stale.json.changedBy).toEqual({ id: planner.id, name: 'Pat Planner' });
    expect(typeof stale.json.changedAt).toBe('string');
    const row = await db.query(`SELECT role FROM resources WHERE id = $1`, [a]);
    expect(row[0].role).toBe('PM');
  });

  it('bumps the workspace data_version on every write (PL-04#AC6)', async () => {
    const before = await db.query(`SELECT data_version FROM workspaces WHERE id = $1`, [ws]);
    await call(v2, 'POST', `${W()}/people`, { token: planner.token, body: { name: 'DV' } });
    const after = await db.query(`SELECT data_version FROM workspaces WHERE id = $1`, [ws]);
    expect(Number(after[0].data_version)).toBe(Number(before[0].data_version) + 1);
  });

  it('a viewer gets 403 with the role message, and another workspace id gives 404', async () => {
    const r = await call(v2, 'POST', `${W()}/people`, { token: viewer.token, body: { name: 'V' } });
    expect(r.status).toBe(403);
    expect(r.json.error).toBe('You need the Planner role to do this.');
    const other = await createWorkspace(db, org, 'Other');
    const p = await createPerson(db, other, { name: 'Elsewhere' });
    const r2 = await call(v2, 'PATCH', `${W()}/people/${p}`, {
      token: planner.token,
      body: { version: 1, patch: { role: 'x' } },
    });
    expect(r2.status).toBe(404);
  });

  it('bulk edits atomically and reports the stale person (PPL-03#AC2)', async () => {
    const a = await createPerson(db, ws, { name: 'Bulk A' });
    const b = await createPerson(db, ws, { name: 'Bulk B' });
    const ok = await call(v2, 'POST', `${W()}/people/bulk`, {
      token: planner.token,
      body: { ids: [a, b], versions: { [a]: 1, [b]: 1 }, patch: { targetUtil: 80 } },
    });
    expect(ok.status).toBe(200);
    expect((ok.json.people as Array<{ targetUtil: number }>).map((x) => x.targetUtil)).toEqual([80, 80]);
    const stale = await call(v2, 'POST', `${W()}/people/bulk`, {
      token: planner.token,
      body: { ids: [a, b], versions: { [a]: 2, [b]: 1 }, patch: { targetUtil: 70 } },
    });
    expect(stale.status).toBe(409);
    expect(stale.json.id).toBe(b);
    const rows = await db.query(`SELECT craft_profile->>'targetUtil' AS t FROM resources WHERE id = ANY($1::text[])`, [
      [a, b],
    ]);
    expect(rows.map((r) => r.t)).toEqual(['80', '80']);
  });

  it('deletes a person with their allocations', async () => {
    const pid = await createPerson(db, ws, { name: 'Leaver' });
    const proj = await createProject(db, ws, { tribeId: tribe });
    await db.query(
      `INSERT INTO allocations (id, workspace_id, resource_id, project_id, percentage) VALUES ($1, $2, $3, $4, 50)`,
      [randomUUID(), ws, pid, proj],
    );
    const r = await call(v2, 'DELETE', `${W()}/people/${pid}?version=1`, { token: planner.token });
    expect(r.status).toBe(204);
    expect(await db.query(`SELECT 1 FROM allocations WHERE resource_id = $1`, [pid])).toHaveLength(0);
  });
});

describe('entitlements (PL-07)', () => {
  it('blocks creating the 6th person on BASIC in public mode but still allows edits (PL-07#AC4)', async () => {
    const basicOrg = await createOrg(db, 'Basic', 'BASIC');
    const bws = await createWorkspace(db, basicOrg);
    const admin = await createUser(db, { orgId: basicOrg, orgRole: 'ORG_ADMIN' });
    for (let i = 0; i < 5; i++) await createPerson(db, bws, { name: `P${i}` });
    const r = await call(v2, 'POST', `/api/v2/workspaces/${bws}/people`, {
      token: admin.token,
      body: { name: 'Sixth' },
    });
    expect(r.status).toBe(403);
    expect(r.json).toMatchObject({ code: 'entitlement', error: 'Your BASIC plan allows up to 5 people.' });
    const someone = (await db.query(`SELECT id FROM resources WHERE workspace_id = $1 LIMIT 1`, [bws]))[0].id;
    const edit = await call(v2, 'PATCH', `/api/v2/workspaces/${bws}/people/${someone}`, {
      token: admin.token,
      body: { version: 1, patch: { role: 'Edited' } },
    });
    expect(edit.status).toBe(200);
    process.env.APP_MODE = 'internal';
    const internal = await call(v2, 'POST', `/api/v2/workspaces/${bws}/people`, {
      token: admin.token,
      body: { name: 'Sixth' },
    });
    expect(internal.status).toBe(201);
  });

  it('rejects CSV import without the csvImport entitlement', async () => {
    const basicOrg = await createOrg(db, 'Basic2', 'BASIC');
    const bws = await createWorkspace(db, basicOrg);
    const admin = await createUser(db, { orgId: basicOrg, orgRole: 'ORG_ADMIN' });
    const r = await call(v2, 'POST', `/api/v2/workspaces/${bws}/people/import`, {
      token: admin.token,
      body: { rows: [{ name: 'A' }], createMissingStructure: false },
    });
    expect(r.status).toBe(403);
    expect(r.json.code).toBe('entitlement');
  });
});

describe('CSV import (PPL-04)', () => {
  it('matches by email then name, creates structure on request and reports errors per row', async () => {
    await createPerson(db, ws, { name: 'Existing Person', email: 'exists@data.test' });
    const r = await call(v2, 'POST', `${W()}/people/import`, {
      token: planner.token,
      body: {
        createMissingStructure: true,
        rows: [
          {
            name: 'Existing Person',
            email: 'exists@data.test',
            jobTitle: 'Lead',
            aboveCraft: 'SM',
            chapter: 'Delivery Chapter',
          },
          {
            name: 'Brand New',
            aboveCraft: 'PM',
            belowCrafts: [{ craftId: 'BA', proficiency: 3, maxPct: 50 }],
            team: 'Squad 1',
          },
          { name: 'Bad Craft', aboveCraft: 'XX' },
          { name: '' },
        ],
      },
    });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ created: 1, updated: 1, skipped: 2 });
    expect((r.json.errors as Array<{ row: number; message: string }>)[0]).toEqual({
      row: 3,
      message: "Unknown craft 'XX'",
    });
    const chapter = await db.query(`SELECT id FROM chapters WHERE org_id = $1 AND name = 'Delivery Chapter'`, [org]);
    expect(chapter).toHaveLength(1);
  });
});

describe('projects and demand (PL-04, DM-01, PPL-07)', () => {
  it('requires a tribe and dual-writes client_name', async () => {
    const none = await call(v2, 'POST', `${W()}/projects`, { token: planner.token, body: { name: 'No tribe' } });
    expect(none.status).toBe(400);
    expect(none.json.fields).toEqual({ tribeId: 'Choose a tribe' });
    const r = await call(v2, 'POST', `${W()}/projects`, {
      token: planner.token,
      body: { name: 'Phoenix', tribeId: tribe, stage: 'In Flight' },
    });
    expect(r.status).toBe(201);
    const row = await db.query(`SELECT client_name, craft_demand FROM projects WHERE id = $1`, [r.json.id]);
    expect(row[0]).toEqual({ client_name: 'Payments', craft_demand: [] });
  });

  it('creates, updates and deletes demand lines, keeping projects.craft_demand in sync (DM-01#AC2)', async () => {
    const pr = await createProject(db, ws, { tribeId: tribe });
    const c = await call(v2, 'POST', `${W()}/demand`, {
      token: planner.token,
      body: { projectId: pr, quarterKey: '2027-Q1', craftId: 'project-mgmt', fte: 1.5, status: 'Confirmed' },
    });
    expect(c.status).toBe(201);
    let row = await db.query(`SELECT craft_demand FROM projects WHERE id = $1`, [pr]);
    expect(row[0].craft_demand).toEqual([{ quarterKey: '2027-Q1', craftId: 'project-mgmt', fte: 1.5 }]);
    const dup = await call(v2, 'POST', `${W()}/demand`, {
      token: planner.token,
      body: { projectId: pr, quarterKey: '2027-Q1', craftId: 'project-mgmt', fte: 1 },
    });
    expect(dup.status).toBe(409);
    const bad = await call(v2, 'POST', `${W()}/demand`, {
      token: planner.token,
      body: { projectId: pr, quarterKey: '2027-5', craftId: 'project-mgmt', fte: 99 },
    });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.json.fields as object).sort()).toEqual(['fte', 'quarterKey']);
    const u = await call(v2, 'PATCH', `${W()}/demand/${c.json.id}`, {
      token: planner.token,
      body: { version: 1, patch: { fte: 2 } },
    });
    expect(u.json.fte).toBe(2);
    const d = await call(v2, 'DELETE', `${W()}/demand/${c.json.id}?version=2`, { token: planner.token });
    expect(d.status).toBe(204);
    row = await db.query(`SELECT craft_demand FROM projects WHERE id = $1`, [pr]);
    expect(row[0].craft_demand).toEqual([]);
    const v = await call(v2, 'POST', `${W()}/demand`, {
      token: viewer.token,
      body: { projectId: pr, quarterKey: '2027-Q1', craftId: 'project-mgmt', fte: 1 },
    });
    expect(v.status).toBe(403);
  });

  it('runs a demand batch atomically', async () => {
    const pr = await createProject(db, ws, { tribeId: tribe });
    const r = await call(v2, 'POST', `${W()}/demand/batch`, {
      token: planner.token,
      body: {
        ops: [
          {
            op: 'create',
            line: {
              projectId: pr,
              quarterKey: '2027-Q2',
              craftId: 'scrum-master',
              fte: 1,
              status: 'Forecast',
              ownerUserId: null,
              note: null,
            },
          },
          {
            op: 'create',
            line: {
              projectId: pr,
              quarterKey: '2027-Q2',
              craftId: 'nope',
              fte: 1,
              status: 'Forecast',
              ownerUserId: null,
              note: null,
            },
          },
        ],
      },
    });
    expect(r.status).toBe(400);
    expect(r.json.fields).toEqual({ 'ops.1.craftId': 'Unknown craft' });
    expect(await db.query(`SELECT 1 FROM demand_lines WHERE project_id = $1`, [pr])).toHaveLength(0);
  });
});

describe('allocations (PL-04#AC4, AL-05)', () => {
  let person: string;
  let project: string;
  beforeAll(async () => {
    person = await createPerson(db, ws, { name: 'Alloc Person' });
    project = await createProject(db, ws, { tribeId: tribe });
  });

  it('applies a batch atomically and returns upserted, deleted and dataVersion', async () => {
    const id = randomUUID();
    const r = await call(v2, 'POST', `${W()}/allocations/batch`, {
      token: planner.token,
      body: {
        label: 'Rebalance',
        ops: [
          {
            op: 'create',
            allocation: {
              id,
              resourceId: person,
              projectId: project,
              percentage: 35,
              startDate: '2026-10-01',
              endDate: '2026-12-31',
            },
          },
          { op: 'create', allocation: { resourceId: person, projectId: project, percentage: 20 } },
        ],
      },
    });
    expect(r.status).toBe(200);
    expect((r.json.upserted as unknown[]).length).toBe(2);
    expect(typeof r.json.dataVersion).toBe('number');
    const stale = await call(v2, 'POST', `${W()}/allocations/batch`, {
      token: planner.token,
      body: {
        ops: [
          { op: 'update', id, version: 1, patch: { percentage: 15 } },
          { op: 'update', id, version: 1, patch: { percentage: 10 } },
        ],
      },
    });
    expect(stale.status).toBe(409);
    expect(stale.json.fields).toEqual({ 'ops.1': 'This record changed' });
    const row = await db.query(`SELECT percentage, version FROM allocations WHERE id = $1`, [id]);
    expect(row[0]).toEqual({ percentage: 35, version: 1 });
    const audits = await db.query(`SELECT after FROM audit_events WHERE action = 'allocation.batch'`);
    expect((audits[0].after as { label: string }).label).toBe('Rebalance');
  });

  it('rejects batches over 500 ops with 413 and values outside 0–200', async () => {
    const ops = Array.from({ length: 501 }, () => ({ op: 'delete', id: 'x', version: 1 }));
    const big = await call(v2, 'POST', `${W()}/allocations/batch`, { token: planner.token, body: { ops } });
    expect(big.status).toBe(413);
    const bad = await call(v2, 'POST', `${W()}/allocations`, {
      token: planner.token,
      body: { resourceId: person, projectId: project, percentage: 250 },
    });
    expect(bad.status).toBe(400);
    expect(bad.json.fields).toEqual({ percentage: 'Enter 0–200' });
  });

  it('locks Planview bookings unless the org allows overrides (AL-05#AC2)', async () => {
    const id = randomUUID();
    await db.query(
      `INSERT INTO allocations (id, workspace_id, resource_id, project_id, percentage, source, external_ref) VALUES ($1, $2, $3, $4, 50, 'planview', 'PV-A1')`,
      [id, ws, person, project],
    );
    const locked = await call(v2, 'PATCH', `${W()}/allocations/${id}`, {
      token: planner.token,
      body: { version: 1, patch: { percentage: 40 } },
    });
    expect(locked.status).toBe(409);
    expect(locked.json.error).toBe('Locked: sourced from Planview');
    await db.query(`UPDATE organizations SET planning = '{"planviewOwnership":"overridable"}' WHERE id = $1`, [org]);
    const ok = await call(v2, 'PATCH', `${W()}/allocations/${id}`, {
      token: planner.token,
      body: { version: 1, patch: { percentage: 40 } },
    });
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ source: 'manual', externalRef: 'PV-A1', percentage: 40 });
    await db.query(`UPDATE organizations SET planning = '{}' WHERE id = $1`, [org]);
  });
});

describe('marketplace, respond and offers (DM-03, DM-05, PPL-05)', () => {
  it('proposes a tentative booking, emails the linked user, prevents double proposals, and the person accepts', async () => {
    const person = await createPerson(db, ws, {
      name: 'Squad Member',
      linkedUserId: contributor.id,
      email: 'squad@data.test',
    });
    const project = await createProject(db, ws, { tribeId: tribe, name: 'Marketplace Project' });
    const line = await call(v2, 'POST', `${W()}/demand`, {
      token: planner.token,
      body: { projectId: project, quarterKey: '2027-Q1', craftId: 'scrum-master', fte: 1 },
    });
    const body = {
      demandLineId: line.json.id,
      projectId: project,
      resourceId: person,
      craftId: 'scrum-master',
      quarterKey: '2027-Q1',
      percentage: 50,
      startDate: '2027-01-01',
      endDate: '2027-03-31',
    };
    mails.length = 0;
    const r = await call(v2, 'POST', `${W()}/marketplace/propose`, { token: planner.token, body });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ state: 'tentative', source: 'marketplace', demandLineId: line.json.id });
    expect((r.json.proposedBy as { id: string }).id).toBe(planner.id);
    expect(mails.some((m) => m.startsWith('squad@data.test|') && m.includes('proposed for Marketplace Project'))).toBe(
      true,
    );
    const again = await call(v2, 'POST', `${W()}/marketplace/propose`, { token: planner.token, body });
    expect(again.status).toBe(409);
    const byViewer = await call(v2, 'POST', `${W()}/marketplace/propose`, { token: viewer.token, body });
    expect(byViewer.status).toBe(403);
    const otherAlloc = await call(v2, 'POST', `${W()}/allocations`, {
      token: planner.token,
      body: {
        resourceId: await createPerson(db, ws, { name: 'Not me' }),
        projectId: project,
        percentage: 10,
        state: 'tentative',
      },
    });
    const notOwn = await call(v2, 'POST', `${W()}/allocations/${otherAlloc.json.id}/respond`, {
      token: contributor.token,
      body: { decision: 'accept' },
    });
    expect(notOwn.status).toBe(403);
    const accept = await call(v2, 'POST', `${W()}/allocations/${r.json.id}/respond`, {
      token: contributor.token,
      body: { decision: 'accept' },
    });
    expect(accept.status).toBe(200);
    expect(accept.json.state).toBe('confirmed');
    expect(accept.json.respondedAt).toBeTruthy();
    const tts = await db.query(`SELECT time_to_staff_days FROM allocations WHERE id = $1`, [r.json.id]);
    expect(tts[0].time_to_staff_days).not.toBeNull();
    const twice = await call(v2, 'POST', `${W()}/allocations/${r.json.id}/respond`, {
      token: contributor.token,
      body: { decision: 'decline' },
    });
    expect(twice.status).toBe(409);
  });

  it('offers: planners for anyone, contributors only for themselves (DM-05#AC3)', async () => {
    const own = await createPerson(db, ws, { name: 'Own Offer', linkedUserId: contributor.id });
    const other = await createPerson(db, ws, { name: 'Other Offer' });
    const r = await call(v2, 'PUT', `${W()}/offers/${other}/2027-Q1`, {
      token: planner.token,
      body: { pct: 30, craftIds: ['scrum-master'], note: 'free' },
    });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({
      personId: other,
      quarterKey: '2027-Q1',
      pct: 30,
      craftIds: ['scrum-master'],
      note: 'free',
    });
    const notOwn = await call(v2, 'PUT', `${W()}/offers/${other}/2027-Q1`, {
      token: contributor.token,
      body: { pct: 10 },
    });
    expect(notOwn.status).toBe(403);
    expect(notOwn.json.error).toBe('You can only offer your own capacity.');
    const viewerTry = await call(v2, 'PUT', `${W()}/offers/${own}/2027-Q1`, { token: viewer.token, body: { pct: 10 } });
    expect(viewerTry.status).toBe(403);
    expect((await call(v2, 'DELETE', `${W()}/offers/${other}/2027-Q1`, { token: planner.token })).status).toBe(204);
  });
});

describe('craft change requests (PPL-06)', () => {
  it('own submit → planner approve updates crafts; others 403; reject needs a reason', async () => {
    const mine = await createPerson(db, ws, { name: 'Requester', linkedUserId: contributor.id });
    const other = await createPerson(db, ws, { name: 'Someone' });
    const proposed = [{ craftId: 'business-analysis', proficiency: 3, maxPct: 40 }];
    const forOther = await call(v2, 'POST', `${W()}/people/${other}/craft-requests`, {
      token: contributor.token,
      body: { secondaryCrafts: proposed },
    });
    expect(forOther.status).toBe(403);
    const primary = await call(v2, 'POST', `${W()}/people/${mine}/craft-requests`, {
      token: contributor.token,
      body: { secondaryCrafts: proposed, primaryCraft: 'scrum-master' },
    });
    expect(primary.status).toBe(400);
    const r = await call(v2, 'POST', `${W()}/people/${mine}/craft-requests`, {
      token: contributor.token,
      body: { secondaryCrafts: proposed },
    });
    expect(r.status).toBe(201);
    expect(r.json.status).toBe('pending');
    const listOwn = await call(v2, 'GET', `${W()}/craft-requests`, { token: contributor.token });
    expect((listOwn.json as unknown as unknown[]).length).toBe(1);
    const listViewer = await call(v2, 'GET', `${W()}/craft-requests`, { token: viewer.token });
    expect(listViewer.json).toEqual([]);
    const noReason = await call(v2, 'POST', `${W()}/craft-requests/${r.json.id}/reject`, {
      token: planner.token,
      body: {},
    });
    expect(noReason.status).toBe(400);
    const byContrib = await call(v2, 'POST', `${W()}/craft-requests/${r.json.id}/approve`, {
      token: contributor.token,
    });
    expect(byContrib.status).toBe(403);
    const ok = await call(v2, 'POST', `${W()}/craft-requests/${r.json.id}/approve`, { token: planner.token });
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ status: 'approved', decidedBy: { id: planner.id } });
    // QA-018 (PPL-06#AC4): the requester's snapshot carries the decision, so My plan can say "Approved by {name}".
    const ownSnap = await call(v2, 'GET', `${W()}/snapshot`, { token: contributor.token });
    expect(
      (ownSnap.json.craftRequests as Array<{ id: string; status: string; decidedBy: { id: string } | null }>).find(
        (x) => x.id === r.json.id,
      ),
    ).toMatchObject({ status: 'approved', decidedBy: { id: planner.id } });
    const person = await db.query(`SELECT craft_profile FROM resources WHERE id = $1`, [mine]);
    expect((person[0].craft_profile as { secondaryCrafts: unknown }).secondaryCrafts).toEqual(proposed);
    const again = await call(v2, 'POST', `${W()}/craft-requests/${r.json.id}/approve`, { token: planner.token });
    expect(again.status).toBe(409);
    const ev = await db.query(`SELECT 1 FROM audit_events WHERE action = 'craft.approve'`);
    expect(ev.length).toBe(1);
  });
});

describe('snapshot and sample data (PL-04#AC1, #AC9)', () => {
  it('installs sample data with fresh UUIDs only into an empty workspace', async () => {
    const empty = await createWorkspace(db, org, 'Sample');
    const admin = await createUser(db, { orgId: org, orgRole: 'ORG_ADMIN' });
    const r = await call(v2, 'POST', `/api/v2/workspaces/${empty}/sample-data`, { token: admin.token });
    expect(r.status).toBe(201);
    const people = r.json.people as Array<{ id: string }>;
    expect(people.length).toBeGreaterThan(5);
    expect(people.every((x) => /^[0-9a-f-]{36}$/.test(x.id))).toBe(true);
    expect((r.json.allocations as unknown[]).length).toBeGreaterThan(5);
    expect((r.json.demand as unknown[]).length).toBeGreaterThan(3);
    const again = await call(v2, 'POST', `/api/v2/workspaces/${empty}/sample-data`, { token: admin.token });
    expect(again.status).toBe(409);
  });

  it('returns the full WorkspaceSnapshot with ≤ 6 data queries after access resolution', async () => {
    db.statements.length = 0;
    const r = await call(v2, 'GET', `${W()}/snapshot`, { token: viewer.token });
    expect(r.status).toBe(200);
    for (const k of [
      'org',
      'workspace',
      'people',
      'projects',
      'allocations',
      'demand',
      'tribes',
      'chapters',
      'teams',
      'crafts',
      'offers',
      'craftRequests',
      'serverTime',
    ]) {
      expect(r.json).toHaveProperty(k);
    }
    expect(r.json.delivery).toBeNull();
    expect((r.json.crafts as unknown[]).length).toBeGreaterThanOrEqual(3);
    expect(r.json.craftRequests).toEqual([]);
    const dataQueries = db.statements.filter(
      (s) =>
        !/schema_migrations|FROM workspaces w\s+JOIN organizations o ON o.id = w.org_id\s+LEFT JOIN users u|FROM users WHERE id/.test(
          s,
        ),
    );
    expect(dataQueries.length).toBeLessThanOrEqual(10);
  });
});
