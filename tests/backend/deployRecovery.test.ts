/**
 * QA-011: a deploy that nobody migrates by hand. The real client runtime (DataRuntime + HttpTransport) talks to the
 * real function handlers on PGlite. A new build ships three pending migrations that are each too slow to share one
 * function invocation, so the auto-migration applies one file per request: the first requests answer 503
 * `migration_pending`, the app shows its maintenance state and retries on its own, and it boots into the workspace
 * as soon as the API is ready, with no user action.
 */
import type { Handler, HandlerEvent, HandlerResponse } from '@netlify/functions';
import jwt from 'jsonwebtoken';
import { setDb, type Db } from '../../netlify/functions/_lib/db';
import { handler as auth } from '../../netlify/functions/auth';
import { handler as v2 } from '../../netlify/functions/v2';
import {
  MIGRATIONS,
  appliedMigrations,
  configureAutoMigration,
  parseMigrations,
  resetSchemaCheck,
} from '../../netlify/functions/_lib/migrate';
import { HttpTransport } from '../../services/api/httpTransport';
import { DataRuntime, type Timers } from '../../state/runtime';
import type { PgliteDb } from './helpers/pglite';
import {
  JWT_SECRET,
  PASSWORD,
  addMember,
  createOrg,
  createPerson,
  createUser,
  createWorkspace,
  setupDb,
  teardownDb,
} from './helpers/harness';

const HANDLERS: Record<string, Handler> = { auth, v2 };

/** fetch() for HttpTransport that dispatches to the Netlify handlers, with a cookie jar. */
function functionsFetch(jar: Map<string, string>, log: Array<{ path: string; status: number }>) {
  return async (input: string, init: RequestInit): Promise<Response> => {
    const url = new URL(input, 'http://app.test.example');
    const fn = /^\/api\/([^/]+)/.exec(url.pathname)?.[1] ?? '';
    const handler = HANDLERS[fn];
    if (!handler) return new Response('{"error":"Not found","code":"not_found"}', { status: 404 });
    const headers: Record<string, string> = { host: 'app.test.example', 'x-nf-client-connection-ip': '192.0.2.9' };
    new Headers(init.headers).forEach((v, k) => (headers[k] = v));
    if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ');
    const event = {
      httpMethod: init.method ?? 'GET',
      path: url.pathname,
      headers,
      queryStringParameters: Object.fromEntries(url.searchParams),
      body: typeof init.body === 'string' ? init.body : null,
      isBase64Encoded: false,
    } as unknown as HandlerEvent;
    const out = (await handler(event, {} as never)) as HandlerResponse;
    for (const c of (out.multiValueHeaders?.['Set-Cookie'] as string[] | undefined) ?? []) {
      const [pair] = String(c).split(';');
      const i = pair.indexOf('=');
      const value = decodeURIComponent(pair.slice(i + 1));
      if (value) jar.set(pair.slice(0, i), value);
      else jar.delete(pair.slice(0, i));
    }
    log.push({ path: url.pathname, status: out.statusCode });
    const resHeaders = new Headers();
    for (const [k, v] of Object.entries(out.headers ?? {})) resHeaders.set(k, String(v));
    return new Response(out.statusCode === 204 ? null : (out.body ?? ''), {
      status: out.statusCode,
      headers: resHeaders,
    });
  };
}

/** Timers the test runs by hand, so "3 s later" happens instantly and every retry is visible. */
function manualTimers() {
  const queue: Array<{ fn: () => void; ms: number }> = [];
  const timers: Timers = {
    set: (fn, ms) => {
      const t = { fn, ms };
      queue.push(t);
      return t;
    },
    clear: (h) => {
      const i = queue.indexOf(h as (typeof queue)[number]);
      if (i >= 0) queue.splice(i, 1);
    },
  };
  return { timers, queue };
}

const settle = async () => {
  for (let i = 0; i < 50; i++) await new Promise((r) => setTimeout(r, 0));
};

let db: PgliteDb;
let wsId: string;
let email: string;
let userId: string;

beforeAll(async () => {
  db = await setupDb();
  const org = await createOrg(db, 'Deploy Org');
  wsId = await createWorkspace(db, org, 'Main');
  const user = await createUser(db, { orgId: org, orgRole: 'MEMBER' });
  email = user.email;
  userId = user.id;
  await addMember(db, user.id, wsId, 'PLANNER');
  await createPerson(db, wsId, { name: 'Noma Odigie' });
});
afterAll(async () => {
  configureAutoMigration(null);
  await teardownDb(db);
});

describe('QA-011 deploy with pending migrations and nobody running db:migrate', () => {
  it('the first requests answer migration_pending, the app retries on its own and boots when the API is ready', async () => {
    // The user signed in before the deploy.
    const jar = new Map<string, string>();
    const log: Array<{ path: string; status: number }> = [];
    const fetchImpl = functionsFetch(jar, log);
    const login = await fetchImpl('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    expect(login.status).toBe(200);

    // The deploy: a build with three more migration files, each slower than one invocation's budget.
    const extra = parseMigrations([
      ...MIGRATIONS.map((m) => ({ file: `${String(m.version).padStart(4, '0')}_${m.name}.sql`, sql: m.sql })),
      { file: '0101_deploy_a.sql', sql: 'CREATE TABLE IF NOT EXISTS qa011_deploy_a (id int);' },
      { file: '0102_deploy_b.sql', sql: 'CREATE TABLE IF NOT EXISTS qa011_deploy_b (id int);' },
      { file: '0103_deploy_c.sql', sql: 'CREATE TABLE IF NOT EXISTS qa011_deploy_c (id int);' },
    ]);
    let t = 0;
    configureAutoMigration({ migrations: extra, now: () => (t += 5000) });
    resetSchemaCheck(); // a freshly deployed function instance
    log.length = 0;

    const { timers, queue } = manualTimers();
    const rt = new DataRuntime({
      transport: new HttpTransport({ fetchImpl, getCookies: () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }),
      timers,
    });
    await rt.start();
    await settle();

    // Maintenance state, not an endless "Loading your workspace".
    expect(rt.getState()).toMatchObject({ status: 'loading', dataStatus: 'error' });
    expect(rt.getState().dataError).toMatchObject({ status: 503, code: 'migration_pending' });
    expect(rt.getState().maintenance).toMatchObject({ attempts: 0 });
    expect(queue).toHaveLength(1);
    expect(queue[0].ms).toBe(3000);

    // Nobody clicks anything: run the scheduled retries until the runtime stops scheduling them.
    let retries = 0;
    while (queue.length && retries < 10) {
      queue.shift()!.fn();
      retries++;
      await settle();
    }

    expect(rt.getState()).toMatchObject({ status: 'authenticated', dataStatus: 'ready', maintenance: null });
    expect(rt.getState().snapshot?.people.map((p) => p.name)).toEqual(['Noma Odigie']);
    expect(retries).toBe(2);
    expect(log.filter((r) => r.status === 503).map((r) => r.path)).toEqual(['/api/v2/me', '/api/v2/me']);
    expect(log.slice(-2).map((r) => `${r.path} ${r.status}`)).toEqual([
      '/api/v2/me 200',
      `/api/v2/workspaces/${wsId}/snapshot 200`,
    ]);
    expect([...(await appliedMigrations(db)).keys()].slice(-3)).toEqual([101, 102, 103]);
    expect(Number((await db.query(`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory'`))[0].n)).toBe(
      0,
    );
  });

  it('a snapshot that answers migration_pending after /me is retried the same way', async () => {
    const jar = new Map<string, string>();
    const log: Array<{ path: string; status: number }> = [];
    const real = functionsFetch(jar, log);
    await real('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    let blocked = 2;
    const fetchImpl = async (input: string, init: RequestInit) => {
      if (input.endsWith('/snapshot') && blocked-- > 0)
        return new Response(JSON.stringify({ error: 'Updating', code: 'migration_pending' }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        });
      return real(input, init);
    };
    const { timers, queue } = manualTimers();
    const rt = new DataRuntime({
      transport: new HttpTransport({ fetchImpl, getCookies: () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }),
      timers,
    });
    await rt.start();
    await settle();
    expect(rt.getState()).toMatchObject({ status: 'authenticated', dataStatus: 'error' });
    expect(rt.getState().maintenance).not.toBeNull();
    while (queue.length) {
      queue.shift()!.fn();
      await settle();
    }
    expect(rt.getState()).toMatchObject({ dataStatus: 'ready', maintenance: null });
  });
});

/**
 * QA-039: go-live day. Every browser holds a v1.1 token (`localStorage.pcp_token`), and the first requests find the
 * migration advisory lock held by another invocation that is still migrating. The token exchange and a sign-in
 * typed during that time must wait in the "being updated" state and finish on their own once the lock is free.
 */
/** Waits (real time) until `cond` holds: a held lock makes each request wait a little in acquireLock. */
async function until(cond: () => boolean, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('QA-039 v1.1 token holders and sign-ins while another invocation holds the migration lock', () => {
  /** The real database, except that the migration advisory lock is "held elsewhere" while `held` is true. */
  function lockHeldDb(real: PgliteDb, state: { held: boolean; attempts: number }): Db {
    return {
      query: (text, params) => real.query(text, params),
      tx: (fn) => real.tx(fn),
      session: (fn) =>
        real.session((s) =>
          fn({
            ...s,
            query: async (text: string, params?: unknown[]) => {
              if (text.includes('pg_try_advisory_lock')) {
                state.attempts++;
                if (state.held) return [{ ok: false }] as never;
              }
              return s.query(text, params);
            },
          }),
        ),
    } as Db;
  }
  const deploy = () =>
    parseMigrations([
      ...MIGRATIONS.map((m) => ({ file: `${String(m.version).padStart(4, '0')}_${m.name}.sql`, sql: m.sql })),
      { file: '0201_go_live.sql', sql: 'CREATE TABLE IF NOT EXISTS qa039_go_live (id int);' },
    ]);

  afterEach(() => {
    setDb(db);
    configureAutoMigration(null);
    resetSchemaCheck();
  });

  it('the v1.1 token is kept, the app waits in maintenance and signs in by itself when the lock is free', async () => {
    const lock = { held: true, attempts: 0 };
    setDb(lockHeldDb(db, lock));
    configureAutoMigration({ migrations: deploy(), lockWaitMs: 10 });
    resetSchemaCheck();
    const jar = new Map<string, string>();
    const log: Array<{ path: string; status: number }> = [];
    const fetchImpl = functionsFetch(jar, log);
    // Exactly what v1.1 signed at sign-in and kept in localStorage.
    const legacy = jwt.sign({ id: userId, email, role: 'USER' }, JWT_SECRET, { expiresIn: '7d' });
    const data = new Map([
      ['pcp_token', legacy],
      ['pcp_user', '{}'],
    ]);
    const storage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    };
    const { timers, queue } = manualTimers();
    const rt = new DataRuntime({
      transport: new HttpTransport({ fetchImpl, getCookies: () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }),
      storage,
      timers,
    });
    await rt.start();
    // Two automatic retries while the lock is still held: never the sign-in page, token kept.
    for (let i = 0; i < 3; i++) {
      await until(() => queue.length === 1);
      expect(rt.getState()).toMatchObject({ status: 'loading', dataStatus: 'error' });
      expect(rt.getState().dataError).toMatchObject({ status: 503, code: 'migration_pending' });
      expect(rt.getState().maintenance).not.toBeNull();
      expect(data.get('pcp_token')).toBe(legacy);
      expect(queue).toHaveLength(1);
      if (i < 2) queue.shift()!.fn();
    }
    expect(log.map((r) => `${r.path} ${r.status}`)).toEqual(Array(3).fill('/api/auth/session 503'));
    // The other invocation finishes; the next automatic retry migrates, exchanges the token and boots.
    lock.held = false;
    queue.shift()!.fn();
    await until(() => rt.getState().dataStatus === 'ready');
    expect(rt.getState()).toMatchObject({ status: 'authenticated', dataStatus: 'ready', maintenance: null });
    expect(rt.getState().notice).toBeNull();
    expect(rt.getState().snapshot?.people.map((p) => p.name)).toEqual(['Noma Odigie']);
    expect(data.has('pcp_token')).toBe(false);
    expect(jar.get('pcp_session')).toBeTruthy();
    expect([...(await appliedMigrations(db)).keys()].pop()).toBe(201);
    expect(queue).toHaveLength(0);
  });

  it('a sign-in typed during the migration says it is being updated, retries and signs in', async () => {
    const lock = { held: true, attempts: 0 };
    setDb(lockHeldDb(db, lock));
    configureAutoMigration({
      migrations: parseMigrations([
        ...deploy().map((m) => ({ file: `${String(m.version).padStart(4, '0')}_${m.name}.sql`, sql: m.sql })),
        { file: '0202_go_live_b.sql', sql: 'CREATE TABLE IF NOT EXISTS qa039_go_live_b (id int);' },
      ]),
      lockWaitMs: 10,
    });
    resetSchemaCheck();
    const jar = new Map<string, string>();
    const log: Array<{ path: string; status: number }> = [];
    const { timers, queue } = manualTimers();
    const rt = new DataRuntime({
      transport: new HttpTransport({
        fetchImpl: functionsFetch(jar, log),
        getCookies: () => [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
      }),
      timers,
    });
    await rt.start();
    expect(rt.getState().status).toBe('anonymous'); // no token, no cookie: the sign-in form
    const waits: number[] = [];
    const signedIn = rt.login(email, PASSWORD, undefined, { onWaiting: (w) => waits.push(w.retryInMs) });
    await until(() => queue.length === 1);
    queue.shift()!.fn(); // still held
    await until(() => queue.length === 1);
    lock.held = false;
    queue.shift()!.fn();
    await expect(signedIn).resolves.toEqual({ require2FA: false });
    await until(() => rt.getState().dataStatus === 'ready');
    expect(waits).toEqual([2000, 3000]);
    expect(log.filter((r) => r.path === '/api/auth/login').map((r) => r.status)).toEqual([503, 503, 200]);
    expect(rt.getState()).toMatchObject({ status: 'authenticated', dataStatus: 'ready' });
    expect([...(await appliedMigrations(db)).keys()].pop()).toBe(202);
  });
});
