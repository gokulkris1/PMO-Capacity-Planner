/**
 * utils/viewModels — pure functions (no React) that turn a WorkspaceSnapshot into what pages
 * render. The functions and interfaces down to `buildSearchIndex` are the frozen contract in
 * BACKLOG §4.3; everything exported after the "additions" marker is additive (see
 * docs/release/handoff-C.md §3).
 *
 * Numbers:
 *  - Load % is the quarter-averaged sum of a person's counted bookings (declined never counts;
 *    tentative counts). Utilisation (`relativePct`, `utilisationFor`, bands) is load as a % of the
 *    person's target (A-4); groups use Σload ÷ Σtarget.
 *  - FTE = % ÷ 100. Demand-side "staffed" = confirmed bookings, "proposed" = tentative bookings,
 *    "gap"/"open" = demand − staffed − proposed.
 *  - Every per-person number comes from `core.loadIndex` (same-number guarantee, RP-03#AC3).
 *
 * Pure: no React, DOM, Node or Netlify imports.
 */
import type * as D from '../../shared/contracts/dto';
import type { AllocationOp } from '../../shared/contracts/api';
import { bandFor, type UtilBand, type UtilisationThresholds } from '../../shared/utilisation';
import { today } from '../clock';
import { craftRelation, headroomOf, type RangeLoad } from '../craftEngine';
import { copyForwardOps, effectiveCraft, quarterCellOps } from './allocationOps';
import {
  basisIndex,
  byId,
  countedAllocations,
  fteIn,
  groupBy,
  groupUtilisation,
  loadIndex,
  rangeOfView,
  rawLoadFor,
  relativeOf,
  round1,
  round2,
  toPersonQuarter,
  type LoadIndex,
} from './core';
import { allocationShare } from '../craftEngine';
import type { QuarterView, TimeBasis } from './types';
import { buildSearchIndex as buildSearchIndexImpl } from '../search';
import { buildDemandGrid, projectsWithoutDemand } from './demand';

export { buildDemandGrid, projectsWithoutDemand };

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

/* ── shared helpers ────────────────────────────────────────────────────────────────── */

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);

function personRowsFrom(
  s: D.WorkspaceSnapshot,
  idx: LoadIndex,
  t: UtilisationThresholds,
): PersonRow[] {
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
    quarters: (idx.raw.get(p.id) ?? []).map((l, i) => toPersonQuarter(idx.quarters[i].key, l, t)),
  }));
}

/* ── contract functions ────────────────────────────────────────────────────────────── */

/**
 * Utilisation of one person on a basis: load as a % of their target, rounded to one decimal
 * (identical to `PersonRow.quarters[i].relativePct` and the Outlook person pivot's
 * `utilisationPct`). 'today' uses `utils/clock.today()`; 'window' averages the window's quarters.
 * Unknown people and quarters outside the window return 0.
 */
export function utilisationFor(
  s: D.WorkspaceSnapshot,
  personId: D.ID,
  basis: TimeBasis,
  quarters: QuarterView[],
): number {
  const person = s.people.find((p) => p.id === personId);
  if (!person) return 0;
  const idx = loadIndex({ ...s, people: [person] }, quarters);
  const load = rawLoadFor(s, idx, personId, basis, today());
  return load === null ? 0 : round1(relativeOf(load, targetFor(person)));
}

function targetFor(p: D.PersonDTO): number {
  return p.targetUtil > 0 ? p.targetUtil : 100;
}

export function buildPeopleRows(s: D.WorkspaceSnapshot, quarters: QuarterView[], t: UtilisationThresholds): PersonRow[] {
  return personRowsFrom(s, loadIndex(s, quarters), t);
}

type GroupBy = 'team' | 'chapter' | 'tribe' | 'none';

function groupKeyOf(
  s: D.WorkspaceSnapshot,
  groupByKind: GroupBy,
  pivot: 'person' | 'project',
  person: D.PersonDTO | undefined,
  project: D.ProjectDTO | undefined,
): { id: string; label: string } {
  if (groupByKind === 'none') return { id: 'all', label: pivot === 'person' ? 'Everyone' : 'All projects' };
  if (groupByKind === 'tribe') {
    const tribeId = pivot === 'project' ? project?.tribeId : person?.homeTribeId;
    const t = s.tribes.find((x) => x.id === tribeId);
    return t ? { id: t.id, label: t.name } : { id: 'none', label: 'No tribe' };
  }
  if (groupByKind === 'team') {
    const t = s.teams.find((x) => x.id === person?.teamId);
    return t ? { id: t.id, label: t.name } : { id: 'none', label: 'No team' };
  }
  const c = s.chapters.find((x) => x.id === person?.chapterId);
  return c ? { id: c.id, label: c.name } : { id: 'none', label: 'No chapter' };
}

function sortGroups<T extends { id: string; label: string }>(groups: T[]): T[] {
  return groups.sort((a, b) => Number(a.id === 'none') - Number(b.id === 'none') || a.label.localeCompare(b.label));
}

function one<T>(set: Set<T>): T | 'mixed' | null {
  return set.size === 0 ? null : set.size === 1 ? [...set][0] : 'mixed';
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
  const people = byId(s.people);
  const projects = byId(s.projects);
  const lockPlanview = s.org.planning.planviewOwnership === 'locked';
  const counted = countedAllocations(s, o.includeTentative);
  const ranges = quarters.map(rangeOfView);

  const cellFor = (allocs: D.AllocationDTO[], qi: number): GridCell => {
    let pct = 0;
    let partial = false;
    const ids: D.ID[] = [];
    const states = new Set<D.AllocationState>();
    const sources = new Set<D.AllocationSource>();
    for (const a of allocs) {
      if (!(a.percentage > 0)) continue;
      const share = allocationShare(a, ranges[qi], projects.get(a.projectId));
      if (share <= 0) continue;
      pct += a.percentage * share;
      if (share < 1) partial = true;
      ids.push(a.id);
      states.add(a.state);
      sources.add(a.source);
    }
    return {
      quarterKey: quarters[qi].key,
      pct: round1(pct),
      band: null,
      partial,
      state: one(states),
      source: one(sources),
      locked: lockPlanview && sources.has('planview'),
      allocationIds: ids,
    };
  };

  interface Acc {
    id: string;
    label: string;
    rows: GridRow[];
    loads: RangeLoad[][];
  }
  const groups = new Map<string, Acc>();
  const ensure = (g: { id: string; label: string }): Acc => {
    let e = groups.get(g.id);
    if (!e) {
      e = { ...g, rows: [], loads: [] };
      groups.set(g.id, e);
    }
    return e;
  };

  if (o.pivot === 'person') {
    const idx = loadIndex(s, quarters, { includeTentative: o.includeTentative });
    const mine = groupBy(counted, (a) => a.resourceId);
    for (const p of [...s.people].sort(byName)) {
      const allocs = mine.get(p.id) ?? [];
      const loads = idx.raw.get(p.id) ?? [];
      const g = ensure(groupKeyOf(s, o.groupBy, 'person', p, undefined));
      g.loads.push(loads);
      g.rows.push({
        key: `person:${p.id}`,
        kind: 'person',
        depth: 0,
        personId: p.id,
        projectId: null,
        craftId: null,
        label: p.name,
        cells: quarters.map((_, qi) => {
          const c = cellFor(allocs, qi);
          const pq = toPersonQuarter(quarters[qi].key, loads[qi], o.thresholds);
          // The person total is the load index value (same number as People and Outlook).
          return { ...c, pct: pq.loadPct, band: pq.band };
        }),
      });
      const bookings = groupBy(allocs, (a) => `${a.projectId}|${effectiveCraft(a, p) ?? ''}`);
      const subRows = [...bookings.entries()].map(([k, list]) => {
        const [projectId, craftId] = k.split('|');
        return {
          key: `booking:${p.id}:${k}`,
          kind: 'booking' as const,
          depth: 1 as const,
          personId: p.id,
          projectId,
          craftId: craftId || null,
          label: projects.get(projectId)?.name ?? projectId,
          cells: quarters.map((_, qi) => cellFor(list, qi)),
        };
      });
      g.rows.push(...subRows.sort((a, b) => a.label.localeCompare(b.label)));
    }
  } else {
    const onProject = groupBy(counted, (a) => a.projectId);
    for (const pr of [...s.projects].sort(byName)) {
      const allocs = onProject.get(pr.id) ?? [];
      const g = ensure(groupKeyOf(s, o.groupBy, 'project', undefined, pr));
      g.rows.push({
        key: `project:${pr.id}`,
        kind: 'project',
        depth: 0,
        personId: null,
        projectId: pr.id,
        craftId: null,
        label: pr.name,
        cells: quarters.map((_, qi) => cellFor(allocs, qi)),
      });
      const bookings = groupBy(allocs, (a) => `${a.resourceId}|${effectiveCraft(a, people.get(a.resourceId)) ?? ''}`);
      const subRows = [...bookings.entries()].map(([k, list]) => {
        const [personId, craftId] = k.split('|');
        const person = people.get(personId);
        return {
          key: `booking:${pr.id}:${k}`,
          kind: 'booking' as const,
          depth: 1 as const,
          personId,
          projectId: pr.id,
          craftId: craftId || null,
          label: person?.name ?? personId,
          cells: quarters.map((_, qi) => cellFor(list, qi)),
        };
      });
      g.rows.push(...subRows.sort((a, b) => a.label.localeCompare(b.label)));
    }
  }

  return {
    quarters,
    groups: sortGroups([...groups.values()]).map((g) => ({
      id: g.id,
      label: g.label,
      rows: g.rows,
      totals: quarters.map((q, qi) => {
        const top = g.rows.filter((r) => r.depth === 0).map((r) => r.cells[qi]);
        const states = new Set<D.AllocationState>();
        const sources = new Set<D.AllocationSource>();
        for (const c of top) {
          if (c.state === 'mixed') ['confirmed', 'tentative'].forEach((x) => states.add(x as D.AllocationState));
          else if (c.state) states.add(c.state);
          if (c.source && c.source !== 'mixed') sources.add(c.source);
        }
        if (o.pivot === 'person') {
          // Group utilisation = Σload ÷ Σtarget (A-4), banded.
          const util = groupUtilisation(g.loads.map((l) => l[qi]));
          return {
            quarterKey: q.key,
            pct: round1(util),
            band: bandFor(util, o.thresholds),
            partial: top.some((c) => c.partial),
            state: one(states),
            source: one(sources),
            locked: false,
            allocationIds: top.flatMap((c) => c.allocationIds),
          };
        }
        // Project pivot: Σ booked % (100 = 1 FTE).
        return {
          quarterKey: q.key,
          pct: round1(top.reduce((x, c) => x + c.pct, 0)),
          band: null,
          partial: top.some((c) => c.partial),
          state: one(states),
          source: one(sources),
          locked: false,
          allocationIds: top.flatMap((c) => c.allocationIds),
        };
      }),
    })),
  };
}

/** AL-02: ops that set one quarter of a booking to `pct` (split/clip/reuse). Throws RangeError outside 0–200. */
export function setQuarterCell(
  s: D.WorkspaceSnapshot,
  quarters: QuarterView[],
  a: { resourceId: D.ID; projectId: D.ID; craftId: D.ID | null; quarterKey: D.QuarterKey; pct: number },
): AllocationOp[] {
  return quarterCellOps(s, quarters, a);
}

/** AL-03: ops that apply the booking's value in `fromQuarterKey` to every later quarter of the window. */
export function copyForward(
  s: D.WorkspaceSnapshot,
  quarters: QuarterView[],
  a: { resourceId: D.ID; projectId: D.ID; craftId: D.ID | null; fromQuarterKey: D.QuarterKey },
): AllocationOp[] {
  return copyForwardOps(s, quarters, a);
}

function pointFromLoads(
  quarterKey: D.QuarterKey,
  people: D.PersonDTO[],
  loads: RangeLoad[],
  demandFte: number,
  t: UtilisationThresholds,
): OutlookPoint {
  let supply = 0,
    above = 0,
    below = 0,
    undeclared = 0,
    free = 0;
  people.forEach((p, i) => {
    const l = loads[i];
    supply += headroomOf(p);
    above += l.above;
    below += l.below;
    undeclared += l.undeclared;
    free += l.free;
  });
  const util = groupUtilisation(loads);
  return {
    quarterKey,
    supplyFte: round2(supply / 100),
    aboveFte: round2(above / 100),
    belowFte: round2(below / 100),
    undeclaredFte: round2(undeclared / 100),
    freeFte: round2(free / 100),
    demandFte: round2(demandFte),
    utilisationPct: round1(util),
    band: bandFor(util, t),
  };
}

/**
 * Capacity Outlook (RP-02). Squad, craft, chapter and person rows are people-centric: the people
 * in the group, their load split above / below / undeclared / free, and Σload ÷ Σtarget. Demand is
 * the demand lines of the group's craft (craft pivot) or the chapter's craft (chapter pivot).
 *
 * Tribe rows are project-centric: FTE booked on the tribe's projects (split by each person's
 * craft relation), `supplyFte` = that committed FTE, `freeFte` = 0, demand = the tribe's demand,
 * and `utilisationPct` = staffing coverage (committed ÷ demand). Their committed FTE equals
 * `buildTribeView().staffedFte` (ORG-05#AC3).
 */
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
  const t = o.thresholds;
  const idx = loadIndex(s, quarters);
  const projects = byId(s.projects);
  const personIn = (p: D.PersonDTO) =>
    (!o.craftId || p.primaryCraft === o.craftId) &&
    (!o.chapterId || p.chapterId === o.chapterId) &&
    (!o.tribeId || p.homeTribeId === o.tribeId);
  const lineIn = (l: D.DemandLineDTO) =>
    (!o.craftId || l.craftId === o.craftId) && (!o.tribeId || projects.get(l.projectId)?.tribeId === o.tribeId);
  const demandIn = (qk: D.QuarterKey, f: (l: D.DemandLineDTO) => boolean) =>
    s.demand.filter((l) => l.quarterKey === qk && f(l)).reduce((x, l) => x + l.fte, 0);
  const pointsFor = (people: D.PersonDTO[], demand: (l: D.DemandLineDTO) => boolean) =>
    quarters.map((q, qi) =>
      pointFromLoads(
        q.key,
        people,
        people.map((p) => idx.raw.get(p.id)![qi]),
        demandIn(q.key, demand),
        t,
      ),
    );

  const scoped = s.people.filter(personIn);
  const squad = pointsFor(scoped, lineIn);
  let rows: OutlookModel['rows'];

  if (o.pivot === 'person') {
    rows = [...scoped].sort(byName).map((p) => ({ id: p.id, label: p.name, points: pointsFor([p], () => false) }));
  } else if (o.pivot === 'craft') {
    rows = [...s.crafts]
      .filter((c) => !c.archived && (!o.craftId || c.id === o.craftId))
      .sort((a, b) => a.sortOrder - b.sortOrder || byName(a, b))
      .map((c) => ({
        id: c.id,
        label: c.name,
        points: pointsFor(
          scoped.filter((p) => p.primaryCraft === c.id),
          (l) => lineIn(l) && l.craftId === c.id,
        ),
      }));
  } else if (o.pivot === 'chapter') {
    rows = [...s.chapters]
      .filter((c) => !c.archived && (!o.chapterId || c.id === o.chapterId))
      .sort(byName)
      .map((c) => ({
        id: c.id,
        label: c.name,
        points: pointsFor(
          scoped.filter((p) => p.chapterId === c.id),
          (l) => lineIn(l) && c.craftId !== null && l.craftId === c.craftId,
        ),
      }));
  } else {
    rows = [...s.tribes]
      .filter((tr) => !tr.archived && (!o.tribeId || tr.id === o.tribeId))
      .sort(byName)
      .map((tr) => ({ id: tr.id, label: tr.name, points: tribePoints(s, quarters, tr.id, o.craftId, t) }));
  }
  return { squad, rows };
}

function tribePoints(
  s: D.WorkspaceSnapshot,
  quarters: QuarterView[],
  tribeId: D.ID,
  craftId: D.ID | undefined,
  t: UtilisationThresholds,
): OutlookPoint[] {
  const people = byId(s.people);
  const projects = byId(s.projects);
  const allocs = countedAllocations(s).filter((a) => projects.get(a.projectId)?.tribeId === tribeId);
  return quarters.map((q) => {
    let above = 0,
      below = 0,
      undeclared = 0;
    for (const a of allocs) {
      const person = people.get(a.resourceId);
      const craft = effectiveCraft(a, person);
      if (craftId && craft !== craftId) continue;
      const fte = fteIn(a, projects.get(a.projectId), q);
      if (fte <= 0) continue;
      const rel = person ? craftRelation(person, craft) : 'undeclared';
      if (rel === 'above') above += fte;
      else if (rel === 'below') below += fte;
      else undeclared += fte;
    }
    const committed = above + below + undeclared;
    const demand = s.demand
      .filter(
        (l) => l.quarterKey === q.key && projects.get(l.projectId)?.tribeId === tribeId && (!craftId || l.craftId === craftId),
      )
      .reduce((x, l) => x + l.fte, 0);
    const coverage = demand > 0 ? (100 * committed) / demand : 0;
    return {
      quarterKey: q.key,
      supplyFte: round2(committed),
      aboveFte: round2(above),
      belowFte: round2(below),
      undeclaredFte: round2(undeclared),
      freeFte: 0,
      demandFte: round2(demand),
      utilisationPct: round1(coverage),
      band: bandFor(coverage, t),
    };
  });
}

/**
 * Squad catalogue (DM-04) for one quarter: per active craft, who can serve it above the table
 * (free up to their target) and below the table (free, capped by the craft's maxPct minus what
 * they already do in that craft), with any marketplace offer. People with nothing free and no
 * offer are left out.
 */
export function buildCatalogue(s: D.WorkspaceSnapshot, quarters: QuarterView[], quarterKey: D.QuarterKey): CatalogueEntry[] {
  const qi = quarters.findIndex((q) => q.key === quarterKey);
  if (qi < 0) return [];
  const idx = loadIndex(s, [quarters[qi]]);
  const offers = new Map(s.offers.filter((o) => o.quarterKey === quarterKey).map((o) => [o.personId, o]));
  return [...s.crafts]
    .filter((c) => !c.archived)
    .sort((a, b) => a.sortOrder - b.sortOrder || byName(a, b))
    .map((craft) => {
      const people: CatalogueEntry['people'] = [];
      for (const p of s.people) {
        const l = idx.raw.get(p.id)![0];
        const offer = offers.get(p.id) ?? null;
        const offered = !!offer && (offer.craftIds.length === 0 || offer.craftIds.includes(craft.id));
        if (p.primaryCraft === craft.id) {
          if (l.free > 0 || offered)
            people.push({ person: p, via: 'above', proficiency: null, freePct: round1(l.free), offer: offered ? offer : null });
          continue;
        }
        const sec = p.secondaryCrafts.find((x) => x.craftId === craft.id);
        if (!sec) continue;
        const onCraft = l.bookings.filter((b) => b.craftId === craft.id).reduce((x, b) => x + b.pct, 0);
        const free = Math.max(0, Math.min(l.free, sec.maxPct - onCraft));
        if (free > 0 || offered)
          people.push({ person: p, via: 'below', proficiency: sec.proficiency, freePct: round1(free), offer: offered ? offer : null });
      }
      people.sort(
        (a, b) =>
          Number(b.via === 'above') - Number(a.via === 'above') ||
          Number(!!b.offer) - Number(!!a.offer) ||
          b.freePct - a.freePct ||
          a.person.name.localeCompare(b.person.name),
      );
      return {
        craft,
        freeAboveFte: round2(people.filter((x) => x.via === 'above').reduce((x, e) => x + e.freePct, 0) / 100),
        reachBelowFte: round2(people.filter((x) => x.via === 'below').reduce((x, e) => x + e.freePct, 0) / 100),
        people,
      };
    });
}

/**
 * Home (RP-01). KPIs follow the basis: a quarter uses that quarter; 'today' uses today's bookings
 * for utilisation and people counts and QBR1 for demand; 'window' averages the four quarters.
 * `nextQuarterPct` is the quarter after the basis quarter (QBR2 for today/window).
 */
export function buildHome(
  s: D.WorkspaceSnapshot,
  quarters: QuarterView[],
  basis: TimeBasis,
  t: UtilisationThresholds,
  me: D.MeWorkspace | null,
): HomeModel {
  const idx = loadIndex(s, quarters);
  const outlook = buildCapacityOutlook(s, quarters, { pivot: 'person', thresholds: t }).squad;
  const rows = personRowsFrom(s, idx, t);
  const qi = basisIndex(basis, quarters);
  const day = today();

  const relOf = (r: PersonRow): number => {
    if (basis.kind === 'quarter') return r.quarters[qi]?.relativePct ?? 0;
    const load = rawLoadFor(s, idx, r.person.id, basis, day) ?? 0;
    return round1(relativeOf(load, targetFor(r.person)));
  };
  const scored = rows.map((r) => ({ r, rel: relOf(r), band: bandFor(relOf(r), t) }));
  const over = scored.filter((x) => x.band === 'over').sort((a, b) => b.rel - a.rel).map((x) => x.r);
  const available = scored.filter((x) => x.band === 'bench').sort((a, b) => a.rel - b.rel).map((x) => x.r);

  const loadsAt = (p: D.PersonDTO) => ({ total: rawLoadFor(s, idx, p.id, basis, day) ?? 0, target: targetFor(p) });
  const util = basis.kind === 'quarter' ? (outlook[qi]?.utilisationPct ?? 0) : round1(groupUtilisation(s.people.map(loadsAt)));
  const grid = buildDemandGrid(s, quarters);
  const unstaffedIn = (i: number) => grid.reduce((x, d) => x + Math.max(0, d.cells[i]?.gapFte ?? 0), 0);
  const unstaffed =
    basis.kind === 'window' && quarters.length > 0
      ? quarters.reduce((x, _, i) => x + unstaffedIn(i), 0) / quarters.length
      : unstaffedIn(qi);
  const nextIdx = Math.min(quarters.length - 1, basis.kind === 'quarter' ? qi + 1 : 1);

  return {
    kpis: {
      utilisationPct: util,
      band: bandFor(util, t),
      nextQuarterPct: outlook[nextIdx]?.utilisationPct ?? 0,
      unstaffedFte: round2(unstaffed),
      overCount: over.length,
      availableCount: available.length,
    },
    outlook,
    over,
    available,
    projectsWithoutDemand: projectsWithoutDemand(s, quarters),
    pendingApprovals: s.craftRequests.filter((r) => r.status === 'pending').length,
    myPendingProposals: me?.linkedPersonId
      ? s.allocations.filter((a) => a.state === 'tentative' && a.resourceId === me.linkedPersonId).length
      : 0,
  };
}

/**
 * One tribe (ORG-05): its projects, demand per quarter, staffed FTE (confirmed + tentative bookings
 * on its projects; equals the Outlook tribe pivot's committed FTE), gap = demand − staffed, and the
 * people serving it with their load on it. Throws for an unknown tribe id.
 */
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
  const projects = s.projects.filter((p) => p.tribeId === tribeId).sort(byName);
  const projectMap = byId(projects);
  const allocs = countedAllocations(s).filter((a) => projectMap.has(a.projectId));
  const demandFte = quarters.map((q) =>
    s.demand.filter((l) => l.quarterKey === q.key && projectMap.has(l.projectId)).reduce((x, l) => x + l.fte, 0),
  );
  const staffed = quarters.map((q) => allocs.reduce((x, a) => x + fteIn(a, projectMap.get(a.projectId), q), 0));
  const byPerson = groupBy(allocs, (a) => a.resourceId);
  const people = s.people
    .filter((p) => byPerson.has(p.id))
    .map((person) => ({
      person,
      pctByQuarter: quarters.map((q) =>
        round1(100 * (byPerson.get(person.id) ?? []).reduce((x, a) => x + fteIn(a, projectMap.get(a.projectId), q), 0)),
      ),
    }))
    .filter((x) => x.pctByQuarter.some((v) => v > 0))
    .sort((a, b) => byName(a.person, b.person));
  return {
    tribe,
    projects,
    demandFte: demandFte.map(round2),
    staffedFte: staffed.map(round2),
    gapFte: quarters.map((_, i) => round2(demandFte[i] - staffed[i])),
    people,
  };
}

/** SH-06: client-side search over the snapshot (implementation in `utils/search.ts`). */
export function buildSearchIndex(
  s: D.WorkspaceSnapshot,
): (q: string) => Array<{ kind: 'person' | 'project' | 'tribe' | 'craft'; id: D.ID; label: string; sublabel: string }> {
  return buildSearchIndexImpl(s);
}

/* ── additions (not in the frozen §4.3 list; see handoff-C.md §3) ───────────────────── */

export * from './marketplace';
export * from './planning';
export * from './delivery';
export { MAX_CELL_PCT, MAX_BATCH_OPS, inverseOps } from './allocationOps';
