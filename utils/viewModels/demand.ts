/**
 * Demand grid (DM-02) and the "initiated projects without demand" rule (DM-02#AC3).
 *
 * Pure: no React, DOM, Node or Netlify imports.
 */
import type * as D from '../../shared/contracts/dto';
import { byId, countedAllocations, fteIn, groupBy, round2 } from './core';
import { demandCells } from './unstaffed';
import type { QuarterView } from './types';

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);

/**
 * Projects × quarters. Per cell: the demand lines, demand FTE, staffed FTE (confirmed bookings on the project under
 * a craft it demands that quarter), proposed FTE (tentative ones, likewise), gap = unstaffed demand summed over the
 * cell's crafts (`utils/viewModels/unstaffed.ts`: never negative, and a booking under one craft never covers
 * another craft's demand, QA-004), and bookedFte = every confirmed or tentative booking on the project that quarter
 * whatever its craft (to show staffing that has no demand behind it).
 */
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
    bookedFte: number;
  }>;
}> {
  const tribes = byId(s.tribes);
  const onProject = groupBy(countedAllocations(s), (a) => a.projectId);
  const cellsOf = groupBy(demandCells(s, quarters), (c) => `${c.projectId}|${c.quarterKey}`);
  const linesOf = groupBy(s.demand, (l) => `${l.projectId}|${l.quarterKey}`);
  return [...s.projects].sort(byName).map((p) => ({
    project: p,
    tribe: (p.tribeId && tribes.get(p.tribeId)) || null,
    cells: quarters.map((q) => {
      const cells = cellsOf.get(`${p.id}|${q.key}`) ?? [];
      const sum = (f: (c: (typeof cells)[number]) => number) => cells.reduce((x, c) => x + f(c), 0);
      const booked = (onProject.get(p.id) ?? []).reduce((x, a) => x + fteIn(a, p, q), 0);
      return {
        quarterKey: q.key,
        lines: linesOf.get(`${p.id}|${q.key}`) ?? [],
        demandFte: round2(sum((c) => c.demandFte)),
        staffedFte: round2(sum((c) => c.staffedFte)),
        proposedFte: round2(sum((c) => c.proposedFte)),
        gapFte: round2(sum((c) => c.openFte)),
        bookedFte: round2(booked),
      };
    }),
  }));
}

/** DM-02#AC3: projects in stage Initiated or Mobilising with no demand captured for QBR1–QBR2. */
export function projectsWithoutDemand(s: D.WorkspaceSnapshot, quarters: QuarterView[]): D.ProjectDTO[] {
  const keys = new Set(quarters.slice(0, 2).map((q) => q.key));
  const withDemand = new Set(s.demand.filter((l) => keys.has(l.quarterKey) && l.fte > 0).map((l) => l.projectId));
  return s.projects
    .filter((p) => (p.stage === 'Initiated' || p.stage === 'Mobilising') && !withDemand.has(p.id))
    .sort(byName);
}
