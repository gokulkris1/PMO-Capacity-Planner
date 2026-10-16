/**
 * Marketplace view-models (DM-03, DM-05, RP-04 time to staff). Additive to the §4.3 contract.
 *
 * Pure: no React, DOM, Node or Netlify imports.
 */
import type * as D from '../../shared/contracts/dto';
import type { UtilBand, UtilisationThresholds } from '../../shared/utilisation';
import { suggestMatches, type DemandLine, type MatchSuggestion } from '../craftEngine';
import { dayNumber } from '../quarters';
import { effectiveCraft } from './allocationOps';
import { byId, countedAllocations, fteIn, loadIndex, round1, round2, toPersonQuarter } from './core';
import type { QuarterView } from './types';

export interface OpenDemandLine {
  key: string;
  project: D.ProjectDTO;
  tribe: D.TribeDTO | null;
  craft: D.CraftDTO | null;
  craftId: D.ID;
  quarter: QuarterView;
  /** Demand lines behind this row (several lines for the same project × quarter × craft are summed). */
  lines: D.DemandLineDTO[];
  demandFte: number;
  /** Confirmed bookings on the project under this craft. */
  staffedFte: number;
  /** Tentative bookings ("0.5 FTE proposed"). */
  proposedFte: number;
  /** demand − staffed − proposed ("0.5 FTE open"). */
  openFte: number;
  /** Ranked candidates for the open FTE (empty when nothing is open). */
  matches: MatchSuggestion[];
}

/**
 * Open demand per project × quarter × craft (DM-03#AC1, #AC5), with ranked matches from
 * `craftEngine.suggestMatches` (people already booked or proposed on the line are excluded).
 * Rows with nothing open are left out unless `includeCovered` is set.
 */
export function buildOpenDemand(
  s: D.WorkspaceSnapshot,
  quarters: QuarterView[],
  o: { quarterKey?: D.QuarterKey; craftId?: D.ID; tribeId?: D.ID; includeCovered?: boolean; matchLimit?: number } = {},
): OpenDemandLine[] {
  const projects = byId(s.projects);
  const tribes = byId(s.tribes);
  const crafts = byId(s.crafts);
  const people = byId(s.people);
  const counted = countedAllocations(s);
  const groups = new Map<string, D.DemandLineDTO[]>();
  for (const l of s.demand) {
    if (o.quarterKey && l.quarterKey !== o.quarterKey) continue;
    if (o.craftId && l.craftId !== o.craftId) continue;
    const k = `${l.projectId}|${l.quarterKey}|${l.craftId}`;
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }
  const out: OpenDemandLine[] = [];
  for (const [key, lines] of groups) {
    const { projectId, quarterKey, craftId } = lines[0];
    const project = projects.get(projectId);
    const quarter = quarters.find((q) => q.key === quarterKey);
    if (!project || !quarter) continue;
    if (o.tribeId && project.tribeId !== o.tribeId) continue;
    let staffed = 0,
      proposed = 0;
    for (const a of counted) {
      if (a.projectId !== projectId || effectiveCraft(a, people.get(a.resourceId)) !== craftId) continue;
      const fte = fteIn(a, project, quarter);
      if (a.state === 'confirmed') staffed += fte;
      else proposed += fte;
    }
    const demand = lines.reduce((x, l) => x + l.fte, 0);
    const open = demand - staffed - proposed;
    if (open <= 0.005 && !o.includeCovered) continue;
    const tribe = (project.tribeId && tribes.get(project.tribeId)) || null;
    const line: DemandLine = {
      projectId,
      projectName: project.name,
      tribe: tribe?.name,
      tribeId: project.tribeId,
      quarterKey,
      craftId,
      demandFte: round2(demand),
      staffedFte: round2(staffed + proposed),
      gapFte: round2(open),
    };
    out.push({
      key,
      project,
      tribe,
      craft: crafts.get(craftId) ?? null,
      craftId,
      quarter,
      lines,
      demandFte: round2(demand),
      staffedFte: round2(staffed),
      proposedFte: round2(proposed),
      openFte: round2(open),
      matches: open > 0.005 ? suggestMatches(line, quarter, s.people, s.projects, counted, o.matchLimit ?? 5) : [],
    });
  }
  return out.sort(
    (a, b) =>
      a.quarter.index - b.quarter.index ||
      b.openFte - a.openFte ||
      a.project.name.localeCompare(b.project.name) ||
      a.craftId.localeCompare(b.craftId),
  );
}

export interface UnderTargetRow {
  person: D.PersonDTO;
  quarterKey: D.QuarterKey;
  loadPct: number;
  relativePct: number;
  band: UtilBand;
  /** Free % up to their target. */
  freePct: number;
  craftIds: D.ID[];
  offer: D.MarketplaceOfferDTO | null;
}

/** DM-05: people whose band is Under target or Available in a quarter, most free first. */
export function buildUnderTarget(
  s: D.WorkspaceSnapshot,
  quarters: QuarterView[],
  quarterKey: D.QuarterKey,
  t: UtilisationThresholds,
): UnderTargetRow[] {
  const qi = quarters.findIndex((q) => q.key === quarterKey);
  if (qi < 0) return [];
  const idx = loadIndex(s, [quarters[qi]]);
  const out: UnderTargetRow[] = [];
  for (const p of s.people) {
    const pq = toPersonQuarter(quarterKey, idx.raw.get(p.id)![0], t);
    if (pq.band !== 'under' && pq.band !== 'bench') continue;
    out.push({
      person: p,
      quarterKey,
      loadPct: pq.loadPct,
      relativePct: pq.relativePct,
      band: pq.band,
      freePct: pq.free,
      craftIds: [p.primaryCraft, ...p.secondaryCrafts.map((c) => c.craftId)].filter((x): x is string => !!x),
      offer: s.offers.find((o) => o.personId === p.id && o.quarterKey === quarterKey) ?? null,
    });
  }
  return out.sort((a, b) => b.freePct - a.freePct || a.person.name.localeCompare(b.person.name));
}

/** Default dates for a proposal in a quarter, clipped to the project window (DM-03 ProposeRequest). */
export function proposalWindow(project: D.ProjectDTO | undefined, q: QuarterView): { startDate: D.ISODate; endDate: D.ISODate } {
  const start = project?.startDate && project.startDate > q.start ? project.startDate : q.start;
  const end = project?.endDate && project.endDate < q.end ? project.endDate : q.end;
  return end < start ? { startDate: q.start, endDate: q.end } : { startDate: start, endDate: end };
}

export interface TimeToStaffRow {
  allocation: D.AllocationDTO;
  person: D.PersonDTO | null;
  project: D.ProjectDTO | null;
  /** Demand line creation, else the proposal time. */
  from: D.ISODateTime;
  respondedAt: D.ISODateTime;
  days: number;
}

/**
 * DM-03#AC4 / RP-04: confirmed marketplace bookings with their time to staff
 * (`respondedAt − demand line createdAt`, else `− proposedAt`), newest first, plus the median over
 * the 90 days up to `asOf`.
 */
export function buildTimeToStaff(
  s: D.WorkspaceSnapshot,
  asOf: D.ISODate,
): { rows: TimeToStaffRow[]; medianDays90: number | null } {
  const lines = byId(s.demand);
  const people = byId(s.people);
  const projects = byId(s.projects);
  const rows: TimeToStaffRow[] = [];
  for (const a of s.allocations) {
    if (a.source !== 'marketplace' || a.state !== 'confirmed' || !a.respondedAt) continue;
    const from = (a.demandLineId && lines.get(a.demandLineId)?.createdAt) || a.proposedAt;
    if (!from) continue;
    const days = Math.max(0, (Date.parse(a.respondedAt) - Date.parse(from)) / 86_400_000);
    rows.push({
      allocation: a,
      person: people.get(a.resourceId) ?? null,
      project: projects.get(a.projectId) ?? null,
      from,
      respondedAt: a.respondedAt,
      days: round1(days),
    });
  }
  rows.sort((a, b) => b.respondedAt.localeCompare(a.respondedAt));
  const cutoff = dayNumber(asOf) - 90;
  const recent = rows
    .filter((r) => dayNumber(r.respondedAt.slice(0, 10)) >= cutoff)
    .map((r) => r.days)
    .sort((a, b) => a - b);
  const mid = Math.floor(recent.length / 2);
  const median = recent.length === 0 ? null : recent.length % 2 ? recent[mid] : round1((recent[mid - 1] + recent[mid]) / 2);
  return { rows, medianDays90: median };
}
