/**
 * Jira sync v2 (JI-01..JI-07): manual job, chunked steps with a cursor, idempotent snapshots, 429 and 401
 * handling, identities, mappings, calibration, health and delivery rows, scheduler and worker.
 */
import { handler as v2 } from '../../netlify/functions/v2';
import { handler as scheduler } from '../../netlify/functions/jira-sync-scheduler';
import { handler as worker } from '../../netlify/functions/jira-sync-worker';
import { encryptSecret } from '../../netlify/functions/_lib/crypto';
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
import { installFetch, jsonResponse } from './helpers/fetchMock';

let db: PgliteDb;
let org: string;
let ws: string;
let tribe: string;
let project: string;
let person: string;
let planner: TestUser;
let viewer: TestUser;
let fetchMock: jest.Mock;
const W = () => `/api/v2/workspaces/${ws}`;

const SP = 'customfield_10016';
const SPRINT = 'customfield_10020';
const closed = (id: number, n: string, start: string, end: string) => ({
  id,
  name: n,
  state: 'closed',
  startDate: `${start}T09:00:00Z`,
  endDate: `${end}T17:00:00Z`,
});
const S41 = closed(41, 'Sprint 41', '2026-07-06', '2026-07-17');
const S42 = closed(42, 'Sprint 42', '2026-07-20', '2026-07-31');
const done = { statusCategory: { key: 'done' } };
const ALICE = { accountId: 'acc-alice', displayName: 'Alice Smith', emailAddress: 'alice@acme.test' };
const issue = (key: string, sprint: unknown, pts: number, assignee: unknown = ALICE) => ({
  key,
  fields: {
    project: { key: 'PHX', name: 'Phoenix' },
    status: done,
    assignee,
    [SP]: pts,
    [SPRINT]: [sprint],
    created: '2026-07-07',
  },
});

async function configureJira() {
  await db.query(`DELETE FROM workspace_integrations WHERE workspace_id = $1`, [ws]);
  await db.query(
    `INSERT INTO workspace_integrations (workspace_id, provider, config, secret_enc) VALUES ($1, 'jira', $2::jsonb, $3)`,
    [
      ws,
      JSON.stringify({
        domain: 'acme.atlassian.net',
        email: 'pm@acme.test',
        projectKeys: ['PHX'],
        storyPointsFieldId: SP,
        sprintFieldId: SPRINT,
      }),
      encryptSecret('tok'),
    ],
  );
}

beforeAll(async () => {
  db = await setupDb();
  org = await createOrg(db, 'Sync Org');
  ws = await createWorkspace(db, org);
  tribe = await createTribe(db, org, 'Payments');
  project = await createProject(db, ws, {
    tribeId: tribe,
    name: 'Phoenix',
    startDate: '2026-01-01',
    endDate: '2027-12-31',
  });
  person = await createPerson(db, ws, { name: 'Alice Smith', email: 'alice@acme.test' });
  await db.query(
    `INSERT INTO allocations (id, workspace_id, resource_id, project_id, percentage) VALUES ('alloc-1', $1, $2, $3, 100)`,
    [ws, person, project],
  );
  planner = await createUser(db, { orgId: org, orgRole: 'MEMBER' });
  viewer = await createUser(db, { orgId: org, orgRole: 'MEMBER' });
  await addMember(db, planner.id, ws, 'PLANNER');
  await addMember(db, viewer.id, ws, 'VIEWER');
});
afterAll(() => teardownDb(db));
beforeEach(() => {
  testEnv();
  fetchMock = installFetch();
});

describe('manual sync (JI-01#AC3-5)', () => {
  it('409s when Jira is not configured; viewers cannot start a sync', async () => {
    const r = await call(v2, 'POST', `${W()}/sync/jira`, { token: planner.token });
    expect(r.status).toBe(409);
    await configureJira();
    expect((await call(v2, 'POST', `${W()}/sync/jira`, { token: viewer.token })).status).toBe(403);
  });

  it('pages with a cursor, finishes, never duplicates a running job, and is idempotent on re-run', async () => {
    await configureJira();
    await db.query(
      `INSERT INTO integration_mappings (workspace_id, provider, external_key, project_id, tribe_id, match_method, confirmed) VALUES ($1, 'jira', 'PHX', $2, $3, 'manual', true)`,
      [ws, project, tribe],
    );
    let page = 0;
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://acme.atlassian.net/rest/api/3/search/jql');
      const body = JSON.parse(String(init.body));
      page++;
      if (!body.nextPageToken)
        return jsonResponse({ issues: [issue('PHX-1', S41, 10), issue('PHX-2', S41, 5)], nextPageToken: 'p2' });
      return jsonResponse({ issues: [issue('PHX-3', S42, 8)], isLast: true });
    });
    const start = await call(v2, 'POST', `${W()}/sync/jira`, { token: planner.token });
    expect(start.status).toBe(202);
    const job = start.json.job as { id: string; status: string; trigger: string };
    expect(job).toMatchObject({ status: 'queued', trigger: 'manual' });
    const dup = await call(v2, 'POST', `${W()}/sync/jira`, { token: planner.token });
    expect((dup.json.job as { id: string }).id).toBe(job.id);
    const step = await call(v2, 'POST', `${W()}/sync/jobs/${job.id}/step`, { token: planner.token });
    expect(step.status).toBe(200);
    expect(step.json.job).toMatchObject({ status: 'succeeded', pagesDone: 2, issuesSeen: 3 });
    expect(page).toBe(2);
    const rows = await db.query(
      `SELECT sprint_id, points_done::float8 AS pts, implied_fte::float8 AS fte, project_id, tribe_id FROM delivery_snapshots WHERE workspace_id = $1 ORDER BY sprint_id`,
      [ws],
    );
    expect(rows).toEqual([
      { sprint_id: '41', pts: 15, fte: 1.5, project_id: project, tribe_id: tribe },
      { sprint_id: '42', pts: 8, fte: 0.8, project_id: project, tribe_id: tribe },
    ]);
    const ident = await db.query(
      `SELECT external_id, person_id, match_method, confirmed FROM external_identities WHERE workspace_id = $1`,
      [ws],
    );
    expect(ident).toEqual([{ external_id: 'acc-alice', person_id: person, match_method: 'email', confirmed: false }]);
    // Re-run the same day: totals are replaced, not doubled.
    page = 0;
    const again = await call(v2, 'POST', `${W()}/sync/jira`, { token: planner.token });
    await call(v2, 'POST', `${W()}/sync/jobs/${(again.json.job as { id: string }).id}/step`, { token: planner.token });
    const rows2 = await db.query(
      `SELECT sum(points_done)::float8 AS pts FROM delivery_snapshots WHERE workspace_id = $1`,
      [ws],
    );
    expect(rows2[0].pts).toBe(23);
    const cal = await db.query(
      `SELECT suggested_value::float8 AS v, is_default FROM tribe_calibrations WHERE tribe_id = $1`,
      [tribe],
    );
    expect(cal[0]).toEqual({ v: 11.5, is_default: true });
  });

  it('stores Retry-After on 429 and stays running; fails clearly on 401 (JI-01#AC5)', async () => {
    await configureJira();
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'slow down' }, 429, { 'Retry-After': '120' }));
    const start = await call(v2, 'POST', `${W()}/sync/jira`, { token: planner.token });
    const id = (start.json.job as { id: string }).id;
    const r = await call(v2, 'POST', `${W()}/sync/jobs/${id}/step`, { token: planner.token });
    expect(r.json.job).toMatchObject({ status: 'running', error: 'Rate limited by Jira' });
    expect((r.json.job as { rateLimitedUntil: string }).rateLimitedUntil).toBeTruthy();
    await db.query(`UPDATE sync_jobs SET rate_limited_until = NULL WHERE id = $1`, [id]);
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'nope' }, 401));
    const r2 = await call(v2, 'POST', `${W()}/sync/jobs/${id}/step`, { token: planner.token });
    expect(r2.json.job).toMatchObject({ status: 'failed', error: 'Jira rejected the credentials' });
    const health = await call(v2, 'GET', `${W()}/sync/health`, { token: viewer.token });
    expect(health.json).toMatchObject({ provider: 'jira', configured: true, state: 'failed' });
    expect((health.json.recentJobs as unknown[]).length).toBeGreaterThan(1);
  });
});

describe('scheduler and worker (JI-01#AC2)', () => {
  it('enqueues one job per configured workspace with the feature on, and the worker advances it', async () => {
    await configureJira();
    await db.query(
      `UPDATE sync_jobs SET status = 'failed' WHERE workspace_id = $1 AND status IN ('queued','running')`,
      [ws],
    );
    const r = await scheduler({} as never, {} as never);
    expect(JSON.parse((r as { body: string }).body).queued).toBe(1);
    fetchMock.mockResolvedValue(jsonResponse({ issues: [], isLast: true }));
    const w = await worker({} as never, {} as never);
    expect(JSON.parse((w as { body: string }).body).stepped).toBe(1);
    const job = await db.query(
      `SELECT status, trigger FROM sync_jobs WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [ws],
    );
    expect(job[0]).toEqual({ status: 'succeeded', trigger: 'schedule' });
    await db.query(`UPDATE organizations SET features = '{"jiraScheduledSync": false}' WHERE id = $1`, [org]);
    const off = await scheduler({} as never, {} as never);
    expect(JSON.parse((off as { body: string }).body).queued).toBe(0);
  });
});

describe('mappings, calibration and delivery (JI-02..JI-06)', () => {
  it('auto-matches by key then name, confirms, and keeps confirmed rows', async () => {
    await configureJira();
    await db.query(`DELETE FROM integration_mappings WHERE workspace_id = $1`, [ws]);
    await db.query(`UPDATE projects SET jira_key = 'PHX' WHERE id = $1`, [project]);
    const other = await createProject(db, ws, { tribeId: tribe, name: 'Ledger' });
    fetchMock.mockResolvedValue(
      jsonResponse({
        values: [
          { key: 'PHX', name: 'Phoenix' },
          { key: 'LED', name: 'ledger' },
          { key: 'ZZZ', name: 'Zed' },
        ],
      }),
    );
    const r = await call(v2, 'POST', `${W()}/integrations/jira/mappings/auto-match`, { token: planner.token });
    expect(r.status).toBe(200);
    const byKey = Object.fromEntries((r.json.projects as Array<{ jiraKey: string }>).map((p) => [p.jiraKey, p]));
    expect(byKey.PHX).toMatchObject({ projectId: project, matchMethod: 'key', confirmed: false, tribeId: tribe });
    expect(byKey.LED).toMatchObject({ projectId: other, matchMethod: 'name', confirmed: false });
    expect(byKey.ZZZ).toMatchObject({ projectId: null, matchMethod: 'none' });
    const put = await call(v2, 'PUT', `${W()}/integrations/jira/mappings/projects`, {
      token: planner.token,
      body: { projects: [{ jiraKey: 'PHX', projectId: project, confirmed: true }] },
    });
    expect(
      (put.json.projects as Array<{ jiraKey: string; confirmed: boolean; matchMethod: string }>).find(
        (p) => p.jiraKey === 'PHX',
      ),
    ).toMatchObject({
      confirmed: true,
      matchMethod: 'key',
    });
    await call(v2, 'POST', `${W()}/integrations/jira/mappings/auto-match`, { token: planner.token });
    const keep = await db.query(`SELECT confirmed FROM integration_mappings WHERE external_key = 'PHX'`);
    expect(keep[0].confirmed).toBe(true);
    const people = await call(v2, 'PUT', `${W()}/integrations/jira/mappings/people`, {
      token: planner.token,
      body: { people: [{ externalId: 'acc-alice', personId: person, confirmed: true }] },
    });
    expect((people.json.people as Array<{ confirmed: boolean }>)[0].confirmed).toBe(true);
    expect(
      (await call(v2, 'PUT', `${W()}/integrations/jira/mappings/people`, { token: viewer.token, body: [] })).status,
    ).toBe(403);
  });

  it('calibration needs a note, is versioned and audited (JI-04#AC2-3)', async () => {
    const list = await call(v2, 'GET', `${W()}/calibration`, { token: planner.token });
    const row = (
      list.json as unknown as Array<{ tribeId: string; isDefault: boolean; version: number; suggestedValue: number }>
    ).find((c) => c.tribeId === tribe)!;
    expect(row).toMatchObject({ isDefault: true, suggestedValue: 11.5 });
    const noNote = await call(v2, 'PUT', `${W()}/calibration/${tribe}`, {
      token: planner.token,
      body: { pointsPerSprintPerFte: 12, sprintLengthDays: 14, version: row.version },
    });
    expect(noNote.status).toBe(400);
    const ok = await call(v2, 'PUT', `${W()}/calibration/${tribe}`, {
      token: planner.token,
      body: { pointsPerSprintPerFte: 12, sprintLengthDays: 14, note: 'Use suggested', version: row.version },
    });
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ pointsPerSprintPerFte: 12, isDefault: false, note: 'Use suggested' });
    const stale = await call(v2, 'PUT', `${W()}/calibration/${tribe}`, {
      token: planner.token,
      body: { pointsPerSprintPerFte: 13, sprintLengthDays: 14, note: 'x', version: row.version },
    });
    expect(stale.status).toBe(409);
    const ev = await db.query(`SELECT 1 FROM audit_events WHERE action = 'calibration.change'`);
    expect(ev).toHaveLength(1);
  });

  it('serves delivery rows from snapshots only, grouped by sprint and tribe (JI-05)', async () => {
    await db.query(`DELETE FROM delivery_snapshots WHERE workspace_id = $1`, [ws]);
    await db.query(
      `INSERT INTO delivery_snapshots (org_id, workspace_id, snapshot_date, jira_project_key, project_id, tribe_id, sprint_id, sprint_name,
         sprint_state, sprint_start, sprint_end, quarter_key, points_total, points_done, issues_total, issues_done, implied_fte)
       VALUES ($1, $2, current_date, 'PHX', $3, $4, '41', 'Sprint 41', 'closed', '2026-07-06', '2026-07-17', '2026-Q3', 15, 15, 2, 2, 1.5),
              ($1, $2, current_date, 'PHX', $3, $4, '42', 'Sprint 42', 'closed', '2026-07-20', '2026-07-31', '2026-Q3', 8, 8, 1, 1, 0.8)`,
      [org, ws, project, tribe],
    );
    fetchMock.mockImplementation(async () => {
      throw new Error('no live Jira calls');
    });
    const bySprint = await call(v2, 'GET', `${W()}/delivery?groupBy=sprint&tribeId=${tribe}`, { token: viewer.token });
    expect(bySprint.status).toBe(200);
    const rows = bySprint.json as unknown as Array<{
      key: string;
      pointsDone: number;
      plannedFte: number;
      impliedFte: number;
    }>;
    expect(rows.map((r) => [r.key, r.pointsDone, r.plannedFte])).toEqual([
      ['41', 15, 1],
      ['42', 8, 1],
    ]);
    const byTribe = await call(v2, 'GET', `${W()}/delivery?groupBy=tribe`, { token: viewer.token });
    expect((byTribe.json as unknown as Array<{ label: string }>)[0].label).toBe('Payments');
    const bad = await call(v2, 'GET', `${W()}/delivery?from=yesterday`, { token: viewer.token });
    expect(bad.status).toBe(400);
    const jobs = await call(v2, 'GET', `${W()}/sync/jobs`, { token: viewer.token });
    expect(jobs.status).toBe(403);
  });
});
