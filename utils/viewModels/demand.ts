/**
 * Demand grid (DM-02) and the "initiated projects without demand" rule (DM-02#AC3).
 *
 * Pure: no React, DOM, Node or Netlify imports.
 */
import type * as D from '../../shared/contracts/dto';
import { byId, fteIn, groupBy, round2 } from './core';
import type { QuarterView } from './types';

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);

/**
 * Projects × quarters. Per cell: the demand lines, demand FTE, staffed FTE (confirmed bookings on
 * the project), proposed FTE (tentative bookings) and gap = demand − staffed − proposed (the
 * "open" FTE; negative when over-staffed).
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
  }>;
}> {
  const tribes = byId(s.tribes);
  const onProject = groupBy(
    s.allocations.filter((a) => a.state !== 'declined'),
    (a) => a.projectId,
  );
  const linesOf = groupBy(s.demand, (l) => `${l.projectId}|${l.quarterKey}`);
  return [...s.projects].sort(byName).map((p) => ({
    project: p,
    tribe: (p.tribeId && tribes.get(p.tribeId)) || null,
    cells: quarters.map((q) => {
      const lines = linesOf.get(`${p.id}|${q.key}`) ?? [];
      let staffed = 0,
        proposed = 0;
      for (const a of onProject.get(p.id) ?? []) {
        const fte = fteIn(a, p, q);
        if (a.state === 'confirmed') staffed += fte;
        else proposed += fte;
      }
      const demand = lines.reduce((x, l) => x + l.fte, 0);
      return {
        quarterKey: q.key,
        lines,
        demandFte: round2(demand),
        staffedFte: round2(staffed),
        proposedFte: round2(proposed),
        gapFte: round2(demand - staffed - proposed),
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

