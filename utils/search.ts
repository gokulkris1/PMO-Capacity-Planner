/**
 * Global search index (SH-06): client-side over the workspace snapshot. Results are grouped
 * People, Projects, Tribes, Crafts (max 5 each, best match first). Matching is case- and
 * accent-insensitive; a label that starts with the query ranks above a word that starts with it,
 * which ranks above a substring, which ranks above a match on secondary text (job title, skills,
 * Jira key, tribe, craft code).
 *
 * Pure: no React, DOM, Node or Netlify imports.
 */
import type * as D from '../shared/contracts/dto';

export type SearchKind = 'person' | 'project' | 'tribe' | 'craft';
export interface SearchResult {
  kind: SearchKind;
  id: D.ID;
  label: string;
  sublabel: string;
}

const KIND_ORDER: SearchKind[] = ['person', 'project', 'tribe', 'craft'];
export const SEARCH_LIMIT_PER_KIND = 5;

export function normalise(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

interface Entry extends SearchResult {
  name: string;
  words: string[];
  extra: string;
}

function entry(kind: SearchKind, id: D.ID, label: string, sublabel: string, extra: Array<string | null | undefined>): Entry {
  const name = normalise(label);
  return {
    kind,
    id,
    label,
    sublabel,
    name,
    words: name.split(/[\s\-–·/&()]+/).filter(Boolean),
    extra: normalise(extra.filter(Boolean).join(' ')),
  };
}

function score(e: Entry, q: string): number {
  if (e.name.startsWith(q)) return 4;
  if (e.words.some((w) => w.startsWith(q))) return 3;
  if (e.name.includes(q)) return 2;
  if (e.extra.includes(q)) return 1;
  return 0;
}

export function buildSearchIndex(s: D.WorkspaceSnapshot): (q: string) => SearchResult[] {
  const tribes = new Map(s.tribes.map((t) => [t.id, t]));
  const crafts = new Map(s.crafts.map((c) => [c.id, c]));
  const entries: Entry[] = [
    ...s.people.map((p) =>
      entry('person', p.id, p.name, p.role, [
        p.role,
        p.email,
        p.location,
        ...p.skills,
        p.primaryCraft ? crafts.get(p.primaryCraft)?.name : null,
      ]),
    ),
    ...s.projects.map((p) => {
      const tribe = p.tribeId ? tribes.get(p.tribeId)?.name : null;
      return entry('project', p.id, p.name, [tribe, p.stage ?? p.status].filter(Boolean).join(' · '), [
        p.jiraKey,
        p.planviewId,
        tribe,
        p.description,
      ]);
    }),
    ...s.tribes
      .filter((t) => !t.archived)
      .map((t) => entry('tribe', t.id, t.name, t.leadName ? `Tribe · ${t.leadName}` : 'Tribe', [t.leadName])),
    ...s.crafts
      .filter((c) => !c.archived)
      .map((c) => entry('craft', c.id, c.name, c.short, [c.short, c.family, c.description])),
  ];

  return (raw: string) => {
    const q = normalise(raw);
    if (!q) return [];
    const scored = entries
      .map((e) => ({ e, s: score(e, q) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || a.e.label.localeCompare(b.e.label));
    const out: SearchResult[] = [];
    for (const kind of KIND_ORDER) {
      scored
        .filter((x) => x.e.kind === kind)
        .slice(0, SEARCH_LIMIT_PER_KIND)
        .forEach(({ e }) => out.push({ kind: e.kind, id: e.id, label: e.label, sublabel: e.sublabel }));
    }
    return out;
  };
}
