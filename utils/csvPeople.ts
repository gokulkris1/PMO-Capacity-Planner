/**
 * People CSV import/export (PPL-04): template, parser with a per-row validation report, and export
 * of the same columns.
 *
 * Columns: name,email,job_title,type,location,chapter,team,home_tribe,target_pct,above_craft,
 * below_crafts,skills — `below_crafts` is `short:level:cap` separated by `|` (e.g. `SM:3:50|BA:2:30`),
 * `skills` is separated by `|`. Crafts are matched by short code, id or name (case-insensitive);
 * chapters, teams and tribes by name. Nothing is written by the parser: the dialog shows the report
 * and sends only the valid rows (`PeopleImportRequest`).
 *
 * Pure: no React, DOM, Node or Netlify imports.
 */
import type * as D from '../shared/contracts/dto';
import type { PeopleImportRow } from '../shared/contracts/api';
import { parseCsvRecords, toCsv, type CsvColumn } from './csv';

export const PEOPLE_CSV_HEADERS = [
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

const DEFAULT_CAP = 40;

/** "Download template" (PPL-04#AC1): header plus one example row. */
export function peopleCsvTemplate(): string {
  return toCsv(
    [
      {
        name: 'Alex Murphy',
        email: 'alex.murphy@example.com',
        job_title: 'Project Manager',
        type: 'Permanent',
        location: 'Dublin',
        chapter: 'Project Management',
        team: 'Delivery',
        home_tribe: 'Digital',
        target_pct: 100,
        above_craft: 'PM',
        below_crafts: 'SM:3:50|BA:2:30',
        skills: 'Prince2|Jira',
      },
    ],
    PEOPLE_CSV_HEADERS.map((h) => ({ header: h, value: (r: Record<string, string | number>) => r[h] })),
  );
}

export interface ParsedPeopleRow {
  /** 1-based data row number (the header is row 0). */
  row: number;
  name: string;
  value: PeopleImportRow | null;
  errors: string[];
  /** Structure the import would create (only when createMissingStructure is ticked). */
  creates: string[];
  /** 'update' when an existing person matches by email (else name), otherwise 'create'. */
  action: 'create' | 'update' | null;
}

export interface PeopleCsvReport {
  headerErrors: string[];
  rows: ParsedPeopleRow[];
  validRows: PeopleImportRow[];
  invalidCount: number;
}

const norm = (s: string) => s.trim().toLowerCase();

function findCraft(crafts: D.CraftDTO[], token: string): D.CraftDTO | undefined {
  const t = norm(token);
  return (
    crafts.find((c) => norm(c.short) === t) ??
    crafts.find((c) => c.id === token.trim()) ??
    crafts.find((c) => norm(c.name) === t)
  );
}

const TYPE_ALIASES: Record<string, D.PersonType> = {
  permanent: 'Permanent',
  perm: 'Permanent',
  contractor: 'Contractor',
  contract: 'Contractor',
  'part-time': 'Part-Time',
  'part time': 'Part-Time',
  parttime: 'Part-Time',
};

export function parsePeopleCsv(
  text: string,
  s: Pick<D.WorkspaceSnapshot, 'crafts' | 'chapters' | 'teams' | 'tribes' | 'people'>,
  o: { createMissingStructure: boolean } = { createMissingStructure: false },
): PeopleCsvReport {
  const { headers, records } = parseCsvRecords(text);
  const headerErrors: string[] = [];
  if (!headers.includes('name')) headerErrors.push("The file needs a 'name' column. Use the template.");
  const unknown = headers.filter((h) => h && !(PEOPLE_CSV_HEADERS as readonly string[]).includes(h));
  if (unknown.length) headerErrors.push(`Unknown columns ignored: ${unknown.join(', ')}`);
  const crafts = s.crafts.filter((c) => !c.archived);
  const seenEmails = new Map<string, number>();
  const rows: ParsedPeopleRow[] = records.map((r, i) => {
    const row = i + 1;
    const errors: string[] = [];
    const creates: string[] = [];
    const name = r.name ?? '';
    if (!name) errors.push('Name is required');

    const email = r.email || undefined;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push(`Invalid email '${email}'`);
    if (email) {
      const prev = seenEmails.get(norm(email));
      if (prev) errors.push(`Same email as row ${prev}`);
      else seenEmails.set(norm(email), row);
    }

    let type: D.PersonType | undefined;
    if (r.type) {
      type = TYPE_ALIASES[norm(r.type)];
      if (!type) errors.push(`Type must be Permanent, Contractor or Part-Time`);
    }

    let targetPct: number | undefined;
    if (r.target_pct) {
      const n = Number(r.target_pct.replace('%', ''));
      if (!Number.isFinite(n) || n < 0 || n > 150) errors.push('Target must be 0–150');
      else targetPct = n;
    }

    const structure = (
      kind: 'chapter' | 'team' | 'home tribe',
      value: string | undefined,
      list: Array<{ name: string }>,
    ) => {
      if (!value) return undefined;
      if (list.some((x) => norm(x.name) === norm(value))) return value;
      if (o.createMissingStructure) creates.push(`${kind} '${value}'`);
      else errors.push(`Unknown ${kind} '${value}'`);
      return value;
    };
    const chapter = structure('chapter', r.chapter, s.chapters);
    const team = structure('team', r.team, s.teams);
    const homeTribe = structure('home tribe', r.home_tribe, s.tribes);

    let aboveCraft: string | undefined;
    if (r.above_craft) {
      const c = findCraft(crafts, r.above_craft);
      if (!c) errors.push(`Unknown craft '${r.above_craft}'`);
      else aboveCraft = c.id;
    }

    let belowCrafts: D.SecondaryCraftDTO[] | undefined;
    if (r.below_crafts) {
      belowCrafts = [];
      for (const token of r.below_crafts
        .split('|')
        .map((t) => t.trim())
        .filter(Boolean)) {
        const [short, level, cap] = token.split(':').map((t) => t.trim());
        const c = findCraft(crafts, short ?? '');
        if (!c) {
          errors.push(`Unknown craft '${short}'`);
          continue;
        }
        const proficiency = level === undefined || level === '' ? 1 : Number(level);
        if (![1, 2, 3].includes(proficiency)) {
          errors.push(`Level for ${c.short} must be 1, 2 or 3`);
          continue;
        }
        const maxPct = cap === undefined || cap === '' ? DEFAULT_CAP : Number(cap.replace('%', ''));
        if (!Number.isFinite(maxPct) || maxPct < 0 || maxPct > 100) {
          errors.push(`Cap for ${c.short} must be 0–100`);
          continue;
        }
        if (c.id === aboveCraft) {
          errors.push(`${c.short} is already their above-the-table craft`);
          continue;
        }
        if (belowCrafts.some((b) => b.craftId === c.id)) {
          errors.push(`${c.short} is listed twice`);
          continue;
        }
        belowCrafts.push({ craftId: c.id, proficiency: proficiency as D.Proficiency, maxPct });
      }
    }

    const skills = r.skills
      ? r.skills
          .split(/[|;]/)
          .map((x) => x.trim())
          .filter(Boolean)
      : undefined;

    const match = s.people.find(
      (p) => (email && p.email && norm(p.email) === norm(email)) || (!email && name && norm(p.name) === norm(name)),
    );
    const value: PeopleImportRow | null = errors.length
      ? null
      : {
          name,
          ...(email !== undefined && { email }),
          ...(r.job_title && { jobTitle: r.job_title }),
          ...(type && { type }),
          ...(r.location && { location: r.location }),
          ...(chapter && { chapter }),
          ...(team && { team }),
          ...(homeTribe && { homeTribe }),
          ...(targetPct !== undefined && { targetPct }),
          ...(aboveCraft && { aboveCraft }),
          ...(belowCrafts && { belowCrafts }),
          ...(skills && { skills }),
        };
    return { row, name, value, errors, creates, action: value ? (match ? 'update' : 'create') : null };
  });
  const validRows = headerErrors.some((e) => e.startsWith('The file needs'))
    ? []
    : rows.filter((r) => r.value).map((r) => r.value!);
  return { headerErrors, rows, validRows, invalidCount: rows.length - validRows.length };
}

/** Export (PPL-04#AC4): the template columns for the given people (e.g. the current filter). */
export function peopleToCsv(s: D.WorkspaceSnapshot, people: readonly D.PersonDTO[] = s.people): string {
  const crafts = new Map(s.crafts.map((c) => [c.id, c]));
  const chapters = new Map(s.chapters.map((c) => [c.id, c.name]));
  const teams = new Map(s.teams.map((t) => [t.id, t.name]));
  const tribes = new Map(s.tribes.map((t) => [t.id, t.name]));
  const short = (id: string | null) => (id ? (crafts.get(id)?.short ?? id) : '');
  const cols: Array<CsvColumn<D.PersonDTO>> = [
    { header: 'name', value: (p) => p.name },
    { header: 'email', value: (p) => p.email },
    { header: 'job_title', value: (p) => p.role },
    { header: 'type', value: (p) => p.type },
    { header: 'location', value: (p) => p.location },
    { header: 'chapter', value: (p) => (p.chapterId ? chapters.get(p.chapterId) : '') },
    { header: 'team', value: (p) => (p.teamId ? teams.get(p.teamId) : '') },
    { header: 'home_tribe', value: (p) => (p.homeTribeId ? tribes.get(p.homeTribeId) : '') },
    { header: 'target_pct', value: (p) => p.targetUtil },
    { header: 'above_craft', value: (p) => short(p.primaryCraft) },
    {
      header: 'below_crafts',
      value: (p) => p.secondaryCrafts.map((c) => `${short(c.craftId)}:${c.proficiency}:${c.maxPct}`).join('|'),
    },
    { header: 'skills', value: (p) => p.skills.join('|') },
  ];
  return toCsv(people, cols);
}
