/**
 * Unstaffed demand: ONE definition used by every view (QA-004, RP-01#AC1, DM-02, DM-03#AC5, ORG-05, RP-04).
 *
 * Demand is captured per project × craft × quarter. For each such cell:
 *   staffed  = confirmed bookings on that project under that craft (the booking's craft, else the person's
 *              above-the-table craft), quarter-averaged FTE;
 *   proposed = tentative bookings on it, the same way (declined never counts);
 *   open     = max(0, demand − staffed − proposed).
 * Unstaffed demand for any scope (Home, a project, a tribe, a craft, the QBR pack) is the sum of `open` over the
 * cells in that scope. A booking under another craft, or on another project, never covers a cell: a Product Manager
 * on Phoenix does not staff Phoenix's Scrum Master demand, and spare Scrum Masters on Ledger do not either.
 *
 * Pure: no React, DOM, Node or Netlify imports.
 */
import type * as D from '../../shared/contracts/dto';
import { effectiveCraft } from './allocationOps';
import { byId, countedAllocations, fteIn, groupBy } from './core';
import type { QuarterView } from './types';

export interface DemandCell {
  /** `${projectId}|${quarterKey}|${craftId}` */
  key: string;
  projectId: D.ID;
  craftId: D.ID;
  quarterKey: D.QuarterKey;
  /** Index of the quarter in the window passed in. */
  quarterIndex: number;
  /** The demand lines behind the cell (several lines for the same cell are summed). */
  lines: D.DemandLineDTO[];
  /** Unrounded FTE; round only for display. */
  demandFte: number;
  staffedFte: number;
  proposedFte: number;
  openFte: number;
}

/** Every demand cell in the window, with its staffed, proposed and open FTE. */
export function demandCells(s: D.WorkspaceSnapshot, quarters: QuarterView[]): DemandCell[] {
  const projects = byId(s.projects);
  const people = byId(s.people);
  const qIndex = new Map(quarters.map((q, i) => [q.key, i]));
  const onProject = groupBy(countedAllocations(s), (a) => a.projectId);
  const groups = new Map<string, D.DemandLineDTO[]>();
  for (const l of s.demand) {
    if (!qIndex.has(l.quarterKey) || !projects.has(l.projectId)) continue;
    const k = `${l.projectId}|${l.quarterKey}|${l.craftId}`;
    const list = groups.get(k);
    if (list) list.push(l);
    else groups.set(k, [l]);
  }
  const out: DemandCell[] = [];
  for (const [key, lines] of groups) {
    const { projectId, quarterKey, craftId } = lines[0];
    const qi = qIndex.get(quarterKey)!;
    const project = projects.get(projectId);
    let staffed = 0;
    let proposed = 0;
    for (const a of onProject.get(projectId) ?? []) {
      if (effectiveCraft(a, people.get(a.resourceId)) !== craftId) continue;
      const fte = fteIn(a, project, quarters[qi]);
      if (a.state === 'confirmed') staffed += fte;
      else proposed += fte;
    }
    const demand = lines.reduce((x, l) => x + (Number(l.fte) || 0), 0);
    out.push({
      key,
      projectId,
      craftId,
      quarterKey,
      quarterIndex: qi,
      lines,
      demandFte: demand,
      staffedFte: staffed,
      proposedFte: proposed,
      openFte: Math.max(0, demand - staffed - proposed),
    });
  }
  return out;
}

/** Σ open FTE per quarter over the cells `include` keeps (unrounded). */
export function unstaffedPerQuarter(
  cells: readonly DemandCell[],
  quarters: QuarterView[],
  include: (c: DemandCell) => boolean = () => true,
): number[] {
  const out = quarters.map(() => 0);
  for (const c of cells) if (include(c)) out[c.quarterIndex] += c.openFte;
  return out;
}

/** Σ open FTE per quarter, keyed by `keyOf(cell)` (e.g. the craft or the project's tribe). Unrounded. */
export function unstaffedBy(
  cells: readonly DemandCell[],
  quarters: QuarterView[],
  keyOf: (c: DemandCell) => string | null | undefined,
): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const c of cells) {
    const k = keyOf(c);
    if (k === null || k === undefined) continue;
    let row = out.get(k);
    if (!row) {
      row = quarters.map(() => 0);
      out.set(k, row);
    }
    row[c.quarterIndex] += c.openFte;
  }
  return out;
}

/** Unstaffed demand per craft per quarter (By craft, Capacity Outlook craft and chapter pivots, QBR pack). */
export function unstaffedByCraft(s: D.WorkspaceSnapshot, quarters: QuarterView[]): Map<D.ID, number[]> {
  return unstaffedBy(demandCells(s, quarters), quarters, (c) => c.craftId);
}

/** Unstaffed demand per tribe per quarter (Tribes, Capacity Outlook tribe pivot). */
export function unstaffedByTribe(s: D.WorkspaceSnapshot, quarters: QuarterView[]): Map<D.ID, number[]> {
  const projects = byId(s.projects);
  return unstaffedBy(demandCells(s, quarters), quarters, (c) => projects.get(c.projectId)?.tribeId);
}
