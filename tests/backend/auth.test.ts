/**
 * /api/auth, /api/verify, /api/health: same logins, legacy tokens, cookie sessions, CSRF, refresh, logout,
 * OTP hardening and rate limits (AC-02, AC-03, AC-07, HS-01, HS-05, HS-13, HS-14, PL-12#AC2, PL-13).
 */
import jwt from 'jsonwebtoken';
import { handler as auth } from '../../netlify/functions/auth';
import { handler as verify } from '../../netlify/functions/verify';
import { handler as health } from '../../netlify/functions/health';
import { handler as v2 } from '../../netlify/functions/v2';
import { setEmailTransport } from '../../netlify/functions/_lib/email';
import type { PgliteDb } from './helpers/pglite';
import {
  JWT_SECRET,
  PASSWORD,
  call,
  cookieValue,
  createOrg,
  createUser,
  createWorkspace,
  addMember,
  setupDb,
  teardownDb,
  testEnv,
} from './helpers/harness';

let db: PgliteDb;
const sent: Array<{ to: string; subject: string; text: string }> = [];

beforeAll(async () => {
  db = await setupDb();
  setEmailTransport({
    send: async (m) => {
      sent.push({ to: m.to, subject: m.subject, text: m.text });
      return {};
    },
  });
});
afterAll(async () => {
  setEmailTransport(null);
  await teardownDb(db);
});
beforeEach(async () => {
  testEnv({ RESEND_API_KEY: 're_test' });
  sent.length = 0;
  await db.query('DELETE FROM rate_limits');
  await db.query('DELETE FROM otps');
});

function codeFrom(to: string): string {
  const m = [...sent].reverse().find((s) => s.to === to);
  const code = m?.text.match(/(\d{6})/)?.[1];
  if (!code) throw new Error(`no code mailed to ${to}`);
  return code;
}

describe('POST /api/auth/login (same logins, AC-03#AC1)', () => {
  it('signs in with the v1.1 response shape plus session and CSRF cookies', async () => {
    const org = await createOrg(db, 'Acme');
    const ws = await createWorkspace(db, org);
    const u = await createUser(db, { email: 'Ada@Acme.test', orgId: org, orgRole: 'ORG_ADMIN' });
    await addMember(db, u.id, ws, 'WORKSPACE_ADMIN');
    const r = await call(auth, 'POST', '/api/auth/login', { body: { email: 'ada@acme.test', password: PASSWORD } });
    expect(r.status).toBe(200);
    expect(r.json.user).toMatchObject({
      id: u.id,
      email: 'ada@acme.test',
      role: 'ORG_ADMIN',
      orgId: org,
      isPlatformAdmin: false,
      emailVerified: true,
      twoFactorEnabled: false,
    });
    expect((r.json.user as { orgSlug: string }).orgSlug).toMatch(/^acme-/);
    expect(typeof r.json.token).toBe('string');
    const session = r.cookies.find((c) => c.startsWith('pcp_session='))!;
    expect(session).toMatch(/HttpOnly/);
    expect(session).toMatch(/Secure/);
    expect(session).toMatch(/SameSite=Lax/);
    expect(session).toMatch(/Path=\/api/);
    expect(session).toMatch(/Max-Age=604800/);
    const csrf = r.cookies.find((c) => c.startsWith('pcp_csrf='))!;
    expect(csrf).not.toMatch(/HttpOnly/);
    expect(csrf).toMatch(/Path=\//);
    const claims = jwt.verify(cookieValue(r.cookies, 'pcp_session')!, JWT_SECRET) as Record<string, unknown>;
    expect(claims).toMatchObject({ sub: u.id, tv: 0 });
    const events = await db.query(`SELECT action FROM audit_events WHERE actor_user_id = $1`, [u.id]);
    expect(events.map((e) => e.action)).toContain('auth.login');
  });

  it('answers 401 with the same message for an unknown email and a wrong password, and audits the failure', async () => {
    const u = await createUser(db, { email: 'known@x.test' });
    const a = await call(auth, 'POST', '/api/auth/login', { body: { email: 'nobody@x.test', password: 'whatever12' } });
    const b = await call(auth, 'POST', '/api/auth/login', {
      body: { email: 'known@x.test', password: 'wrong-password' },
    });
    expect([a.status, b.status]).toEqual([401, 401]);
    expect(a.json.error).toBe('Invalid email or password');
    expect(b.json.error).toBe('Invalid email or password');
    expect(a.json.code).toBe('unauthorized');
    const failed = await db.query(`SELECT target_id FROM audit_events WHERE action = 'auth.login_failed'`);
    expect(failed.map((f) => f.target_id)).toContain(u.id);
  });

  it('accepts short legacy passwords for existing users (no policy on sign-in)', async () => {
    const bcrypt = await import('bcryptjs');
    await db.query(`INSERT INTO users (email, password_hash, role) VALUES ('short@x.test', $1, 'USER')`, [
      bcrypt.hashSync('abc', 4),
    ]);
    const r = await call(auth, 'POST', '/api/auth/login', { body: { email: 'short@x.test', password: 'abc' } });
    expect(r.status).toBe(200);
  });

  it('runs the 2FA flow end-to-end without ever returning the code (HS-05#AC6)', async () => {
    await createUser(db, { email: 'twofa@x.test', twoFactor: true });
    const first = await call(auth, 'POST', '/api/auth/login', { body: { email: 'twofa@x.test', password: PASSWORD } });
    expect(first.status).toBe(200);
    expect(first.json).toEqual({ require2FA: true, email: 'twofa@x.test' });
    expect(first.cookies).toHaveLength(0);
    const code = codeFrom('twofa@x.test');
    const stored = await db.query(`SELECT otp, otp_hash FROM otps WHERE email = 'twofa@x.test'`);
    expect(stored[0].otp).toBe('');
    expect(stored[0].otp_hash).toMatch(/^[0-9a-f]{64}$/);
    const second = await call(auth, 'POST', '/api/auth/login', {
      body: { email: 'twofa@x.test', password: PASSWORD, otp: code },
    });
    expect(second.status).toBe(200);
    expect(second.json.token).toBeDefined();
  });

  it('expires an OTP after 5 wrong attempts, even when the 6th is right (HS-05#AC2)', async () => {
    await createUser(db, { email: 'brute@x.test', twoFactor: true });
    await call(auth, 'POST', '/api/auth/login', { body: { email: 'brute@x.test', password: PASSWORD } });
    const code = codeFrom('brute@x.test');
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      const r = await call(auth, 'POST', '/api/auth/login', {
        body: { email: 'brute@x.test', password: PASSWORD, otp: wrong },
      });
      expect(r.status).toBe(400);
    }
    const last = await call(auth, 'POST', '/api/auth/login', {
      body: { email: 'brute@x.test', password: PASSWORD, otp: code },
    });
    expect(last.status).toBe(400);
    expect(last.json.error).toBe('This code has expired. Request a new one.');
  });

  it('rate limits after 10 attempts per email in 15 minutes with Retry-After (HS-05#AC3)', async () => {
    await createUser(db, { email: 'rl@x.test' });
    for (let i = 0; i < 10; i++) {
      await call(auth, 'POST', '/api/auth/login', { body: { email: 'rl@x.test', password: 'bad-password' } });
    }
    const r = await call(auth, 'POST', '/api/auth/login', { body: { email: 'rl@x.test', password: PASSWORD } });
    expect(r.status).toBe(429);
    expect(r.json.code).toBe('rate_limited');
    expect(Number(r.headers['Retry-After'])).toBeGreaterThan(0);
    expect(r.json.error).toMatch(/Too many attempts. Try again in \d+ minutes\./);
  });

  it('rate limits 30 attempts per IP', async () => {
    const headers = { 'x-nf-client-connection-ip': '203.0.113.9' };
    for (let i = 0; i < 30; i++) {
      await call(auth, 'POST', '/api/auth/login', { body: { email: `ip${i}@x.test`, password: 'nope-nope' }, headers });
    }
    const r = await call(auth, 'POST', '/api/auth/login', {
      body: { email: 'other@x.test', password: 'nope-nope' },
      headers,
    });
    expect(r.status).toBe(429);
  });
});

describe('sessions (AC-02, AC-03)', () => {
  it('accepts a v1.1 bearer token without tv and exchanges it for a cookie session (AC-03#AC2)', async () => {
    const u = await createUser(db, { email: 'legacy@x.test' });
    const legacy = jwt.sign({ id: u.id, email: u.email, role: 'USER' }, JWT_SECRET, { expiresIn: '7d' });
    const me = await call(v2, 'GET', '/api/v2/me', { token: legacy });
    expect(me.status).toBe(200);
    const r = await call(auth, 'POST', '/api/auth/session', { token: legacy });
    expect(r.status).toBe(200);
    expect((r.json.user as { id: string }).id).toBe(u.id);
    expect(cookieValue(r.cookies, 'pcp_session')).toBeTruthy();
    expect(cookieValue(r.cookies, 'pcp_csrf')).toHaveLength(43);
  });

  it('rejects tokens with alg none, another algorithm or another secret (AC-02#AC2)', async () => {
    const u = await createUser(db);
    const none = jwt.sign({ sub: u.id }, '', { algorithm: 'none' } as never);
    const hs512 = jwt.sign({ sub: u.id }, JWT_SECRET, { algorithm: 'HS512' });
    const other = jwt.sign({ sub: u.id }, 'another-secret');
    for (const t of [none, hs512, other]) {
      const r = await call(v2, 'GET', '/api/v2/me', { token: t });
      expect(r.status).toBe(401);
      expect(r.json.code).toBe('unauthorized');
    }
  });

  it('accepts JWT_SECRET_NEXT for graceful rotation', async () => {
    const u = await createUser(db);
    process.env.JWT_SECRET_NEXT = 'next-secret';
    const t = jwt.sign({ sub: u.id, tv: 0 }, 'next-secret');
    expect((await call(v2, 'GET', '/api/v2/me', { token: t })).status).toBe(200);
  });

  it('revokes sessions when token_version changes (AC-02#AC3)', async () => {
    const u = await createUser(db);
    await db.query('UPDATE users SET token_version = 3 WHERE id = $1', [u.id]);
    const r = await call(v2, 'GET', '/api/v2/me', { token: u.token });
    expect(r.status).toBe(401);
    expect(r.json.error).toBe('Your session has ended. Sign in again.');
  });

  it('requires X-CSRF-Token for cookie-authenticated writes, not for bearer (AC-03#AC3)', async () => {
    const org = await createOrg(db, 'Csrf');
    const u = await createUser(db, { orgId: org, orgRole: 'ORG_ADMIN' });
    const login = await call(auth, 'POST', '/api/auth/login', { body: { email: u.email, password: PASSWORD } });
    const cookies = {
      pcp_session: cookieValue(login.cookies, 'pcp_session')!,
      pcp_csrf: cookieValue(login.cookies, 'pcp_csrf')!,
    };
    const path = `/api/v2/orgs/${org}/tribes`;
    const noHeader = await call(v2, 'POST', path, { cookies, body: { name: 'T1' } });
    expect(noHeader.status).toBe(403);
    expect(noHeader.json.error).toBe('CSRF check failed');
    const wrong = await call(v2, 'POST', path, { cookies, body: { name: 'T1' }, headers: { 'x-csrf-token': 'x' } });
    expect(wrong.status).toBe(403);
    const ok = await call(v2, 'POST', path, {
      cookies,
      body: { name: 'T1' },
      headers: { 'x-csrf-token': cookies.pcp_csrf },
    });
    expect(ok.status).toBe(201);
    const get = await call(v2, 'GET', path, { cookies });
    expect(get.status).toBe(200);
    const bearer = await call(v2, 'POST', path, { token: u.token, body: { name: 'T2' } });
    expect(bearer.status).toBe(201);
  });

  it('rejects disallowed Origins and never answers CORS with * (AC-03#AC4)', async () => {
    const u = await createUser(db);
    const bad = await call(v2, 'GET', '/api/v2/me', { token: u.token, headers: { origin: 'https://evil.example' } });
    expect(bad.status).toBe(403);
    expect(bad.headers['Access-Control-Allow-Origin']).toBeUndefined();
    process.env.ALLOWED_ORIGINS = 'https://pmo.example';
    const good = await call(v2, 'GET', '/api/v2/me', { token: u.token, headers: { origin: 'https://pmo.example' } });
    expect(good.status).toBe(200);
    expect(good.headers['Access-Control-Allow-Origin']).toBe('https://pmo.example');
    expect(good.headers['Access-Control-Allow-Credentials']).toBe('true');
    expect(good.headers.Vary).toBe('Origin');
    const same = await call(v2, 'GET', '/api/v2/me', {
      token: u.token,
      headers: { origin: 'https://app.test.example', host: 'app.test.example' },
    });
    expect(same.status).toBe(200);
  });

  it('refreshes a session (cookie and v1.1 GET path) and returns 401 + cleared cookies when invalid (AC-03#AC5,#AC7)', async () => {
    const u = await createUser(db);
    const viaLegacy = await call(auth, 'GET', '/api/auth?refresh=true', { token: u.token });
    expect(viaLegacy.status).toBe(200);
    expect(viaLegacy.json.ok).toBe(true);
    expect(typeof viaLegacy.json.token).toBe('string');
    const viaCookie = await call(auth, 'POST', '/api/auth/refresh', { cookies: { pcp_session: u.token } });
    expect(viaCookie.status).toBe(200);
    expect(viaCookie.json).toEqual({ ok: true });
    expect(cookieValue(viaCookie.cookies, 'pcp_session')).toBeTruthy();
    const bad = await call(auth, 'POST', '/api/auth/refresh', { cookies: { pcp_session: 'garbage' } });
    expect(bad.status).toBe(401);
    expect(bad.cookies.some((c) => c.startsWith('pcp_session=;') && c.includes('Max-Age=0'))).toBe(true);
  });

  it('logs out (204, cookies cleared) and "all devices" bumps token_version (AC-03#AC6)', async () => {
    const u = await createUser(db);
    const r = await call(auth, 'POST', '/api/auth/logout', { token: u.token });
    expect(r.status).toBe(204);
    expect(r.cookies).toHaveLength(2);
    const all = await call(auth, 'POST', '/api/auth/logout', { token: u.token, body: { allDevices: true } });
    expect(all.status).toBe(204);
    expect((await call(v2, 'GET', '/api/v2/me', { token: u.token })).status).toBe(401);
  });

  it('serves 503 when JWT_SECRET is missing instead of using a default (PL-01#AC6)', async () => {
    delete process.env.JWT_SECRET;
    const r = await call(auth, 'POST', '/api/auth/login', { body: { email: 'a@b.c', password: 'x' } });
    expect(r.status).toBe(503);
  });
});

describe('password reset, change and policy (HS-01, HS-13, HS-14)', () => {
  it('never returns a code from reset or verify and answers the same for unknown emails (PL-12#AC2 SEC-01)', async () => {
    await createUser(db, { email: 'reset@x.test' });
    const known = await call(auth, 'POST', '/api/auth/reset/send-otp', { body: { email: 'reset@x.test' } });
    const unknown = await call(auth, 'POST', '/api/auth/reset/send-otp', { body: { email: 'ghost@x.test' } });
    expect(known.json).toEqual({ sent: true });
    expect(unknown.json).toEqual({ sent: true });
    expect(JSON.stringify(known.json)).not.toMatch(/otp/i);
    const v = await call(verify, 'POST', '/api/verify/send', { body: { email: 'reset@x.test' } });
    expect(v.status).toBe(200);
    expect(Object.keys(v.json)).toEqual(['sent']);
  });

  it('resets the password with the emailed code, enforces 10 chars and ends other sessions', async () => {
    const u = await createUser(db, { email: 'reset2@x.test' });
    await call(auth, 'POST', '/api/auth/reset/send-otp', { body: { email: 'reset2@x.test' } });
    const code = codeFrom('reset2@x.test');
    const short = await call(auth, 'POST', '/api/auth/reset/confirm', {
      body: { email: 'reset2@x.test', otp: code, newPassword: 'short' },
    });
    expect(short.status).toBe(400);
    expect(short.json.fields).toEqual({ newPassword: 'Use at least 10 characters.' });
    const ok = await call(auth, 'POST', '/api/auth/reset/confirm', {
      body: { email: 'reset2@x.test', otp: code, newPassword: 'a much longer password' },
    });
    expect(ok.json).toEqual({ success: true });
    expect((await call(v2, 'GET', '/api/v2/me', { token: u.token })).status).toBe(401);
    const login = await call(auth, 'POST', '/api/auth/login', {
      body: { email: 'reset2@x.test', password: 'a much longer password' },
    });
    expect(login.status).toBe(200);
  });

  it('a 2FA code cannot be used to reset a password', async () => {
    await createUser(db, { email: 'ctx@x.test', twoFactor: true });
    await call(auth, 'POST', '/api/auth/login', { body: { email: 'ctx@x.test', password: PASSWORD } });
    const code = codeFrom('ctx@x.test');
    const r = await call(auth, 'POST', '/api/auth/reset/confirm', {
      body: { email: 'ctx@x.test', otp: code, newPassword: 'a much longer password' },
    });
    expect(r.status).toBe(400);
  });

  it('requires the password to switch 2FA off (HS-14)', async () => {
    const u = await createUser(db, { twoFactor: true });
    const none = await call(auth, 'POST', '/api/auth/2fa', { token: u.token, body: { enabled: false } });
    expect(none.status).toBe(400);
    const wrong = await call(auth, 'POST', '/api/auth/2fa', {
      token: u.token,
      body: { enabled: false, password: 'nope' },
    });
    expect(wrong.status).toBe(401);
    const legacyToggle = await call(auth, 'POST', '/api/auth/2fa/toggle', { token: u.token });
    expect(legacyToggle.status).toBe(400);
    const ok = await call(auth, 'POST', '/api/auth/2fa', {
      token: u.token,
      body: { enabled: false, password: PASSWORD },
    });
    expect(ok.json).toEqual({ twoFactorEnabled: false });
    const ev = await db.query(`SELECT action FROM audit_events WHERE target_id = $1`, [u.id]);
    expect(ev.map((e) => e.action)).toContain('auth.2fa_change');
  });

  it('changes the password with the current one and keeps this session', async () => {
    const u = await createUser(db);
    const bad = await call(auth, 'POST', '/api/auth/password', {
      token: u.token,
      body: { currentPassword: 'wrong', newPassword: 'another long password' },
    });
    expect(bad.status).toBe(401);
    const ok = await call(auth, 'POST', '/api/auth/password', {
      token: u.token,
      body: { currentPassword: PASSWORD, newPassword: 'another long password' },
    });
    expect(ok.status).toBe(200);
    expect((await call(v2, 'GET', '/api/v2/me', { token: ok.json.token as string })).status).toBe(200);
    expect((await call(v2, 'GET', '/api/v2/me', { token: u.token })).status).toBe(401);
  });
});

describe('registration and verification (AC-07, HS-13)', () => {
  it('is closed in internal mode unless ALLOW_PUBLIC_SIGNUP=true (AC-07#AC4)', async () => {
    process.env.APP_MODE = 'internal';
    const r = await call(auth, 'POST', '/api/auth/register', {
      body: { email: 'n@x.test', password: 'long enough pw' },
    });
    expect(r.status).toBe(403);
    expect(r.json.error).toBe('Sign-up is by invitation only.');
    process.env.ALLOW_PUBLIC_SIGNUP = 'true';
    const ok = await call(auth, 'POST', '/api/auth/register', {
      body: { email: 'n@x.test', password: 'long enough pw' },
    });
    expect(ok.status).toBe(201);
  });

  it('answers identically for new and existing emails and emails the owner (HS-13#AC3)', async () => {
    await createUser(db, { email: 'taken@x.test' });
    const a = await call(auth, 'POST', '/api/auth/register', {
      body: { email: 'fresh@x.test', password: 'long enough pw' },
    });
    const b = await call(auth, 'POST', '/api/auth/register', {
      body: { email: 'taken@x.test', password: 'long enough pw' },
    });
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.json).toEqual({ emailVerificationRequired: true });
    expect(b.json).toEqual({ emailVerificationRequired: true });
    expect(sent.find((m) => m.to === 'taken@x.test')?.subject).toMatch(/Someone tried to register/);
    const short = await call(auth, 'POST', '/api/auth/register', { body: { email: 'z@x.test', password: 'short' } });
    expect(short.status).toBe(400);
    expect(short.json.fields).toEqual({ password: 'Use at least 10 characters.' });
  });

  it('a new user can sign in unverified, cannot create an org, verifies and then can (AC-07#AC3)', async () => {
    await call(auth, 'POST', '/api/auth/register', { body: { email: 'newbie@x.test', password: 'long enough pw' } });
    const login = await call(auth, 'POST', '/api/auth/login', {
      body: { email: 'newbie@x.test', password: 'long enough pw' },
    });
    expect(login.status).toBe(200);
    expect((login.json.user as { emailVerified: boolean }).emailVerified).toBe(false);
    const token = login.json.token as string;
    const blocked = await call(v2, 'POST', '/api/v2/orgs', { token, body: { name: 'Mine', workspaceName: 'PMO' } });
    expect(blocked.status).toBe(403);
    expect(blocked.json.error).toBe('Verify your email first');
    const code = codeFrom('newbie@x.test');
    const v = await call(verify, 'POST', '/api/verify/check', { body: { email: 'newbie@x.test', otp: code } });
    expect(v.json).toEqual({ verified: true });
    const created = await call(v2, 'POST', '/api/v2/orgs', { token, body: { name: 'Mine', workspaceName: 'PMO' } });
    expect(created.status).toBe(201);
  });

  it('never promotes SUPER_ADMIN_EMAIL (AC-07#AC1)', async () => {
    process.env.SUPER_ADMIN_EMAIL = 'boss@x.test';
    await call(auth, 'POST', '/api/auth/register', { body: { email: 'boss@x.test', password: 'long enough pw' } });
    const rows = await db.query(`SELECT role, is_platform_admin FROM users WHERE email = 'boss@x.test'`);
    expect(rows[0]).toEqual({ role: 'USER', is_platform_admin: false });
    delete process.env.SUPER_ADMIN_EMAIL;
  });
});

describe('legacy admin routes', () => {
  it('answer 410 for invite, user update and remove-member (SEC-02/03)', async () => {
    const admin = await createUser(db, { platformAdmin: true });
    for (const [m, p] of [
      ['POST', '/api/auth/users/invite'],
      ['PUT', `/api/auth/users/${admin.id}`],
      ['POST', '/api/auth/remove-member'],
      ['POST', '/api/auth/admin/users'],
    ]) {
      const r = await call(auth, m, p, { token: admin.token, body: { email: 'x@y.z', role: 'SUPERUSER' } });
      expect([p, r.status, r.json.code]).toEqual([p, 410, 'gone']);
    }
  });

  it('GET /users is tenant-scoped; stats are platform-only', async () => {
    const orgA = await createOrg(db, 'TA');
    const orgB = await createOrg(db, 'TB');
    const adminA = await createUser(db, { orgId: orgA, orgRole: 'ORG_ADMIN' });
    const memberA = await createUser(db, { orgId: orgA, orgRole: 'MEMBER' });
    const userB = await createUser(db, { orgId: orgB, orgRole: 'MEMBER' });
    const list = await call(auth, 'GET', '/api/auth/users', { token: adminA.token });
    const ids = (list.json.users as Array<{ id: string }>).map((u) => u.id);
    expect(ids).toEqual(expect.arrayContaining([adminA.id, memberA.id]));
    expect(ids).not.toContain(userB.id);
    expect((await call(auth, 'GET', '/api/auth/users', { token: memberA.token })).status).toBe(403);
    expect((await call(auth, 'GET', '/api/auth/admin/stats', { token: adminA.token })).status).toBe(403);
    const pa = await createUser(db, { platformAdmin: true });
    expect((await call(auth, 'GET', '/api/auth/admin/stats', { token: pa.token })).status).toBe(200);
  });
});

describe('GET /api/health (PL-13)', () => {
  it('reports schema and env presence as booleans only', async () => {
    const r = await call(health, 'GET', '/api/health');
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, schemaVersion: 7, requiredSchemaVersion: 7 });
    const env = r.json.env as Record<string, unknown>;
    expect(env.JWT_SECRET).toBe(true);
    expect(Object.values(env).every((v) => typeof v === 'boolean')).toBe(true);
    expect(r.body).not.toContain(JWT_SECRET);
    expect(r.headers['x-request-id']).toBeTruthy();
  });
});
