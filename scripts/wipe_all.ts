/**
 * Wipes every tenant, user and capacity row. Development databases only (HS-16#AC2):
 *   ALLOW_DESTRUCTIVE=yes PROD_DB_HOST=<prod host> DATABASE_URL=<dev url> npx tsx scripts/wipe_all.ts
 * Exits 1 before connecting without ALLOW_DESTRUCTIVE=yes, without PROD_DB_HOST, or when the URL is production.
 */
import 'dotenv/config';
import pg from 'pg';
import { assertDestructiveAllowed } from './lib/destructiveGuard';

const url = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || '';
assertDestructiveAllowed(url);

async function wipeDatabase(): Promise<void> {
  const client = new pg.Client({
    connectionString: url,
    ssl: url.includes('localhost') ? undefined : { rejectUnauthorized: true },
  });
  await client.connect();
  try {
    await client.query(
      'TRUNCATE TABLE allocations, projects, resources, workspaces, users, organizations, audit_events RESTART IDENTITY CASCADE',
    );
    console.log('Wiped all tenant, user and capacity data.');
  } finally {
    await client.end();
  }
}

wipeDatabase().catch((err: unknown) => {
  console.error('Failed to wipe the database:', err instanceof Error ? err.message : err);
  process.exit(1);
});
