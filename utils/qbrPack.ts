/**
 * QBR pack document model (RP-04#AC2): every section of the PDF as plain data, built from the
 * view-models (so the PDF and the pages agree). `utils/pdfExport.ts` renders it with jsPDF; the
 * model is pure and unit-tested.
 *
 * Sections: cover; squad utilisation QBR1–4 vs target (KPIs, table and chart); supply vs demand by
 * craft; open demand; over capacity / available lists; delivery signal by tribe (only when Jira is
 * mapped); time to staff (median, last 90 days).
 *
 * Pure: no React, DOM, Node or Netlify imports.
 */
import type * as D from '../shared/contracts/dto';
import { BAND_LABEL, type UtilBand, type UtilisationThresholds } from '../shared/utilisation';
import { PRODUCT_NAME } from '../constants';
import { formatFte } from './quarters';
import {
  buildCapacityOutlook,
  buildCraftBalance,
  buildHome,
  buildOpenDemand,
  buildTimeToStaff,
  deliverySignal,
  DELIVERY_SIGNAL_LABEL,
} from './viewModels';
import type { QuarterView } from './viewModels/types';

export type Cell = string | number;
export interface TableSection {
  kind: 'table';
  title: string;
  caption?: string;
  columns: string[];
  align: Array<'left' | 'right'>;
  rows: Cell[][];
  /** Column index holding a utilisation band (rendered with band colours). */
  bandColumn?: number;
  bands?: UtilBand[];
  empty: string;
}
export interface KpiSection {
  kind: 'kpis';
  title: string;
  items: Array<{ label: string; value: string; caption: string; band?: UtilBand }>;
}
export interface ChartSection {
  kind: 'chart';
  title: string;
  caption: string;
  categories: string[];
  /** Stacked series, in fixed order (DESIGN_SYSTEM §11.1): above, below, undeclared, free. */
  stacks: Array<{ name: string; slot: 1 | 2 | 3 | 'bench'; values: number[] }>;
  /** Demand markers (slot 4). */
  markers: { name: string; values: number[] };
  /** Target line. */
  target: { name: string; values: number[] };
  unit: 'FTE';
}
export type Section = TableSection | KpiSection | ChartSection;

export interface QbrPackModel {
  fileName: string;
  cover: { title: string; subtitle: string; generatedOn: string; basis: string };
  sections: Section[];
}

const fte = (n: number) => formatFte(n);
const pct = (n: number) => `${Math.round(n)}%`;

export interface QbrPackInput {
  snapshot: D.WorkspaceSnapshot;
  quarters: QuarterView[];
  thresholds: UtilisationThresholds;
  /** 'YYYY-MM-DD' (from utils/clock.today()). */
  generatedOn: D.ISODate;
  /** Use fiscal labels (ST-03#AC3) instead of calendar labels. */
  fiscalLabels?: boolean;
}

export function buildQbrPack(i: QbrPackInput): QbrPackModel {
  const { snapshot: s, quarters, thresholds: t } = i;
  const qLabel = (q: QuarterView) => `${q.label} · ${i.fiscalLabels ? q.fiscalLabel : q.calendarLabel}`;
  const sections: Section[] = [];

  // Squad utilisation QBR1–4 vs target.
  const outlook = buildCapacityOutlook(s, quarters, { pivot: 'person', thresholds: t });
  sections.push({
    kind: 'kpis',
    title: 'Squad utilisation',
    items: outlook.squad.map((p, k) => ({
      label: quarters[k].label,
      value: pct(p.utilisationPct),
      caption: `${qLabel(quarters[k])} · ${BAND_LABEL[p.band]}`,
      band: p.band,
    })),
  });
  sections.push({
    kind: 'chart',
    title: 'Supply and demand, QBR1–QBR4',
    caption: 'FTE, quarter-averaged. Bars: booked above the table, below the table, undeclared, free. Markers: demand.',
    categories: quarters.map(qLabel),
    stacks: [
      { name: 'Above the table', slot: 1, values: outlook.squad.map((p) => p.aboveFte) },
      { name: 'Below the table', slot: 2, values: outlook.squad.map((p) => p.belowFte) },
      { name: 'Undeclared craft', slot: 3, values: outlook.squad.map((p) => p.undeclaredFte) },
      { name: 'Free', slot: 'bench', values: outlook.squad.map((p) => p.freeFte) },
    ],
    markers: { name: 'Demand', values: outlook.squad.map((p) => p.demandFte) },
    target: { name: 'Target', values: outlook.squad.map((p) => p.supplyFte) },
    unit: 'FTE',
  });
  sections.push({
    kind: 'table',
    title: 'Squad utilisation vs target',
    columns: ['Quarter', 'Supply FTE', 'Booked FTE', 'Free FTE', 'Demand FTE', 'Utilisation', 'Band'],
    align: ['left', 'right', 'right', 'right', 'right', 'right', 'left'],
    rows: outlook.squad.map((p, k) => [
      qLabel(quarters[k]),
      fte(p.supplyFte),
      fte(p.aboveFte + p.belowFte + p.undeclaredFte),
      fte(p.freeFte),
      fte(p.demandFte),
      pct(p.utilisationPct),
      BAND_LABEL[p.band],
    ]),
    bandColumn: 6,
    bands: outlook.squad.map((p) => p.band),
    empty: 'No people in this workspace.',
  });

  // Supply vs demand by craft.
  const balance = buildCraftBalance(s, quarters).filter((r) =>
    r.quarters.some((q) => q.supplyFte || q.demandFte || q.committedFte),
  );
  sections.push({
    kind: 'table',
    title: 'Supply vs demand by craft',
    caption: 'Per quarter: supply (above-the-table holders) / committed / demand / gap, in FTE.',
    columns: ['Craft', ...quarters.map((q) => q.label)],
    align: ['left', ...quarters.map(() => 'right' as const)],
    rows: balance.map((r) => [
      r.craft.name,
      ...r.quarters.map((q) => `${fte(q.supplyFte)} / ${fte(q.committedFte)} / ${fte(q.demandFte)} / ${fte(q.gapFte)}`),
    ]),
    empty: 'No craft supply or demand.',
  });

  // Open demand.
  const open = buildOpenDemand(s, quarters, { matchLimit: 0 });
  sections.push({
    kind: 'table',
    title: 'Open demand',
    columns: ['Quarter', 'Project', 'Tribe', 'Craft', 'Demand', 'Staffed', 'Proposed', 'Open'],
    align: ['left', 'left', 'left', 'left', 'right', 'right', 'right', 'right'],
    rows: open.map((l) => [
      l.quarter.label,
      l.project.name,
      l.tribe?.name ?? '',
      l.craft?.short ?? l.craftId,
      fte(l.demandFte),
      fte(l.staffedFte),
      fte(l.proposedFte),
      fte(l.openFte),
    ]),
    empty: 'All captured demand is staffed or proposed.',
  });

  // Over capacity / available (QBR1).
  const home = buildHome(s, quarters, { kind: 'quarter', key: quarters[0]?.key ?? '' }, t, null);
  const personRows = (rows: typeof home.over) =>
    rows.map((r) => [
      r.person.name,
      r.primary?.short ?? '',
      pct(r.quarters[0]?.loadPct ?? 0),
      pct(r.quarters[0]?.relativePct ?? 0),
    ]);
  sections.push({
    kind: 'table',
    title: `Over capacity (${quarters[0] ? qLabel(quarters[0]) : 'QBR1'})`,
    columns: ['Person', 'Craft', 'Load', 'Of target'],
    align: ['left', 'left', 'right', 'right'],
    rows: personRows(home.over),
    empty: 'Nobody is over capacity.',
  });
  sections.push({
    kind: 'table',
    title: `Available (${quarters[0] ? qLabel(quarters[0]) : 'QBR1'})`,
    columns: ['Person', 'Craft', 'Load', 'Of target'],
    align: ['left', 'left', 'right', 'right'],
    rows: personRows(home.available),
    empty: 'Nobody is below the Available threshold.',
  });

  // Delivery signal by tribe (only when Jira is mapped).
  const delivery = s.delivery?.byProjectQbr1 ?? [];
  if (delivery.length) {
    const tribes = new Map(s.tribes.map((x) => [x.id, x.name]));
    const projects = new Map(s.projects.map((p) => [p.id, p]));
    const byTribe = new Map<string, { planned: number; implied: number }>();
    for (const d of delivery) {
      const name = tribes.get(projects.get(d.projectId)?.tribeId ?? '') ?? 'No tribe';
      const acc = byTribe.get(name) ?? { planned: 0, implied: 0 };
      acc.planned += d.plannedFte;
      acc.implied += d.impliedFte;
      byTribe.set(name, acc);
    }
    sections.push({
      kind: 'table',
      title: 'Delivery signal by tribe (QBR1)',
      caption: 'Planned FTE vs Jira-implied FTE. Signal, not a timesheet.',
      columns: ['Tribe', 'Planned FTE', 'Jira-implied FTE', 'Signal'],
      align: ['left', 'right', 'right', 'left'],
      rows: [...byTribe.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([name, v]) => [
          name,
          fte(v.planned),
          fte(v.implied),
          DELIVERY_SIGNAL_LABEL[deliverySignal(v.planned, v.implied)],
        ]),
      empty: 'No Jira data.',
    });
  }

  // Time to staff.
  const tts = buildTimeToStaff(s, i.generatedOn);
  sections.push({
    kind: 'kpis',
    title: 'Time to staff',
    items: [
      {
        label: 'Median, last 90 days',
        value: tts.medianDays90 === null ? 'No data' : `${tts.medianDays90} days`,
        caption: `${tts.rows.length} marketplace bookings confirmed`,
      },
    ],
  });

  const subtitle = `${s.org.name} · ${s.workspace.name}`;
  return {
    fileName: `qbr-pack-${i.generatedOn}.pdf`,
    cover: {
      title: `${PRODUCT_NAME} · QBR pack`,
      subtitle,
      generatedOn: i.generatedOn,
      basis: quarters.length ? `QBR1 = ${quarters[0].calendarLabel} (${quarters[0].fiscalLabel})` : '',
    },
    sections,
  };
}
