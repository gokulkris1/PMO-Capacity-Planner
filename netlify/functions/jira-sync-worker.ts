/**
 * Scheduled every 10 minutes (netlify.toml): advance queued/running Jira sync jobs, ≤ 7 s per invocation
 * (JI-01#AC2-3). A job left by a closed browser tab is finished here.
 */
import type { Handler } from '@netlify/functions';
import { getDb } from './_lib/db';
import { ensureSchema } from './_lib/migrate';
import { runWorker } from './_lib/jira/sync';
import { errorFields, log } from './_lib/log';

export const handler: Handler = async () => {
  try {
    const db = getDb();
    await ensureSchema(db);
    const stepped = await runWorker(db, 7000);
    log('info', { event: 'jira.worker', fn: 'jira-sync-worker', stepped });
    return { statusCode: 200, body: JSON.stringify({ stepped }) };
  } catch (e) {
    log('error', { event: 'jira.worker_failed', fn: 'jira-sync-worker', err: errorFields(e) });
    return { statusCode: 500, body: JSON.stringify({ error: 'Server error' }) };
  }
};
