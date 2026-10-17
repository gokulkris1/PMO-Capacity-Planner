/**
 * QA-011: a deploy that nobody migrates by hand. The real client runtime (DataRuntime + HttpTransport) talks to the
 * real function handlers on PGlite. A new build ships three pending migrations that are each too slow to share one
 * function invocation, so the auto-migration applies one file per request: the first requests answer 503
 * `migration_pending`, the app shows its maintenance state and retries on its own, and it boots into the workspace
 * as soon as the API is ready, with no user action.
 */
import type { Handler, HandlerEvent, HandlerResponse } from '@netlify/functions';
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

beforeAll(async () => {
  db = await setupDb();
  const org = await createOrg(db, 'Deploy Org');
  wsId = await createWorkspace(db, org, 'Main');
  const user = await createUser(db, { orgId: org, orgRole: 'MEMBER' });
  email = user.email;
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
