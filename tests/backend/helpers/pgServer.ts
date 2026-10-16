/**
 * A real PostgreSQL server for tests that PGlite cannot model (several connections, advisory locks held by other
 * sessions, concurrent cold starts). Uses `UPGRADE_TEST_PG_URL` when set, otherwise starts a throw-away cluster
 * with the local `initdb`/`pg_ctl` (Debian/Ubuntu layout or PATH). Returns null when neither is available, so the
 * tests that need it are skipped rather than failing on machines without PostgreSQL.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- test-only paths (temp dir, PostgreSQL install dirs) */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, chownSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import type { Db, Queryable, Row, Session } from '../../../netlify/functions/_lib/db';

export interface PgServer {
  /** Connection string for a database on the server. */
  url(db?: string): string;
  createDatabase(name: string): Promise<string>;
  stop(): Promise<void>;
}

function findBin(name: string): string | null {
  const base = '/usr/lib/postgresql';
  if (existsSync(base)) {
    const versions = readdirSync(base).sort((a, b) => Number(b) - Number(a));
    for (const v of versions) {
      const p = join(base, v, 'bin', name);
      if (existsSync(p)) return p;
    }
  }
  try {
    return execFileSync('which', [name], { encoding: 'utf8' }).trim() || null;
  } catch {
    return null;
  }
}

async function adminQuery(url: string, text: string): Promise<void> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query(text);
  } finally {
    await c.end();
  }
}

export async function startPostgres(): Promise<PgServer | null> {
  const external = process.env.UPGRADE_TEST_PG_URL;
  if (external) {
    const u = new URL(external);
    const at = (db: string) => {
      const x = new URL(external);
      x.pathname = `/${db}`;
      return x.toString();
    };
    return {
      url: (db = u.pathname.slice(1) || 'postgres') => at(db),
      async createDatabase(name) {
        await adminQuery(external, `DROP DATABASE IF EXISTS ${name}`);
        await adminQuery(external, `CREATE DATABASE ${name}`);
        return at(name);
      },
      async stop() {},
    };
  }
  const initdb = findBin('initdb');
  const pgCtl = findBin('pg_ctl');
  if (!initdb || !pgCtl) return null;
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  const run = (bin: string, args: string[]) =>
    isRoot
      ? execFileSync('runuser', ['-u', 'postgres', '--', bin, ...args], { stdio: 'pipe' })
      : execFileSync(bin, args, { stdio: 'pipe' });
  const dir = mkdtempSync(join(tmpdir(), 'pcp-pg-'));
  const port = 56000 + Math.floor(Math.random() * 3000);
  try {
    if (isRoot) {
      const pwd = execFileSync('id', ['-u', 'postgres'], { encoding: 'utf8' }).trim();
      const gid = execFileSync('id', ['-g', 'postgres'], { encoding: 'utf8' }).trim();
      chownSync(dir, Number(pwd), Number(gid));
    }
    run(initdb, ['-D', join(dir, 'data'), '-A', 'trust', '-U', 'postgres', '--no-sync']);
    run(pgCtl, [
      '-D',
      join(dir, 'data'),
      '-o',
      `-p ${port} -k ${dir} -c listen_addresses=127.0.0.1 -c fsync=off -c max_connections=50`,
      '-l',
      join(dir, 'log'),
      '-w',
      'start',
    ]);
  } catch {
    rmSync(dir, { recursive: true, force: true });
    return null;
  }
  const at = (db: string) => `postgres://postgres@127.0.0.1:${port}/${db}`;
  return {
    url: (db = 'postgres') => at(db),
    async createDatabase(name) {
      await adminQuery(at('postgres'), `DROP DATABASE IF EXISTS ${name}`);
      await adminQuery(at('postgres'), `CREATE DATABASE ${name}`);
      return at(name);
    },
    async stop() {
      try {
        run(pgCtl, ['-D', join(dir, 'data'), '-m', 'immediate', 'stop']);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}

/** `Db` over node-postgres: one pool per instance, like one Netlify function instance per Neon connection. */
export class PgDb implements Db {
  readonly pool: pg.Pool;
  constructor(url: string) {
    this.pool = new pg.Pool({ connectionString: url, max: 4 });
    // Idle clients error when the throw-away server stops; that is not a test failure.
    this.pool.on('error', () => undefined);
  }

  async query<T extends Row = Row>(text: string, params: unknown[] = []): Promise<T[]> {
    return (await this.pool.query(text, params)).rows as T[];
  }

  async tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const out = await fn({
        query: async <R extends Row = Row>(text: string, params: unknown[] = []) =>
          (await c.query(text, params)).rows as R[],
      });
      await c.query('COMMIT');
      return out;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }

  async session<T>(fn: (s: Session) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      return await fn({
        query: async <R extends Row = Row>(text: string, params: unknown[] = []) =>
          (await c.query(text, params)).rows as R[],
        exec: async (text: string) => {
          await c.query(text);
        },
      });
    } finally {
      c.release();
    }
  }

  close(): Promise<void> {
    return this.pool.end();
  }
}
