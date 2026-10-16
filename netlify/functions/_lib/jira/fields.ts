/**
 * Jira field detection and value parsing (JI-08). Pure TypeScript: no Node built-ins, no fetch, no DB.
 * Reusable unchanged by a Release 3.0 Forge resolver.
 */

export interface JiraField {
  id: string;
  name: string;
  schema?: { type?: string; custom?: string };
}

export interface JiraSprint {
  id: number;
  name: string;
  state: string;
  startDate: string | null;
  endDate: string | null;
  originBoardId: number | null;
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (isPlainObject(v)) {
    for (const k of ['DisplayName', 'displayName', 'Name', 'name', 'Title', 'title', 'id', 'Id', 'ID']) {
      if (typeof v[k] === 'string') return v[k] as string;
    }
  }
  return null;
}

export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 'YYYY-Qn' (calendar quarter, UTC) from a date string. */
export function quarterKey(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
}

/** Story points field: the preferred id if present, else "Story point estimate" / "Story points"; plus "Sprint". */
export function detectJiraFields(fields: JiraField[], preferredStoryPoints?: string) {
  const byName = (names: string[]) =>
    fields.find((f) =>
      names.includes(
        String(f.name || '')
          .trim()
          .toLowerCase(),
      ),
    );
  let storyPoints: JiraField | undefined;
  if (preferredStoryPoints) storyPoints = fields.find((f) => f.id === preferredStoryPoints);
  if (!storyPoints) storyPoints = byName(['story point estimate', 'story points']);
  const sprint = byName(['sprint']);
  return { storyPointsFieldId: storyPoints?.id, sprintFieldId: sprint?.id };
}

export function parseSprintValue(v: unknown): JiraSprint | null {
  if (isPlainObject(v)) {
    const id = num(v.id);
    if (id === null) return null;
    return {
      id,
      name: str(v.name) || `Sprint ${id}`,
      state: (str(v.state) || 'unknown').toLowerCase(),
      startDate: str(v.startDate),
      endDate: str(v.endDate),
      originBoardId: num(v.originBoardId),
    };
  }
  if (typeof v === 'string') {
    // Legacy "com.atlassian.greenhopper.service.sprint.Sprint@abc[id=1,name=Sprint 1,state=ACTIVE,...]" form
    const m = v.match(/\[(.*)\]$/);
    if (!m) return null;
    const kv: Record<string, string> = {};
    for (const pair of m[1].split(',')) {
      const idx = pair.indexOf('=');
      if (idx > 0) kv[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
    }
    const id = num(kv.id);
    if (id === null) return null;
    const clean = (s?: string) => (!s || s === '<null>' ? null : s);
    return {
      id,
      name: kv.name || `Sprint ${id}`,
      state: (kv.state || 'unknown').toLowerCase(),
      startDate: clean(kv.startDate),
      endDate: clean(kv.endDate),
      originBoardId: num(kv.rapidViewId),
    };
  }
  return null;
}

/** The issue's latest sprint: the one with the greatest startDate, else the last entry. */
export function latestSprint(raw: unknown): JiraSprint | null {
  const list = (Array.isArray(raw) ? raw : raw ? [raw] : []).map(parseSprintValue).filter((s): s is JiraSprint => !!s);
  if (!list.length) return null;
  let best = list[list.length - 1];
  let bestTime = best.startDate ? new Date(best.startDate).getTime() : -Infinity;
  for (const s of list) {
    const t = s.startDate ? new Date(s.startDate).getTime() : -Infinity;
    if (t > bestTime) {
      best = s;
      bestTime = t;
    }
  }
  return best;
}

export function isDone(fields: Record<string, unknown>): boolean {
  const status = isPlainObject(fields.status) ? fields.status : {};
  const cat = isPlainObject(status.statusCategory) ? status.statusCategory : {};
  return String(cat.key ?? '').toLowerCase() === 'done' || String(cat.name ?? '').toLowerCase() === 'done';
}

/** JQL string literal with quotes and backslashes removed (keys and dates only). */
export function jqlString(s: string): string {
  return `"${String(s).replace(/["\\]/g, '')}"`;
}
