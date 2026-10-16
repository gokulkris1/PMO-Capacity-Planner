/**
 * /api/integrations/* (HS-08, HS-09, UAM-07): permissions per role, secrets never returned, secret cleared when
 * the host changes, Jira host allow-list, public-HTTPS Planview, redirects not followed, usage limited to the
 * configured project keys, v2/legacy encryption.
 */
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { handler as integrations } from '../../netlify/functions/integrations';
import { decryptSecret, encryptSecret } from '../../netlify/functions/_lib/crypto';
import { setDnsLookup, isPrivateAddress } from '../../netlify/functions/_lib/net';
import { genericAssignments, genericProjects, adaptiveAssignments } from '../../netlify/functions/_lib/planview/client';
import type { PgliteDb } from './helpers/pglite';
import { addMember, call, createOrg, createUser, createWorkspace, setupDb, teardownDb, testEnv, JWT_SECRET, type TestUser } from './helpers/harness';
import { installFetch, jsonResponse } from './helpers/fetchMock';

let db: PgliteDb;
let ws: string;
let admin: TestUser;
let planner: TestUser;
let viewer: TestUser;
let fetchMock: jest.Mock;

const path = (p: string) => `/api/integrations${p}?wsId=${ws}`;

beforeAll(async () => {
  db = await setupDb();
  const org = await createOrg(db, 'Integrations Org');
  ws = await createWorkspace(db, org);
  admin = await createUser(db, { orgId: org, orgRole: 'MEMBER' });
  planner = await createUser(db, { orgId: org, orgRole: 'MEMBER' });
  viewer = await createUser(db, { orgId: org, orgRole: 'MEMBER' });
  await addMember(db, admin.id, ws, 'WORKSPACE_ADMIN');
  await addMember(db, planner.id, ws, 'PLANNER');
  await addMember(db, viewer.id, ws, 'VIEWER');
});
afterAll(async () => {
  setDnsLookup(null);
  await teardownDb(db);
});
beforeEach(async () => {
  testEnv();
  fetchMock = installFetch();
  setDnsLookup(async () => ['93.184.216.34']);
  await db.query(`DELETE FROM workspace_integrations`);
});

async function saveJira(extra: Record<string, unknown> = {}) {
  return call(integrations, 'POST', path('/config'), {
    token: admin.token,
    body: { jira: { domain: 'acme.atlassian.net', email: 'pm@acme.com', apiToken: 'jira-token', projectKeys: ['ABC'], ...extra } },
  });
}

describe('permissions (HS-08#AC5-6)', () => {
  it('config read is Planner+, writes and remote listing are PMO Admin only, viewers get nothing', async () => {
    await saveJira();
    expect((await call(integrations, 'GET', path('/config'), { token: planner.token })).status).toBe(200);
    expect((await call(integrations, 'GET', path('/config'), { token: viewer.token })).status).toBe(403);
    for (const [m, p] of [
      ['POST', '/config'],
      ['POST', '/jira/test'],
      ['GET', '/jira/projects'],
      ['GET', '/jira/boards'],
      ['POST', '/planview/test'],
    ]) {
      const r = await call(integrations, m, path(p), { token: planner.token, body: {} });
      expect([p, r.status]).toEqual([p, 403]);
    }
    expect((await call(integrations, 'POST', path('/jira/usage'), { token: viewer.token, body: {} })).status).toBe(403);
    expect((await call(integrations, 'GET', path('/config'))).status).toBe(401);
    expect((await call(integrations, 'GET', '/api/integrations/config', { token: admin.token })).status).toBe(400);
  });

  it('never returns the secret and stores it as v2 ciphertext (HS-09#AC1)', async () => {
    const r = await saveJira();
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.json)).not.toContain('jira-token');
    expect((r.json.jira as { hasSecret: boolean; configured: boolean })).toMatchObject({ hasSecret: true, configured: true });
    const row = await db.query(`SELECT secret_enc FROM workspace_integrations WHERE provider = 'jira'`);
    expect(String(row[0].secret_enc)).toMatch(/^v2:/);
    expect(decryptSecret(String(row[0].secret_enc))).toBe('jira-token');
    const ev = await db.query(`SELECT action FROM audit_events WHERE workspace_id = $1`, [ws]);
    expect(ev.map((e) => e.action)).toContain('integration.secret_update');
  });
});

describe('secret binding and host rules (HS-08#AC1-4)', () => {
  it('clears the stored token when the domain or email changes without a new token', async () => {
    await saveJira();
    const moved = await call(integrations, 'POST', path('/config'), { token: admin.token, body: { jira: { domain: 'evil.atlassian.net' } } });
    expect(moved.json.secretCleared).toBe(true);
    expect((moved.json.jira as { hasSecret: boolean }).hasSecret).toBe(false);
    await saveJira();
    const keysOnly = await call(integrations, 'POST', path('/config'), { token: admin.token, body: { jira: { projectKeys: ['ABC', 'XYZ'] } } });
    expect(keysOnly.json.secretCleared).toBe(false);
    expect((keysOnly.json.jira as { hasSecret: boolean }).hasSecret).toBe(true);
  });

  it('accepts only Atlassian Cloud hosts for Jira', async () => {
    for (const domain of ['localhost', '10.0.0.1', 'evil.example.com', 'acme.atlassian.net:8443']) {
      const r = await call(integrations, 'POST', path('/config'), { token: admin.token, body: { jira: { domain, email: 'a@b.c' } } });
      expect([domain, r.status, r.json.fields]).toEqual([domain, 400, { domain: 'Enter your Jira Cloud site, e.g. acme.atlassian.net' }]);
    }
  });

  it('requires a public HTTPS Planview URL (no IPs, ports, http, private DNS answers)', async () => {
    const bad = ['http://pv.example.com', 'https://10.1.2.3', 'https://pv.example.com:8443', 'https://[::1]'];
    for (const baseUrl of bad) {
      const r = await call(integrations, 'POST', path('/config'), { token: admin.token, body: { planview: { baseUrl, secret: 's' } } });
      expect([baseUrl, r.status, r.json.error]).toEqual([baseUrl, 400, 'Planview URL must be a public HTTPS address']);
    }
    setDnsLookup(async () => ['169.254.169.254']);
    const metadata = await call(integrations, 'POST', path('/config'), { token: admin.token, body: { planview: { baseUrl: 'https://pv.example.com', secret: 's' } } });
    expect(metadata.status).toBe(400);
    setDnsLookup(async () => ['93.184.216.34']);
    const ok = await call(integrations, 'POST', path('/config'), {
      token: admin.token,
      body: { planview: { baseUrl: 'https://pv.example.com/api/', flavour: 'generic', secret: 's', generic: { projectsPath: '/projects' } } },
    });
    expect(ok.status).toBe(200);
    const moved = await call(integrations, 'POST', path('/config'), { token: admin.token, body: { planview: { baseUrl: 'https://other.example.com' } } });
    expect(moved.json.secretCleared).toBe(true);
    expect(isPrivateAddress('192.168.1.1')).toBe(true);
    expect(isPrivateAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
  });

  it('does not follow redirects from the remote host', async () => {
    await saveJira();
    fetchMock.mockResolvedValue({ ok: false, status: 302, type: 'basic', headers: { get: () => 'https://evil' }, text: async () => '' });
    const r = await call(integrations, 'POST', path('/jira/test'), { token: admin.token, body: {} });
    expect(r.status).toBe(502);
    expect(r.json.error).toBe('Unexpected redirect from acme.atlassian.net');
    expect(fetchMock.mock.calls[0][1].redirect).toBe('manual');
  });
});

describe('Jira usage and test', () => {
  it('limits usage to configured project keys and sends Basic auth to the configured site', async () => {
    await saveJira({ storyPointsFieldId: 'customfield_1' });
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/rest/api/3/field')) return jsonResponse([{ id: 'customfield_9', name: 'Sprint' }]);
      return jsonResponse({ issues: [], isLast: true });
    });
    const r = await call(integrations, 'POST', path('/jira/usage'), { token: planner.token, body: { projectKeys: ['ABC', 'SECRET'] } });
    expect(r.status).toBe(200);
    const search = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/search/jql'))!;
    expect(search[0]).toBe('https://acme.atlassian.net/rest/api/3/search/jql');
    expect(JSON.parse(search[1].body).jql).toContain('project in ("ABC")');
    expect(JSON.parse(search[1].body).jql).not.toContain('SECRET');
    expect(search[1].headers.Authorization).toBe(`Basic ${Buffer.from('pm@acme.com:jira-token').toString('base64')}`);
  });

  it('maps upstream failures to a generic 502 and a missing config to 400', async () => {
    const none = await call(integrations, 'POST', path('/jira/usage'), { token: planner.token, body: {} });
    expect(none.status).toBe(400);
    await saveJira({ storyPointsFieldId: 'cf', sprintFieldId: 'cs' } as Record<string, unknown>);
    fetchMock.mockResolvedValue(jsonResponse({ errorMessages: ['Bad JQL'] }, 400));
    const r = await call(integrations, 'POST', path('/jira/usage'), { token: planner.token, body: {} });
    expect(r.status).toBe(502);
    expect(r.json.code).toBe('server_error');
  });
});

describe('encryption key (HS-09)', () => {
  it('decrypts legacy 3-part secrets with the JWT-derived key', () => {
    const key = createHash('sha256').update(`${JWT_SECRET}:integrations`).digest();
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([c.update('legacy-token', 'utf8'), c.final()]);
    const payload = `${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${ct.toString('base64')}`;
    expect(decryptSecret(payload)).toBe('legacy-token');
  });

  it('refuses new secret writes without INTEGRATIONS_ENC_KEY (503) but still reads legacy ones', async () => {
    delete process.env.INTEGRATIONS_ENC_KEY;
    expect(() => encryptSecret('x')).toThrow();
    const r = await saveJira();
    expect(r.status).toBe(503);
  });
});

describe('Planview adapters', () => {
  it('maps generic records through dotted field paths', () => {
    const projects = genericProjects({ externalId: 'meta.code', name: 'title' }, [{ meta: { code: 'P-1' }, title: 'Alpha', StartDate: '2026-10-01' }]);
    expect(projects).toEqual([{ externalId: 'P-1', name: 'Alpha', status: null, startDate: '2026-10-01', endDate: null, manager: null }]);
    const a = genericAssignments({ percent: 'alloc.pct' }, [{ id: 'A1', Resource: 'Noma', email: 'n@x', alloc: { pct: 40 } }], 'P-1');
    expect(a[0]).toMatchObject({ externalId: 'A1', projectExternalId: 'P-1', resourceName: 'Noma', percent: 40 });
  });

  it('normalises AdaptiveWork units into percent or hours', () => {
    const rows = adaptiveAssignments(
      [
        { id: '/RegularResourceLink/1', Resource: { Name: 'A', Email: 'a@x' }, Units: { value: 50, unit: 'Percent' } },
        { id: '/RegularResourceLink/2', Resource: { Name: 'B' }, Units: { value: 16, unit: 'Hours' } },
      ],
      'P',
    );
    expect(rows[0]).toMatchObject({ percent: 50, resourceEmail: 'a@x' });
    expect(rows[1]).toMatchObject({ percent: null, hours: 16 });
  });
});
