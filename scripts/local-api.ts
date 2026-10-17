/* eslint-disable security/detect-non-literal-fs-filename -- dev-only script, paths are fixed inside the repository */
/**
 * Local API host for development and the "live" end-to-end run (package I). DEV ONLY: never deployed.
 *
 *   npm run dev:api                 # http://localhost:8888/api/* on an in-memory PGlite database
 *   LOCAL_API_DB=v11 npm run dev:api  # same, but the database starts as the v1.1 production schema + data
 *                                      (tests/backend/helpers/v11Production.ts) and is upgraded by the first request
 *   DATABASE_URL=postgres://… npm run dev:api   # against a real PostgreSQL instead
 *
 * It serves the Netlify function handlers under /api/<function>/… exactly as netlify.toml's redirect does
 * (`/api/* → /.netlify/functions/:splat`), with the event shape Netlify passes (original path, headers, query,
 * body, Set-Cookie as multiValueHeaders). `npm run dev:vite` proxies /api to it (vite.config.ts).
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import type { Handler, HandlerEvent, HandlerResponse } from '@netlify/functions';
import { setDb, type Db, type Queryable, type Row, type Session } from '../netlify/functions/_lib/db';

const PORT = Number(process.env.LOCAL_API_PORT || 8888);
const ROOT = join(import.meta.dirname, '..');

process.env.JWT_SECRET ??= 'local-dev-jwt-secret-not-for-production';
process.env.CONTEXT ??= 'dev';
process.env.LOG_LEVEL ??= 'warn';
process.env.URL ??= 'http://localhost:3000';

/** PGlite as the functions' Db (one in-process Postgres; statements are serialised). */
class PgliteDb implements Db {
  constructor(readonly pg: PGlite) {}
  async query<T extends Row = Row>(text: string, params: unknown[] = []): Promise<T[]> {
    return (await this.pg.query<T>(text, params as never[])).rows;
  }
  async tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
    return this.pg.transaction(async (t) =>
      fn({
        query: async <R extends Row = Row>(text: string, params: unknown[] = []) =>
          (await t.query<R>(text, params as never[])).rows,
      }),
    );
  }
  async session<T>(fn: (s: Session) => Promise<T>): Promise<T> {
    return fn({
      query: (text, params) => this.query(text, params),
      exec: async (text: string) => {
        await this.pg.exec(text);
      },
    });
  }
}

async function database(): Promise<void> {
  if (process.env.DATABASE_URL) {
    const { PgDb } = await import('../tests/backend/helpers/pgServer');
    console.log(`local-api: using DATABASE_URL (${new URL(process.env.DATABASE_URL).host})`);
    setDb(new PgDb(process.env.DATABASE_URL));
    return;
  }
  const db = new PgliteDb(new PGlite());
  if (process.env.LOCAL_API_DB === 'v11') {
    const { buildV11Production, usersFor } = await import('../tests/backend/helpers/v11Production');
    await db.session((s) => buildV11Production(s, 'replayed'));
    console.log('local-api: v1.1 production-shaped database; sign in as any of:');
    for (const u of usersFor('replayed'))
      console.log(`  ${u.loginEmail}  /  ${u.password}${u.twoFactor ? '  (2FA)' : ''}`);
  }
  setDb(db);
}

const handlers = new Map<string, Promise<Handler | null>>();
function handlerFor(fn: string): Promise<Handler | null> {
  if (!/^[a-z0-9_-]+$/.test(fn)) return Promise.resolve(null);
  let h = handlers.get(fn);
  if (!h) {
    const file = join(ROOT, 'netlify', 'functions', `${fn}.ts`);
    h = existsSync(file) ? import(file).then((m: { handler?: Handler }) => m.handler ?? null) : Promise.resolve(null);
    handlers.set(fn, h);
  }
  return h;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function serve(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const m = /^\/(?:api|\.netlify\/functions)\/([^/]+)/.exec(url.pathname);
  const handler = m ? await handlerFor(m[1]) : null;
  if (!handler) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found', code: 'not_found' }));
    return;
  }
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers[k] = v;
  headers['x-nf-client-connection-ip'] ??= req.socket.remoteAddress ?? '127.0.0.1';
  const body = await readBody(req);
  const event = {
    httpMethod: req.method ?? 'GET',
    path: url.pathname,
    rawUrl: url.toString(),
    headers,
    queryStringParameters: Object.fromEntries(url.searchParams),
    body: body || null,
    isBase64Encoded: false,
  } as unknown as HandlerEvent;
  const out = (await handler(event, {} as never)) as HandlerResponse;
  const resHeaders: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(out.headers ?? {})) resHeaders[k] = String(v);
  const cookies = out.multiValueHeaders?.['Set-Cookie'];
  if (cookies) resHeaders['Set-Cookie'] = cookies.map(String);
  res.writeHead(out.statusCode, resHeaders);
  res.end(out.body ?? '');
}

await database();
createServer((req, res) => {
  serve(req, res).catch((e: unknown) => {
    console.error('local-api: handler crashed', e);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Something went wrong', code: 'server_error' }));
  });
}).listen(PORT, () => console.log(`local-api: http://localhost:${PORT}/api/*`));
