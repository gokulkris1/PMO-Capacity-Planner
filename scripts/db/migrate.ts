/**
 * npm run db:migrate [-- --dry-run]
 *
 * Applies pending migrations with the same runner the functions use at cold start (advisory lock,
 * schema_migrations), so nobody has to run SQL by hand. Normally unnecessary: the first request after a deploy
 * applies them. `--dry-run` applies everything inside one transaction, prints row counts before/after and the
 * per-org role summary, then rolls back (PL-02#AC1, AC-01#AC1).
 *
 * Exit codes: 0 ok; 1 a migration failed, the lock could not be taken, or an applied migration file was edited.
 * Connection: DATABASE_URL, NETLIFY_DATABASE_URL_UNPOOLED, NETLIFY_DATABASE_URL or NEON_DATABASE_URL (first set).
 */
import 'dotenv/config';
import pg from 'pg';
import type { Row, Session } from '../../netlify/functions/_lib/db';
import { databaseUrl } from '../../netlify/functions/_lib/env';
import {
  appliedMigrations,
  applyPending,
  dryRun,
  MIGRATIONS,
  modifiedMigrations,
  REQUIRED_SCHEMA_VERSION,
} from '../../netlify/functions/_lib/migrate';

export function pgSession(client: pg.Client): Session {
  return {
    query: async <T extends Row = Row>(text: string, params: unknown[] = []) =>
      (await client.query(text, params)).rows as T[],
    exec: async (text: string) => {
      await client.query(text);
    },
  };
}

export function connect(): pg.Client {
  const url = databaseUrl();
  if (!url) {
    console.error('Set DATABASE_URL (or NETLIFY_DATABASE_URL / NEON_DATABASE_URL).');
    process.exit(1);
  }
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  return new pg.Client({ connectionString: url, ssl: local ? undefined : { rejectUnauthorized: true } });
}

async function main(): Promise<number> {
  const dry = process.argv.includes('--dry-run');
  const client = connect();
  await client.connect();
  const s = pgSession(client);
  try {
    await s.exec(
      `CREATE TABLE IF NOT EXISTS schema_migrations (version INT PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
    );
    const modified = modifiedMigrations(await appliedMigrations(s)).map((m) => m.version);
    if (modified.length) {
      for (const v of modified) console.error(`Migration ${v} was modified after being applied`);
      console.error('Restore the original file and add a new migration instead.');
      return 1;
    }
    if (dry) {
      const report = await dryRun(s);
      console.log(JSON.stringify(report, null, 2));
      console.log('Dry run complete; nothing was changed.');
      return 0;
    }
    const result = await applyPending(s, { lockWaitMs: 60_000 });
    if (!result.lockAcquired) {
      console.error('Another process holds the migration lock. Try again in a minute.');
      return 1;
    }
    console.log(
      result.applied.length
        ? `Applied ${result.applied.join(', ')}; schema is at ${REQUIRED_SCHEMA_VERSION}.`
        : `0 pending; schema is at ${REQUIRED_SCHEMA_VERSION} (${MIGRATIONS.length} migrations).`,
    );
    return 0;
  } catch (e) {
    console.error('Migration failed:', e instanceof Error ? e.message : e);
    return 1;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && /migrate\.ts$/.test(process.argv[1])) {
  main().then((code) => process.exit(code));
}
