/**
 * Rolling quarter helpers.
 *
 * The PMO plans in a rolling four-quarter window. The current calendar quarter is "QBR1", the
 * next is "QBR2", and so on. Quarter keys are stable calendar quarters ('2026-Q4', A-1) so demand
 * entered against a quarter keeps meaning as the window rolls forward. A fiscal-year start month
 * (1, 4, 7 or 10) changes labels only ("FY27 Q1").
 *
 * Two families of helpers live here:
 *  - ISO-day helpers (`dayNumber`, `quarterBounds`, `overlapDays`, `rollingQuarterViews`, …) used by the
 *    2.0 view-models. They work on 'YYYY-MM-DD' strings in UTC day numbers, so results never
 *    depend on the browser's time zone or daylight-saving changes.
 *  - The v1.1 `Quarter` helpers (`getRollingQuarters`, `quarterFromKey`, `parseDay`,
 *    `overlapFraction`) still used by legacy components. They produce the same fractions.
 *
 * Pure: no React, DOM, Node or Netlify imports.
 */
import type { ISODate, QuarterKey } from '../shared/contracts/dto';
import type { QuarterView } from './viewModels/types';

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');
const DAY_MS = 86_400_000;

/* ── ISO-day helpers (2.0) ─────────────────────────────────────────────────────────── */

export type FiscalStartMonth = 1 | 4 | 7 | 10;

/** Validates 'YYYY-MM-DD' (or an ISO date-time; only the date part is used). */
export function isIsoDate(value: unknown): value is ISODate {
  if (typeof value !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return false;
  const y = Number(m[1]),
    mo = Number(m[2]),
    d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

/** Days since 1970-01-01 for an ISO date (UTC, so no time-zone drift). NaN when invalid. */
export function dayNumber(iso: ISODate): number {
  if (!isIsoDate(iso)) return NaN;
  return Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / DAY_MS;
}

export function isoFromDayNumber(n: number): ISODate {
  const d = new Date(n * DAY_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Adds `n` days to an ISO date. */
export function addDays(iso: ISODate, n: number): ISODate {
  return isoFromDayNumber(dayNumber(iso.slice(0, 10)) + n);
}

export function parseQuarterKey(key: string): { year: number; q: number } | null {
  const m = /^(\d{4})-Q([1-4])$/.exec(key);
  if (!m) return null;
  return { year: Number(m[1]), q: Number(m[2]) };
}

/** Calendar quarter key containing an ISO date. */
export function quarterKeyOf(iso: ISODate): QuarterKey {
  return `${iso.slice(0, 4)}-Q${Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1}`;
}

/** First and last day of a calendar quarter. */
export function quarterBounds(key: QuarterKey): { start: ISODate; end: ISODate } | null {
  const p = parseQuarterKey(key);
  if (!p) return null;
  const startMonth = (p.q - 1) * 3 + 1;
  const lastDay = new Date(Date.UTC(p.year, startMonth + 2, 0)).getUTCDate();
  return { start: `${p.year}-${pad(startMonth)}-01`, end: `${p.year}-${pad(startMonth + 2)}-${pad(lastDay)}` };
}

/** The quarter key `n` quarters after `key` (n may be negative). */
export function shiftQuarter(key: QuarterKey, n: number): QuarterKey {
  const p = parseQuarterKey(key);
  if (!p) return key;
  const idx = p.year * 4 + (p.q - 1) + n;
  return `${Math.floor(idx / 4)}-Q${(idx % 4) + 1}`;
}

/** Fiscal label for a calendar quarter. Fiscal years are named after the calendar year they end in. */
export function fiscalLabel(year: number, q: number, fiscalYearStartMonth: FiscalStartMonth): string {
  const startMonth = (q - 1) * 3 + 1;
  const fq = Math.floor(((startMonth - fiscalYearStartMonth + 12) % 12) / 3) + 1;
  const fy = fiscalYearStartMonth === 1 || startMonth < fiscalYearStartMonth ? year : year + 1;
  return `FY${String(fy).slice(2)} Q${fq}`;
}

/** "Oct–Dec 2026". */
export function quarterRangeLabel(key: QuarterKey): string {
  const p = parseQuarterKey(key);
  if (!p) return key;
  const m = (p.q - 1) * 3;
  return `${MONTH_SHORT[m]}–${MONTH_SHORT[m + 2]} ${p.year}`;
}

/** One QuarterView for a calendar quarter key at a position in the rolling window. */
export function quarterView(key: QuarterKey, index: number, fiscalYearStartMonth: FiscalStartMonth = 1): QuarterView {
  const p = parseQuarterKey(key);
  const b = quarterBounds(key);
  if (!p || !b) throw new Error(`Invalid quarter key: ${key}`);
  return {
    key,
    index: index as QuarterView['index'],
    label: `QBR${index + 1}` as QuarterView['label'],
    calendarLabel: `Q${p.q} ${p.year}`,
    fiscalLabel: fiscalLabel(p.year, p.q, fiscalYearStartMonth),
    start: b.start,
    end: b.end,
  };
}

/** Four rolling quarters starting with the quarter that contains `today` (QBR1 … QBR4). */
export function rollingQuarterViews(today: ISODate, fiscalYearStartMonth: FiscalStartMonth = 1): QuarterView[] {
  const first = quarterKeyOf(today);
  return [0, 1, 2, 3].map((i) => quarterView(shiftQuarter(first, i), i, fiscalYearStartMonth));
}

/** Number of days in [start, end] (inclusive). */
export function spanDays(start: ISODate, end: ISODate): number {
  return Math.max(0, dayNumber(end) - dayNumber(start) + 1);
}

/**
 * Days of [start, end] (null = open-ended) that fall inside [rangeStart, rangeEnd], inclusive.
 */
export function overlapDays(
  start: ISODate | null,
  end: ISODate | null,
  rangeStart: ISODate,
  rangeEnd: ISODate,
): number {
  const s = Math.max(start ? dayNumber(start) : -Infinity, dayNumber(rangeStart));
  const e = Math.min(end ? dayNumber(end) : Infinity, dayNumber(rangeEnd));
  return e < s ? 0 : e - s + 1;
}

/** Fraction (0..1) of the range [rangeStart, rangeEnd] covered by [start, end]. */
export function overlapShare(
  start: ISODate | null,
  end: ISODate | null,
  rangeStart: ISODate,
  rangeEnd: ISODate,
): number {
  const total = spanDays(rangeStart, rangeEnd);
  return total > 0 ? overlapDays(start, end, rangeStart, rangeEnd) / total : 0;
}

/* ── v1.1 Quarter helpers (legacy UI; kept until package B retires the old views) ─────────── */

export interface Quarter {
  key: string; // '2026-Q4'
  label: string; // 'QBR1'
  name: string; // 'Q4 2026'
  range: string; // 'Oct–Dec 2026'
  index: number; // 0..n-1 within the rolling window
  start: Date; // first day 00:00 local
  end: Date; // last day 23:59:59 local
  days: number;
}

export function quarterKeyFor(date: Date): string {
  const q = Math.floor(date.getMonth() / 3) + 1;
  return `${date.getFullYear()}-Q${q}`;
}

export function quarterFromKey(key: string, index = 0): Quarter | null {
  const parsed = parseQuarterKey(key);
  if (!parsed) return null;
  const startMonth = (parsed.q - 1) * 3;
  const start = new Date(parsed.year, startMonth, 1, 0, 0, 0, 0);
  const end = new Date(parsed.year, startMonth + 3, 0, 23, 59, 59, 999);
  const days = Math.round((end.getTime() - start.getTime()) / DAY_MS);
  return {
    key,
    label: `QBR${index + 1}`,
    name: `Q${parsed.q} ${parsed.year}`,
    range: quarterRangeLabel(key),
    index,
    start,
    end,
    days,
  };
}

/** Next `count` quarters starting from the quarter containing `from`. */
export function getRollingQuarters(from: Date, count = 4): Quarter[] {
  const out: Quarter[] = [];
  let year = from.getFullYear();
  let q = Math.floor(from.getMonth() / 3) + 1;
  for (let i = 0; i < count; i++) {
    const quarter = quarterFromKey(`${year}-Q${q}`, i);
    if (quarter) out.push(quarter);
    q += 1;
    if (q > 4) {
      q = 1;
      year += 1;
    }
  }
  return out;
}

/** Parse 'YYYY-MM-DD' (or an ISO string) into a local Date at the start or end of that day. */
export function parseDay(value: string | undefined | null, edge: 'start' | 'end'): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (!m) return null;
  const y = Number(m[1]),
    mo = Number(m[2]),
    d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return edge === 'start' ? new Date(y, mo - 1, d, 0, 0, 0, 0) : new Date(y, mo - 1, d, 23, 59, 59, 999);
}

/** Fraction (0..1) of the quarter that the [start, end] window covers. */
export function overlapFraction(start: Date | null, end: Date | null, quarter: Quarter): number {
  const s = start && start > quarter.start ? start : quarter.start;
  const e = end && end < quarter.end ? end : quarter.end;
  if (e < s) return 0;
  const days = Math.round((e.getTime() - s.getTime()) / DAY_MS);
  return Math.max(0, Math.min(1, days / quarter.days));
}

/** "0.5", "1", "12.5". */
export function formatFte(fte: number): string {
  return (Math.round(fte * 100) / 100).toFixed(fte >= 10 ? 1 : 2).replace(/\.?0+$/, '') || '0';
}
