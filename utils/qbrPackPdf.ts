/**
 * QBR pack download with the signature of B2's interim `pages/reports/_parts/qbrPackPdf.ts`:
 * `downloadQbrPack(data, meta)`. jsPDF loads on demand (SH-08#AC2): this module imports
 * `utils/pdfExport.ts` dynamically, so importing it statically from a page is cheap.
 *
 * `qbrPackModel()` (pure) turns B2's `QbrPackData` (from `utils/reportData.buildQbrPack`) into the
 * section model that `utils/pdfExport.renderQbrPack` draws with the DESIGN_SYSTEM §11.5 palette.
 */
import { BAND_LABEL } from '../shared/utilisation';
import { PRODUCT_NAME } from '../constants';
import type { QbrPackModel, Section } from './qbrPack';
import { formatFte } from './quarters';
import type { QbrPackData } from './reportData';
import { deliverySignal, DELIVERY_SIGNAL_LABEL } from './viewModels';

export interface QbrPackMeta {
  org: string;
  workspace: string;
  /** ISO date or date-time. */
  generatedAt: string;
  filename: string;
}

const fte = (n: number) => formatFte(n);
const pct = (n: number) => `${Math.round(n)}%`;

export function qbrPackModel(data: QbrPackData, meta: QbrPackMeta): QbrPackModel {
  const q = data.quarters;
  const qLabel = (i: number) => (q[i] ? `${q[i].label} · ${q[i].calendarLabel}` : '');
  const sections: Section[] = [
    {
      kind: 'kpis',
      title: 'Squad utilisation',
      items: data.squad.map((p, i) => ({
        label: q[i]?.label ?? p.quarterKey,
        value: pct(p.utilisationPct),
        caption: `${qLabel(i)} · ${BAND_LABEL[p.band]}`,
        band: p.band,
      })),
    },
    {
      kind: 'chart',
      title: 'Supply and demand, QBR1–QBR4',
      caption:
        'FTE, quarter-averaged. Bars: booked above the table, below the table, undeclared, free. Markers: demand.',
      categories: data.squad.map((_, i) => qLabel(i)),
      stacks: [
        { name: 'Above the table', slot: 1, values: data.squad.map((p) => p.aboveFte) },
        { name: 'Below the table', slot: 2, values: data.squad.map((p) => p.belowFte) },
        { name: 'Undeclared craft', slot: 3, values: data.squad.map((p) => p.undeclaredFte) },
        { name: 'Free', slot: 'bench', values: data.squad.map((p) => p.freeFte) },
      ],
      markers: { name: 'Demand', values: data.squad.map((p) => p.demandFte) },
      target: { name: 'Target', values: data.squad.map((p) => p.supplyFte) },
      unit: 'FTE',
    },
    {
      kind: 'table',
      title: 'Supply vs demand by craft',
      caption: 'Per quarter: supply / booked / demand, in FTE. Reach = below-the-table capacity in QBR1.',
      columns: ['Craft', ...q.map((x) => x.label), 'Reach QBR1'],
      align: ['left', ...q.map(() => 'right' as const), 'right'],
      rows: data.crafts.map((c) => [
        c.label,
        ...c.points.map(
          (p) => `${fte(p.supplyFte)} / ${fte(p.aboveFte + p.belowFte + p.undeclaredFte)} / ${fte(p.demandFte)}`,
        ),
        fte(c.reachQ1),
      ]),
      empty: 'No craft supply or demand.',
    },
    {
      kind: 'table',
      title: 'Open demand',
      columns: ['Quarter', 'Project', 'Tribe', 'Craft', 'Open FTE'],
      align: ['left', 'left', 'left', 'left', 'right'],
      rows: data.openDemand.map((o) => [o.quarter, o.project, o.tribe, o.craft, fte(o.open)]),
      empty: 'All captured demand is staffed or proposed.',
    },
    {
      kind: 'table',
      title: `Over capacity (${qLabel(0) || 'QBR1'})`,
      columns: ['Person', 'Of target'],
      align: ['left', 'right'],
      rows: data.over.map((o) => [o.name, pct(o.pct)]),
      empty: 'Nobody is over capacity.',
    },
    {
      kind: 'table',
      title: `Under target and available (${qLabel(0) || 'QBR1'})`,
      columns: ['Person', 'Of target', 'Band'],
      align: ['left', 'right', 'left'],
      rows: data.under.map((u) => [u.name, pct(u.pct), u.band]),
      empty: 'Everyone is on target or over.',
    },
  ];
  if (data.delivery.length) {
    sections.push({
      kind: 'table',
      title: 'Delivery signal by tribe (QBR1)',
      caption: 'Planned FTE vs Jira-implied FTE. Signal, not a timesheet.',
      columns: ['Tribe', 'Planned FTE', 'Jira-implied FTE', 'Signal'],
      align: ['left', 'right', 'right', 'left'],
      rows: data.delivery.map((d) => [
        d.tribe,
        fte(d.planned),
        fte(d.implied),
        DELIVERY_SIGNAL_LABEL[deliverySignal(d.planned, d.implied)],
      ]),
      empty: 'No Jira data.',
    });
  }
  sections.push({
    kind: 'kpis',
    title: 'Time to staff',
    items: [
      {
        label: 'Median, last 90 days',
        value:
          data.timeToStaffMedianHours === null
            ? 'No data'
            : `${Math.round((data.timeToStaffMedianHours / 24) * 10) / 10} days`,
        caption: `${data.timeToStaffCount} marketplace bookings confirmed`,
      },
    ],
  });
  return {
    fileName: meta.filename,
    cover: {
      title: `${PRODUCT_NAME} · QBR pack`,
      subtitle: `${meta.org} · ${meta.workspace}`,
      generatedOn: coverDate(meta.generatedAt),
      basis: q[0] ? `QBR1 = ${q[0].calendarLabel} (${q[0].fiscalLabel})` : '',
    },
    sections,
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "17 Oct 2026" from an ISO date or date-time (QA-031: the cover used to cut a formatted date at 10 characters). */
export function coverDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

/** Renders and downloads the QBR pack; jsPDF is fetched on first use. */
export async function downloadQbrPack(data: QbrPackData, meta: QbrPackMeta): Promise<void> {
  const { downloadQbrPack: download } = await import('./pdfExport');
  download(qbrPackModel(data, meta));
}
