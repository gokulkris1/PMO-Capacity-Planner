/**
 * PGlite-backed implementation of `Db` (netlify/functions/_lib/db.ts) so handlers run against a real Postgres
 * in Jest. Only works under `npm test` (needs --experimental-vm-modules).
 */
import { PGlite } from '@electric-sql/pglite';
import type { Db, Queryable, Row, Session } from '../../../netlify/functions/_lib/db';

export class PgliteDb implements Db {
  readonly pg: PGlite;
  /** Every statement text, for "≤ N queries" assertions. */
  readonly statements: string[] = [];
  /** When set, the next statement matching it throws (rollback tests). */
  failOn: RegExp | null = null;
  constructor() {
    this.pg = new PGlite();
  }

  private record(text: string): void {
    this.statements.push(text);
    if (this.failOn?.test(text)) throw new Error(`injected failure: ${text.slice(0, 40)}`);
  }

  async query<T extends Row = Row>(text: string, params: unknown[] = []): Promise<T[]> {
    this.record(text);
    const r = await this.pg.query<T>(text, params as never[]);
    return r.rows;
  }

  async tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
    return this.pg.transaction(async (t) => {
      const q: Queryable = {
        query: async <R extends Row = Row>(text: string, params: unknown[] = []) => {
          this.record(text);
          return (await t.query<R>(text, params as never[])).rows;
        },
      };
      return fn(q);
    });
  }

  async session<T>(fn: (s: Session) => Promise<T>): Promise<T> {
    return fn({
      query: (text, params) => this.query(text, params),
      exec: async (text: string) => {
        this.statements.push(text);
        await this.pg.exec(text);
      },
    });
  }

  async close(): Promise<void> {
    await this.pg.close();
  }
}
