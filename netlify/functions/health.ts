/**
 * GET /api/health (PL-13, PL-02#AC6): no auth, booleans only, never secret values.
 * 200 when the database answers and the schema is current (it applies pending migrations like any function);
 * 503 otherwise.
 */
import { reply, withApi } from './_lib/api';
import { envPresence, optionalEnv } from './_lib/env';
import { REQUIRED_SCHEMA_VERSION, currentSchemaVersion, ensureSchema } from './_lib/migrate';
import { errorFields, log } from './_lib/log';

export const handler = withApi(
  { fn: 'health', auth: 'none', schemaCheck: false, requireJwtSecret: false },
  async (ctx) => {
    const env = envPresence();
    const base = {
      version: optionalEnv('APP_VERSION') || optionalEnv('COMMIT_REF') || 'dev',
      requiredSchemaVersion: REQUIRED_SCHEMA_VERSION,
      env,
      websocket: typeof (globalThis as { WebSocket?: unknown }).WebSocket === 'function',
    };
    let schemaVersion: number | null = null;
    try {
      await ensureSchema(ctx.db).catch(() => undefined);
      schemaVersion = await currentSchemaVersion(ctx.db);
    } catch (e) {
      log('error', { event: 'health.db_unreachable', err: errorFields(e) });
      return reply(503, { ok: false, schemaVersion, ...base });
    }
    const ok = schemaVersion >= REQUIRED_SCHEMA_VERSION && env.JWT_SECRET;
    return reply(ok ? 200 : 503, { ok, schemaVersion, ...base });
  },
);
