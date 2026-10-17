/**
 * HS-09: re-encrypt stored integration secrets with INTEGRATIONS_ENC_KEY (v2 format). Legacy rows were encrypted
 * with a key derived from JWT_SECRET; they keep working (read path), this only removes that coupling.
 *   DATABASE_URL=… JWT_SECRET=… INTEGRATIONS_ENC_KEY=… npx tsx scripts/reencrypt_integrations.ts [--dry-run]
 * Prints counts only, never secrets. Each row is updated individually and audited (integration.secret_update).
 */
import 'dotenv/config';
import { decryptSecret, encryptSecret } from '../netlify/functions/_lib/crypto';
import { connect, pgSession } from './db/migrate';

async function main(): Promise<number> {
  const dry = process.argv.includes('--dry-run');
  if (!process.env.INTEGRATIONS_ENC_KEY) {
    console.error('Set INTEGRATIONS_ENC_KEY (32 bytes, base64).');
    return 1;
  }
  const client = connect();
  await client.connect();
  const q = pgSession(client);
  let migrated = 0;
  let failed = 0;
  try {
    const rows = await q.query<{ workspace_id: string; provider: string; secret_enc: string }>(
      `SELECT workspace_id, provider, secret_enc FROM workspace_integrations
       WHERE secret_enc IS NOT NULL AND secret_enc NOT LIKE 'v2:%'`,
    );
    for (const r of rows) {
      let plain: string;
      try {
        plain = decryptSecret(r.secret_enc);
      } catch {
        failed++;
        console.error(`Cannot decrypt ${r.provider} secret of workspace ${r.workspace_id}; re-enter it in Settings.`);
        continue;
      }
      migrated++;
      if (dry) continue;
      await q.exec('BEGIN');
      await q.query(`UPDATE workspace_integrations SET secret_enc = $3 WHERE workspace_id = $1 AND provider = $2`, [
        r.workspace_id,
        r.provider,
        encryptSecret(plain),
      ]);
      await q.query(
        `INSERT INTO audit_events (workspace_id, actor_type, action, target_type, target_id, after)
         VALUES ($1, 'system', 'integration.secret_update', 'integration', $2, '{"reencrypted":true}'::jsonb)`,
        [r.workspace_id, r.provider],
      );
      await q.exec('COMMIT');
    }
    console.log(
      `${dry ? 'Would re-encrypt' : 'Re-encrypted'} ${migrated} secret(s); ${failed} could not be decrypted.`,
    );
    return failed ? 1 : 0;
  } catch (e) {
    await q.exec('ROLLBACK').catch(() => undefined);
    console.error('Failed:', e instanceof Error ? e.message : e);
    return 1;
  } finally {
    await client.end();
  }
}

main().then((code) => process.exit(code));
