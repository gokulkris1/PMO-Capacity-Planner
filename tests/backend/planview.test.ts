/** Planview v2 (PV-01..PV-03): preview diff, apply in one transaction, idempotent re-import, field-map test. */
import { handler as v2 } from '../../netlify/functions/v2';
import { encryptSecret } from '../../netlify/functions/_lib/crypto';
import { setDnsLookup } from '../../netlify/functions/_lib/net';
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
import { installFetch, jsonResponse } from './helpers/fetchMock';

let db: PgliteDb;
let ws: string;
let planner: TestUser;
let admin: TestUser;
let noma: string;
let manualProject: string;
let fetchMock: jest.Mock;
const W = () => `/api/v2/workspaces/${ws}`;

const PROJECTS = [
  { id: 'PV-1', name: 'Phoenix', status: 'Active', start: '2026-10-01', end: '2027-04-30' },
  { id: 'PV-2', name: 'Ledger', status: 'Planning', start: '2027-01-01', end: '2027-06-30' },
];
const ASSIGNMENTS: Record<string, unknown[]> = {
  'PV-1': [
    { id: 'A-1', name: 'Noma Odigie', email: 'noma@acme.test', percent: 50, start: '2026-10-01', end: '2026-12-31' },
    { id: 'A-2', name: 'Unknown Person', email: null, percent: 20, start: '2026-10-01', end: '2026-12-31' },
  ],
  'PV-2': [],
};

beforeAll(async () => {
  db = await setupDb();
  const org = await createOrg(db, 'PV Org');
  ws = await createWorkspace(db, org);
  planner = await createUser(db, { orgId: org, orgRole: 'MEMBER' });
  admin = await createUser(db, { orgId: org, orgRole: 'ORG_ADMIN' });
  await addMember(db, planner.id, ws, 'PLANNER');
  noma = await createPerson(db, ws, { name: 'Noma Odigie', email: 'noma@acme.test' });
  manualProject = await createProject(db, ws, { name: 'Manual one' });
  await db.query(
    `INSERT INTO workspace_integrations (workspace_id, provider, config, secret_enc) VALUES ($1, 'planview', $2::jsonb, $3)`,
    [
      ws,
      JSON.stringify({
        flavour: 'generic',
        baseUrl: 'https://pv.example.com',
        generic: {
          projectsPath: '/projects',
          assignmentsPath: '/assignments',
          fieldMap: { externalId: 'id', startDate: 'start', endDate: 'end', resourceName: 'name' },
        },
      }),
      encryptSecret('pv-secret'),
    ],
  );
});
afterAll(async () => {
  setDnsLookup(null);
  await teardownDb(db);
});
beforeEach(() => {
  testEnv();
  setDnsLookup(async () => ['93.184.216.34']);
  fetchMock = installFetch();
  fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer pv-secret');
    if (url.startsWith('https://pv.example.com/projects')) return jsonResponse({ value: PROJECTS });
    const pid = new URL(url).searchParams.get('projectId') ?? '';
    return jsonResponse({ value: ASSIGNMENTS[pid] ?? [] });
  });
});

describe('preview and apply (PV-01, PV-03)', () => {
  let previewId: string;
  it('previews new projects/assignments with suggested and unmatched people', async () => {
    const r = await call(v2, 'POST', `${W()}/planview/preview`, { token: planner.token });
    expect(r.status).toBe(200);
    previewId = r.json.previewId as string;
    expect(r.json.partial).toBe(false);
    const projects = r.json.projects as { new: Array<{ externalId: string }>; changed: unknown[]; removed: unknown[] };
    expect(projects.new.map((p) => p.externalId)).toEqual(['PV-1', 'PV-2']);
    const a = r.json.assignments as {
      new: Array<{ externalId: string; personId: string | null }>;
      unmatchedPeople: Array<{ externalId: string; suggestedPersonId: string | null }>;
    };
    expect(a.new.find((x) => x.externalId === 'A-1')?.personId).toBe(noma);
    expect(a.unmatchedPeople.find((x) => x.externalId === 'noma@acme.test')?.suggestedPersonId).toBe(noma);
    expect(a.unmatchedPeople.find((x) => x.externalId === 'unknown person')?.suggestedPersonId).toBeNull();
  });

  it('applies selected changes in one transaction, never touching manual bookings', async () => {
    await db.query(
      `INSERT INTO allocations (id, workspace_id, resource_id, project_id, percentage, source) VALUES ('manual-1', $1, $2, $3, 30, 'manual')`,
      [ws, noma, manualProject],
    );
    const r = await call(v2, 'POST', `${W()}/planview/apply`, {
      token: planner.token,
      body: { previewId, accept: { projects: ['PV-1', 'PV-2'], assignments: ['A-1', 'A-2'] }, personMatches: {} },
    });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ created: 3, updated: 0, skipped: 1 });
    const allocs = await db.query(
      `SELECT source, external_ref, percentage, start_date::text AS s FROM allocations WHERE workspace_id = $1 ORDER BY id`,
      [ws],
    );
    expect(allocs).toContainEqual({ source: 'planview', external_ref: 'A-1', percentage: 50, s: '2026-10-01' });
    expect(allocs).toContainEqual({ source: 'manual', external_ref: null, percentage: 30, s: null });
    const pv = await db.query(
      `SELECT name, source, planview_id FROM projects WHERE planview_id IS NOT NULL ORDER BY planview_id`,
    );
    expect(pv.map((p) => [p.planview_id, p.source])).toEqual([
      ['PV-1', 'planview'],
      ['PV-2', 'planview'],
    ]);
    const ident = await db.query(
      `SELECT external_id, person_id, confirmed FROM external_identities WHERE provider = 'planview'`,
    );
    expect(ident).toEqual([{ external_id: 'noma@acme.test', person_id: noma, confirmed: true }]);
    const ev = await db.query(`SELECT after FROM audit_events WHERE action = 'integration.import'`);
    expect(ev[0].after).toEqual({ created: 3, updated: 0, skipped: 1 });
  });

  it('reports 0 new and 0 changed on an identical re-import, and 409 for a used or expired preview (PV-01#AC4-5)', async () => {
    const again = await call(v2, 'POST', `${W()}/planview/preview`, { token: planner.token });
    const p = again.json.projects as { new: unknown[]; changed: unknown[] };
    const a = again.json.assignments as { new: Array<{ externalId: string }>; changed: unknown[] };
    expect(p.new).toHaveLength(0);
    expect(p.changed).toHaveLength(0);
    expect(a.new.map((x) => x.externalId)).toEqual(['A-2']); // still no person for this one
    expect(a.changed).toHaveLength(0);
    const used = await call(v2, 'POST', `${W()}/planview/apply`, {
      token: planner.token,
      body: { previewId, accept: { projects: [], assignments: [] } },
    });
    expect(used.status).toBe(409);
    expect(used.json.error).toBe('This preview expired. Run it again.');
  });

  it('shows field-level changes and only PMO Admins can test the mapping (PV-02)', async () => {
    PROJECTS[0].end = '2027-05-31';
    const r = await call(v2, 'POST', `${W()}/planview/preview`, { token: planner.token });
    const changed = (r.json.projects as { changed: Array<{ externalId: string; changes: unknown[] }> }).changed;
    expect(changed[0]).toMatchObject({
      externalId: 'PV-1',
      changes: [{ field: 'endDate', from: '2027-04-30', to: '2027-05-31' }],
    });
    expect((await call(v2, 'POST', `${W()}/planview/test-mapping`, { token: planner.token })).status).toBe(403);
    const t = await call(v2, 'POST', `${W()}/planview/test-mapping`, { token: admin.token });
    expect(t.status).toBe(200);
    expect((t.json.mapped as { project: { externalId: string } }).project.externalId).toBe('PV-1');
    expect(t.json.missing).toEqual([]);
  });

  it('turns upstream failures into a generic 502', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: 'down' }, 500));
    const r = await call(v2, 'POST', `${W()}/planview/preview`, { token: planner.token });
    expect(r.status).toBe(502);
    expect(r.json.code).toBe('server_error');
  });
});
