/**
 * Jira aggregation (JI-01, JI-04, JI-08). Pure: takes parsed Jira JSON, returns data. No I/O.
 */
import { isDone, isPlainObject, latestSprint, num, quarterKey, round2, str } from './fields';

export interface Calibration {
  pointsPerSprintPerFte: number;
  sprintLengthDays: number;
}
export const DEFAULT_CALIBRATION: Calibration = { pointsPerSprintPerFte: 10, sprintLengthDays: 14 };

type Issue = { key?: unknown; fields?: unknown };

// ── Snapshot rows (sync job pages) ─────────────────────────────────────────

export interface SnapshotRow {
  jiraProjectKey: string;
  sprintId: string | null;
  sprintName: string | null;
  sprintState: string | null;
  sprintStart: string | null;
  sprintEnd: string | null;
  quarterKey: string | null;
  assigneeAccountId: string | null;
  assigneeName: string | null;
  assigneeEmail: string | null;
  pointsTotal: number;
  pointsDone: number;
  issuesTotal: number;
  issuesDone: number;
}

/** Groups one page of issues by (project, sprint, assignee). Rows from several pages are summed by the caller. */
export function aggregatePage(
  issues: Issue[],
  storyPointsFieldId: string | undefined,
  sprintFieldId: string | undefined,
): SnapshotRow[] {
  const rows = new Map<string, SnapshotRow>();
  for (const issue of issues) {
    const f = isPlainObject(issue?.fields) ? issue.fields : {};
    const project = isPlainObject(f.project) ? f.project : {};
    const projectKey = str(project.key) || (typeof issue?.key === 'string' ? issue.key.split('-')[0] : 'UNKNOWN');
    const assignee = isPlainObject(f.assignee) ? f.assignee : null;
    const sprint = sprintFieldId ? latestSprint(f[sprintFieldId]) : null;
    const points = storyPointsFieldId ? (num(f[storyPointsFieldId]) ?? 0) : 0;
    const done = isDone(f);
    const accountId = assignee ? str(assignee.accountId) : null;
    const key = `${projectKey}|${sprint?.id ?? ''}|${accountId ?? ''}`;
    const row =
      rows.get(key) ??
      ({
        jiraProjectKey: projectKey,
        sprintId: sprint ? String(sprint.id) : null,
        sprintName: sprint?.name ?? null,
        sprintState: sprint?.state ?? null,
        sprintStart: sprint?.startDate ? sprint.startDate.slice(0, 10) : null,
        sprintEnd: sprint?.endDate ? sprint.endDate.slice(0, 10) : null,
        quarterKey: quarterKey(sprint?.startDate) ?? quarterKey(str(f.resolutiondate)) ?? quarterKey(str(f.created)),
        assigneeAccountId: accountId,
        assigneeName: assignee ? str(assignee.displayName) : null,
        assigneeEmail: assignee ? str(assignee.emailAddress) : null,
        pointsTotal: 0,
        pointsDone: 0,
        issuesTotal: 0,
        issuesDone: 0,
      } satisfies SnapshotRow);
    row.pointsTotal += points;
    row.issuesTotal += 1;
    if (done) {
      row.pointsDone += points;
      row.issuesDone += 1;
    }
    rows.set(key, row);
  }
  return [...rows.values()].map((r) => ({
    ...r,
    pointsTotal: round2(r.pointsTotal),
    pointsDone: round2(r.pointsDone),
  }));
}

/** JI-01#AC6: implied FTE = points done ÷ (calibration points per sprint per FTE × sprints in range). */
export function impliedFte(pointsDone: number, calibration: Calibration, sprintsInRange = 1): number {
  const denom = calibration.pointsPerSprintPerFte * Math.max(1, sprintsInRange);
  return denom > 0 ? Math.round((pointsDone / denom) * 1000) / 1000 : 0;
}

/**
 * JI-04#AC1: Σ completed points of the last 3 closed sprints ÷ (3 × mapped FTE in those sprints), rounded to 0.5.
 * `sprints` lists closed sprints with their done points and the planned FTE on the tribe's mapped projects.
 */
export function suggestCalibration(
  sprints: Array<{ sprintId: string; name: string; end: string | null; pointsDone: number; plannedFte: number }>,
): { value: number; basis: { sprintNames: string[]; points: number; fte: number } } | null {
  const closed = [...sprints].sort((a, b) => String(b.end ?? '').localeCompare(String(a.end ?? ''))).slice(0, 3);
  if (!closed.length) return null;
  const points = closed.reduce((s, x) => s + x.pointsDone, 0);
  const fte = closed.reduce((s, x) => s + x.plannedFte, 0) / closed.length;
  if (fte <= 0 || points <= 0) return null;
  const value = Math.max(0.5, Math.round((points / (closed.length * fte)) * 2) / 2);
  return {
    value,
    basis: { sprintNames: closed.map((c) => c.name).reverse(), points: round2(points), fte: round2(fte) },
  };
}

// ── Usage report (legacy POST /api/integrations/jira/usage) ─────────────────

export interface UsageOptions {
  storyPointsFieldId?: string;
  sprintFieldId?: string;
  tribeByProjectKey: Record<string, string>;
  calibration: Record<string, Calibration>;
  sprintsInRange: number;
}

export function aggregateUsage(issues: Issue[], o: UsageOptions) {
  const calibrationFor = (projectKey: string) => {
    const tribe = o.tribeByProjectKey[projectKey] || '*';
    return o.calibration[tribe] || o.calibration['*'] || DEFAULT_CALIBRATION;
  };
  type AssigneeAgg = {
    accountId: string;
    displayName: string;
    email: string;
    points: number;
    donePoints: number;
    issues: number;
  };
  type ProjectAgg = { key: string; name: string; tribe: string; points: number; donePoints: number; issues: number };
  type SprintAgg = {
    sprintId: number;
    sprintName: string;
    state: string;
    startDate: string | null;
    endDate: string | null;
    points: number;
    donePoints: number;
    issues: number;
    byAssignee: Record<string, number>;
  };
  type QuarterAgg = { quarterKey: string; points: number; donePoints: number; issues: number };
  const byAssignee = new Map<string, AssigneeAgg>();
  const byProject = new Map<string, ProjectAgg>();
  const bySprint = new Map<number, SprintAgg>();
  const byQuarter = new Map<string, QuarterAgg>();
  const fteBySprint: Record<string, number> = {};
  let totalPoints = 0;
  let donePointsTotal = 0;

  for (const issue of issues) {
    const f = isPlainObject(issue?.fields) ? issue.fields : {};
    const points = o.storyPointsFieldId ? (num(f[o.storyPointsFieldId]) ?? 0) : 0;
    const donePts = isDone(f) ? points : 0;
    totalPoints += points;
    donePointsTotal += donePts;
    const assignee = isPlainObject(f.assignee) ? f.assignee : {};
    const accountId = str(assignee.accountId) || 'unassigned';
    const a = byAssignee.get(accountId) || {
      accountId,
      displayName: str(assignee.displayName) || 'Unassigned',
      email: str(assignee.emailAddress) || '',
      points: 0,
      donePoints: 0,
      issues: 0,
    };
    a.points += points;
    a.donePoints += donePts;
    a.issues += 1;
    byAssignee.set(accountId, a);
    const project = isPlainObject(f.project) ? f.project : {};
    const projectKey = str(project.key) || (typeof issue?.key === 'string' ? issue.key.split('-')[0] : 'UNKNOWN');
    const p = byProject.get(projectKey) || {
      key: projectKey,
      name: str(project.name) || projectKey,
      tribe: o.tribeByProjectKey[projectKey] || '*',
      points: 0,
      donePoints: 0,
      issues: 0,
    };
    p.points += points;
    p.donePoints += donePts;
    p.issues += 1;
    byProject.set(projectKey, p);
    const sprint = o.sprintFieldId ? latestSprint(f[o.sprintFieldId]) : null;
    if (sprint) {
      const s = bySprint.get(sprint.id) || {
        sprintId: sprint.id,
        sprintName: sprint.name,
        state: sprint.state,
        startDate: sprint.startDate,
        endDate: sprint.endDate,
        points: 0,
        donePoints: 0,
        issues: 0,
        byAssignee: {},
      };
      s.points += points;
      s.donePoints += donePts;
      s.issues += 1;
      s.byAssignee[accountId] = (s.byAssignee[accountId] || 0) + points;
      bySprint.set(sprint.id, s);
      const sk = String(sprint.id);
      fteBySprint[sk] = (fteBySprint[sk] || 0) + points / calibrationFor(projectKey).pointsPerSprintPerFte;
    }
    const qk = quarterKey(sprint?.startDate) || quarterKey(str(f.resolutiondate)) || quarterKey(str(f.created));
    if (qk) {
      const q = byQuarter.get(qk) || { quarterKey: qk, points: 0, donePoints: 0, issues: 0 };
      q.points += points;
      q.donePoints += donePts;
      q.issues += 1;
      byQuarter.set(qk, q);
    }
  }
  const fteByProject: Record<string, number> = {};
  for (const p of byProject.values()) {
    fteByProject[p.key] = round2(p.points / (calibrationFor(p.key).pointsPerSprintPerFte * o.sprintsInRange));
  }
  for (const k of Object.keys(fteBySprint)) fteBySprint[k] = round2(fteBySprint[k]);
  return {
    storyPointsFieldId: o.storyPointsFieldId || null,
    issueCount: issues.length,
    totalPoints: round2(totalPoints),
    donePoints: round2(donePointsTotal),
    byAssignee: [...byAssignee.values()].sort(
      (x, y) => y.points - x.points || x.displayName.localeCompare(y.displayName),
    ),
    byProject: [...byProject.values()].sort((x, y) => x.key.localeCompare(y.key)),
    bySprint: [...bySprint.values()].sort(
      (x, y) => (x.startDate || '').localeCompare(y.startDate || '') || x.sprintId - y.sprintId,
    ),
    byQuarter: [...byQuarter.values()].sort((x, y) => x.quarterKey.localeCompare(y.quarterKey)),
    fteEstimate: { byProject: fteByProject, bySprint: fteBySprint },
  };
}

// ── Planned FTE from allocations (overlap-weighted) ────────────────────────

export interface PlannedAllocation {
  projectId: string;
  resourceId: string;
  percentage: number;
  startDate: string | null;
  endDate: string | null;
  state?: string;
}

function dayNum(d: string): number {
  return Math.floor(Date.parse(`${d.slice(0, 10)}T00:00:00Z`) / 86400000);
}

/** Σ pct/100 weighted by the overlap of each allocation with [from, to] (inclusive dates). Declined bookings excluded. */
export function plannedFte(allocations: PlannedAllocation[], from: string, to: string): number {
  const a0 = dayNum(from);
  const a1 = dayNum(to);
  const span = a1 - a0 + 1;
  if (span <= 0) return 0;
  let total = 0;
  for (const a of allocations) {
    if (a.state === 'declined') continue;
    const s = a.startDate ? Math.max(a0, dayNum(a.startDate)) : a0;
    const e = a.endDate ? Math.min(a1, dayNum(a.endDate)) : a1;
    if (e < s) continue;
    total += (a.percentage / 100) * ((e - s + 1) / span);
  }
  return Math.round(total * 1000) / 1000;
}
