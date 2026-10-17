/**
 * Independent QA (Release 2.0): the CSV people import end to end, client parser → real API handler.
 *
 * The developer tests cover the parser (utils/csvPeople) and the handler separately, and the e2e covers the import in
 * the demo workspace (DemoTransport), so nobody posts what the real client sends to the real server.
 *
 * QA-005 (Critical): parsePeopleCsv resolves `above_craft` short codes to craft ids ("PM" → "project-mgmt") but the
 * /people/import schema caps `aboveCraft` at 10 characters, so every row with an above-the-table craft whose id is
 * longer than 10 characters (all twelve seeded crafts except none) is skipped with
 * "Too big: expected string to have <=10 characters". On the live stack the template row and a Noma update came back
 * "0 created, 0 updated, 2 skipped".
 */
import { handler as v2 } from '../../netlify/functions/v2';
import { parsePeopleCsv } from '../../utils/csvPeople';
import type { WorkspaceSnapshot } from '../../shared/contracts/dto';
import type { PgliteDb } from '../backend/helpers/pglite';
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
} from '../backend/helpers/harness';

let db: PgliteDb;
let ws: string;
let planner: TestUser;
const CSV = [
  'name,email,job_title,type,location,chapter,team,home_tribe,target_pct,above_craft,below_crafts,skills',
  'Zoë Quinn,zoe.quinn@qa.test,Delivery Lead,Permanent,Dublin,,,,90,PM,SM:2:30|BA:1:20,Agile;Risk',
].join('\n');

async function snapshot(): Promise<WorkspaceSnapshot> {
  const r = await call(v2, 'GET', `/api/v2/workspaces/${ws}/snapshot`, { token: planner.token });
  expect(r.status).toBe(200);
  return r.json as unknown as WorkspaceSnapshot;
}

beforeAll(async () => {
  db = await setupDb();
  const org = await createOrg(db, 'Import Org');
  ws = await createWorkspace(db, org, 'Main');
  planner = await createUser(db, { orgId: org, orgRole: 'MEMBER' });
  await addMember(db, planner.id, ws, 'PLANNER');
});
afterAll(async () => teardownDb(db));
beforeEach(() => testEnv());

describe('QA: CSV people import, client parser to real handler', () => {
  it('the client parser accepts the template row and resolves crafts to ids', async () => {
    const report = parsePeopleCsv(CSV, await snapshot());
    expect(report.invalidCount).toBe(0);
    expect(report.validRows[0]).toMatchObject({ name: 'Zoë Quinn', aboveCraft: 'project-mgmt' });
  });

  it('the handler accepts an above-the-table craft given as a short code', async () => {
    const r = await call(v2, 'POST', `/api/v2/workspaces/${ws}/people/import`, {
      token: planner.token,
      body: { rows: [{ name: 'Short Code', aboveCraft: 'PM' }], createMissingStructure: false },
    });
    expect(r.json).toMatchObject({ created: 1, skipped: 0 });
  });

  it.skip('QA-005 rows produced by the client parser import without being skipped', async () => {
    const report = parsePeopleCsv(CSV, await snapshot());
    const r = await call(v2, 'POST', `/api/v2/workspaces/${ws}/people/import`, {
      token: planner.token,
      body: { rows: report.validRows, createMissingStructure: false },
    });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ created: 1, updated: 0, skipped: 0, errors: [] });
    const zoe = (await snapshot()).people.find((p) => p.name === 'Zoë Quinn');
    expect(zoe).toMatchObject({ primaryCraft: 'project-mgmt', targetUtil: 90 });
  });
});
