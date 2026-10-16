/** Number, date and label formatting shared by B2 pages (DESIGN_SYSTEM §3: one decimal FTE, integer %). */
import type * as D from '../../../shared/contracts/dto';
import type { QuarterView } from '../../../state';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 0.46 → "0.5". Never "-0.0". */
export function fte(n: number | null | undefined): string {
  const v = Math.round((n ?? 0) * 10) / 10;
  return (Object.is(v, -0) ? 0 : v).toFixed(1);
}
/** 0.46 → "0.5 FTE". */
export function fteUnit(n: number | null | undefined): string {
  return `${fte(n)} FTE`;
}
/** Signed FTE delta: "+0.5" / "−0.5" / "0.0". */
export function fteSigned(n: number): string {
  const v = Math.round(n * 10) / 10;
  if (v > 0) return `+${v.toFixed(1)}`;
  if (v < 0) return `−${Math.abs(v).toFixed(1)}`;
  return '0.0';
}
/** 94.6 → "95%". */
export function pct(n: number | null | undefined): string {
  return `${Math.round(n ?? 0)}%`;
}

/** "2026-11-02" → "2 Nov 2026". */
export function date(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
/** "2026-11-02" → "2 Nov". */
export function dateShort(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!m || !d) return iso;
  return `${d} ${MONTHS[m - 1]}`;
}
export function dateRange(a: string | null | undefined, b: string | null | undefined): string {
  if (!a && !b) return 'Open-ended';
  return `${a ? date(a) : 'Start'} – ${b ? date(b) : 'open'}`;
}
/** ISO date-time → "16 Oct 2026, 09:05". */
export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${hh}:${mm}`;
}
/** Relative time against `now` (pass the snapshot's serverTime to stay pure). */
export function relative(iso: string | null | undefined, now: string | number | Date): string {
  if (!iso) return 'never';
  const t = new Date(iso).getTime();
  const n = new Date(now).getTime();
  if (Number.isNaN(t) || Number.isNaN(n)) return '—';
  const s = Math.round((n - t) / 1000);
  const abs = Math.abs(s);
  const fmt = (v: number, unit: string) => `${v} ${unit}${v === 1 ? '' : 's'}`;
  let out: string;
  if (abs < 60) out = 'just now';
  else if (abs < 3600) out = fmt(Math.round(abs / 60), 'minute');
  else if (abs < 86400) out = fmt(Math.round(abs / 3600), 'hour');
  else out = fmt(Math.round(abs / 86400), 'day');
  if (out === 'just now') return out;
  return s >= 0 ? `${out} ago` : `in ${out}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '';
  return (first + last).toUpperCase();
}

/** "QBR1 · Q4 2026" — the time-basis caption every metric carries. */
export function quarterCaption(q: QuarterView | undefined): string {
  return q ? `${q.label} · ${q.calendarLabel}` : '';
}
export function quarterTooltip(q: QuarterView): string {
  const fiscal = q.fiscalLabel && q.fiscalLabel !== q.calendarLabel ? ` (${q.fiscalLabel})` : '';
  return `${q.label} = ${q.calendarLabel}${fiscal}, ${date(q.start)} – ${date(q.end)}`;
}

export const PROFICIENCY_LABEL: Record<D.Proficiency, string> = {
  1: 'Can assist',
  2: 'Can own with support',
  3: 'Can own independently',
};

export const STAGE_ORDER: D.ProjectStage[] = ['Pipeline', 'Initiated', 'Mobilising', 'In Flight', 'Closing'];

/** Lookup maps for a snapshot (cheap; call inside useMemo). */
export function indexSnapshot(s: D.WorkspaceSnapshot) {
  return {
    people: new Map(s.people.map((x) => [x.id, x])),
    projects: new Map(s.projects.map((x) => [x.id, x])),
    tribes: new Map(s.tribes.map((x) => [x.id, x])),
    chapters: new Map(s.chapters.map((x) => [x.id, x])),
    teams: new Map(s.teams.map((x) => [x.id, x])),
    crafts: new Map(s.crafts.map((x) => [x.id, x])),
  };
}
export type SnapshotIndex = ReturnType<typeof indexSnapshot>;

/** Sort helper: stable, locale-aware for strings, numeric otherwise. */
export function compare(a: string | number | null | undefined, b: string | number | null | undefined): number {
  if (a === b) return 0;
  if (a === null || a === undefined || a === '') return 1;
  if (b === null || b === undefined || b === '') return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

/** Builds CSV text (RFC 4180) from rows; formula-injection safe for spreadsheet apps. */
export function toCsv(header: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const cell = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return '';
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s) && typeof v === 'string') s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** Triggers a browser download of text content (no network). */
export function downloadText(filename: string, text: string, type = 'text/csv;charset=utf-8'): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** User-facing error text: never raw server text (DESIGN_SYSTEM §8.13). */
export function errorMessage(e: unknown, fallback = 'Something went wrong. Try again.'): string {
  const err = e as { status?: number; code?: string; message?: string; requestId?: string } | null;
  if (!err || typeof err !== 'object') return fallback;
  const ref = err.requestId ? ` Reference ${err.requestId}.` : '';
  if (err.status === 403 && err.code === 'entitlement') return 'Your plan does not include this.';
  if (err.status === 403) return 'You do not have permission to do that.';
  if (err.status === 404) return 'That item no longer exists. Reload to see the latest data.';
  if (err.status === 409) return err.message || 'Someone else changed this. Reload to see their change.';
  if (err.status === 400) return err.message || 'Check the highlighted fields.';
  if (err.status === 413) return 'Too many changes at once. Try a smaller selection.';
  return `${fallback}${ref}`;
}
