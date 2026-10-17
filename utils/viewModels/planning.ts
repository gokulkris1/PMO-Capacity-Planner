/**
 * Planning view-models: Demand "By craft", Projects table, My Plan, craft-change queue, structure
 * and craft-catalogue admin tables, plus client-side validation that mirrors the API rules.
 * Additive to the §4.3 contract.
 *
 * Pure: no React, DOM, Node or Netlify imports.
 */
import type * as D from '../../shared/contracts/dto';
import { QUARTER_KEY_RE } from '../../shared/contracts/dto';
import type { UtilisationThresholds } from '../../shared/utilisation';
import { craftBalance } from '../craftEngine';
import {
  byId,
  countedAllocations,
  fteIn,
  groupBy,
  loadIndex,
  round2,
  toPersonQuarter,
  type PersonQuarter,
} from './core';
import { buildDemandGrid } from './demand';
import { unstaffedByCraft } from './unstaffed';
import type { QuarterView } from './types';

/* ── Demand "By craft" (DM-02#AC1) ─────────────────────────────────────────────────── */

export interface CraftBalanceRow {
  craft: D.CraftDTO;
  quarters: Array<{
    quarterKey: D.QuarterKey;
    /** Above-the-table holders' capacity (FTE). */
    supplyFte: number;
    /** FTE booked under this craft by anyone. */
    committedFte: number;
    demandFte: number;
    /** Unstaffed demand for the craft: Σ open per project (`./unstaffed.ts`, QA-004), the Marketplace's number. */
    gapFte: number;
    /** Above-the-table holders' unbooked capacity in this craft. */
    benchFte: number;
    /** What below-the-table holders could add (free, capped by their maxPct). */
    reachFte: number;
  }>;
}

export function buildCraftBalance(s: D.WorkspaceSnapshot, quarters: QuarterView[]): CraftBalanceRow[] {
  const counted = countedAllocations(s);
  const unstaffed = unstaffedByCraft(s, quarters);
  return [...s.crafts]
    .filter((c) => !c.archived)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((craft) => ({
      craft,
      quarters: quarters.map((q, i) => {
        const b = craftBalance(craft, q, s.people, s.projects, counted, s.demand);
        return {
          quarterKey: q.key,
          supplyFte: b.primarySupply,
          committedFte: b.committed,
          demandFte: b.demand,
          gapFte: round2(unstaffed.get(craft.id)?.[i] ?? 0),
          benchFte: b.primaryBench,
          reachFte: b.secondaryReach,
        };
      }),
    }));
}

/* ── Projects table (PPL-07) ───────────────────────────────────────────────────────── */

export interface ProjectRow {
  project: D.ProjectDTO;
  tribe: D.TribeDTO | null;
  /** Per window quarter. */
  quarters: Array<{
    quarterKey: D.QuarterKey;
    demandFte: number;
    staffedFte: number;
    proposedFte: number;
    gapFte: number;
  }>;
  /** True for Initiated/Mobilising projects with no demand in QBR1–QBR2 (DM-02#AC3). */
  noDemandWarning: boolean;
  /** Planview-sourced project under the "locked" rule: dates are read-only (PPL-07#AC3). */
  datesLocked: boolean;
}

export function buildProjectRows(s: D.WorkspaceSnapshot, quarters: QuarterView[]): ProjectRow[] {
  const grid = buildDemandGrid(s, quarters);
  const firstTwo = new Set(quarters.slice(0, 2).map((q) => q.key));
  const locked = s.org.planning.planviewOwnership === 'locked';
  return grid.map((g) => ({
    project: g.project,
    tribe: g.tribe,
    quarters: g.cells.map((c) => ({
      quarterKey: c.quarterKey,
      demandFte: c.demandFte,
      staffedFte: c.staffedFte,
      proposedFte: c.proposedFte,
      gapFte: c.gapFte,
    })),
    noDemandWarning:
      (g.project.stage === 'Initiated' || g.project.stage === 'Mobilising') &&
      !s.demand.some((l) => l.projectId === g.project.id && firstTwo.has(l.quarterKey) && l.fte > 0),
    datesLocked: locked && g.project.source === 'planview',
  }));
}

/* ── My Plan (PPL-05) ──────────────────────────────────────────────────────────────── */

export interface MyPlanModel {
  person: D.PersonDTO;
  quarters: PersonQuarter[];
  proposals: Array<{ allocation: D.AllocationDTO; project: D.ProjectDTO | null; craft: D.CraftDTO | null }>;
  bookings: Array<{ allocation: D.AllocationDTO; project: D.ProjectDTO | null; craft: D.CraftDTO | null }>;
  crafts: {
    primary: D.CraftDTO | null;
    secondary: Array<{ craft: D.CraftDTO; proficiency: D.Proficiency; maxPct: number }>;
  };
  /** The pending request, if any ("Pending approval by {approver}"). */
  pendingRequest: D.CraftChangeRequestDTO | null;
  /** Who the pending request is routed to: the chapter lead's name, else 'a Planner'. */
  approverLabel: string;
  /** Latest decided request ("Approved by {name}" / "Rejected: {reason}"). */
  lastDecision: D.CraftChangeRequestDTO | null;
  offers: D.MarketplaceOfferDTO[];
}

/** Returns null when the person is not in the snapshot (the "not linked" empty state). */
export function buildMyPlan(
  s: D.WorkspaceSnapshot,
  quarters: QuarterView[],
  personId: D.ID | null,
  t: UtilisationThresholds,
): MyPlanModel | null {
  const person = personId ? s.people.find((p) => p.id === personId) : undefined;
  if (!person) return null;
  const idx = loadIndex({ ...s, people: [person] }, quarters);
  const projects = byId(s.projects);
  const crafts = byId(s.crafts);
  const mine = s.allocations.filter((a) => a.resourceId === person.id);
  const withRefs = (a: D.AllocationDTO) => ({
    allocation: a,
    project: projects.get(a.projectId) ?? null,
    craft: crafts.get(a.craftId ?? person.primaryCraft ?? '') ?? null,
  });
  const requests = s.craftRequests
    .filter((r) => r.personId === person.id)
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  const chapter = s.chapters.find((c) => c.id === person.chapterId);
  const lead = chapter?.leadPersonId ? s.people.find((p) => p.id === chapter.leadPersonId) : undefined;
  const lastDecision = requests
    .filter((r) => r.status !== 'pending')
    .sort((a, b) => (b.decidedAt ?? '').localeCompare(a.decidedAt ?? ''))[0];
  return {
    person,
    quarters: (idx.raw.get(person.id) ?? []).map((l, i) => toPersonQuarter(quarters[i].key, l, t)),
    proposals: mine
      .filter((a) => a.state === 'tentative')
      .map(withRefs)
      .sort((a, b) => (a.allocation.startDate ?? '').localeCompare(b.allocation.startDate ?? '')),
    bookings: mine
      .filter((a) => a.state === 'confirmed')
      .map(withRefs)
      .sort((a, b) => (a.allocation.startDate ?? '').localeCompare(b.allocation.startDate ?? '')),
    crafts: {
      primary: (person.primaryCraft && crafts.get(person.primaryCraft)) || null,
      secondary: person.secondaryCrafts.flatMap((c) => {
        const craft = crafts.get(c.craftId);
        return craft ? [{ craft, proficiency: c.proficiency, maxPct: c.maxPct }] : [];
      }),
    },
    pendingRequest: requests.find((r) => r.status === 'pending') ?? null,
    approverLabel: lead && lead.id !== person.id ? lead.name : 'a Planner',
    lastDecision: lastDecision ?? null,
    offers: s.offers.filter((o) => o.personId === person.id),
  };
}

/* ── Craft-change queue (PPL-06#AC2) ───────────────────────────────────────────────── */

export interface CraftRequestRow {
  request: D.CraftChangeRequestDTO;
  person: D.PersonDTO | null;
  chapter: D.ChapterDTO | null;
  /** True when the viewer leads the person's chapter ("Your chapter"). */
  yourChapter: boolean;
  added: D.SecondaryCraftDTO[];
  removed: D.SecondaryCraftDTO[];
  changed: Array<{ from: D.SecondaryCraftDTO; to: D.SecondaryCraftDTO }>;
}

/** Pending requests, the viewer's chapters first, then oldest first. */
export function buildCraftRequestQueue(s: D.WorkspaceSnapshot, viewerPersonId: D.ID | null): CraftRequestRow[] {
  const people = byId(s.people);
  const chapters = byId(s.chapters);
  return s.craftRequests
    .filter((r) => r.status === 'pending')
    .map((request) => {
      const person = people.get(request.personId) ?? null;
      const chapter = (person?.chapterId && chapters.get(person.chapterId)) || null;
      const cur = new Map(request.current.map((c) => [c.craftId, c]));
      const next = new Map(request.proposed.map((c) => [c.craftId, c]));
      return {
        request,
        person,
        chapter,
        yourChapter: !!viewerPersonId && chapter?.leadPersonId === viewerPersonId,
        added: request.proposed.filter((c) => !cur.has(c.craftId)),
        removed: request.current.filter((c) => !next.has(c.craftId)),
        changed: request.proposed
          .filter((c) => {
            const old = cur.get(c.craftId);
            return !!old && (old.proficiency !== c.proficiency || old.maxPct !== c.maxPct);
          })
          .map((c) => ({ from: cur.get(c.craftId)!, to: c })),
      };
    })
    .sort(
      (a, b) =>
        Number(b.yourChapter) - Number(a.yourChapter) || a.request.submittedAt.localeCompare(b.request.submittedAt),
    );
}

/* ── Structure and craft admin tables (ORG-03, ORG-04) ─────────────────────────────── */

export interface StructureRow<T> {
  entity: T;
  peopleCount: number;
  projectsCount: number;
  lead: D.PersonDTO | null;
}

export function buildStructureRows(s: D.WorkspaceSnapshot): {
  tribes: Array<StructureRow<D.TribeDTO>>;
  chapters: Array<StructureRow<D.ChapterDTO>>;
  teams: Array<StructureRow<D.TeamDTO>>;
} {
  const people = byId(s.people);
  const byHomeTribe = groupBy(s.people, (p) => p.homeTribeId);
  const byChapter = groupBy(s.people, (p) => p.chapterId);
  const byTeam = groupBy(s.people, (p) => p.teamId);
  const projectsByTribe = groupBy(s.projects, (p) => p.tribeId);
  const sortRows = <T extends { name: string; archived: boolean }>(rows: Array<StructureRow<T>>) =>
    rows.sort(
      (a, b) => Number(a.entity.archived) - Number(b.entity.archived) || a.entity.name.localeCompare(b.entity.name),
    );
  return {
    tribes: sortRows(
      s.tribes.map((t) => ({
        entity: t,
        peopleCount: byHomeTribe.get(t.id)?.length ?? 0,
        projectsCount: projectsByTribe.get(t.id)?.length ?? 0,
        lead: null,
      })),
    ),
    chapters: sortRows(
      s.chapters.map((c) => ({
        entity: c,
        peopleCount: byChapter.get(c.id)?.length ?? 0,
        projectsCount: 0,
        lead: (c.leadPersonId && people.get(c.leadPersonId)) || null,
      })),
    ),
    teams: sortRows(
      s.teams.map((t) => ({ entity: t, peopleCount: byTeam.get(t.id)?.length ?? 0, projectsCount: 0, lead: null })),
    ),
  };
}

export interface CraftAdminRow {
  craft: D.CraftDTO;
  aboveHolders: number;
  belowHolders: number;
  /** References that block a hard delete (ORG-02#AC2): people, demand lines, allocations, chapters. */
  inUse: number;
}

export function buildCraftAdminRows(s: D.WorkspaceSnapshot): CraftAdminRow[] {
  return [...s.crafts]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((craft) => {
      const above = s.people.filter((p) => p.primaryCraft === craft.id).length;
      const below = s.people.filter((p) => p.secondaryCrafts.some((c) => c.craftId === craft.id)).length;
      const refs =
        above +
        below +
        s.demand.filter((l) => l.craftId === craft.id).length +
        s.allocations.filter((a) => a.craftId === craft.id).length +
        s.chapters.filter((c) => c.craftId === craft.id).length;
      return { craft, aboveHolders: above, belowHolders: below, inUse: refs };
    });
}

/** "Create chapters from crafts" (ORG-03#AC3): one chapter per above-the-table craft in use, with its members. */
export function chaptersFromCrafts(
  s: D.WorkspaceSnapshot,
): Array<{ craft: D.CraftDTO; name: string; personIds: D.ID[] }> {
  const crafts = byId(s.crafts);
  const holders = groupBy(
    s.people.filter((p) => p.primaryCraft),
    (p) => p.primaryCraft!,
  );
  return [...holders.entries()]
    .filter(([id]) => crafts.has(id))
    .map(([id, people]) => ({ craft: crafts.get(id)!, name: crafts.get(id)!.name, personIds: people.map((p) => p.id) }))
    .sort((a, b) => a.craft.sortOrder - b.craft.sortOrder);
}

/* ── validation mirroring the API (client-side hints; the server stays authoritative) ─ */

export type FieldErrors = Record<string, string>;

/** ORG-02#AC4: short code is 2–4 uppercase letters/digits, unique per org; name required and unique. */
export function validateCraft(s: D.WorkspaceSnapshot, c: { id?: D.ID; name?: unknown; short?: unknown }): FieldErrors {
  const e: FieldErrors = {};
  const name = typeof c.name === 'string' ? c.name.trim() : '';
  const short = typeof c.short === 'string' ? c.short.trim() : '';
  if (!name) e.name = 'Enter a name';
  else if (s.crafts.some((x) => x.id !== c.id && x.name.toLowerCase() === name.toLowerCase()))
    e.name = 'Already exists';
  if (!/^[A-Z0-9]{2,4}$/.test(short)) e.short = 'Use 2–4 capital letters or digits';
  else if (s.crafts.some((x) => x.id !== c.id && x.short === short)) e.short = 'Already used by another craft';
  return e;
}

/** Tribe/chapter/team: name required and unique (case-insensitive) within its kind. */
export function validateStructureName(
  list: ReadonlyArray<{ id: D.ID; name: string }>,
  e: { id?: D.ID; name?: unknown },
): FieldErrors {
  const name = typeof e.name === 'string' ? e.name.trim() : '';
  if (!name) return { name: 'Enter a name' };
  if (list.some((x) => x.id !== e.id && x.name.trim().toLowerCase() === name.toLowerCase()))
    return { name: 'Already exists' };
  return {};
}

/** DM-01#AC2: quarter key format, FTE 0–50, craft exists and is active. */
export function validateDemandLine(
  s: D.WorkspaceSnapshot,
  l: { quarterKey?: unknown; fte?: unknown; craftId?: unknown; projectId?: unknown },
): FieldErrors {
  const e: FieldErrors = {};
  if (typeof l.quarterKey !== 'string' || !QUARTER_KEY_RE.test(l.quarterKey))
    e.quarterKey = 'Use a quarter like 2027-Q1';
  if (typeof l.fte !== 'number' || !Number.isFinite(l.fte) || l.fte < 0 || l.fte > 50) e.fte = 'Enter 0–50 FTE';
  const craft = s.crafts.find((c) => c.id === l.craftId);
  if (!craft) e.craftId = 'Choose a craft';
  else if (craft.archived) e.craftId = 'This craft is archived';
  if (l.projectId !== undefined && !s.projects.some((p) => p.id === l.projectId)) e.projectId = 'Choose a project';
  return e;
}

/** PPL-02: target 0–150, crafts consistent (below ≠ above, no duplicates, proficiency 1–3, cap 0–100). */
export function validatePerson(p: Partial<D.PersonDTO>): FieldErrors {
  const e: FieldErrors = {};
  if (p.name !== undefined && !String(p.name).trim()) e.name = 'Enter a name';
  if (p.targetUtil !== undefined && (!Number.isFinite(p.targetUtil) || p.targetUtil < 0 || p.targetUtil > 150))
    e.targetUtil = 'Target must be 0–150';
  if (p.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) e.email = 'Enter a valid email';
  if (p.secondaryCrafts) {
    const seen = new Set<string>();
    p.secondaryCrafts.forEach((c, i) => {
      if (p.primaryCraft && c.craftId === p.primaryCraft)
        e[`secondaryCrafts.${i}`] = 'Already their above-the-table craft';
      else if (seen.has(c.craftId)) e[`secondaryCrafts.${i}`] = 'Listed twice';
      else if (![1, 2, 3].includes(c.proficiency)) e[`secondaryCrafts.${i}`] = 'Choose L1, L2 or L3';
      else if (!(c.maxPct >= 0 && c.maxPct <= 100)) e[`secondaryCrafts.${i}`] = 'Cap must be 0–100%';
      seen.add(c.craftId);
    });
  }
  return e;
}

/** Sum of FTE of a booking list in a quarter (used by drawers). */
export function bookedFte(s: D.WorkspaceSnapshot, allocations: D.AllocationDTO[], q: QuarterView): number {
  const projects = byId(s.projects);
  return round2(allocations.reduce((x, a) => x + fteIn(a, projects.get(a.projectId), q), 0));
}
