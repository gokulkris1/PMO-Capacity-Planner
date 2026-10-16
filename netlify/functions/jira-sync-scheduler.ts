/**
 * Scheduled daily at 05:00 UTC (netlify.toml): enqueue one Jira sync job per workspace with a Jira connection and
 * `features.jiraScheduledSync` on (JI-01#AC2). Scheduled functions only run on published deploys (A-11).
 */
import type { Handler } from '@netlify/functions';
import { getDb } from './_lib/db';
import { ensureSchema } from './_lib/migrate';
import { enqueueScheduled } from './_lib/jira/sync';
import { errorFields, log } from './_lib/log';

export const handler: Handler = async () => {
  try {
    const db = getDb();
    await ensureSchema(db);
    const queued = await enqueueScheduled(db);
    log('info', { event: 'jira.schedule', fn: 'jira-sync-scheduler', queued });
    return { statusCode: 200, body: JSON.stringify({ queued }) };
  } catch (e) {
    log('error', { event: 'jira.schedule_failed', fn: 'jira-sync-scheduler', err: errorFields(e) });
    return { statusCode: 500, body: JSON.stringify({ error: 'Server error' }) };
  }
};
