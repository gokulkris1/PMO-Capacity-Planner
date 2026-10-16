/**
 * WP-0 STUB: four rolling calendar quarters with QBR and fiscal labels (A-1).
 * Pure; C may move this to utils/ and drive it from `utils/clock.ts`.
 */
import type { QuarterView } from '../../utils/viewModels/types';

const pad = (n: number) => String(n).padStart(2, '0');

/** Fiscal label for a calendar quarter; fiscal years are named after the calendar year they end in. */
export function fiscalLabel(year: number, q: number, fiscalYearStartMonth: 1 | 4 | 7 | 10): string {
  const startMonth = (q - 1) * 3 + 1;
  const fq = Math.floor(((startMonth - fiscalYearStartMonth + 12) % 12) / 3) + 1;
  const fy = fiscalYearStartMonth === 1 || startMonth < fiscalYearStartMonth ? year : year + 1;
  return `FY${String(fy).slice(2)} Q${fq}`;
}

export function rollingQuarterViews(today: Date, fiscalYearStartMonth: 1 | 4 | 7 | 10 = 1): QuarterView[] {
  let year = today.getFullYear();
  let q = Math.floor(today.getMonth() / 3) + 1;
  const out: QuarterView[] = [];
  for (let i = 0; i < 4; i++) {
    const startMonth = (q - 1) * 3 + 1;
    const lastDay = new Date(Date.UTC(year, startMonth + 2, 0)).getUTCDate();
    out.push({
      key: `${year}-Q${q}`,
      index: i as QuarterView['index'],
      label: `QBR${i + 1}` as QuarterView['label'],
      calendarLabel: `Q${q} ${year}`,
      fiscalLabel: fiscalLabel(year, q, fiscalYearStartMonth),
      start: `${year}-${pad(startMonth)}-01`,
      end: `${year}-${pad(startMonth + 2)}-${pad(lastDay)}`,
    });
    q += 1;
    if (q > 4) {
      q = 1;
      year += 1;
    }
  }
  return out;
}
