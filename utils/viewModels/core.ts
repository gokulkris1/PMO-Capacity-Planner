/**
 * View-model core: lookups and the single per-person load computation that every view reads.
 *
 * Same-number guarantee (RP-03#AC3): People (`buildPeopleRows`), the allocation grid
 * (`buildAllocationGrid`), Capacity Outlook (`buildCapacityOutlook`), Home and `utilisationFor`
 * all take a person's quarter load from `loadIndex()` below, which delegates to
 * `craftEngine.personRangeLoad`. Rounding happens once, here, in `toPersonQuarter`.
 *
 * Counting rules (documented once, used everywhere):
 *  - declined bookings never count;
 *  - tentative bookings count towards load and utilisation (they are planned capacity) unless a
 *    view explicitly excludes them (the grid's "Show tentative" off);
 *  - on the demand side, confirmed bookings are "staffed" and tentative ones "proposed".
 *
 * Pure: no React, DOM, Node or Netlify imports.
 */
import type * as D from '../../shared/contracts/dto';
import { bandFor, type UtilBand, type UtilisationThresholds } from '../../shared/utilisation';
import {
  allocationShare,
  effectiveWindow,
  headroomOf,
  personRangeLoad,
  round1,
  round2,
  targetOf,
  type DayRange,
  type RangeLoad,
} from '../craftEngine';
import { dayNumber, isIsoDate } from '../quarters';
import type { QuarterView, TimeBasis } from './types';

export { round1, round2 };

export const byId = <T extends { id: D.ID }>(list: readonly T[]): Map<D.ID, T> => new Map(list.map((x) => [x.id, x]));

export function rangeOfView(q: QuarterView): DayRange {
  return { key: q.key, label: q.label, start: q.start, end: q.end };
}

/** A booking date is usable when it is empty (open-ended) or an ISO day; v1.1 data can hold "TBC" (QA-025). */
const usableDate = (d: string | null | undefined): boolean => !d || isIsoDate(d);

/**
 * Declined never counts; tentative counts unless excluded. A booking whose dates cannot be read (a drifted v1.1
 * TEXT value such as "TBC") is left out of every number instead of turning a person's load into NaN (QA-025).
 */
export function counts(a: D.AllocationDTO, includeTentative = true): boolean {
  if (!usableDate(a.startDate) || !usableDate(a.endDate)) return false;
  return a.state === 'confirmed' || (includeTentative && a.state === 'tentative');
}

export function countedAllocations(s: D.WorkspaceSnapshot, includeTentative = true): D.AllocationDTO[] {
  return s.allocations.filter((a) => counts(a, includeTentative));
}

export function groupBy<T, K>(list: readonly T[], key: (x: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const x of list) {
    const k = key(x);
    const bucket = out.get(k);
    if (bucket) bucket.push(x);
    else out.set(k, [x]);
  }
  return out;
}

/** Quarter-averaged FTE of one allocation in one quarter. */
export function fteIn(a: D.AllocationDTO, project: D.ProjectDTO | undefined, q: QuarterView): number {
  if (!(a.percentage > 0)) return 0;
  return (a.percentage * allocationShare(a, rangeOfView(q), project)) / 100;
}

/* ── per-person load index ─────────────────────────────────────────────────────────── */

export interface PersonQuarter {
  key: D.QuarterKey;
  loadPct: number;
  relativePct: number;
  band: UtilBand;
  above: number;
  below: number;
  undeclared: number;
  free: number;
}

export interface LoadIndex {
  /** Raw (unrounded) loads per person, one entry per quarter in `quarters` order. */
  raw: Map<D.ID, RangeLoad[]>;
  quarters: QuarterView[];
}

export interface LoadOptions {
  includeTentative?: boolean;
}

export function loadIndex(s: D.WorkspaceSnapshot, quarters: QuarterView[], o: LoadOptions = {}): LoadIndex {
  const projects = byId(s.projects);
  const mine = groupBy(countedAllocations(s, o.includeTentative ?? true), (a) => a.resourceId);
  const ranges = quarters.map(rangeOfView);
  const raw = new Map<D.ID, RangeLoad[]>();
  for (const p of s.people) {
    const allocs = mine.get(p.id) ?? [];
    raw.set(
      p.id,
      ranges.map((r) => personRangeLoad(p, r, allocs, projects)),
    );
  }
  return { raw, quarters };
}

/** Utilisation relative to target, unrounded (A-4). */
export function relativeOf(load: number, target: number): number {
  return target > 0 ? (100 * load) / target : 0;
}

export function toPersonQuarter(key: D.QuarterKey, l: RangeLoad, t: UtilisationThresholds): PersonQuarter {
  const relative = relativeOf(l.total, l.target);
  return {
    key,
    loadPct: round1(l.total),
    relativePct: round1(relative),
    band: bandFor(relative, t),
    above: round1(l.above),
    below: round1(l.below),
    undeclared: round1(l.undeclared),
    free: round1(l.free),
  };
}

/** Raw load of a person on one calendar day (the "Today" basis). */
export function loadOnDay(s: D.WorkspaceSnapshot, personId: D.ID, day: D.ISODate, includeTentative = true): number {
  const projects = byId(s.projects);
  const n = dayNumber(day);
  let total = 0;
  for (const a of s.allocations) {
    if (a.resourceId !== personId || !counts(a, includeTentative) || !(a.percentage > 0)) continue;
    const w = effectiveWindow(a, projects.get(a.projectId));
    if ((w.start === null || dayNumber(w.start) <= n) && (w.end === null || dayNumber(w.end) >= n)) {
      total += a.percentage;
    }
  }
  return total;
}

/**
 * Raw load for a person on a basis. 'quarter' is that quarter, 'window' the mean of the window's
 * quarters, 'today' the bookings active today. Returns null when the quarter is not in the window.
 */
export function rawLoadFor(
  s: D.WorkspaceSnapshot,
  idx: LoadIndex,
  personId: D.ID,
  basis: TimeBasis,
  todayIso: D.ISODate,
): number | null {
  if (basis.kind === 'today') return loadOnDay(s, personId, todayIso);
  const loads = idx.raw.get(personId);
  if (!loads) return null;
  if (basis.kind === 'quarter') {
    const i = idx.quarters.findIndex((q) => q.key === basis.key);
    return i >= 0 ? loads[i].total : null;
  }
  if (loads.length === 0) return 0;
  return loads.reduce((x, l) => x + l.total, 0) / loads.length;
}

/** Index of the basis quarter (today and window map to QBR1 for quarter-shaped figures). */
export function basisIndex(basis: TimeBasis, quarters: QuarterView[]): number {
  if (basis.kind === 'quarter')
    return Math.max(
      0,
      quarters.findIndex((q) => q.key === basis.key),
    );
  return 0;
}

/** Σload ÷ Σtarget for a group of people (A-4), unrounded. */
export function groupUtilisation(loads: Array<{ total: number; target: number }>): number {
  const target = loads.reduce((x, l) => x + l.target, 0);
  const load = loads.reduce((x, l) => x + l.total, 0);
  return target > 0 ? (100 * load) / target : 0;
}

export { headroomOf, targetOf };
