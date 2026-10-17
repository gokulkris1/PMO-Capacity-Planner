/**
 * Craft engine: turns people, projects, allocations and demand into the numbers the PMO needs to
 * run a rolling four-quarter plan.
 *
 *   - per person per quarter: above-the-table %, below-the-table %, undeclared %, free %
 *   - per craft per quarter: supply (people who hold the craft), committed, demand, gap, reach
 *   - marketplace matches: who can absorb unstaffed demand, ranked with reasons
 *
 * All FTE figures are quarter-averaged: an allocation of 50% that only covers half the quarter
 * counts as 0.25 FTE for that quarter. Day arithmetic is done on ISO dates in UTC day numbers
 * (`utils/quarters.ts`), so results never depend on the browser's time zone.
 *
 * The inputs are structural (ORG-06): v1.1 `Resource`/`Project`/`Allocation` objects and 2.0 DTOs
 * both fit. The craft catalogue, tribe ids and demand lines are passed in as arguments; nothing
 * here reads `constants.ts`.
 *
 * Pure: no React, DOM, Node or Netlify imports.
 */
import { toIsoDate } from './clock';
import { overlapShare, parseDay, type Quarter } from './quarters';
import type { QuarterView } from './viewModels/types';

export const DEFAULT_SECONDARY_MAX_PCT = 40;
export const DEFAULT_TARGET_UTIL = 100;

/* ── structural input types ────────────────────────────────────────────────────────── */

export interface EngineAllocation {
  id?: string;
  resourceId: string;
  projectId: string;
  percentage: number;
  startDate?: string | null;
  endDate?: string | null;
  craftId?: string | null;
}

export interface EngineDemand {
  projectId?: string;
  quarterKey: string;
  craftId: string;
  fte: number;
  note?: string | null;
}

export interface EngineProject {
  id: string;
  name: string;
  startDate?: string | null;
  endDate?: string | null;
  /** v1.1 embedded demand; 2.0 passes demand lines separately. */
  craftDemand?: EngineDemand[];
  /** v1.1 tribe name. */
  clientName?: string;
  /** 2.0 tribe id. */
  tribeId?: string | null;
}

export interface EngineSecondaryCraft {
  craftId: string;
  proficiency: 1 | 2 | 3;
  maxPct?: number;
}

export interface EnginePerson {
  id: string;
  name: string;
  totalCapacity?: number;
  primaryCraft?: string | null;
  secondaryCrafts?: EngineSecondaryCraft[];
  /** 2.0: tribe ids; v1.1: tribe names. */
  tribeAffinity?: string[];
  targetUtil?: number | null;
}

export interface EngineCraft {
  id: string;
}

/** A v1.1 `Quarter` (Date bounds) or a 2.0 `QuarterView` (ISO bounds). */
export type QuarterLike = Quarter | QuarterView;

export interface DayRange {
  key: string;
  label: string;
  start: string;
  end: string;
}

/** Normalises a quarter to ISO day bounds. */
export function rangeOf(q: QuarterLike): DayRange {
  if (typeof q.start === 'string') {
    const v = q as QuarterView;
    return { key: v.key, label: v.label, start: v.start, end: v.end };
  }
  const l = q as Quarter;
  return { key: l.key, label: l.label, start: toIsoDate(l.start), end: toIsoDate(l.end) };
}

/* ── allocation → quarter ──────────────────────────────────────────────────────────── */

const day = (v: string | null | undefined): string | null => (v ? v.slice(0, 10) : null);

/** Effective window as ISO days: the allocation's own dates, else the project's, else open-ended (null). */
export function effectiveWindow(
  a: Pick<EngineAllocation, 'startDate' | 'endDate'>,
  project?: Pick<EngineProject, 'startDate' | 'endDate'> | null,
): { start: string | null; end: string | null } {
  return { start: day(a.startDate) ?? day(project?.startDate), end: day(a.endDate) ?? day(project?.endDate) };
}

/** v1.1 shape of `effectiveWindow` (local Date objects). */
export function allocationWindow(
  a: EngineAllocation,
  project?: EngineProject,
): { start: Date | null; end: Date | null } {
  const w = effectiveWindow(a, project);
  return { start: parseDay(w.start, 'start'), end: parseDay(w.end, 'end') };
}

/** Fraction (0..1) of the range covered by the allocation's effective window. */
export function allocationShare(a: EngineAllocation, range: DayRange, project?: EngineProject | null): number {
  const w = effectiveWindow(a, project);
  return overlapShare(w.start, w.end, range.start, range.end);
}

/** Quarter-averaged percentage contributed by one allocation in one quarter. */
export function allocationPctInQuarter(a: EngineAllocation, quarter: QuarterLike, project?: EngineProject): number {
  if (!a.percentage || a.percentage <= 0) return 0;
  return a.percentage * allocationShare(a, rangeOf(quarter), project);
}

/** The craft a booking counts under: its own craft, else the person's above-the-table craft. */
export function allocationCraft(
  a: Pick<EngineAllocation, 'craftId'>,
  person?: EnginePerson | null,
): string | undefined {
  return a.craftId || person?.primaryCraft || undefined;
}

export type CraftRelation = 'above' | 'below' | 'undeclared';

/** How a craft relates to a person: their above-the-table craft, a declared below-the-table craft, or neither. */
export function craftRelation(person: EnginePerson, craftId: string | null | undefined): CraftRelation {
  if (craftId && craftId === person.primaryCraft) return 'above';
  if (craftId && (person.secondaryCrafts ?? []).some((s) => s.craftId === craftId)) return 'below';
  return 'undeclared';
}

/** Target utilisation (default 100). */
export function targetOf(person: EnginePerson): number {
  return person.targetUtil && person.targetUtil > 0 ? person.targetUtil : DEFAULT_TARGET_UTIL;
}

/** Capacity the person can be booked to without exceeding their target: min(capacity, target). */
export function headroomOf(person: EnginePerson): number {
  return Math.min(person.totalCapacity ?? 100, targetOf(person));
}

/** Groups allocations by person once, so per-person loops stay O(bookings), not O(people × bookings). */
export function allocationsByResource<A extends EngineAllocation>(allocations: A[]): Map<string, A[]> {
  const out = new Map<string, A[]>();
  for (const a of allocations) {
    const list = out.get(a.resourceId);
    if (list) list.push(a);
    else out.set(a.resourceId, [a]);
  }
  return out;
}

/* ── per person ────────────────────────────────────────────────────────────────────── */

export interface BookingShare {
  allocationId: string | undefined;
  projectId: string;
  craftId: string | undefined;
  relation: CraftRelation;
  /** Quarter-averaged %. */
  pct: number;
  /** True when the booking covers only part of the range. */
  partial: boolean;
}

/** Unrounded load of one person over a day range. The single source for every per-person number. */
export interface RangeLoad {
  above: number;
  below: number;
  undeclared: number;
  total: number;
  capacity: number;
  target: number;
  /** max(0, min(capacity, target) − total) */
  free: number;
  partial: boolean;
  bookings: BookingShare[];
}

/**
 * Load of one person over a range. `allocations` may contain other people's bookings (they are
 * skipped); pass a pre-filtered list for speed. `projects` is a list or a lookup map.
 */
export function personRangeLoad(
  person: EnginePerson,
  range: DayRange,
  allocations: EngineAllocation[],
  projects: EngineProject[] | Map<string, EngineProject>,
): RangeLoad {
  const projectMap = projects instanceof Map ? projects : new Map(projects.map((p) => [p.id, p]));
  let above = 0,
    below = 0,
    undeclared = 0,
    partial = false;
  const bookings: BookingShare[] = [];
  for (const a of allocations) {
    if (a.resourceId !== person.id || !a.percentage || a.percentage <= 0) continue;
    const share = allocationShare(a, range, projectMap.get(a.projectId));
    if (share <= 0) continue;
    const pct = a.percentage * share;
    const craftId = allocationCraft(a, person);
    const relation = craftRelation(person, craftId);
    if (relation === 'above') above += pct;
    else if (relation === 'below') below += pct;
    else undeclared += pct;
    if (share < 1) partial = true;
    bookings.push({ allocationId: a.id, projectId: a.projectId, craftId, relation, pct, partial: share < 1 });
  }
  const total = above + below + undeclared;
  return {
    above,
    below,
    undeclared,
    total,
    capacity: person.totalCapacity ?? 100,
    target: targetOf(person),
    free: Math.max(0, headroomOf(person) - total),
    partial,
    bookings,
  };
}

export interface PersonQuarterLoad {
  quarterKey: string;
  aboveTable: number; // % of capacity spent on primary craft
  belowTable: number; // % of capacity spent on secondary crafts
  other: number; // % spent on allocations whose craft the person has not declared
  total: number; // aboveTable + belowTable + other
  capacity: number; // resource.totalCapacity
  bench: number; // max(0, capacity - total)
  byProject: { projectId: string; pct: number; craftId?: string }[];
}

/** v1.1 rounded view of `personRangeLoad` (legacy components and tests). */
export function personQuarterLoad(
  resource: EnginePerson,
  quarter: QuarterLike,
  allocations: EngineAllocation[],
  projects: EngineProject[],
): PersonQuarterLoad {
  const range = rangeOf(quarter);
  const l = personRangeLoad(resource, range, allocations, projects);
  return {
    quarterKey: range.key,
    aboveTable: round1(l.above),
    belowTable: round1(l.below),
    other: round1(l.undeclared),
    total: round1(l.total),
    capacity: l.capacity,
    bench: round1(Math.max(0, l.capacity - l.total)),
    byProject: l.bookings.map((b) => ({ projectId: b.projectId, pct: b.pct, craftId: b.craftId })),
  };
}

export function personOutlook(
  resource: EnginePerson,
  quarters: QuarterLike[],
  allocations: EngineAllocation[],
  projects: EngineProject[],
): PersonQuarterLoad[] {
  return quarters.map((q) => personQuarterLoad(resource, q, allocations, projects));
}

/* ── demand ────────────────────────────────────────────────────────────────────────── */

/** Demand lines: the 2.0 list when given, else each project's v1.1 `craftDemand`. */
export function demandOf(
  projects: EngineProject[],
  demand?: EngineDemand[],
): Array<EngineDemand & { projectId: string }> {
  if (demand) return demand.filter((d): d is EngineDemand & { projectId: string } => !!d.projectId);
  return projects.flatMap((p) => (p.craftDemand ?? []).map((d) => ({ ...d, projectId: p.id })));
}

/* ── per craft ─────────────────────────────────────────────────────────────────────── */

export interface CraftQuarterBalance {
  craftId: string;
  quarterKey: string;
  /** FTE of people whose primary craft this is (above-the-table supply) */
  primarySupply: number;
  /** FTE that holders of this craft as a secondary could add, bounded by their maxPct and free capacity */
  secondaryReach: number;
  /** FTE currently allocated under this craft */
  committed: number;
  /** FTE of anticipated demand captured on projects */
  demand: number;
  /** demand − committed (positive = unstaffed) */
  gap: number;
  /** primarySupply − committed-by-primary-holders (positive = bench in this craft) */
  primaryBench: number;
}

export function craftBalance(
  craft: EngineCraft,
  quarter: QuarterLike,
  resources: EnginePerson[],
  projects: EngineProject[],
  allocations: EngineAllocation[],
  demand?: EngineDemand[],
): CraftQuarterBalance {
  const range = rangeOf(quarter);
  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const mine = allocationsByResource(allocations);
  const resourceMap = new Map(resources.map((r) => [r.id, r]));

  let primarySupply = 0;
  let primaryCommitted = 0;
  let committed = 0;
  let secondaryReach = 0;

  for (const r of resources) {
    const load = personRangeLoad(r, range, mine.get(r.id) ?? [], projectMap);
    const onCraft = load.bookings.filter((b) => b.craftId === craft.id).reduce((s, b) => s + b.pct, 0) / 100;
    if (r.primaryCraft === craft.id) {
      primarySupply += (r.totalCapacity ?? 100) / 100;
      primaryCommitted += onCraft;
    }
    const sec = (r.secondaryCrafts ?? []).find((s) => s.craftId === craft.id);
    if (sec) {
      const freeFte = Math.max(0, load.capacity - load.total) / 100;
      const cap = (sec.maxPct ?? DEFAULT_SECONDARY_MAX_PCT) / 100;
      secondaryReach += Math.max(0, Math.min(freeFte, cap - onCraft));
    }
  }

  for (const a of allocations) {
    if (allocationCraft(a, resourceMap.get(a.resourceId)) !== craft.id || !(a.percentage > 0)) continue;
    committed += (a.percentage * allocationShare(a, range, projectMap.get(a.projectId))) / 100;
  }

  const demandFte = demandOf(projects, demand)
    .filter((d) => d.quarterKey === range.key && d.craftId === craft.id)
    .reduce((x, d) => x + (Number(d.fte) || 0), 0);

  return {
    craftId: craft.id,
    quarterKey: range.key,
    primarySupply: round2(primarySupply),
    secondaryReach: round2(secondaryReach),
    committed: round2(committed),
    demand: round2(demandFte),
    gap: round2(demandFte - committed),
    primaryBench: round2(primarySupply - primaryCommitted),
  };
}

export function craftMatrix(
  crafts: EngineCraft[],
  quarters: QuarterLike[],
  resources: EnginePerson[],
  projects: EngineProject[],
  allocations: EngineAllocation[],
  demand?: EngineDemand[],
): Record<string, Record<string, CraftQuarterBalance>> {
  const out: Record<string, Record<string, CraftQuarterBalance>> = {};
  for (const c of crafts) {
    out[c.id] = {};
    for (const q of quarters) out[c.id][rangeOf(q).key] = craftBalance(c, q, resources, projects, allocations, demand);
  }
  return out;
}

/* ── demand lines ──────────────────────────────────────────────────────────────────── */

export interface DemandLine {
  projectId: string;
  projectName: string;
  /** v1.1 tribe name (`project.clientName`) or the 2.0 tribe name when known. */
  tribe?: string;
  /** 2.0 tribe id. */
  tribeId?: string | null;
  quarterKey: string;
  craftId: string;
  demandFte: number;
  staffedFte: number; // allocations on this project under this craft in this quarter
  gapFte: number;
  note?: string;
}

export function demandLines(
  projects: EngineProject[],
  resources: EnginePerson[],
  allocations: EngineAllocation[],
  quarters: QuarterLike[],
  demand?: EngineDemand[],
  tribeName?: (tribeId: string) => string | undefined,
): DemandLine[] {
  const resourceMap = new Map(resources.map((r) => [r.id, r]));
  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const ranges = new Map(quarters.map((q) => [rangeOf(q).key, rangeOf(q)]));
  // Sum lines per (project, quarter, craft) so duplicates never double-count staffing.
  const grouped = new Map<string, EngineDemand & { projectId: string }>();
  for (const d of demandOf(projects, demand)) {
    const k = `${d.projectId}|${d.quarterKey}|${d.craftId}`;
    const prev = grouped.get(k);
    grouped.set(k, prev ? { ...prev, fte: prev.fte + (Number(d.fte) || 0) } : { ...d, fte: Number(d.fte) || 0 });
  }
  const lines: DemandLine[] = [];
  for (const d of grouped.values()) {
    const p = projectMap.get(d.projectId);
    const range = ranges.get(d.quarterKey);
    if (!p || !range) continue;
    const staffed =
      allocations
        .filter((a) => a.projectId === p.id && allocationCraft(a, resourceMap.get(a.resourceId)) === d.craftId)
        .reduce((s, a) => s + (a.percentage > 0 ? a.percentage * allocationShare(a, range, p) : 0), 0) / 100;
    lines.push({
      projectId: p.id,
      projectName: p.name,
      tribe: (p.tribeId && tribeName?.(p.tribeId)) || p.clientName,
      tribeId: p.tribeId ?? null,
      quarterKey: d.quarterKey,
      craftId: d.craftId,
      demandFte: round2(d.fte),
      staffedFte: round2(staffed),
      gapFte: round2(d.fte - staffed),
      note: d.note ?? undefined,
    });
  }
  return lines;
}

/* ── marketplace matching ──────────────────────────────────────────────────────────── */

export interface MatchSuggestion {
  resourceId: string;
  resourceName: string;
  craftId: string;
  quarterKey: string;
  projectId: string;
  /** 'primary' = above the table, 'secondary' = below the table */
  via: 'primary' | 'secondary';
  proficiency: 1 | 2 | 3;
  /** % of the person's capacity we propose to book */
  proposedPct: number;
  /** person's free % in that quarter before this proposal */
  freePct: number;
  score: number;
  reasons: string[];
}

/** True when the person's tribe affinity covers the line's tribe (ids first, legacy names as fallback). */
export function knowsTribe(person: EnginePerson, line: Pick<DemandLine, 'tribe' | 'tribeId'>): boolean {
  const affinity = person.tribeAffinity ?? [];
  if (line.tribeId && affinity.includes(line.tribeId)) return true;
  const name = line.tribe?.toLowerCase();
  return !!name && affinity.some((t) => t.toLowerCase() === name);
}

/**
 * Rank who could absorb an unstaffed demand line. Scoring favours people who hold the craft above
 * the table, then higher below-the-table proficiency, then more free capacity, then tribe
 * familiarity. Each candidate is capped at their free capacity (up to their target) and, for
 * below-the-table crafts, at their declared maxPct.
 */
export function suggestMatches(
  line: DemandLine,
  quarter: QuarterLike,
  resources: EnginePerson[],
  projects: EngineProject[],
  allocations: EngineAllocation[],
  limit = 5,
): MatchSuggestion[] {
  if (line.gapFte <= 0) return [];
  const range = rangeOf(quarter);
  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const mine = allocationsByResource(allocations);
  const needPct = Math.round(line.gapFte * 100);
  const out: MatchSuggestion[] = [];

  for (const r of resources) {
    const load = personRangeLoad(r, range, mine.get(r.id) ?? [], projectMap);
    const freePct = load.free;
    if (freePct < 5) continue;
    if (load.bookings.some((b) => b.projectId === line.projectId && b.craftId === line.craftId)) continue; // already on it

    let via: 'primary' | 'secondary';
    let proficiency: 1 | 2 | 3 = 3;
    let cap = freePct;
    if (r.primaryCraft === line.craftId) {
      via = 'primary';
    } else {
      const sec = (r.secondaryCrafts ?? []).find((s) => s.craftId === line.craftId);
      if (!sec) continue;
      via = 'secondary';
      proficiency = sec.proficiency;
      const onCraft = load.bookings.filter((b) => b.craftId === line.craftId).reduce((s, b) => s + b.pct, 0);
      cap = Math.min(freePct, Math.max(0, (sec.maxPct ?? DEFAULT_SECONDARY_MAX_PCT) - onCraft));
    }
    if (cap < 5) continue;

    const proposedPct = Math.max(5, Math.min(cap, needPct));
    const reasons: string[] = [];
    let score = 0;
    if (via === 'primary') {
      score += 60;
      reasons.push('Above the table');
    } else {
      score += 20 + proficiency * 8;
      reasons.push(`L${proficiency} below the table`);
    }
    score += Math.min(25, freePct / 4);
    reasons.push(`${Math.round(freePct)}% free`);
    if (knowsTribe(r, line)) {
      score += 10;
      reasons.push(line.tribe ? `Knows ${line.tribe}` : 'Knows the tribe');
    }
    if (proposedPct >= needPct) {
      score += 5;
      reasons.push('Covers the full gap');
    }
    if (load.total < 60) {
      score += 5;
      reasons.push('Currently under-used');
    }

    out.push({
      resourceId: r.id,
      resourceName: r.name,
      craftId: line.craftId,
      quarterKey: range.key,
      projectId: line.projectId,
      via,
      proficiency,
      proposedPct: Math.round(proposedPct),
      freePct: Math.round(freePct),
      score: Math.round(score),
      reasons,
    });
  }

  return out.sort((a, b) => b.score - a.score || a.resourceName.localeCompare(b.resourceName)).slice(0, limit);
}

/* ── portfolio summary ─────────────────────────────────────────────────────────────── */

export interface QuarterSummary {
  quarterKey: string;
  headcount: number;
  capacityFte: number;
  committedFte: number;
  aboveTableFte: number;
  belowTableFte: number;
  benchFte: number;
  avgUtil: number; // committed / capacity
  demandFte: number;
  unstaffedFte: number; // sum of positive demand gaps
  overAllocated: number; // people > capacity
  underTarget: number; // people below their target
}

export function quarterSummary(
  quarter: QuarterLike,
  resources: EnginePerson[],
  projects: EngineProject[],
  allocations: EngineAllocation[],
  demand?: EngineDemand[],
): QuarterSummary {
  const range = rangeOf(quarter);
  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const mine = allocationsByResource(allocations);
  let capacity = 0,
    committed = 0,
    above = 0,
    below = 0,
    bench = 0,
    over = 0,
    under = 0;
  for (const r of resources) {
    const l = personRangeLoad(r, range, mine.get(r.id) ?? [], projectMap);
    capacity += l.capacity;
    committed += l.total;
    above += l.above;
    below += l.below;
    bench += Math.max(0, l.capacity - l.total);
    if (l.total > l.capacity) over++;
    if (l.total < l.target) under++;
  }
  const lines = demandLines(projects, resources, allocations, [quarter], demand);
  const demandFte = lines.reduce((s, l) => s + l.demandFte, 0);
  const unstaffed = lines.reduce((s, l) => s + Math.max(0, l.gapFte), 0);
  return {
    quarterKey: range.key,
    headcount: resources.length,
    capacityFte: round2(capacity / 100),
    committedFte: round2(committed / 100),
    aboveTableFte: round2(above / 100),
    belowTableFte: round2(below / 100),
    benchFte: round2(bench / 100),
    avgUtil: capacity ? Math.round((committed / capacity) * 100) : 0,
    demandFte: round2(demandFte),
    unstaffedFte: round2(unstaffed),
    overAllocated: over,
    underTarget: under,
  };
}

/* ── helpers ───────────────────────────────────────────────────────────────────────── */

/** v1.1 helper: replaces (or with fte 0 removes) one quarter × craft entry in a project's embedded demand. */
export function upsertDemand<T extends EngineDemand>(list: T[] | undefined, next: T): T[] {
  const base = [...(list ?? [])].filter((d) => !(d.quarterKey === next.quarterKey && d.craftId === next.craftId));
  if (next.fte > 0) base.push(next);
  return base.sort((a, b) => a.quarterKey.localeCompare(b.quarterKey) || a.craftId.localeCompare(b.craftId));
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
