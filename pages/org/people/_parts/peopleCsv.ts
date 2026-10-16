/**
 * People CSV template, parser and validator for PPL-04 (pure). Interim: BACKLOG names `utils/csvPeople.ts`
 * (package C) as the long-term home; this module has the same column contract so the swap is mechanical.
 * Columns: name,email,job_title,type,location,chapter,team,home_tribe,target_pct,above_craft,below_crafts,skills
 * `below_crafts` is `short:level:cap` joined by `|` (e.g. `SM:3:50|BA:2:30`); `skills` is `;`-separated.
 */
import type * as D from '../../../../shared/contracts/dto';
import type { PeopleImportRow } from '../../../../shared/contracts/api';
import { toCsv } from '../../../plan/_kit/format';

export const PEOPLE_CSV_COLUMNS = [
  'name',
  'email',
  'job_title',
  'type',
  'location',
  'chapter',
  'team',
  'home_tribe',
  'target_pct',
  'above_craft',
  'below_crafts',
  'skills',
] as const;

export function peopleTemplateCsv(): string {
  return toCsv(
    [...PEOPLE_CSV_COLUMNS],
    [
      [
        'Maria Kelly',
        'maria.kelly@example.com',
        'Product Manager',
        'Permanent',
        'Dublin',
        'Product Management',
        'Product Management',
        'Operations',
        100,
        'PdM',
        'BA:2:30|VM:2:20',
        'Telephony;Vendor contracts',
      ],
    ],
  );
}

export function peopleToCsv(
  people: D.PersonDTO[],
  s: Pick<D.WorkspaceSnapshot, 'crafts' | 'chapters' | 'teams' | 'tribes'>,
): string {
  const craft = new Map(s.crafts.map((c) => [c.id, c.short]));
  const name = <T extends { id: string; name: string }>(list: T[], id: string | null) =>
    (id && list.find((x) => x.id === id)?.name) || '';
  return toCsv(
    [...PEOPLE_CSV_COLUMNS],
    people.map((p) => [
      p.name,
      p.email ?? '',
      p.role,
      p.type,
      p.location ?? '',
      name(s.chapters, p.chapterId),
      name(s.teams, p.teamId),
      name(s.tribes, p.homeTribeId),
      p.targetUtil,
      (p.primaryCraft && craft.get(p.primaryCraft)) || '',
      p.secondaryCrafts.map((c) => `${craft.get(c.craftId) ?? c.craftId}:${c.proficiency}:${c.maxPct}`).join('|'),
      p.skills.join(';'),
    ]),
  );
}

/** Minimal RFC 4180 parser (quotes, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export interface ParsedPersonRow {
  line: number;
  row: PeopleImportRow;
  errors: string[];
  match: 'create' | 'update';
}

const BOM = String.fromCharCode(0xfeff);
const TYPES: D.PersonType[] = ['Permanent', 'Contractor', 'Part-Time'];

export function validatePeopleCsv(
  text: string,
  s: Pick<D.WorkspaceSnapshot, 'crafts' | 'people'>,
): { rows: ParsedPersonRow[]; headerError: string | null } {
  const all = parseCsv(text.startsWith(BOM) ? text.slice(1) : text);
  if (all.length === 0) return { rows: [], headerError: 'The file is empty.' };
  const header = all[0].map((h) => h.trim().toLowerCase());
  const missing = ['name'].filter((c) => !header.includes(c));
  if (missing.length)
    return { rows: [], headerError: `Missing column "${missing[0]}". Download the template to see the format.` };
  const col = (r: string[], c: (typeof PEOPLE_CSV_COLUMNS)[number]) => {
    const i = header.indexOf(c);
    return i >= 0 ? (r[i] ?? '').trim() : '';
  };
  const byShort = new Map(s.crafts.filter((c) => !c.archived).map((c) => [c.short.toUpperCase(), c]));
  const byEmail = new Map(s.people.filter((p) => p.email).map((p) => [String(p.email).toLowerCase(), p]));
  const byName = new Map(s.people.map((p) => [p.name.toLowerCase(), p]));
  const rows = all.slice(1).map((r, i): ParsedPersonRow => {
    const errors: string[] = [];
    const name = col(r, 'name');
    if (!name) errors.push('Name is required');
    const email = col(r, 'email');
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.push(`Invalid email '${email}'`);
    const typeRaw = col(r, 'type');
    const type = typeRaw ? TYPES.find((t) => t.toLowerCase() === typeRaw.toLowerCase()) : undefined;
    if (typeRaw && !type) errors.push(`Unknown type '${typeRaw}'`);
    const targetRaw = col(r, 'target_pct');
    const target = targetRaw ? Number(targetRaw) : undefined;
    if (target !== undefined && (!Number.isFinite(target) || target < 0 || target > 150))
      errors.push('Target must be 0–150');
    const aboveRaw = col(r, 'above_craft');
    const above = aboveRaw ? byShort.get(aboveRaw.toUpperCase()) : undefined;
    if (aboveRaw && !above) errors.push(`Unknown craft '${aboveRaw}'`);
    const below: D.SecondaryCraftDTO[] = [];
    for (const part of col(r, 'below_crafts')
      .split('|')
      .map((x) => x.trim())
      .filter(Boolean)) {
      const [short, lvl, cap] = part.split(':');
      const craft = byShort.get((short ?? '').toUpperCase());
      const level = Number(lvl ?? 2);
      const maxPct = cap === undefined || cap === '' ? 40 : Number(cap);
      if (!craft) errors.push(`Unknown craft '${short}'`);
      else if (![1, 2, 3].includes(level)) errors.push(`Level for ${short} must be 1, 2 or 3`);
      else if (!Number.isFinite(maxPct) || maxPct < 0 || maxPct > 100) errors.push(`Cap for ${short} must be 0–100`);
      else if (above && craft.id === above.id) errors.push(`${short} is already their above-the-table craft`);
      else below.push({ craftId: craft.id, proficiency: level as D.Proficiency, maxPct });
    }
    const existing = (email && byEmail.get(email.toLowerCase())) || byName.get(name.toLowerCase());
    return {
      line: i + 2,
      errors,
      match: existing ? 'update' : 'create',
      row: {
        name,
        email: email || undefined,
        jobTitle: col(r, 'job_title') || undefined,
        type,
        location: col(r, 'location') || undefined,
        chapter: col(r, 'chapter') || undefined,
        team: col(r, 'team') || undefined,
        homeTribe: col(r, 'home_tribe') || undefined,
        targetPct: target,
        aboveCraft: above?.id,
        belowCrafts: below,
        skills: col(r, 'skills')
          .split(';')
          .map((x) => x.trim())
          .filter(Boolean),
      },
    };
  });
  return { rows, headerError: null };
}
