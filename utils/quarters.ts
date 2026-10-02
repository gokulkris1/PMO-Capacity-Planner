/**
 * Rolling quarter helpers.
 *
 * The PMO plans in a rolling four-quarter window. The current calendar quarter is
 * "QBR1", the next is "QBR2", and so on. Quarter keys are stable ('2026-Q4') so
 * demand entered against a quarter keeps meaning as the window rolls forward.
 */

export interface Quarter {
    key: string;        // '2026-Q4'
    label: string;      // 'QBR1'
    name: string;       // 'Q4 2026'
    range: string;      // 'Oct–Dec 2026'
    index: number;      // 0..n-1 within the rolling window
    start: Date;        // first day 00:00 local
    end: Date;          // last day 23:59:59 local
    days: number;
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function quarterKeyFor(date: Date): string {
    const q = Math.floor(date.getMonth() / 3) + 1;
    return `${date.getFullYear()}-Q${q}`;
}

export function parseQuarterKey(key: string): { year: number; q: number } | null {
    const m = /^(\d{4})-Q([1-4])$/.exec(key);
    if (!m) return null;
    return { year: Number(m[1]), q: Number(m[2]) };
}

export function quarterFromKey(key: string, index = 0): Quarter | null {
    const parsed = parseQuarterKey(key);
    if (!parsed) return null;
    const startMonth = (parsed.q - 1) * 3;
    const start = new Date(parsed.year, startMonth, 1, 0, 0, 0, 0);
    const end = new Date(parsed.year, startMonth + 3, 0, 23, 59, 59, 999);
    const days = Math.round((end.getTime() - start.getTime()) / 86400000);
    return {
        key,
        label: `QBR${index + 1}`,
        name: `Q${parsed.q} ${parsed.year}`,
        range: `${MONTH_SHORT[startMonth]}–${MONTH_SHORT[startMonth + 2]} ${parsed.year}`,
        index,
        start,
        end,
        days,
    };
}

/** Next `count` quarters starting from the quarter containing `from` (default: today). */
export function getRollingQuarters(from: Date = new Date(), count = 4): Quarter[] {
    const out: Quarter[] = [];
    let year = from.getFullYear();
    let q = Math.floor(from.getMonth() / 3) + 1;
    for (let i = 0; i < count; i++) {
        const quarter = quarterFromKey(`${year}-Q${q}`, i);
        if (quarter) out.push(quarter);
        q += 1;
        if (q > 4) { q = 1; year += 1; }
    }
    return out;
}

/** Parse 'YYYY-MM-DD' (or an ISO string) into a local Date at the start or end of that day. */
export function parseDay(value: string | undefined | null, edge: 'start' | 'end'): Date | null {
    if (!value) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
    if (!m) return null;
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return edge === 'start'
        ? new Date(y, mo - 1, d, 0, 0, 0, 0)
        : new Date(y, mo - 1, d, 23, 59, 59, 999);
}

/** Fraction (0..1) of the quarter that the [start, end] window covers. */
export function overlapFraction(start: Date | null, end: Date | null, quarter: Quarter): number {
    const s = start && start > quarter.start ? start : quarter.start;
    const e = end && end < quarter.end ? end : quarter.end;
    if (e < s) return 0;
    const days = Math.round((e.getTime() - s.getTime()) / 86400000);
    return Math.max(0, Math.min(1, days / quarter.days));
}

export function formatFte(fte: number): string {
    return (Math.round(fte * 100) / 100).toFixed(fte >= 10 ? 1 : 2).replace(/\.?0+$/, '') || '0';
}
