#!/usr/bin/env node
/**
 * HS-16#AC1 / CA-8: grant (or with --revoke, remove) platform admin for an existing account.
 *   DATABASE_URL=… node scripts/grant_platform_admin.mjs --email someone@company.com [--revoke]
 * Sets users.is_platform_admin, bumps token_version (existing sessions re-read the new rights) and writes an
 * audit_events row (actor_type 'system', action platform.admin_grant / platform.admin_revoke) in one transaction.
 * Replaces seed_super_admin.ts and SUPER_ADMIN_EMAIL auto-promotion.
 */
import 'dotenv/config';
import pg from 'pg';

const argv = process.argv.slice(2);
const emailArg = argv.includes('--email') ? argv[argv.indexOf('--email') + 1] : '';
const revoke = argv.includes('--revoke');
const email = String(emailArg || '')
  .trim()
  .toLowerCase();
if (!/^[^@\s]+@[^@\s]+$/.test(email)) {
  console.error('Usage: node scripts/grant_platform_admin.mjs --email someone@company.com [--revoke]');
  process.exit(1);
}
const url =
  process.env.DATABASE_URL ||
  process.env.NETLIFY_DATABASE_URL_UNPOOLED ||
  process.env.NETLIFY_DATABASE_URL ||
  process.env.NEON_DATABASE_URL;
if (!url) {
  console.error('Set DATABASE_URL.');
  process.exit(1);
}

const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
const client = new pg.Client({ connectionString: url, ssl: local ? undefined : { rejectUnauthorized: true } });
await client.connect();
let code = 0;
try {
  await client.query('BEGIN');
  const { rows } = await client.query(
    `UPDATE users SET is_platform_admin = $2, token_version = token_version + 1 WHERE lower(email) = $1
     RETURNING id, org_id`,
    [email, !revoke],
  );
  if (!rows.length) {
    await client.query('ROLLBACK');
    console.error(`No account with email ${email}. Ask the person to register or accept an invitation first.`);
    code = 1;
  } else {
    await client.query(
      `INSERT INTO audit_events (actor_type, action, target_type, target_id, after)
       VALUES ('system', $1, 'user', $2, $3::jsonb)`,
      [
        revoke ? 'platform.admin_revoke' : 'platform.admin_grant',
        rows[0].id,
        JSON.stringify({ isPlatformAdmin: !revoke, via: 'scripts/grant_platform_admin.mjs' }),
      ],
    );
    await client.query('COMMIT');
    console.log(`${revoke ? 'Revoked' : 'Granted'} platform admin for ${email}.`);
  }
} catch (e) {
  await client.query('ROLLBACK').catch(() => undefined);
  console.error('Failed:', e instanceof Error ? e.message : e);
  code = 1;
} finally {
  await client.end();
}
process.exit(code);
