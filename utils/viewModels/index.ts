/**
 * utils/viewModels — pure functions (no React) that turn a WorkspaceSnapshot into what
 * pages render. Signatures are the frozen contract in BACKLOG §4.3.
 *
 * ┌──────────────────────────────────────────────────────────────────────────────────┐
 * │ WP-0 STUB. Package C replaces the bodies (RP-03, ORG-06, AL-*, DM-*, RP-*)       │
 * │ without changing exports. The stubs are honest: they compute plausible numbers   │
 * │ from the snapshot by delegating to the v1.1 `utils/craftEngine.ts`, but they are │
 * │ not the reviewed 2.0 rules (e.g. thresholds per org, same-number guarantee,      │
 * │ craft catalogue from the snapshot). B may render them; nobody should test        │
 * │ business rules against them.                                                     │
 * └──────────────────────────────────────────────────────────────────────────────────┘
 *
 * Pure: no React, DOM, Node or Netlify imports.
 */
import type * as D from '../../shared/contracts/dto';
import type { AllocationOp } from '../../shared/contracts/api';
import { bandFor, relativeLoad, type UtilBand, type UtilisationThresholds } from '../../shared/utilisation';
import { personQuarterLoad, DEFAULT_SECONDARY_MAX_PCT, type PersonQuarterLoad } from '../craftEngine';
import { overlapFraction, parseDay, type Quarter } from '../quarters';
import type { Resource } from '../../types';
import { toLegacy, toLegacyQuarters, countedAllocations, type LegacyModel } from './legacy';
import { bookingAllocations, effectiveCraft, effectiveWindow, setBookingRange } from './allocationOps';
import type { QuarterView, TimeBasis } from './types';

export type { QuarterView, TimeBasis } from './types';

/* ── contract types (BACKLOG §4.3) ─────────────────────────────────────────────────── */

export interface PersonRow {
  person: D.PersonDTO;
  chapter: D.ChapterDTO | null;
  team: D.TeamDTO | null;
  primary: D.CraftDTO | null;
  secondary: Array<{ craft: D.CraftDTO; proficiency: D.Proficiency; maxPct: number }>;
  quarters: Array<{
    key: D.QuarterKey;
    loadPct: number;
    relativePct: number;
    band: UtilBand;
    above: number;
    below: number;
    undeclared: number;
    free: number;
  }>;
}
export interface GridCell {
  quarterKey: D.QuarterKey;
  pct: number;
  band: UtilBand | null;
  partial: boolean;
  state: D.AllocationState | 'mixed' | null;
  source: D.AllocationSource | 'mixed' | null;
  locked: boolean;
  allocationIds: D.ID[];
}
export interface GridRow {
  key: string;
  kind: 'person' | 'project' | 'booking';
  depth: 0 | 1;
  personId: D.ID | null;
  projectId: D.ID | null;
  craftId: D.ID | null;
  label: string;
  cells: GridCell[];
}
export interface GridModel {
  quarters: QuarterView[];
  groups: Array<{ id: string; label: string; totals: GridCell[]; rows: GridRow[] }>;
}
export interface OutlookPoint {
  quarterKey: D.QuarterKey;
  supplyFte: number;
  aboveFte: number;
  belowFte: number;
  undeclaredFte: number;
  freeFte: number;
  demandFte: number;
  utilisationPct: number;
  band: UtilBand;
}
export interface OutlookModel {
  squad: OutlookPoint[];
  rows: Array<{ id: string; label: string; points: OutlookPoint[] }>;
}
export interface CatalogueEntry {
  craft: D.CraftDTO;
  freeAboveFte: number;
  reachBelowFte: number;
  people: Array<{
    person: D.PersonDTO;
    via: 'above' | 'below';
    proficiency: D.Proficiency | null;
    freePct: number;
    offer: D.MarketplaceOfferDTO | null;
  }>;
}
export interface HomeModel {
  kpis: {
    utilisationPct: number;
    band: UtilBand;
    nextQuarterPct: number;
    unstaffedFte: number;
    overCount: number;
    availableCount: number;
  };
  outlook: OutlookPoint[];
  over: PersonRow[];
  available: PersonRow[];
  projectsWithoutDemand: D.ProjectDTO[];
  pendingApprovals: number;
  myPendingProposals: number;
}

/* ── helpers ───────────────────────────────────────────────────────────────────────── */

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const byId = <T extends { id: D.ID }>(list: T[]) => new Map(list.map((x) => [x.id, x]));

function todayIso(): D.ISODate {
  // TODO(C): use `today()` from utils/clock.ts (RP-03#AC3).
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Overlap-weighted % of one allocation in one quarter (same rule as craftEngine.allocationPctInQuarter). */
function pctInQuarter(a: D.AllocationDTO, project: D.ProjectDTO | undefined, q: Quarter): number {
  if (a.percentage <= 0) return 0;
  const w = effectiveWindow(a, project);
  return a.percentage * overlapFraction(parseDay(w.start, 'start'), parseDay(w.end, 'end'), q);
}

function loadsFor(m: LegacyModel, quarters: Quarter[]): Map<D.ID, PersonQuarterLoad[]> {
  const out = new Map<D.ID, PersonQuarterLoad[]>();
  for (const r of m.resources)
    out.set(
      r.id,
      quarters.map((q) => personQuarterLoad(r, q, m.allocations, m.projects)),
    );
  return out;
}

function demandFteIn(
  s: D.WorkspaceSnapshot,
  quarterKey: D.QuarterKey,
  filter?: (l: D.DemandLineDTO) => boolean,
): number {
  return s.demand.filter((l) => l.quarterKey === quarterKey && (!filter || filter(l))).reduce((x, l) => x + l.fte, 0);
}

function outlookPoint(
  people: Resource[],
  loads: Map<D.ID, PersonQuarterLoad[]>,
  qi: number,
  quarterKey: D.QuarterKey,
  demandFte: number,
  t: UtilisationThresholds,
): OutlookPoint {
  let supply = 0,
    above = 0,
    below = 0,
    other = 0,
    free = 0,
    load = 0,
    target = 0;
  for (const r of people) {
    const l = loads.get(r.id)?.[qi];
    if (!l) continue;
    supply += l.capacity;
    above += l.aboveTable;
    below += l.belowTable;
    other += l.other;
    free += l.bench;
    load += l.total;
    target += r.targetUtil && r.targetUtil > 0 ? r.targetUtil : 100;
  }
  const utilisationPct = target > 0 ? Math.round((100 * load) / target) : 0;
  return {
    quarterKey,
    supplyFte: r2(supply / 100),
    aboveFte: r2(above / 100),
    belowFte: r2(below / 100),
    undeclaredFte: r2(other / 100),
    freeFte: r2(free / 100),
    demandFte: r2(demandFte),
    utilisationPct,
    band: bandFor(utilisationPct, t),
  };
}

function basisIndex(basis: TimeBasis, quarters: QuarterView[]): number {
  if (basis.kind === 'quarter')
    return Math.max(
      0,
      quarters.findIndex((q) => q.key === basis.key),
    );
  return 0;
}

/* ── contract functions ────────────────────────────────────────────────────────────── */

/**
 * STUB: load % for one person (Σ overlap-weighted allocation %), not relative to target.
 * 'today' sums bookings active today; 'quarter' is that quarter; 'window' averages the quarters.
 */
export function utilisationFor(
  s: D.WorkspaceSnapshot,
  personId: D.ID,
  basis: TimeBasis,
  quarters: QuarterView[],
): number {
  const m = toLegacy(s);
  const r = m.resources.find((x) => x.id === personId);
  if (!r) return 0;
  if (basis.kind === 'today') {
    const today = todayIso();
    const projects = byId(s.projects);
    return r1(
      countedAllocations(s)
        .filter((a) => a.resourceId === personId)
        .filter((a) => {
          const w = effectiveWindow(a, projects.get(a.projectId));
          return (w.start === null || w.start <= today) && (w.end === null || w.end >= today);
        })
        .reduce((x, a) => x + a.percentage, 0),
    );
  }
  const lq = toLegacyQuarters(quarters);
  if (basis.kind === 'quarter') {
    const q = lq.find((x) => x.key === basis.key);
    return q ? personQuarterLoad(r, q, m.allocations, m.projects).total : 0;
  }
  if (lq.length === 0) return 0;
  return r1(lq.reduce((x, q) => x + personQuarterLoad(r, q, m.allocations, m.projects).total, 0) / lq.length);
}

export function buildPeopleRows(
  s: D.WorkspaceSnapshot,
  quarters: QuarterView[],
  t: UtilisationThresholds,
): PersonRow[] {
  const m = toLegacy(s);
  const lq = toLegacyQuarters(quarters);
  const loads = loadsFor(m, lq);
  const chapters = byId(s.chapters);
  const teams = byId(s.teams);
  const crafts = byId(s.crafts);
  return s.people.map((p) => ({
    person: p,
    chapter: (p.chapterId && chapters.get(p.chapterId)) || null,
    team: (p.teamId && teams.get(p.teamId)) || null,
    primary: (p.primaryCraft && crafts.get(p.primaryCraft)) || null,
    secondary: p.secondaryCrafts.flatMap((c) => {
      const craft = crafts.get(c.craftId);
      return craft ? [{ craft, proficiency: c.proficiency, maxPct: c.maxPct }] : [];
    }),
    quarters: (loads.get(p.id) ?? []).map((l) => {
      const relativePct = relativeLoad(l.total, p.targetUtil);
      return {
        key: l.quarterKey,
        loadPct: l.total,
        relativePct: r1(relativePct),
        band: bandFor(relativePct, t),
        above: l.aboveTable,
        below: l.belowTable,
        undeclared: l.other,
        free: l.bench,
      };
    }),
  }));
}

export function buildAllocationGrid(
  s: D.WorkspaceSnapshot,
  quarters: QuarterView[],
  o: {
    groupBy: 'team' | 'chapter' | 'tribe' | 'none';
    pivot: 'person' | 'project';
    includeTentative: boolean;
    thresholds: UtilisationThresholds;
  },
): GridModel {
  const lq = toLegacyQuarters(quarters);
  const people = byId(s.people);
  const projects = byId(s.projects);
  const locked = s.org.planning.planviewOwnership === 'locked';
  const counted = countedAllocations(s, o.includeTentative);

  const cellFor = (allocs: D.AllocationDTO[], qi: number): GridCell => {
    const q = lq[qi];
    let pct = 0;
    let partial = false;
    const ids: D.ID[] = [];
    const states = new Set<D.AllocationState>();
    const sources = new Set<D.AllocationSource>();
    for (const a of allocs) {
      const w = effectiveWindow(a, projects.get(a.projectId));
      const frac = overlapFraction(parseDay(w.start, 'start'), parseDay(w.end, 'end'), q);
      if (frac <= 0 || a.percentage <= 0) continue;
      pct += a.percentage * frac;
      if (frac < 1) partial = true;
      ids.push(a.id);
      states.add(a.state);
      sources.add(a.source);
    }
    const one = <T>(set: Set<T>): T | 'mixed' | null =>
      set.size === 0 ? null : set.size === 1 ? [...set][0] : 'mixed';
    return {
      quarterKey: quarters[qi].key,
      pct: r1(pct),
      band: null,
      partial,
      state: one(states),
      source: one(sources),
      locked: locked && sources.has('planview'),
      allocationIds: ids,
    };
  };

  const withBand = (c: GridCell, target: number): GridCell => ({
    ...c,
    band: bandFor(relativeLoad(c.pct, target), o.thresholds),
  });

  const groupKey = (p: D.PersonDTO | undefined, pr: D.ProjectDTO | undefined): { id: string; label: string } => {
    if (o.groupBy === 'none') return { id: 'all', label: 'Everyone' };
    if (o.groupBy === 'tribe') {
      const tribeId = o.pivot === 'project' ? pr?.tribeId : p?.homeTribeId;
      const t = s.tribes.find((x) => x.id === tribeId);
      return t ? { id: t.id, label: t.name } : { id: 'none', label: 'No tribe' };
    }
    if (o.groupBy === 'team') {
      const t = s.teams.find((x) => x.id === p?.teamId);
      return t ? { id: t.id, label: t.name } : { id: 'none', label: 'No team' };
    }
    const c = s.chapters.find((x) => x.id === p?.chapterId);
    return c ? { id: c.id, label: c.name } : { id: 'none', label: 'No chapter' };
  };

  const groups = new Map<
    string,
    { id: string; label: string; totals: GridCell[]; rows: GridRow[]; load: number[]; target: number }
  >();
  const ensure = (g: { id: string; label: string }) => {
    let e = groups.get(g.id);
    if (!e) {
      e = { ...g, totals: [], rows: [], load: quarters.map(() => 0), target: 0 };
      groups.set(g.id, e);
    }
    return e;
  };

  if (o.pivot === 'person') {
    for (const p of s.people) {
      const mine = counted.filter((a) => a.resourceId === p.id);
      const g = ensure(groupKey(p, undefined));
      const cells = quarters.map((_, qi) => withBand(cellFor(mine, qi), p.targetUtil));
      g.rows.push({
        key: `person:${p.id}`,
        kind: 'person',
        depth: 0,
        personId: p.id,
        projectId: null,
        craftId: null,
        label: p.name,
        cells,
      });
      cells.forEach((c, qi) => (g.load[qi] += c.pct));
      g.target += p.targetUtil > 0 ? p.targetUtil : 100;
      const bookings = new Map<string, D.AllocationDTO[]>();
      for (const a of mine) {
        const k = `${a.projectId}|${effectiveCraft(a, p) ?? ''}`;
        bookings.set(k, [...(bookings.get(k) ?? []), a]);
      }
      for (const [k, allocs] of bookings) {
        const [projectId, craftId] = k.split('|');
        g.rows.push({
          key: `booking:${p.id}:${k}`,
          kind: 'booking',
          depth: 1,
          personId: p.id,
          projectId,
          craftId: craftId || null,
          label: projects.get(projectId)?.name ?? projectId,
          cells: quarters.map((_, qi) => cellFor(allocs, qi)),
        });
      }
    }
  } else {
    for (const pr of s.projects) {
      const mine = counted.filter((a) => a.projectId === pr.id);
      const g = ensure(groupKey(undefined, pr));
      const cells = quarters.map((_, qi) => cellFor(mine, qi));
      g.rows.push({
        key: `project:${pr.id}`,
        kind: 'project',
        depth: 0,
        personId: null,
        projectId: pr.id,
        craftId: null,
        label: pr.name,
        cells,
      });
      const bookings = new Map<string, D.AllocationDTO[]>();
      for (const a of mine) {
        const k = `${a.resourceId}|${effectiveCraft(a, people.get(a.resourceId)) ?? ''}`;
        bookings.set(k, [...(bookings.get(k) ?? []), a]);
      }
      for (const [k, allocs] of bookings) {
        const [personId, craftId] = k.split('|');
        const person = people.get(personId);
        g.rows.push({
          key: `booking:${pr.id}:${k}`,
          kind: 'booking',
          depth: 1,
          personId,
          projectId: pr.id,
          craftId: craftId || null,
          label: person?.name ?? personId,
          cells: quarters.map((_, qi) => withBand(cellFor(allocs, qi), person?.targetUtil ?? 100)),
        });
      }
    }
  }

  return {
    quarters,
    groups: [...groups.values()].map((g) => ({
      id: g.id,
      label: g.label,
      rows: g.rows,
      totals: quarters.map((q, qi) => {
        const rowCells = g.rows.filter((r) => r.depth === 0).map((r) => r.cells[qi]);
        // Person pivot: group utilisation = Σload ÷ Σtarget (A-4). Project pivot: Σ booked % (100 = 1 FTE).
        const util = o.pivot === 'person' && g.target > 0 ? (100 * g.load[qi]) / g.target : null;
        const pct = r1(util ?? rowCells.reduce((x, c) => x + c.pct, 0));
        return {
          quarterKey: q.key,
          pct,
          band: util === null ? null : bandFor(util, o.thresholds),
          partial: rowCells.some((c) => c.partial),
          state: null,
          source: null,
          locked: false,
          allocationIds: rowCells.flatMap((c) => c.allocationIds),
        };
      }),
    })),
  };
}

/** STUB (functional): splits/updates/creates so that only `quarterKey` changes, clipped to the project window. */
export function setQuarterCell(
  s: D.WorkspaceSnapshot,
  quarters: QuarterView[],
  a: { resourceId: D.ID; projectId: D.ID; craftId: D.ID | null; quarterKey: D.QuarterKey; pct: number },
): AllocationOp[] {
  const q = quarters.find((x) => x.key === a.quarterKey);
  if (!q) return [];
  return setBookingRange(s, {
    resourceId: a.resourceId,
    projectId: a.projectId,
    craftId: a.craftId,
    from: q.start,
    to: q.end,
    pct: a.pct,
  });
}

/** STUB (functional): applies the booking's nominal % in `fromQuarterKey` to every later quarter of the window. */
export function copyForward(
  s: D.WorkspaceSnapshot,
  quarters: QuarterView[],
  a: { resourceId: D.ID; projectId: D.ID; craftId: D.ID | null; fromQuarterKey: D.QuarterKey },
): AllocationOp[] {
  const i = quarters.findIndex((x) => x.key === a.fromQuarterKey);
  const later = i >= 0 ? quarters.slice(i + 1) : [];
  if (later.length === 0) return [];
  const from = quarters[i];
  const project = s.projects.find((p) => p.id === a.projectId);
  const pct = bookingAllocations(s, a)
    .filter((x) => {
      const w = effectiveWindow(x, project);
      return (w.start === null || w.start <= from.end) && (w.end === null || w.end >= from.start);
    })
    .reduce((x, al) => x + al.percentage, 0);
  return setBookingRange(s, { ...a, from: later[0].start, to: later[later.length - 1].end, pct });
}

export function buildCapacityOutlook(
  s: D.WorkspaceSnapshot,
  quarters: QuarterView[],
  o: {
    pivot: 'craft' | 'chapter' | 'tribe' | 'person';
    craftId?: D.ID;
    chapterId?: D.ID;
    tribeId?: D.ID;
    thresholds: UtilisationThresholds;
  },
): OutlookModel {
  const m = toLegacy(s);
  const lq = toLegacyQuarters(quarters);
  const loads = loadsFor(m, lq);
  const projects = byId(s.projects);
  const personIn = (p: D.PersonDTO) =>
    (!o.craftId || p.primaryCraft === o.craftId) &&
    (!o.chapterId || p.chapterId === o.chapterId) &&
    (!o.tribeId || p.homeTribeId === o.tribeId);
  const lineIn = (l: D.DemandLineDTO) =>
    (!o.craftId || l.craftId === o.craftId) && (!o.tribeId || projects.get(l.projectId)?.tribeId === o.tribeId);
  const resources = (ids: Set<D.ID>) => m.resources.filter((r) => ids.has(r.id));
  const points = (ids: Set<D.ID>, demand: (l: D.DemandLineDTO) => boolean) =>
    quarters.map((q, qi) =>
      outlookPoint(resources(ids), loads, qi, q.key, demandFteIn(s, q.key, demand), o.thresholds),
    );

  const scoped = s.people.filter(personIn);
  const squad = points(new Set(scoped.map((p) => p.id)), lineIn);

  let rows: OutlookModel['rows'];
  if (o.pivot === 'person') {
    rows = scoped.map((p) => ({ id: p.id, label: p.name, points: points(new Set([p.id]), () => false) }));
  } else if (o.pivot === 'craft') {
    rows = s.crafts
      .filter((c) => !c.archived && (!o.craftId || c.id === o.craftId))
      .map((c) => ({
        id: c.id,
        label: c.name,
        points: points(
          new Set(scoped.filter((p) => p.primaryCraft === c.id).map((p) => p.id)),
          (l) => lineIn(l) && l.craftId === c.id,
        ),
      }));
  } else if (o.pivot === 'chapter') {
    rows = s.chapters
      .filter((c) => !c.archived && (!o.chapterId || c.id === o.chapterId))
      .map((c) => ({
        id: c.id,
        label: c.name,
        points: points(
          new Set(scoped.filter((p) => p.chapterId === c.id).map((p) => p.id)),
          (l) => lineIn(l) && (c.craftId === null || l.craftId === c.craftId),
        ),
      }));
  } else {
    rows = s.tribes
      .filter((t) => !t.archived && (!o.tribeId || t.id === o.tribeId))
      .map((t) => ({
        id: t.id,
        label: t.name,
        points: points(
          new Set(scoped.filter((p) => p.homeTribeId === t.id).map((p) => p.id)),
          (l) => lineIn(l) && projects.get(l.projectId)?.tribeId === t.id,
        ),
      }));
  }
  return { squad, rows };
}

export function buildDemandGrid(
  s: D.WorkspaceSnapshot,
  quarters: QuarterView[],
): Array<{
  project: D.ProjectDTO;
  tribe: D.TribeDTO | null;
  cells: Array<{
    quarterKey: D.QuarterKey;
    lines: D.DemandLineDTO[];
    demandFte: number;
    staffedFte: number;
    proposedFte: number;
    gapFte: number;
  }>;
}> {
  const lq = toLegacyQuarters(quarters);
  const tribes = byId(s.tribes);
  return s.projects.map((p) => ({
    project: p,
    tribe: (p.tribeId && tribes.get(p.tribeId)) || null,
    cells: quarters.map((q, qi) => {
      const lines = s.demand.filter((l) => l.projectId === p.id && l.quarterKey === q.key);
      const fteOf = (state: D.AllocationState) =>
        s.allocations
          .filter((a) => a.projectId === p.id && a.state === state)
          .reduce((x, a) => x + pctInQuarter(a, p, lq[qi]) / 100, 0);
      const demandFte = lines.reduce((x, l) => x + l.fte, 0);
      const staffedFte = fteOf('confirmed');
      return {
        quarterKey: q.key,
        lines,
        demandFte: r2(demandFte),
        staffedFte: r2(staffedFte),
        proposedFte: r2(fteOf('tentative')),
        gapFte: r2(demandFte - staffedFte),
      };
    }),
  }));
}

export function buildCatalogue(
  s: D.WorkspaceSnapshot,
  quarters: QuarterView[],
  quarterKey: D.QuarterKey,
): CatalogueEntry[] {
  const qv = quarters.find((q) => q.key === quarterKey);
  if (!qv) return [];
  const m = toLegacy(s);
  const [q] = toLegacyQuarters([qv]);
  const loads = new Map(m.resources.map((r) => [r.id, personQuarterLoad(r, q, m.allocations, m.projects)]));
  return s.crafts
    .filter((c) => !c.archived)
    .map((craft) => {
      const people: CatalogueEntry['people'] = [];
      for (const p of s.people) {
        const l = loads.get(p.id);
        if (!l) continue;
        const free = Math.max(0, Math.min(l.capacity, p.targetUtil) - l.total);
        const offer = s.offers.find((x) => x.personId === p.id && x.quarterKey === quarterKey) ?? null;
        if (p.primaryCraft === craft.id) {
          people.push({ person: p, via: 'above', proficiency: null, freePct: r1(free), offer });
          continue;
        }
        const sec = p.secondaryCrafts.find((x) => x.craftId === craft.id);
        if (sec) {
          const onCraft = l.byProject.filter((b) => b.craftId === craft.id).reduce((x, b) => x + b.pct, 0);
          const cap = Math.max(0, (sec.maxPct ?? DEFAULT_SECONDARY_MAX_PCT) - onCraft);
          people.push({
            person: p,
            via: 'below',
            proficiency: sec.proficiency,
            freePct: r1(Math.min(free, cap)),
            offer,
          });
        }
      }
      people.sort((a, b) => (a.via === b.via ? b.freePct - a.freePct : a.via === 'above' ? -1 : 1));
      return {
        craft,
        freeAboveFte: r2(people.filter((x) => x.via === 'above').reduce((x, e) => x + e.freePct, 0) / 100),
        reachBelowFte: r2(people.filter((x) => x.via === 'below').reduce((x, e) => x + e.freePct, 0) / 100),
        people,
      };
    });
}

export function buildHome(
  s: D.WorkspaceSnapshot,
  quarters: QuarterView[],
  basis: TimeBasis,
  t: UtilisationThresholds,
  me: D.MeWorkspace | null,
): HomeModel {
  const qi = basisIndex(basis, quarters);
  const outlook = buildCapacityOutlook(s, quarters, { pivot: 'person', thresholds: t }).squad;
  const rows = buildPeopleRows(s, quarters, t);
  const at = (r: PersonRow) => r.quarters[qi];
  const over = rows.filter((r) => at(r)?.band === 'over').sort((a, b) => at(b).relativePct - at(a).relativePct);
  const available = rows.filter((r) => at(r)?.band === 'bench').sort((a, b) => at(a).relativePct - at(b).relativePct);
  const demand = buildDemandGrid(s, quarters);
  const unstaffed = demand.reduce((x, d) => x + Math.max(0, d.cells[qi]?.gapFte ?? 0), 0);
  const withDemand = new Set(s.demand.map((l) => l.projectId));
  const current = outlook[qi];
  return {
    kpis: {
      utilisationPct: current?.utilisationPct ?? 0,
      band: current?.band ?? bandFor(0, t),
      nextQuarterPct: outlook[qi + 1]?.utilisationPct ?? 0,
      unstaffedFte: r2(unstaffed),
      overCount: over.length,
      availableCount: available.length,
    },
    outlook,
    over,
    available,
    projectsWithoutDemand: s.projects.filter((p) => p.stage === 'Initiated' && !withDemand.has(p.id)),
    pendingApprovals: s.craftRequests.filter((r) => r.status === 'pending').length,
    myPendingProposals: me?.linkedPersonId
      ? s.allocations.filter((a) => a.state === 'tentative' && a.resourceId === me.linkedPersonId).length
      : 0,
  };
}

export function buildTribeView(
  s: D.WorkspaceSnapshot,
  quarters: QuarterView[],
  tribeId: D.ID,
): {
  tribe: D.TribeDTO;
  projects: D.ProjectDTO[];
  demandFte: number[];
  staffedFte: number[];
  gapFte: number[];
  people: Array<{ person: D.PersonDTO; pctByQuarter: number[] }>;
} {
  const tribe = s.tribes.find((t) => t.id === tribeId);
  if (!tribe) throw new Error(`Unknown tribe: ${tribeId}`);
  const projects = s.projects.filter((p) => p.tribeId === tribeId);
  const ids = new Set(projects.map((p) => p.id));
  const grid = buildDemandGrid(s, quarters).filter((d) => ids.has(d.project.id));
  const sum = (f: (c: (typeof grid)[number]['cells'][number]) => number) =>
    quarters.map((_, qi) => r2(grid.reduce((x, d) => x + f(d.cells[qi]), 0)));
  const lq = toLegacyQuarters(quarters);
  const m = toLegacy(s);
  const tribeAllocs = m.allocations.filter((a) => ids.has(a.projectId));
  const people = s.people
    .map((person) => {
      const r = m.resources.find((x) => x.id === person.id);
      const pctByQuarter = r ? lq.map((q) => personQuarterLoad(r, q, tribeAllocs, m.projects).total) : [];
      return { person, pctByQuarter };
    })
    .filter((x) => x.pctByQuarter.some((v) => v > 0));
  return {
    tribe,
    projects,
    demandFte: sum((c) => c.demandFte),
    staffedFte: sum((c) => c.staffedFte),
    gapFte: sum((c) => c.gapFte),
    people,
  };
}

export function buildSearchIndex(
  s: D.WorkspaceSnapshot,
): (q: string) => Array<{ kind: 'person' | 'project' | 'tribe' | 'craft'; id: D.ID; label: string; sublabel: string }> {
  const tribes = byId(s.tribes);
  const entries = [
    ...s.people.map((p) => ({ kind: 'person' as const, id: p.id, label: p.name, sublabel: p.role })),
    ...s.projects.map((p) => ({
      kind: 'project' as const,
      id: p.id,
      label: p.name,
      sublabel: [p.tribeId ? tribes.get(p.tribeId)?.name : null, p.status].filter(Boolean).join(' · '),
    })),
    ...s.tribes
      .filter((t) => !t.archived)
      .map((t) => ({ kind: 'tribe' as const, id: t.id, label: t.name, sublabel: 'Tribe' })),
    ...s.crafts
      .filter((c) => !c.archived)
      .map((c) => ({ kind: 'craft' as const, id: c.id, label: c.name, sublabel: c.short })),
  ];
  return (q: string) => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    return entries
      .filter((e) => e.label.toLowerCase().includes(needle) || e.sublabel.toLowerCase().includes(needle))
      .sort(
        (a, b) => Number(!a.label.toLowerCase().startsWith(needle)) - Number(!b.label.toLowerCase().startsWith(needle)),
      )
      .slice(0, 20);
  };
}
