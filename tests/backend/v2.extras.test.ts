/**
 * Routes the 2.0 client and shell call beyond the §4.3 table (coordinator request): PATCH /me, invitation resend
 * and `emailSent`, platform overview, sign out everywhere, and legacy /api/qbr with a cookie session.
 */
import { handler as v2 } from '../../netlify/functions/v2';
import { handler as auth } from '../../netlify/functions/auth';
import { handler as qbr } from '../../netlify/functions/qbr';
import { setEmailTransport } from '../../netlify/functions/_lib/email';
import type { PgliteDb } from './helpers/pglite';
import {
  PASSWORD,
  addMember,
  call,
  cookieValue,
  createOrg,
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
let otherWs: string;
let admin: TestUser;
let wsAdmin: TestUser;
let viewer: TestUser;
let outsider: TestUser;
let platform: TestUser;

async function signIn(u: TestUser) {
  const r = await call(auth, 'POST', '/api/auth/login', { body: { email: u.email, password: PASSWORD } });
  expect(r.status).toBe(200);
  return {
    cookies: { pcp_session: cookieValue(r.cookies, 'pcp_session')!, pcp_csrf: cookieValue(r.cookies, 'pcp_csrf')! },
    token: r.json.token as string,
  };
}

beforeAll(async () => {
  db = await setupDb();
  org = await createOrg(db, 'Extras', 'ENTERPRISE', { features: { qbrSprintModule: true } });
  const other = await createOrg(db, 'Elsewhere');
  ws = await createWorkspace(db, org, 'Main');
  otherWs = await createWorkspace(db, org, 'Second');
  admin = await createUser(db, { orgId: org, orgRole: 'ORG_ADMIN', name: 'Ada Admin' });
  wsAdmin = await createUser(db, { orgId: org, orgRole: 'MEMBER' });
  viewer = await createUser(db, { orgId: org, orgRole: 'MEMBER' });
  outsider = await createUser(db, { orgId: other, orgRole: 'ORG_ADMIN' });
  platform = await createUser(db, { platformAdmin: true });
  await addMember(db, wsAdmin.id, otherWs, 'WORKSPACE_ADMIN');
  await addMember(db, viewer.id, ws, 'VIEWER');
});
afterAll(async () => {
  setEmailTransport(null);
  await teardownDb(db);
});
beforeEach(() => testEnv());

describe('PATCH /api/v2/me', () => {
  it('updates the caller own name, audits it and returns MeResponse', async () => {
    const r = await call(v2, 'PATCH', '/api/v2/me', { token: viewer.token, body: { name: '  Vera Viewer ' } });
    expect(r.status).toBe(200);
    expect((r.json.user as { name: string }).name).toBe('Vera Viewer');
    expect((r.json.org as { id: string }).id).toBe(org);
    const ev = await db.query(
      `SELECT before, after FROM audit_events WHERE action = 'user.profile_update' AND target_id = $1`,
      [viewer.id],
    );
    expect(ev[0]).toMatchObject({ after: { name: 'Vera Viewer' } });
  });

  it('rejects empty names, unknown fields and anonymous callers; cookie writes need CSRF', async () => {
    expect((await call(v2, 'PATCH', '/api/v2/me', { token: viewer.token, body: { name: ' ' } })).status).toBe(400);
    const extra = await call(v2, 'PATCH', '/api/v2/me', { token: viewer.token, body: { name: 'X', email: 'a@b.c' } });
    expect(extra.status).toBe(400);
    expect((await call(v2, 'PATCH', '/api/v2/me', { body: { name: 'X' } })).status).toBe(401);
    const s = await signIn(viewer);
    expect((await call(v2, 'PATCH', '/api/v2/me', { cookies: s.cookies, body: { name: 'Y' } })).status).toBe(403);
    const ok = await call(v2, 'PATCH', '/api/v2/me', {
      cookies: s.cookies,
      body: { name: 'Vera' },
      headers: { 'x-csrf-token': s.cookies.pcp_csrf },
    });
    expect(ok.status).toBe(200);
  });
});

describe('invitations: emailSent and resend', () => {
  it('reports emailSent=false without an email provider and true with one', async () => {
    const off = await call(v2, 'POST', `/api/v2/orgs/${org}/invitations`, {
      token: admin.token,
      body: { email: 'new1@extras.test', orgRole: 'MEMBER', workspaces: [{ workspaceId: ws, role: 'PLANNER' }] },
    });
    expect(off.status).toBe(201);
    expect(off.json.emailSent).toBe(false);
    const sent: string[] = [];
    setEmailTransport({
      send: async (m) => {
        sent.push(String(m.to));
        return {};
      },
    });
    const on = await call(v2, 'POST', `/api/v2/orgs/${org}/invitations`, {
      token: admin.token,
      body: { email: 'new2@extras.test', orgRole: 'MEMBER', workspaces: [{ workspaceId: ws, role: 'VIEWER' }] },
    });
    expect(on.json.emailSent).toBe(true);
    expect(sent).toContain('new2@extras.test');
    setEmailTransport(null);
  });

  it('resend issues a new link, invalidates the old one and is limited like revoke', async () => {
    const created = await call(v2, 'POST', `/api/v2/orgs/${org}/invitations`, {
      token: admin.token,
      body: { email: 'resend@extras.test', orgRole: 'MEMBER', workspaces: [{ workspaceId: ws, role: 'VIEWER' }] },
    });
    const id = (created.json.invitation as { id: string }).id;
    const oldToken = (created.json.inviteUrl as string).split('/invite/')[1];
    const path = `/api/v2/orgs/${org}/invitations/${id}/resend`;

    expect((await call(v2, 'POST', path, { token: outsider.token, body: {} })).status).toBe(403);
    expect((await call(v2, 'POST', path, { token: viewer.token, body: {} })).status).toBe(403);
    // A workspace admin may only resend invitations to workspaces they administer.
    expect((await call(v2, 'POST', path, { token: wsAdmin.token, body: {} })).status).toBe(403);
    expect((await call(v2, 'POST', path, { body: {} })).status).toBe(401);

    const r = await call(v2, 'POST', path, { token: admin.token, body: {} });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ invitation: { id, email: 'resend@extras.test' }, emailSent: false });
    const newToken = (r.json.inviteUrl as string).split('/invite/')[1];
    expect(newToken).not.toBe(oldToken);
    expect((await call(v2, 'GET', `/api/v2/invitations/${newToken}`)).status).toBe(200);
    expect([404, 410]).toContain((await call(v2, 'GET', `/api/v2/invitations/${oldToken}`)).status);
    const ev = await db.query(`SELECT count(*)::int AS n FROM audit_events WHERE action = 'member.invite_resend'`);
    expect(ev[0].n).toBe(1);

    expect((await call(v2, 'DELETE', `/api/v2/orgs/${org}/invitations/${id}`, { token: admin.token })).status).toBe(
      204,
    );
    expect((await call(v2, 'POST', path, { token: admin.token, body: {} })).status).toBe(404);
    expect(
      (await call(v2, 'POST', `/api/v2/orgs/${org}/invitations/not-a-uuid/resend`, { token: admin.token, body: {} }))
        .status,
    ).toBe(404);
  });
});

describe('GET /api/v2/platform/overview', () => {
  it('is platform-admin only and returns counts', async () => {
    expect((await call(v2, 'GET', '/api/v2/platform/overview')).status).toBe(401);
    expect((await call(v2, 'GET', '/api/v2/platform/overview', { token: admin.token })).status).toBe(403);
    await signIn(admin);
    const r = await call(v2, 'GET', '/api/v2/platform/overview', { token: platform.token });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ orgs: 2, workspaces: 2, platformAdmins: 1 });
    expect(r.json.activeSessions as number).toBeGreaterThanOrEqual(1);
    expect(r.json.syncHealth).toMatchObject({ queued: 0, running: 0, failed24h: 0 });
  });
});

describe('POST /api/auth/logout-all', () => {
  it('revokes every session and legacy bearer token of the caller', async () => {
    const u = await createUser(db, { orgId: org, orgRole: 'MEMBER' });
    const a = await signIn(u);
    const b = await signIn(u);
    expect((await call(v2, 'GET', '/api/v2/me', { token: u.token })).status).toBe(200);
    expect((await call(auth, 'POST', '/api/auth/logout-all', { cookies: a.cookies })).status).toBe(403); // CSRF
    const r = await call(auth, 'POST', '/api/auth/logout-all', {
      cookies: a.cookies,
      headers: { 'x-csrf-token': a.cookies.pcp_csrf },
    });
    expect(r.status).toBe(204);
    expect(cookieValue(r.cookies, 'pcp_session')).toBe('');
    expect((await call(v2, 'GET', '/api/v2/me', { cookies: b.cookies })).status).toBe(401);
    expect((await call(v2, 'GET', '/api/v2/me', { token: b.token })).status).toBe(401);
    expect((await call(v2, 'GET', '/api/v2/me', { token: u.token })).status).toBe(401); // v1.1 token (tv=0)
    const ev = await db.query(
      `SELECT count(*)::int AS n FROM audit_events WHERE action = 'auth.logout_all' AND target_id = $1`,
      [u.id],
    );
    expect(ev[0].n).toBe(1);
    expect((await call(auth, 'POST', '/api/auth/logout-all', {})).status).toBe(401);
  });
});

describe('legacy /api/qbr with a cookie session (Sprints page)', () => {
  it('reads with the cookie alone and writes with the CSRF header', async () => {
    const s = await signIn(admin);
    expect((await call(qbr, 'GET', `/api/qbr/overview?wsId=${ws}`, { cookies: s.cookies })).status).toBe(200);
    const noCsrf = await call(qbr, 'POST', `/api/qbr/seed?wsId=${ws}`, { cookies: s.cookies, body: {} });
    expect(noCsrf.status).toBe(403);
    const ok = await call(qbr, 'POST', `/api/qbr/seed?wsId=${ws}`, {
      cookies: s.cookies,
      body: {},
      headers: { 'x-csrf-token': s.cookies.pcp_csrf },
    });
    expect(ok.status).toBe(200);
  });
});
