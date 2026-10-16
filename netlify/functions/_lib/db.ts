/**
 * Database access (PL-01). One interface, three implementations:
 * - Neon (production): single statements over the HTTP driver; transactions and sessions over the WebSocket Pool.
 * - PGlite (tests, via `setDbForTests`), and `pg` (CLI scripts), both built on the same interface.
 *
 * Rule: inside `tx(fn)` use only the `q` passed to `fn` (never `getDb().query`), so every statement is part of
 * the transaction and the PGlite test adapter cannot deadlock.
 * SQL is portable Postgres (no Neon-only functions, PL-04#AC10).
 */
import { neon, neonConfig, Pool } from '@neondatabase/serverless';
import { databaseUrl } from './env';
import { serviceUnavailable } from './errors';
import { log } from './log';

export type Row = Record<string, unknown>;

export interface Queryable {
  query<T extends Row = Row>(text: string, params?: unknown[]): Promise<T[]>;
}
export interface Session extends Queryable {
  /** Runs a multi-statement script without parameters (migrations). */
  exec(text: string): Promise<void>;
}
export interface Db extends Queryable {
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  /** A dedicated connection (advisory locks, migrations). */
  session<T>(fn: (s: Session) => Promise<T>): Promise<T>;
}

// ── Neon implementation ─────────────────────────────────────────────────────

function ensureWebSocket(): void {
  if (neonConfig.webSocketConstructor) return;
  const ws = (globalThis as { WebSocket?: unknown }).WebSocket;
  if (!ws) {
    throw serviceUnavailable(
      'Service is not configured. Contact your administrator.',
      'WebSocket unavailable for the Neon Pool: run functions on Node 22 (NODE_VERSION=22)',
    );
  }
  neonConfig.webSocketConstructor = ws as never;
}

class NeonDb implements Db {
  private readonly http: ReturnType<typeof neon>;
  constructor(private readonly url: string) {
    this.http = neon(url);
  }

  async query<T extends Row = Row>(text: string, params: unknown[] = []): Promise<T[]> {
    return (await this.http.query(text, params)) as T[];
  }

  private async withClient<T>(
    fn: (c: { query: (t: string, p?: unknown[]) => Promise<{ rows: Row[] }> }) => Promise<T>,
  ) {
    ensureWebSocket();
    const pool = new Pool({ connectionString: this.url, max: 1 });
    pool.on('error', (err: Error) => log('warn', { event: 'db.pool_error', err: { message: err.message } }));
    const client = await pool.connect();
    try {
      return await fn(client as unknown as { query: (t: string, p?: unknown[]) => Promise<{ rows: Row[] }> });
    } finally {
      client.release();
      await pool.end().catch(() => undefined);
    }
  }

  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
    return this.withClient(async (client) => {
      const q: Queryable = {
        query: async <R extends Row = Row>(text: string, params: unknown[] = []) =>
          (await client.query(text, params)).rows as R[],
      };
      await client.query('BEGIN');
      try {
        const out = await fn(q);
        await client.query('COMMIT');
        return out;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw e;
      }
    });
  }

  session<T>(fn: (s: Session) => Promise<T>): Promise<T> {
    return this.withClient((client) =>
      fn({
        query: async <R extends Row = Row>(text: string, params: unknown[] = []) =>
          (await client.query(text, params)).rows as R[],
        exec: async (text: string) => {
          await client.query(text);
        },
      }),
    );
  }
}

// ── Resolution and test injection ───────────────────────────────────────────

let injected: Db | null = null;
const cache = new Map<string, Db>();

/** Tests and scripts inject their own implementation (PGlite or pg). Pass null to reset. */
export function setDb(db: Db | null): void {
  injected = db;
}

export function getDb(): Db {
  if (injected) return injected;
  const url = databaseUrl();
  if (!url) throw serviceUnavailable('Service is not configured. Contact your administrator.', 'DATABASE_URL missing');
  let db = cache.get(url);
  if (!db) {
    db = new NeonDb(url);
    cache.set(url, db);
  }
  return db;
}

export function withTx<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
  return getDb().tx(fn);
}

// ── Row helpers ─────────────────────────────────────────────────────────────

export async function one<T extends Row = Row>(q: Queryable, text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await q.query<T>(text, params);
  return rows[0] ?? null;
}

/** RFC 3339 UTC string from a Date or a timestamp string; null-safe. */
export function iso(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  const d =
    v instanceof Date ? v : new Date(String(v).includes('T') || String(v).includes('+') ? String(v) : `${String(v)}Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** 'YYYY-MM-DD' from a Date or string; null-safe. Prefer selecting `col::text` in SQL. */
export function isoDate(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

export function num(v: unknown, fallback = 0): number {
  if (v === null || v === undefined || v === '') return fallback;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function json<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
}
