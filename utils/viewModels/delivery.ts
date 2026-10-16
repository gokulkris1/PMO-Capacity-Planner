/**
 * Delivery view-models (JI-04 … JI-07): calibration defaults, implied FTE, the delivery signal,
 * sprint view, trend, and the sync-health banner. Inputs are the DTOs returned by the delivery,
 * calibration and sync-health routes (snapshots only, never a live Jira call). Additive to §4.3.
 *
 * Pure: no React, DOM, Node or Netlify imports.
 */
import type * as D from '../../shared/contracts/dto';
import { round1, round2 } from './core';

/** JI-04#AC3: workspace default when a tribe has no calibration. */
export const DEFAULT_CALIBRATION = { pointsPerSprintPerFte: 10, sprintLengthDays: 14 } as const;

export interface EffectiveCalibration {
  tribeId: D.ID;
  pointsPerSprintPerFte: number;
  sprintLengthDays: number;
  /** True when the workspace default is used (UI label "Default"). */
  isDefault: boolean;
  calibration: D.TribeCalibrationDTO | null;
}

/** Calibration for a tribe, keyed by tribe id (JI-04#AC4: renames never change it). */
export function effectiveCalibration(calibrations: D.TribeCalibrationDTO[], tribeId: D.ID): EffectiveCalibration {
  const c = calibrations.find((x) => x.tribeId === tribeId);
  if (!c || c.isDefault || !(c.pointsPerSprintPerFte > 0) || !(c.sprintLengthDays > 0)) {
    return { tribeId, ...DEFAULT_CALIBRATION, isDefault: true, calibration: c ?? null };
  }
  return {
    tribeId,
    pointsPerSprintPerFte: c.pointsPerSprintPerFte,
    sprintLengthDays: c.sprintLengthDays,
    isDefault: false,
    calibration: c,
  };
}

/** JI-01#AC6: implied FTE = points done ÷ (points per sprint per FTE × sprints in the range). */
export function impliedFte(
  pointsDone: number,
  cal: Pick<EffectiveCalibration, 'pointsPerSprintPerFte' | 'sprintLengthDays'>,
  rangeDays: number,
): number {
  const sprints = rangeDays / cal.sprintLengthDays;
  const denom = cal.pointsPerSprintPerFte * sprints;
  return denom > 0 ? round2(pointsDone / denom) : 0;
}

/** "Based on sprints 41–43: 96 pts, 3.2 FTE" (JI-04#AC2). */
export function suggestedBasisLabel(c: D.TribeCalibrationDTO): string | null {
  const b = c.suggestedBasis;
  if (!b || b.sprintNames.length === 0) return null;
  const names = b.sprintNames.length === 1 ? b.sprintNames[0] : `${b.sprintNames[0]}–${b.sprintNames[b.sprintNames.length - 1]}`;
  return `Based on ${names}: ${round1(b.points)} pts, ${round1(b.fte)} FTE`;
}

export type DeliverySignal = 'more' | 'less' | 'in-line' | 'none';
export const DELIVERY_SIGNAL_LABEL: Record<DeliverySignal, string> = {
  more: 'Jira shows more effort than planned',
  less: 'Jira shows less effort than planned',
  'in-line': 'In line',
  none: 'No delivery data',
};

/** JI-06#AC1: more when implied > planned × 1.2, less when implied < planned × 0.8, else in line. */
export function deliverySignal(plannedFte: number, impliedFteValue: number): DeliverySignal {
  if (plannedFte <= 0 && impliedFteValue <= 0) return 'none';
  if (impliedFteValue > plannedFte * 1.2) return 'more';
  if (impliedFteValue < plannedFte * 0.8) return 'less';
  return 'in-line';
}

export interface ProjectDeliveryModel {
  qbr1: { plannedFte: number; impliedFte: number; signal: DeliverySignal } | null;
  sprints: Array<D.DeliveryRowDTO & { signal: DeliverySignal }>;
  hasData: boolean;
}

/** Project drawer "Delivery" tab: QBR1 planned vs implied, and the last 3 sprints. */
export function buildProjectDelivery(
  s: D.WorkspaceSnapshot,
  rows: D.DeliveryRowDTO[],
  projectId: D.ID,
): ProjectDeliveryModel {
  const q = s.delivery?.byProjectQbr1.find((x) => x.projectId === projectId) ?? null;
  const sprints = rows
    .filter((r) => r.projectId === projectId && r.sprintId)
    .sort((a, b) => b.to.localeCompare(a.to))
    .slice(0, 3)
    .map((r) => ({ ...r, signal: deliverySignal(r.plannedFte, r.impliedFte) }));
  return {
    qbr1: q ? { plannedFte: q.plannedFte, impliedFte: q.impliedFte, signal: deliverySignal(q.plannedFte, q.impliedFte) } : null,
    sprints,
    hasData: !!q || sprints.length > 0,
  };
}

/** JI-05: last `limit` sprints for a tribe, oldest first (for a left-to-right chart). */
export function buildSprintView(rows: D.DeliveryRowDTO[], tribeId: D.ID, limit = 6): D.DeliveryRowDTO[] {
  return rows
    .filter((r) => r.tribeId === tribeId && r.sprintId)
    .sort((a, b) => b.to.localeCompare(a.to))
    .slice(0, limit)
    .reverse();
}

/** JI-06#AC2: planned vs implied per tribe over the snapshot history (only tribes with ≥ 2 points). */
export function buildDeliveryTrend(
  rows: D.DeliveryRowDTO[],
): Array<{ tribeId: D.ID; points: Array<{ from: D.ISODate; to: D.ISODate; plannedFte: number; impliedFte: number }> }> {
  const byTribe = new Map<D.ID, D.DeliveryRowDTO[]>();
  for (const r of rows) if (r.tribeId) byTribe.set(r.tribeId, [...(byTribe.get(r.tribeId) ?? []), r]);
  return [...byTribe.entries()]
    .map(([tribeId, list]) => ({
      tribeId,
      points: list
        .sort((a, b) => a.from.localeCompare(b.from))
        .map((r) => ({ from: r.from, to: r.to, plannedFte: r.plannedFte, impliedFte: r.impliedFte })),
    }))
    .filter((t) => t.points.length >= 2);
}

/* ── sync health (JI-07, RP-01#AC4) ────────────────────────────────────────────────── */

export type SyncPill = 'Succeeded' | 'Failed' | 'Partial' | 'Running' | 'Rate limited' | 'Queued' | 'Stale' | 'Never run';

export function syncJobLabel(job: D.SyncJobDTO, now: Date): SyncPill {
  if (job.status === 'running' && job.rateLimitedUntil && Date.parse(job.rateLimitedUntil) > now.getTime())
    return 'Rate limited';
  const map: Record<D.SyncStatus, SyncPill> = {
    queued: 'Queued',
    running: 'Running',
    succeeded: 'Succeeded',
    failed: 'Failed',
    partial: 'Partial',
  };
  return map[job.status];
}

/** JI-07#AC3: stale when no successful sync in 48 h. */
export function syncHealthState(h: D.SyncHealthDTO, now: Date): D.SyncHealthDTO['state'] {
  if (!h.configured) return 'never';
  if (h.lastJob?.status === 'running' || h.lastJob?.status === 'queued') return 'running';
  if (h.lastJob?.status === 'failed') return 'failed';
  if (!h.lastSuccessAt) return h.lastJob ? 'failed' : 'never';
  return now.getTime() - Date.parse(h.lastSuccessAt) > 48 * 3_600_000 ? 'stale' : 'ok';
}

/** "3 hours ago", "2 days ago", "just now". */
export function relativeTime(iso: D.ISODateTime, now: Date): string {
  const sec = Math.round((now.getTime() - Date.parse(iso)) / 1000);
  if (!Number.isFinite(sec)) return '';
  const abs = Math.abs(sec);
  const unit = (n: number, u: string) => `${n} ${u}${n === 1 ? '' : 's'}`;
  const text =
    abs < 60
      ? null
      : abs < 3600
        ? unit(Math.round(abs / 60), 'minute')
        : abs < 86_400
          ? unit(Math.round(abs / 3600), 'hour')
          : unit(Math.round(abs / 86_400), 'day');
  if (!text) return 'just now';
  return sec >= 0 ? `${text} ago` : `in ${text}`;
}

/** Home / Delivery banner (RP-01#AC4): null when healthy, never configured, or running. */
export function syncHealthBanner(
  h: D.SyncHealthDTO | null | undefined,
  now: Date,
): { kind: 'failed' | 'stale'; message: string } | null {
  if (!h) return null;
  const state = syncHealthState(h, now);
  if (state === 'failed') {
    const at = h.lastJob?.finishedAt ?? h.lastJob?.startedAt;
    const reason = h.lastJob?.error ?? 'Unknown error';
    return { kind: 'failed', message: `Jira sync failed ${at ? relativeTime(at, now) : ''}: ${reason}`.replace('  ', ' ') };
  }
  if (state === 'stale') {
    return { kind: 'stale', message: `Jira data is stale: last successful sync ${relativeTime(h.lastSuccessAt!, now)}.` };
  }
  return null;
}
