/** Sync health, delivery rows and the snapshot's delivery summary (JI-05, JI-06, JI-07). Read-only: snapshots only. */
import type {
  AllocationDTO,
  DeliveryRowDTO,
  DeliverySummaryDTO,
  ProjectDTO,
  SyncHealthDTO,
} from '../../../../shared/contracts/dto';
import type { Queryable } from '../db';
import { iso } from '../db';
import { quarterKeyOf, quarterRange } from '../entity';
import { jiraConfigured, loadStored } from '../integrationsStore';
import { plannedFte } from './aggregate';
import { SYNC_JOB_COLUMNS, syncJobDTO } from './sync';

const STALE_MS = 48 * 3600 * 1000;

export async function syncHealth(q: Queryable, wsId: string): Promise<SyncHealthDTO> {
  const stored = await loadStored(q, wsId);
  const jobs = await q.query(
    `SELECT ${SYNC_JOB_COLUMNS}, j.created_at FROM sync_jobs j LEFT JOIN users rb ON rb.id = j.requested_by
     WHERE j.workspace_id = $1 AND j.provider = 'jira' ORDER BY j.created_at DESC LIMIT 10`,
    [wsId],
  );
  const success = await q.query<{ at: unknown }>(
    `SELECT max(finished_at) AS at FROM sync_jobs WHERE workspace_id = $1 AND provider = 'jira' AND status = 'succeeded'`,
    [wsId],
  );
  const recentJobs = jobs.map(syncJobDTO);
  const lastJob = recentJobs[0] ?? null;
  const lastSuccessAt = iso(success[0]?.at);
  let state: SyncHealthDTO['state'] = 'ok';
  if (!lastJob) state = 'never';
  else if (lastJob.status === 'queued' || lastJob.status === 'running') state = 'running';
  else if (lastJob.status === 'failed' || lastJob.status === 'partial') state = 'failed';
  else if (!lastSuccessAt || Date.now() - Date.parse(lastSuccessAt) > STALE_MS) state = 'stale';
  return { provider: 'jira', configured: jiraConfigured(stored), state, lastSuccessAt, lastJob, recentJobs };
}

async function latestSnapshotDate(q: Queryable, wsId: string): Promise<string | null> {
  const r = await q.query<{ d: string | null }>(
    `SELECT max(snapshot_date)::text AS d FROM delivery_snapshots WHERE workspace_id = $1`,
    [wsId],
  );
  return r[0]?.d ?? null;
}

export async function deliverySummary(
  q: Queryable,
  wsId: string,
  projects: ProjectDTO[],
  allocations: AllocationDTO[],
): Promise<DeliverySummaryDTO | null> {
  const health = await syncHealth(q, wsId);
  const date = await latestSnapshotDate(q, wsId);
  if (!health.configured && !date && health.state === 'never') return null;
  const qk = quarterKeyOf(new Date());
  const { from, to } = quarterRange(qk);
  const implied = date
    ? await q.query<{ project_id: string; fte: number }>(
        `SELECT project_id, sum(implied_fte)::float8 / greatest(count(DISTINCT sprint_id), 1) AS fte FROM delivery_snapshots
         WHERE workspace_id = $1 AND snapshot_date = $2 AND quarter_key = $3 AND project_id IS NOT NULL AND sprint_id IS NOT NULL
         GROUP BY project_id`,
        [wsId, date, qk],
      )
    : [];
  const mapped = new Set(implied.map((r) => String(r.project_id)));
  const byProjectQbr1 = projects
    .filter((p) => mapped.has(p.id))
    .map((p) => ({
      projectId: p.id,
      plannedFte: plannedFte(
        allocations.filter((a) => a.projectId === p.id),
        from,
        to,
      ),
      impliedFte: Math.round(Number(implied.find((r) => String(r.project_id) === p.id)?.fte ?? 0) * 1000) / 1000,
    }));
  return { health, byProjectQbr1 };
}

export type GroupBy = 'tribe' | 'project' | 'sprint' | 'person';

/** GET /delivery: rows from the latest snapshot only (JI-05#AC2). */
export async function deliveryRows(
  q: Queryable,
  wsId: string,
  opts: { groupBy: GroupBy; tribeId?: string; projectId?: string; from?: string; to?: string },
): Promise<DeliveryRowDTO[]> {
  const date = await latestSnapshotDate(q, wsId);
  if (!date) return [];
  const params: unknown[] = [wsId, date];
  const where = ['s.workspace_id = $1', 's.snapshot_date = $2'];
  if (opts.tribeId) {
    params.push(opts.tribeId);
    where.push(`s.tribe_id = $${params.length}`);
  }
  if (opts.projectId) {
    params.push(opts.projectId);
    where.push(`s.project_id = $${params.length}`);
  }
  if (opts.from) {
    params.push(opts.from);
    where.push(`(s.sprint_end IS NULL OR s.sprint_end >= $${params.length}::date)`);
  }
  if (opts.to) {
    params.push(opts.to);
    where.push(`(s.sprint_start IS NULL OR s.sprint_start <= $${params.length}::date)`);
  }
  const rows = await q.query(
    `SELECT s.jira_project_key, s.project_id, p.name AS project_name, s.tribe_id, t.name AS tribe_name, s.sprint_id, s.sprint_name,
            s.sprint_start::text AS sprint_start, s.sprint_end::text AS sprint_end, s.quarter_key, s.person_id, r.name AS person_name,
            s.assignee_account_id, ei.display_name AS assignee_name,
            s.points_total::float8 AS points_total, s.points_done::float8 AS points_done, s.issues_done, coalesce(s.implied_fte, 0)::float8 AS implied_fte
     FROM delivery_snapshots s
     LEFT JOIN projects p ON p.id = s.project_id AND p.workspace_id = s.workspace_id
     LEFT JOIN tribes t ON t.id = s.tribe_id
     LEFT JOIN resources r ON r.id = s.person_id AND r.workspace_id = s.workspace_id
     LEFT JOIN external_identities ei ON ei.workspace_id = s.workspace_id AND ei.provider = 'jira' AND ei.external_id = s.assignee_account_id
     WHERE ${where.join(' AND ')}`,
    params,
  );
  const allocs = await q.query(
    `SELECT project_id, resource_id, percentage, start_date::text AS start_date, end_date::text AS end_date, state
     FROM allocations WHERE workspace_id = $1`,
    [wsId],
  );
  type Acc = DeliveryRowDTO & { sprints: Set<string>; projects: Set<string>; persons: Set<string> };
  const groups = new Map<string, Acc>();
  for (const r of rows) {
    let key: string;
    let label: string;
    switch (opts.groupBy) {
      case 'sprint':
        key = String(r.sprint_id ?? 'none');
        label = String(r.sprint_name ?? 'No sprint');
        break;
      case 'project':
        key = String(r.project_id ?? `jira:${r.jira_project_key}`);
        label = String(r.project_name ?? r.jira_project_key);
        break;
      case 'person':
        key = String(r.person_id ?? `jira:${r.assignee_account_id ?? 'unassigned'}`);
        label = String(r.person_name ?? r.assignee_name ?? 'Unassigned');
        break;
      default:
        key = String(r.tribe_id ?? 'none');
        label = String(r.tribe_name ?? 'No tribe');
    }
    const g =
      groups.get(key) ??
      ({
        key,
        label,
        tribeId: r.tribe_id ? String(r.tribe_id) : null,
        projectId: r.project_id ? String(r.project_id) : null,
        sprintId: r.sprint_id ? String(r.sprint_id) : null,
        sprintName: r.sprint_name ? String(r.sprint_name) : null,
        quarterKey: r.quarter_key ? String(r.quarter_key) : null,
        from: String(r.sprint_start ?? opts.from ?? date),
        to: String(r.sprint_end ?? opts.to ?? date),
        pointsTotal: 0,
        pointsDone: 0,
        issuesDone: 0,
        impliedFte: 0,
        plannedFte: 0,
        sprints: new Set<string>(),
        projects: new Set<string>(),
        persons: new Set<string>(),
      } as Acc);
    g.pointsTotal += Number(r.points_total);
    g.pointsDone += Number(r.points_done);
    g.issuesDone += Number(r.issues_done);
    g.impliedFte += Number(r.implied_fte);
    if (r.sprint_id) g.sprints.add(String(r.sprint_id));
    if (r.project_id) g.projects.add(String(r.project_id));
    if (r.person_id) g.persons.add(String(r.person_id));
    if (r.sprint_start && String(r.sprint_start) < g.from) g.from = String(r.sprint_start);
    if (r.sprint_end && String(r.sprint_end) > g.to) g.to = String(r.sprint_end);
    groups.set(key, g);
  }
  const out: DeliveryRowDTO[] = [];
  for (const g of groups.values()) {
    const relevant = allocs.filter(
      (a) =>
        g.projects.has(String(a.project_id)) && (opts.groupBy !== 'person' || g.persons.has(String(a.resource_id))),
    );
    const planned = plannedFte(
      relevant.map((a) => ({
        projectId: String(a.project_id),
        resourceId: String(a.resource_id),
        percentage: Number(a.percentage),
        startDate: a.start_date ? String(a.start_date) : null,
        endDate: a.end_date ? String(a.end_date) : null,
        state: String(a.state),
      })),
      g.from,
      g.to,
    );
    const { sprints: _s, projects: _p, persons: _x, ...row } = g;
    out.push({
      ...row,
      pointsTotal: Math.round(row.pointsTotal * 100) / 100,
      pointsDone: Math.round(row.pointsDone * 100) / 100,
      impliedFte: Math.round((row.impliedFte / Math.max(1, g.sprints.size)) * 1000) / 1000,
      plannedFte: planned,
    });
  }
  return out.sort((a, b) =>
    opts.groupBy === 'sprint' ? a.from.localeCompare(b.from) : a.label.localeCompare(b.label),
  );
}
