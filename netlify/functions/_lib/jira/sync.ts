/**
 * Chunked Jira sync into delivery snapshots (JI-01, JI-03, JI-04). A job is advanced in steps of at most ~7 s
 * (Netlify kills functions at 10 s): each page of issues is aggregated and upserted together with the cursor in one
 * transaction, so a crash between pages never double-counts. Steps run from "Sync now" (client loop), the
 * `jira-sync-worker` scheduled function, or the manual step endpoint. Only one active job per workspace.
 */
import { randomUUID } from 'node:crypto';
import type { SyncJobDTO } from '../../../../shared/contracts/dto';
import type { Db, Queryable } from '../db';
import { iso, json, one } from '../db';
import { userRef } from '../dto';
import { HttpError } from '../errors';
import { audit, SYSTEM_AUDIT } from '../audit';
import { errorFields, log } from '../log';
import { TimeoutError, UpstreamError } from '../net';
import { loadStored, jiraCreds, jiraConfigured } from '../integrationsStore';
import { featuresOf } from '../dto';
import {
  DEFAULT_CALIBRATION,
  aggregatePage,
  impliedFte,
  plannedFte,
  suggestCalibration,
  type Calibration,
} from './aggregate';
import { detectJiraFields, jqlString } from './fields';
import { jiraFields, searchPage } from './client';

type R = Record<string, unknown>;

export const SYNC_JOB_COLUMNS = `j.id, j.provider, j.trigger, j.status, j.pages_done, j.issues_seen, j.error, j.rate_limited_until,
  j.started_at, j.finished_at, j.requested_by, rb.name AS requested_by_name`;

export function syncJobDTO(r: R): SyncJobDTO {
  return {
    id: String(r.id),
    provider: r.provider === 'planview' ? 'planview' : 'jira',
    trigger: r.trigger === 'manual' ? 'manual' : 'schedule',
    status: (['queued', 'running', 'succeeded', 'failed', 'partial'].includes(String(r.status))
      ? r.status
      : 'queued') as SyncJobDTO['status'],
    pagesDone: Number(r.pages_done ?? 0),
    issuesSeen: Number(r.issues_seen ?? 0),
    error: r.error ? String(r.error) : null,
    rateLimitedUntil: iso(r.rate_limited_until),
    startedAt: iso(r.started_at),
    finishedAt: iso(r.finished_at),
    requestedBy: userRef(r.requested_by, r.requested_by_name),
  };
}

export async function loadJob(q: Queryable, wsId: string, jobId: string): Promise<SyncJobDTO | null> {
  const r = await one(
    q,
    `SELECT ${SYNC_JOB_COLUMNS} FROM sync_jobs j LEFT JOIN users rb ON rb.id = j.requested_by WHERE j.workspace_id = $1 AND j.id = $2`,
    [wsId, jobId],
  );
  return r ? syncJobDTO(r) : null;
}

export async function activeJob(q: Queryable, wsId: string): Promise<SyncJobDTO | null> {
  const r = await one(
    q,
    `SELECT ${SYNC_JOB_COLUMNS} FROM sync_jobs j LEFT JOIN users rb ON rb.id = j.requested_by
     WHERE j.workspace_id = $1 AND j.provider = 'jira' AND j.status IN ('queued', 'running') ORDER BY j.created_at DESC LIMIT 1`,
    [wsId],
  );
  return r ? syncJobDTO(r) : null;
}

/** Creates a queued job unless one is already active (JI-01#AC4: no duplicates). */
export async function enqueueJob(
  q: Queryable,
  orgId: string,
  wsId: string,
  trigger: 'schedule' | 'manual',
  userId: string | null,
) {
  const existing = await activeJob(q, wsId);
  if (existing) return { job: existing, created: false };
  const id = randomUUID();
  await q.query(
    `INSERT INTO sync_jobs (id, org_id, workspace_id, provider, trigger, status, requested_by) VALUES ($1, $2, $3, 'jira', $4, 'queued', $5)`,
    [id, orgId, wsId, trigger, userId],
  );
  return { job: (await loadJob(q, wsId, id)) as SyncJobDTO, created: true };
}

/** JI-01#AC2: one scheduled job per workspace with a Jira connection and the daily-sync feature on. */
export async function enqueueScheduled(db: Db): Promise<number> {
  const rows = await db.query(
    `SELECT w.id, w.org_id, o.features FROM workspace_integrations wi
     JOIN workspaces w ON w.id = wi.workspace_id JOIN organizations o ON o.id = w.org_id
     WHERE wi.provider = 'jira' AND wi.secret_enc IS NOT NULL`,
  );
  let n = 0;
  for (const r of rows) {
    if (!featuresOf(r.features).jiraScheduledSync) continue;
    const res = await enqueueJob(db, String(r.org_id), String(r.id), 'schedule', null);
    if (res.created) n++;
  }
  return n;
}

/** Claims a job for one step (row lock via locked_until); null when another step holds it or it is finished. */
async function claim(db: Db, jobId: string): Promise<R | null> {
  return one(
    db,
    `UPDATE sync_jobs SET locked_until = now() + interval '20 seconds',
       status = CASE WHEN status = 'queued' THEN 'running' ELSE status END, started_at = coalesce(started_at, now())
     WHERE id = $1 AND status IN ('queued', 'running') AND (locked_until IS NULL OR locked_until < now())
     RETURNING *`,
    [jobId],
  );
}

async function finish(db: Db, job: R, status: 'succeeded' | 'failed' | 'partial', error: string | null) {
  await db.tx(async (q) => {
    await q.query(
      `UPDATE sync_jobs SET status = $2, error = $3, finished_at = now(), locked_until = NULL WHERE id = $1`,
      [job.id, status, error],
    );
    await audit(
      q,
      {
        ...SYSTEM_AUDIT,
        actorUserId: job.requested_by ? String(job.requested_by) : null,
        actorType: job.requested_by ? 'user' : 'system',
      },
      {
        action: 'integration.sync',
        orgId: String(job.org_id),
        workspaceId: String(job.workspace_id),
        targetType: 'sync_job',
        targetId: String(job.id),
        after: { status, error, pagesDone: job.pages_done, issuesSeen: job.issues_seen },
      },
    );
  });
}

interface Cursor {
  projectKeys: string[];
  index: number;
  token: string | null;
  sp?: string;
  sprint?: string;
}

async function initCursor(db: Db, job: R): Promise<Cursor> {
  const wsId = String(job.workspace_id);
  const stored = await loadStored(db, wsId);
  const creds = jiraCreds(stored);
  const mapped = await db.query<{ external_key: string }>(
    `SELECT external_key FROM integration_mappings WHERE workspace_id = $1 AND provider = 'jira' AND confirmed`,
    [wsId],
  );
  const keys = [...new Set([...creds.config.projectKeys, ...mapped.map((m) => m.external_key.toUpperCase())])].sort();
  if (!keys.length) throw new HttpError(409, 'conflict', 'No Jira projects are configured for this workspace.');
  let sp = creds.config.storyPointsFieldId;
  let sprint = creds.config.sprintFieldId;
  if (!sp || !sprint) {
    const detected = detectJiraFields(await jiraFields(creds), sp);
    sp = sp ?? detected.storyPointsFieldId;
    sprint = sprint ?? detected.sprintFieldId;
  }
  const cursor: Cursor = { projectKeys: keys, index: 0, token: null, sp, sprint };
  await db.tx(async (q) => {
    await q.query(`UPDATE sync_jobs SET cursor = $2::jsonb, snapshot_date = current_date WHERE id = $1`, [
      job.id,
      JSON.stringify(cursor),
    ]);
    await q.query(`DELETE FROM delivery_snapshots WHERE workspace_id = $1 AND snapshot_date = current_date`, [wsId]);
  });
  return cursor;
}

async function calibrations(
  q: Queryable,
  wsId: string,
): Promise<{ byTribe: Map<string, Calibration>; fallback: Calibration }> {
  const rows = await q.query<{ tribe_id: string; pps: number; sld: number }>(
    `SELECT tribe_id, points_per_sprint_per_fte::float8 AS pps, sprint_length_days AS sld FROM tribe_calibrations WHERE workspace_id = $1`,
    [wsId],
  );
  const stored = await loadStored(q, wsId);
  const fallback = stored.settings?.config.calibration['*'] ?? DEFAULT_CALIBRATION;
  return {
    byTribe: new Map(
      rows.map((r) => [r.tribe_id, { pointsPerSprintPerFte: Number(r.pps), sprintLengthDays: Number(r.sld) }]),
    ),
    fallback,
  };
}

/** Writes one page: snapshot rows (additive upsert), identities and the cursor, in one transaction. */
async function writePage(db: Db, job: R, cursor: Cursor, page: Awaited<ReturnType<typeof searchPage>>) {
  const wsId = String(job.workspace_id);
  const orgId = String(job.org_id);
  const rows = aggregatePage(page.issues, cursor.sp, cursor.sprint);
  await db.tx(async (q) => {
    for (const r of rows) {
      await q.query(
        `INSERT INTO delivery_snapshots (org_id, workspace_id, snapshot_date, jira_project_key, project_id, tribe_id, sprint_id, sprint_name,
           sprint_state, sprint_start, sprint_end, quarter_key, assignee_account_id, person_id, points_total, points_done, issues_total, issues_done)
         SELECT $1::uuid, $2::uuid, current_date, $3::text, m.project_id, coalesce(m.tribe_id, p.tribe_id), $4::text, $5::text, $6::text,
           $7::date, $8::date, $9::text, $10::text,
           (SELECT ei.person_id FROM external_identities ei
             WHERE ei.workspace_id = $2::uuid AND ei.provider = 'jira' AND ei.external_id = $10::text AND ei.confirmed),
           $11::numeric, $12::numeric, $13::int, $14::int
         FROM (SELECT 1) one
         LEFT JOIN integration_mappings m ON m.workspace_id = $2 AND m.provider = 'jira' AND m.external_key = $3 AND m.confirmed
         LEFT JOIN projects p ON p.id = m.project_id AND p.workspace_id = $2
         ON CONFLICT (workspace_id, snapshot_date, jira_project_key, coalesce(sprint_id, ''), coalesce(assignee_account_id, ''))
         DO UPDATE SET points_total = delivery_snapshots.points_total + EXCLUDED.points_total,
           points_done = delivery_snapshots.points_done + EXCLUDED.points_done,
           issues_total = delivery_snapshots.issues_total + EXCLUDED.issues_total,
           issues_done = delivery_snapshots.issues_done + EXCLUDED.issues_done`,
        [
          orgId,
          wsId,
          r.jiraProjectKey,
          r.sprintId,
          r.sprintName,
          r.sprintState,
          r.sprintStart,
          r.sprintEnd,
          r.quarterKey,
          r.assigneeAccountId,
          r.pointsTotal,
          r.pointsDone,
          r.issuesTotal,
          r.issuesDone,
        ],
      );
      if (r.assigneeAccountId)
        await upsertIdentity(q, orgId, wsId, r.assigneeAccountId, r.assigneeName, r.assigneeEmail);
    }
    const next: Cursor = page.nextPageToken
      ? { ...cursor, token: page.nextPageToken }
      : { ...cursor, index: cursor.index + 1, token: null };
    await q.query(
      `UPDATE sync_jobs SET cursor = $2::jsonb, pages_done = pages_done + 1, issues_seen = issues_seen + $3, rate_limited_until = NULL,
         error = NULL WHERE id = $1`,
      [job.id, JSON.stringify(next), page.issues.length],
    );
    Object.assign(cursor, next);
  });
}

/** JI-03#AC1/AC3: existing account id first (manual wins), then email, then exact name; unconfirmed suggestions. */
export async function upsertIdentity(
  q: Queryable,
  orgId: string,
  wsId: string,
  accountId: string,
  name: string | null,
  email: string | null,
) {
  const existing = await one(
    q,
    `SELECT id FROM external_identities WHERE workspace_id = $1 AND provider = 'jira' AND external_id = $2`,
    [wsId, accountId],
  );
  if (existing) {
    await q.query(
      `UPDATE external_identities SET last_seen_at = now(), display_name = coalesce($2, display_name), email = coalesce($3, email) WHERE id = $1`,
      [existing.id, name, email],
    );
    return;
  }
  let personId: string | null = null;
  let method = 'none';
  if (email) {
    const byEmail = await one<{ id: string }>(
      q,
      `SELECT id FROM resources WHERE workspace_id = $1 AND lower(email) = lower($2) ORDER BY id LIMIT 1`,
      [wsId, email],
    );
    if (byEmail) {
      personId = byEmail.id;
      method = 'email';
    }
  }
  if (!personId && name) {
    const byName = await q.query<{ id: string }>(
      `SELECT id FROM resources WHERE workspace_id = $1 AND lower(name) = lower($2) LIMIT 2`,
      [wsId, name],
    );
    if (byName.length === 1) {
      personId = byName[0].id;
      method = 'name';
    }
  }
  await q.query(
    `INSERT INTO external_identities (id, org_id, workspace_id, person_id, provider, external_id, display_name, email, match_method, confirmed, last_seen_at)
     VALUES ($1, $2, $3, $4, 'jira', $5, $6, $7, $8, false, now()) ON CONFLICT DO NOTHING`,
    [randomUUID(), orgId, wsId, personId, accountId, name ?? '', email, method],
  );
}

/** Implied FTE per row and per-tribe suggested calibration (JI-01#AC6, JI-04#AC1). */
export async function finalizeSnapshot(db: Db, wsId: string): Promise<void> {
  const { byTribe, fallback } = await calibrations(db, wsId);
  const rows = await db.query(
    `SELECT id, tribe_id, project_id, sprint_id, sprint_name, sprint_state, sprint_end::text AS sprint_end, sprint_start::text AS sprint_start,
            points_done::float8 AS points_done
     FROM delivery_snapshots WHERE workspace_id = $1 AND snapshot_date = current_date`,
    [wsId],
  );
  const ids: string[] = [];
  const ftes: number[] = [];
  for (const r of rows) {
    if (!r.sprint_id) continue;
    const cal = (r.tribe_id ? byTribe.get(String(r.tribe_id)) : undefined) ?? fallback;
    ids.push(String(r.id));
    ftes.push(impliedFte(Number(r.points_done), cal, 1));
  }
  const allocations = await db.query(
    `SELECT project_id, resource_id, percentage, start_date::text AS start_date, end_date::text AS end_date, state FROM allocations WHERE workspace_id = $1`,
    [wsId],
  );
  const tribes = new Map<
    string,
    Map<
      string,
      {
        sprintId: string;
        name: string;
        end: string | null;
        start: string | null;
        pointsDone: number;
        projects: Set<string>;
      }
    >
  >();
  for (const r of rows) {
    if (!r.tribe_id || !r.sprint_id || r.sprint_state !== 'closed') continue;
    const t = tribes.get(String(r.tribe_id)) ?? new Map();
    const s = t.get(String(r.sprint_id)) ?? {
      sprintId: String(r.sprint_id),
      name: String(r.sprint_name ?? r.sprint_id),
      end: r.sprint_end ? String(r.sprint_end) : null,
      start: r.sprint_start ? String(r.sprint_start) : null,
      pointsDone: 0,
      projects: new Set<string>(),
    };
    s.pointsDone += Number(r.points_done);
    if (r.project_id) s.projects.add(String(r.project_id));
    t.set(s.sprintId, s);
    tribes.set(String(r.tribe_id), t);
  }
  await db.tx(async (q) => {
    if (ids.length) {
      await q.query(
        `UPDATE delivery_snapshots s SET implied_fte = v.f FROM (SELECT unnest($1::bigint[]) AS id, unnest($2::numeric[]) AS f) v WHERE s.id = v.id`,
        [ids, ftes],
      );
    }
    for (const [tribeId, sprints] of tribes) {
      const list = [...sprints.values()].map((s) => ({
        sprintId: s.sprintId,
        name: s.name,
        end: s.end,
        pointsDone: s.pointsDone,
        plannedFte:
          s.start && s.end
            ? plannedFte(
                allocations
                  .filter((a) => s.projects.has(String(a.project_id)))
                  .map((a) => ({
                    projectId: String(a.project_id),
                    resourceId: String(a.resource_id),
                    percentage: Number(a.percentage),
                    startDate: a.start_date ? String(a.start_date) : null,
                    endDate: a.end_date ? String(a.end_date) : null,
                    state: String(a.state),
                  })),
                s.start,
                s.end,
              )
            : 0,
      }));
      const suggestion = suggestCalibration(list);
      if (!suggestion) continue;
      await q.query(
        `INSERT INTO tribe_calibrations (workspace_id, tribe_id, points_per_sprint_per_fte, sprint_length_days, suggested_value, suggested_basis, is_default)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, true)
         ON CONFLICT (workspace_id, tribe_id) DO UPDATE SET suggested_value = EXCLUDED.suggested_value, suggested_basis = EXCLUDED.suggested_basis`,
        [
          wsId,
          tribeId,
          fallback.pointsPerSprintPerFte,
          fallback.sprintLengthDays,
          suggestion.value,
          JSON.stringify(suggestion.basis),
        ],
      );
    }
  });
}

/** Advances a job until `deadline` (ms since epoch). Never throws for Jira/network failures: they land on the job. */
export async function runStep(db: Db, jobId: string, deadline: number): Promise<void> {
  const job = await claim(db, jobId);
  if (!job) return;
  const rateLimited = job.rate_limited_until ? Date.parse(String(iso(job.rate_limited_until))) : 0;
  if (rateLimited > Date.now()) {
    await db.query(`UPDATE sync_jobs SET locked_until = NULL WHERE id = $1`, [jobId]);
    return;
  }
  const wsId = String(job.workspace_id);
  try {
    const stored = await loadStored(db, wsId);
    if (!jiraConfigured(stored)) throw new HttpError(409, 'conflict', 'Jira is not configured for this workspace.');
    const creds = jiraCreds(stored);
    let cursor = json<Cursor>(job.cursor, { projectKeys: [], index: 0, token: null });
    if (!cursor.projectKeys?.length) cursor = await initCursor(db, job);
    while (cursor.index < cursor.projectKeys.length) {
      const remaining = deadline - Date.now();
      if (remaining < 1500) break;
      const key = cursor.projectKeys[cursor.index];
      const fields = ['summary', 'status', 'assignee', 'project', 'issuetype', 'resolutiondate', 'created'];
      if (cursor.sp) fields.push(cursor.sp);
      if (cursor.sprint) fields.push(cursor.sprint);
      const page = await searchPage(
        creds,
        `project = ${jqlString(key)} AND updated >= -120d ORDER BY key ASC`,
        fields,
        cursor.token,
        Math.min(remaining - 1000, 8000),
      );
      await writePage(db, job, cursor, page);
      job.pages_done = Number(job.pages_done ?? 0) + 1;
      job.issues_seen = Number(job.issues_seen ?? 0) + page.issues.length;
    }
    if (cursor.index >= cursor.projectKeys.length) {
      await finalizeSnapshot(db, wsId);
      await finish(db, job, 'succeeded', null);
    } else {
      await db.query(`UPDATE sync_jobs SET locked_until = NULL WHERE id = $1`, [jobId]);
    }
  } catch (e) {
    const pages = Number(job.pages_done ?? 0);
    if (e instanceof UpstreamError && e.status === 429) {
      const wait = e.retryAfterSec ?? 60;
      await db.query(
        `UPDATE sync_jobs SET rate_limited_until = now() + ($2 || ' seconds')::interval, error = 'Rate limited by Jira', locked_until = NULL WHERE id = $1`,
        [jobId, String(Math.ceil(wait))],
      );
      return;
    }
    if (e instanceof TimeoutError) {
      await db.query(`UPDATE sync_jobs SET locked_until = NULL WHERE id = $1`, [jobId]);
      return;
    }
    let message = 'Sync failed';
    if (e instanceof UpstreamError && (e.status === 401 || e.status === 403)) message = 'Jira rejected the credentials';
    else if (e instanceof UpstreamError) message = `Jira ${e.status}: ${e.message}`.slice(0, 300);
    else if (e instanceof HttpError) message = e.message;
    else log('error', { event: 'jira.sync_failed', jobId, err: errorFields(e) });
    await finish(db, job, pages > 0 ? 'partial' : 'failed', message);
  }
}

/** Worker: advance queued/running jobs until the budget is spent (scheduled every 10 minutes). */
export async function runWorker(db: Db, budgetMs = 7000): Promise<number> {
  const deadline = Date.now() + budgetMs;
  const jobs = await db.query<{ id: string }>(
    `SELECT id FROM sync_jobs WHERE status IN ('queued', 'running') AND (locked_until IS NULL OR locked_until < now())
       AND (rate_limited_until IS NULL OR rate_limited_until <= now()) ORDER BY created_at LIMIT 10`,
  );
  let n = 0;
  for (const j of jobs) {
    if (deadline - Date.now() < 2000) break;
    await runStep(db, j.id, deadline);
    n++;
  }
  return n;
}
