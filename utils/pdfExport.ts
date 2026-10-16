/**
 * PDF rendering with jsPDF (RP-04, SH-08#AC2). Load this module on demand:
 *
 *   const { downloadQbrPack } = await import('../../utils/pdfExport');
 *   downloadQbrPack(buildQbrPack({ snapshot, quarters, thresholds, generatedOn: today() }));
 *
 * so `jspdf` is in its own chunk and is not fetched until "Download" is clicked. Colours are the
 * fixed PDF palette from DESIGN_SYSTEM §11.5 (the only place outside styles/ where hex is allowed;
 * jsPDF cannot read CSS variables). Font: Helvetica, 9/11/14/18 pt.
 */
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { UtilBand } from '../shared/utilisation';
import { PRODUCT_NAME } from '../constants';
import type { Allocation, Project, Resource } from '../types';
import type { ChartSection, KpiSection, QbrPackModel, TableSection } from './qbrPack';

/** DESIGN_SYSTEM §11.5 PDF palette. */
export const PDF_PALETTE = {
  text: '#14233B',
  secondary: '#44546F',
  tertiary: '#5E6C84',
  border: '#DCE2EA',
  headerFill: '#EEF1F6',
  primary: '#1F5FCC',
  series: ['#1F5FCC', '#00897A', '#C77A12', '#6E56CF', '#C2417A', '#4E7F2A', '#2E93D1', '#9A5B2E'],
  target: '#0B1F3A',
  bench: '#E3E8EF',
  benchHatch: '#B8C3D2',
  bands: {
    bench: { fg: '#44546F', bg: '#EEF1F6' },
    under: { fg: '#A35200', bg: '#FFF3E0' },
    'on-target': { fg: '#17744A', bg: '#E6F4EC' },
    over: { fg: '#C22E2E', bg: '#FDECEC' },
  } satisfies Record<UtilBand, { fg: string; bg: string }>,
} as const;

const SIZE = { caption: 9, body: 11, h3: 14, h1: 18 } as const;
const MARGIN = 14;

type Rgb = [number, number, number];
export function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function lastY(doc: jsPDF, fallback: number): number {
  return (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? fallback;
}

class Writer {
  y = MARGIN;
  readonly width: number;
  readonly height: number;
  constructor(readonly doc: jsPDF) {
    this.width = doc.internal.pageSize.getWidth();
    this.height = doc.internal.pageSize.getHeight();
  }
  ensure(space: number): void {
    if (this.y + space > this.height - MARGIN - 8) {
      this.doc.addPage();
      this.y = MARGIN + 4;
    }
  }
  text(s: string, size: number, color: string, style: 'normal' | 'bold' = 'normal', x = MARGIN): void {
    this.doc.setFont('helvetica', style);
    this.doc.setFontSize(size);
    this.doc.setTextColor(...hexToRgb(color));
    this.doc.text(s, x, this.y);
  }
  heading(s: string): void {
    this.ensure(32);
    this.y += 6;
    this.text(s, SIZE.h3, PDF_PALETTE.text, 'bold');
    this.y += 6;
  }
}

function drawCover(w: Writer, model: QbrPackModel): void {
  const { doc } = w;
  // Product mark: rounded square with three capacity bars (DESIGN_SYSTEM §9).
  doc.setFillColor(...hexToRgb(PDF_PALETTE.primary));
  doc.roundedRect(MARGIN, 18, 10, 10, 2.5, 2.5, 'F');
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(MARGIN + 2, 20.7, 3.4, 1, 0.5, 0.5, 'F');
  doc.roundedRect(MARGIN + 2, 22.5, 4.6, 1, 0.5, 0.5, 'F');
  doc.roundedRect(MARGIN + 2, 24.3, 5.8, 1, 0.5, 0.5, 'F');
  w.y = 25.5;
  w.text(PRODUCT_NAME, SIZE.body, PDF_PALETTE.text, 'bold', MARGIN + 13);
  w.y = 48;
  w.text(model.cover.title, SIZE.h1, PDF_PALETTE.text, 'bold');
  w.y += 9;
  w.text(`${model.cover.subtitle} · generated ${model.cover.generatedOn}`, SIZE.body, PDF_PALETTE.secondary);
  if (model.cover.basis) {
    w.y += 6;
    w.text(model.cover.basis, SIZE.caption, PDF_PALETTE.tertiary);
  }
  doc.setDrawColor(...hexToRgb(PDF_PALETTE.border));
  doc.line(MARGIN, w.y + 5, w.width - MARGIN, w.y + 5);
  w.y += 10;
}

function drawKpis(w: Writer, s: KpiSection): void {
  w.heading(s.title);
  const { doc } = w;
  const gap = 4;
  const n = Math.max(1, s.items.length);
  const tileW = (w.width - 2 * MARGIN - gap * (n - 1)) / n;
  w.ensure(24);
  s.items.forEach((k, i) => {
    const x = MARGIN + i * (tileW + gap);
    const band = k.band ? PDF_PALETTE.bands[k.band] : null;
    doc.setDrawColor(...hexToRgb(PDF_PALETTE.border));
    doc.setFillColor(...hexToRgb(band ? band.bg : '#FFFFFF'));
    doc.roundedRect(x, w.y, tileW, 20, 1.5, 1.5, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(SIZE.caption);
    doc.setTextColor(...hexToRgb(PDF_PALETTE.secondary));
    doc.text(k.label, x + 3, w.y + 5);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(SIZE.h3);
    doc.setTextColor(...hexToRgb(band ? band.fg : PDF_PALETTE.text));
    doc.text(k.value, x + 3, w.y + 12);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...hexToRgb(PDF_PALETTE.tertiary));
    doc.text(doc.splitTextToSize(k.caption, tileW - 6)[0] ?? '', x + 3, w.y + 17);
  });
  w.y += 24;
}

function drawTable(w: Writer, s: TableSection): void {
  w.heading(s.title);
  if (s.caption) {
    w.text(s.caption, SIZE.caption, PDF_PALETTE.tertiary);
    w.y += 3;
  }
  if (s.rows.length === 0) {
    w.y += 2;
    w.text(s.empty, SIZE.caption, PDF_PALETTE.secondary);
    w.y += 4;
    return;
  }
  autoTable(w.doc, {
    startY: w.y,
    margin: { left: MARGIN, right: MARGIN },
    head: [s.columns],
    body: s.rows.map((r) => r.map((c) => String(c))),
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: SIZE.caption,
      textColor: hexToRgb(PDF_PALETTE.text),
      lineColor: hexToRgb(PDF_PALETTE.border),
      lineWidth: 0.2,
    },
    headStyles: {
      fillColor: hexToRgb(PDF_PALETTE.headerFill),
      textColor: hexToRgb(PDF_PALETTE.secondary),
      fontStyle: 'bold',
    },
    columnStyles: Object.fromEntries(s.align.map((a, i) => [i, { halign: a }])),
    didParseCell: (data) => {
      if (data.section !== 'body' || s.bandColumn === undefined || data.column.index !== s.bandColumn) return;
      const band = s.bands?.[data.row.index];
      if (!band) return;
      data.cell.styles.fillColor = hexToRgb(PDF_PALETTE.bands[band].bg);
      data.cell.styles.textColor = hexToRgb(PDF_PALETTE.bands[band].fg);
    },
  });
  w.y = lastY(w.doc, w.y) + 4;
}

function drawChart(w: Writer, s: ChartSection): void {
  w.heading(s.title);
  w.text(s.caption, SIZE.caption, PDF_PALETTE.tertiary);
  w.y += 4;
  const { doc } = w;
  const height = 60;
  w.ensure(height + 16);
  const top = w.y;
  const left = MARGIN + 10;
  const right = w.width - MARGIN;
  const totals = s.categories.map((_, i) => s.stacks.reduce((x, st) => x + (st.values[i] ?? 0), 0));
  const max = Math.max(1, ...totals, ...s.markers.values, ...s.target.values) * 1.1;
  const yOf = (v: number) => top + height - (v / max) * height;
  // Gridlines and axis labels.
  doc.setDrawColor(...hexToRgb(PDF_PALETTE.bench));
  doc.setFontSize(7);
  doc.setTextColor(...hexToRgb(PDF_PALETTE.tertiary));
  for (let k = 0; k <= 4; k++) {
    const v = (max / 4) * k;
    doc.line(left, yOf(v), right, yOf(v));
    doc.text(v.toFixed(1), MARGIN, yOf(v) + 1);
  }
  const slotW = (right - left) / s.categories.length;
  const barW = Math.min(18, slotW * 0.5);
  s.categories.forEach((label, i) => {
    const x = left + slotW * i + (slotW - barW) / 2;
    let base = 0;
    for (const st of s.stacks) {
      const v = st.values[i] ?? 0;
      if (v <= 0) continue;
      const color = st.slot === 'bench' ? PDF_PALETTE.bench : PDF_PALETTE.series[st.slot - 1];
      doc.setFillColor(...hexToRgb(color));
      doc.rect(x, yOf(base + v), barW, yOf(base) - yOf(base + v) - 0.4, 'F');
      base += v;
    }
    // Demand marker (slot 4) and target (dashed navy).
    doc.setDrawColor(...hexToRgb(PDF_PALETTE.series[3]));
    doc.setLineWidth(0.8);
    doc.line(x - 2, yOf(s.markers.values[i] ?? 0), x + barW + 2, yOf(s.markers.values[i] ?? 0));
    doc.setDrawColor(...hexToRgb(PDF_PALETTE.target));
    doc.setLineWidth(0.4);
    doc.setLineDashPattern([1.5, 1.5], 0);
    doc.line(x - 3, yOf(s.target.values[i] ?? 0), x + barW + 3, yOf(s.target.values[i] ?? 0));
    doc.setLineDashPattern([], 0);
    doc.setLineWidth(0.2);
    doc.setFontSize(7);
    doc.setTextColor(...hexToRgb(PDF_PALETTE.secondary));
    doc.text(label, x + barW / 2, top + height + 5, { align: 'center' });
  });
  // Legend.
  let lx = left;
  const ly = top + height + 11;
  const legend: Array<[string, string]> = [
    ...s.stacks.map((st): [string, string] => [
      st.name,
      st.slot === 'bench' ? PDF_PALETTE.bench : PDF_PALETTE.series[st.slot - 1],
    ]),
    [s.markers.name, PDF_PALETTE.series[3]],
    [s.target.name, PDF_PALETTE.target],
  ];
  doc.setFontSize(7);
  for (const [name, color] of legend) {
    doc.setFillColor(...hexToRgb(color));
    doc.rect(lx, ly - 2.5, 3, 3, 'F');
    doc.setTextColor(...hexToRgb(PDF_PALETTE.secondary));
    doc.text(name, lx + 4.5, ly);
    lx += doc.getTextWidth(name) + 10;
  }
  w.y = ly + 6;
}

function footer(doc: jsPDF, title: string): void {
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...hexToRgb(PDF_PALETTE.tertiary));
    doc.text(
      `${title} · Page ${i} of ${pages}`,
      doc.internal.pageSize.getWidth() / 2,
      doc.internal.pageSize.getHeight() - 8,
      {
        align: 'center',
      },
    );
  }
}

/** Renders the QBR pack model to a jsPDF document (A4 portrait). */
export function renderQbrPack(model: QbrPackModel): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const w = new Writer(doc);
  drawCover(w, model);
  for (const s of model.sections) {
    if (s.kind === 'kpis') drawKpis(w, s);
    else if (s.kind === 'chart') drawChart(w, s);
    else drawTable(w, s);
  }
  footer(doc, `${PRODUCT_NAME} · QBR pack`);
  return doc;
}

/** Renders and downloads the QBR pack. */
export function downloadQbrPack(model: QbrPackModel): void {
  renderQbrPack(model).save(model.fileName);
}

/**
 * @deprecated v1.1 "Executive summary" used by the legacy App.tsx. Replaced by the QBR pack
 * (RP-04); removed when package B retires the old header action.
 */
export function exportExecSummaryPDF(resources: Resource[], projects: Project[], allocations: Allocation[]): void {
  const doc = new jsPDF();
  const w = new Writer(doc);
  w.y = 22;
  w.text(`${PRODUCT_NAME} · Executive summary`, SIZE.h1, PDF_PALETTE.text, 'bold');
  w.y += 8;
  w.text(`Generated ${new Date().toISOString().slice(0, 10)}`, SIZE.caption, PDF_PALETTE.tertiary);
  w.y += 4;
  const load = (id: string) => allocations.filter((a) => a.resourceId === id).reduce((x, a) => x + a.percentage, 0);
  drawTable(w, {
    kind: 'table',
    title: 'People',
    columns: ['Person', 'Role', 'Booked %'],
    align: ['left', 'left', 'right'],
    rows: resources.map((r) => [r.name, r.role, `${load(r.id)}%`]),
    empty: 'No people.',
  });
  drawTable(w, {
    kind: 'table',
    title: 'Projects',
    columns: ['Project', 'Status', 'Priority', 'Booked FTE'],
    align: ['left', 'left', 'left', 'right'],
    rows: projects.map((p) => [
      p.name,
      p.status,
      p.priority,
      (allocations.filter((a) => a.projectId === p.id).reduce((x, a) => x + a.percentage, 0) / 100).toFixed(1),
    ]),
    empty: 'No projects.',
  });
  footer(doc, `${PRODUCT_NAME} · Executive summary`);
  doc.save(`executive-summary-${new Date().toISOString().slice(0, 10)}.pdf`);
}
