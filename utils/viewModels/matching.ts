/**
 * Marketplace ranking and per-craft staffing promoted from B2's page helpers to view-models
 * (handoff-C.md §3). Additive to the §4.3 contract.
 *
 * Pure: no React, DOM, Node or Netlify imports.
 */
import type * as D from '../../shared/contracts/dto';
import { effectiveCraft } from './allocationOps';
import { byId, countedAllocations, fteIn, round2 } from './core';
import type { CatalogueEntry } from './index';
import type { QuarterView } from './types';

export interface Match {
  person: D.PersonDTO;
  via: 'above' | 'below';
  proficiency: D.Proficiency | null;
  freePct: number;
  offer: D.MarketplaceOfferDTO | null;
  score: number;
  reasons: string[];
  suggestedPct: number;
}

/**
 * Ranked matches for one open demand line from its catalogue entry (DM-03#AC1). Same signature and
 * scoring as B2's interim `pages/plan/marketplace/rankMatches.ts`: above the table first, then L3/L2/L1
 * below the table, free capacity towards the gap, tribe familiarity, and an existing offer.
 */
export function rankMatches(
  entry: CatalogueEntry | undefined,
  project: D.ProjectDTO | undefined,
  gapFte: number,
  exclude: Set<D.ID>,
): Match[] {
  if (!entry) return [];
  const needPct = Math.max(5, Math.round(gapFte * 100));
  return entry.people
    .filter((p) => p.freePct >= 5 && !exclude.has(p.person.id))
    .map((p) => {
      const reasons: string[] = [];
      let score = 0;
      if (p.via === 'above') {
        score += 100;
        reasons.push('Above the table');
      } else {
        score += p.proficiency === 3 ? 80 : p.proficiency === 2 ? 60 : 40;
        reasons.push(`L${p.proficiency ?? 1} below the table`);
      }
      score += (Math.min(p.freePct, needPct) / needPct) * 40;
      reasons.push(`${Math.round(p.freePct)}% free`);
      const tribeId = project?.tribeId;
      if (tribeId && (p.person.tribeAffinity.includes(tribeId) || p.person.homeTribeId === tribeId)) {
        score += 15;
        reasons.push('Knows the tribe');
      }
      if (p.offer) {
        score += 10;
        reasons.push('Offered');
      }
      const suggestedPct = Math.max(5, Math.min(needPct, Math.floor(p.freePct / 5) * 5 || 5));
      return { ...p, score: Math.round(score), reasons, suggestedPct };
    })
    .sort((a, b) => b.score - a.score || b.freePct - a.freePct);
}

/**
 * Staffed FTE per project × craft per window quarter, keyed `${projectId}|${craftId}` (the booking's
 * craft, else the person's above-the-table craft). Confirmed bookings only unless `includeTentative`.
 */
export function staffedFteByProjectCraft(
  s: D.WorkspaceSnapshot,
  quarters: QuarterView[],
  o: { includeTentative?: boolean } = {},
): Map<string, number[]> {
  const projects = byId(s.projects);
  const people = byId(s.people);
  const out = new Map<string, number[]>();
  for (const a of countedAllocations(s, o.includeTentative ?? false)) {
    const k = `${a.projectId}|${effectiveCraft(a, people.get(a.resourceId)) ?? ''}`;
    const row = out.get(k) ?? quarters.map(() => 0);
    quarters.forEach((q, i) => {
      row[i] += fteIn(a, projects.get(a.projectId), q);
    });
    out.set(k, row);
  }
  for (const [k, row] of out) out.set(k, row.map(round2));
  return out;
}
