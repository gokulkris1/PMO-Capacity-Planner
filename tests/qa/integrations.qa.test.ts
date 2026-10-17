/**
 * QA-009 / QA-010 (Release 2.0 fixes): outbound failures and rejected Jira credentials.
 *
 * - QA-009: with Jira or Planview unreachable (DNS failure, refused connection) every integration call answered
 *   500 "Server error". It must be a 502 (unreachable or failing upstream) or 504 (no answer in time) ApiError with a
 *   message a person can act on, and the settings UI shows that message.
 * - QA-010: Jira Cloud answers an unauthenticated JQL search with 200 and no issues, so a sync with a wrong API token
 *   "succeeded" and health said Healthy. The job must fail, health must be failed and the Home banner must show.
 */
import { handler as integrations } from '../../netlify/functions/integrations';
import { handler as v2 } from '../../netlify/functions/v2';
import { encryptSecret } from '../../netlify/functions/_lib/crypto';
import { setDnsLookup } from '../../netlify/functions/_lib/net';
import { ApiRequestError, userMessage } from '../../services/api/errors';
import { errorMessage } from '../../components/ui/format';
import { syncHealthBanner } from '../../utils/viewModels/delivery';
import type { SyncHealthDTO } from '../../shared/contracts/dto';
import type { PgliteDb } from '../backend/helpers/pglite';
import {
  addMember,
  call,
  createOrg,
  createProject,
  createTribe,
  createUser,
  createWorkspace,
  setupDb,
  teardownDb,
  testEnv,
  type TestUser,
} from '../backend/helpers/harness';
import { installFetch, jsonResponse } from '../backend/helpers/fetchMock';

let db: PgliteDb;
let ws: string;
let admin: TestUser;
let planner: TestUser;
let fetchMock: jest.Mock;
const path = (p: string) => `/api/integrations${p}${p.includes('?') ? '&' : '?'}wsId=${ws}`;
const W = () => `/api/v2/workspaces/${ws}`;

/** What Node's fetch throws when DNS fails: TypeError('fetch failed') with the system error as `cause`. */
const dnsFailure = () => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });

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
        storyPointsFieldId: 'customfield_10016',
        sprintFieldId: 'customfield_10020',
      }),
      encryptSecret('fake-token'),
    ],
  );
}

beforeAll(async () => {
  db = await setupDb();
  const org = await createOrg(db, 'Egress Org');
  ws = await createWorkspace(db, org);
  const tribe = await createTribe(db, org, 'Payments');
  await createProject(db, ws, { tribeId: tribe, name: 'Phoenix' });
  admin = await createUser(db, { orgId: org, orgRole: 'MEMBER' });
  planner = await createUser(db, { orgId: org, orgRole: 'MEMBER' });
  await addMember(db, admin.id, ws, 'WORKSPACE_ADMIN');
  await addMember(db, planner.id, ws, 'PLANNER');
});
afterAll(async () => {
  setDnsLookup(null);
  await teardownDb(db);
});
beforeEach(async () => {
  testEnv();
  fetchMock = installFetch();
  setDnsLookup(async () => ['93.184.216.34']);
  await configureJira();
});

describe('QA-009 Jira or Planview unreachable: 502/504 with a human message, never 500', () => {
  it('every Jira integration call answers 502 "Could not reach Jira …" when the host cannot be reached', async () => {
    fetchMock.mockRejectedValue(dnsFailure());
    for (const [m, p, who, body] of [
      ['POST', '/jira/test', admin, {}],
      ['GET', '/jira/projects', admin, undefined],
      ['GET', '/jira/boards?projectKey=PHX', admin, undefined],
      ['POST', '/jira/usage', planner, {}],
    ] as const) {
      const r = await call(integrations, m, path(p), { token: who.token, body });
      expect([p, r.status, r.json.code]).toEqual([p, 502, 'server_error']);
      expect(r.json.error).toBe(
        'Could not reach Jira at acme.atlassian.net. Check the address and try again in a minute.',
      );
    }
  });

  it('a Jira that does not answer in time is a 504 with the timeout in the message', async () => {
    testEnv({ INTEGRATIONS_FETCH_TIMEOUT_MS: '50' });
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) =>
          init.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          ),
        ),
    );
    const r = await call(integrations, 'POST', path('/jira/test'), { token: admin.token, body: {} });
    expect([r.status, r.json.code]).toEqual([504, 'server_error']);
    expect(r.json.error).toMatch(/^Jira did not respond within 0\.1s\. Try again in a minute\.$/);
  });

  it('Planview unreachable is a 502 too, and an unreachable Jira during a sync fails the job with the reason', async () => {
    await call(integrations, 'POST', path('/config'), {
      token: admin.token,
      body: {
        planview: {
          baseUrl: 'https://pv.example.com/api',
          flavour: 'generic',
          secret: 'pv-token',
          generic: { projectsPath: '/projects' },
        },
      },
    });
    fetchMock.mockRejectedValue(dnsFailure());
    const pv = await call(integrations, 'POST', path('/planview/test'), { token: admin.token, body: {} });
    expect(pv.status).toBe(502);
    expect(pv.json.error).toMatch(/^Could not reach Planview at pv\.example\.com/);

    await configureJira();
    const start = await call(v2, 'POST', `${W()}/sync/jira`, { token: planner.token });
    const id = (start.json.job as { id: string }).id;
    const step = await call(v2, 'POST', `${W()}/sync/jobs/${id}/step`, { token: planner.token });
    expect(step.status).toBe(200);
    expect(step.json.job).toMatchObject({
      status: 'failed',
      error: 'Could not reach Jira at acme.atlassian.net. Check the address and try again in a minute.',
    });
  });

  it('the settings and delivery UI show the server message for 502 and 504, not "Something went wrong"', () => {
    const unreachable = new ApiRequestError(502, 'server_error', 'Could not reach Jira at acme.atlassian.net.', {
      requestId: 'r1',
    });
    const slow = new ApiRequestError(504, 'server_error', 'Jira did not respond within 8s. Try again in a minute.');
    expect(userMessage(unreachable)).toBe('Could not reach Jira at acme.atlassian.net.');
    expect(userMessage(slow)).toBe('Jira did not respond within 8s. Try again in a minute.');
    expect(errorMessage(unreachable)).toBe('Could not reach Jira at acme.atlassian.net.');
    // A 500 still never leaks server text.
    expect(userMessage(new ApiRequestError(500, 'server_error', 'stack trace'))).toBe(
      'Something went wrong. Try again.',
    );
  });
});

describe('QA-010 Jira rejects the credentials during a sync', () => {
  const sync = async () => {
    await db.query(
      `UPDATE sync_jobs SET status = 'failed' WHERE workspace_id = $1 AND status IN ('queued','running')`,
      [ws],
    );
    const start = await call(v2, 'POST', `${W()}/sync/jira`, { token: planner.token });
    const id = (start.json.job as { id: string }).id;
    return call(v2, 'POST', `${W()}/sync/jobs/${id}/step`, { token: planner.token });
  };

  it('a 401 from Jira fails the job, health is failed and the Home banner says why', async () => {
    // What Jira Cloud does with a fake token: /myself is 401, while the JQL search answers 200 with nothing.
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith('/rest/api/3/myself')
        ? jsonResponse({ message: 'Client must be authenticated to access this resource.' }, 401)
        : jsonResponse({ issues: [], isLast: true }),
    );
    const step = await sync();
    expect(step.json.job).toMatchObject({ status: 'failed', error: 'Jira rejected the credentials', issuesSeen: 0 });
    const health = await call(v2, 'GET', `${W()}/sync/health`, { token: planner.token });
    expect(health.json).toMatchObject({ configured: true, state: 'failed' });
    const banner = syncHealthBanner(health.json as unknown as SyncHealthDTO, new Date());
    expect(banner).toMatchObject({ kind: 'failed' });
    expect(banner?.message).toMatch(/^Jira sync failed .*: Jira rejected the credentials$/);
  });

  it('a 200 that Jira marks as a failed login (X-Seraph-LoginReason) is a credentials failure too', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({ accountId: '', issues: [], isLast: true }, 200, {
        'X-Seraph-LoginReason': 'AUTHENTICATED_FAILED',
      }),
    );
    const step = await sync();
    expect(step.json.job).toMatchObject({ status: 'failed', error: 'Jira rejected the credentials' });
    const test = await call(integrations, 'POST', path('/jira/test'), { token: admin.token, body: {} });
    expect(test.status).toBe(502);
    expect(test.json.error).toMatch(/^Jira rejected the credentials \(401\)\. Check the email and API token/);
  });
});
