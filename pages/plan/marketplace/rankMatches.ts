/**
 * Ranked matches for one open demand line (DM-03#AC1), derived from the catalogue view-model.
 * Interim: the contract has no `suggestMatches` view-model; if C adds one, swap this for it.
 */
import type * as D from '../../../shared/contracts/dto';
import type { CatalogueEntry } from '../../../utils/viewModels';

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

export function rankMatches(entry: CatalogueEntry | undefined, project: D.ProjectDTO | undefined, gapFte: number, exclude: Set<D.ID>): Match[] {
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
