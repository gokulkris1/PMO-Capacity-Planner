/**
 * QBR pack PDF (RP-04#AC2/3). jsPDF and autotable load on demand (SH-08#AC2). Colours are read from the design
 * tokens at run time (DESIGN_SYSTEM §11.5 palette = light token values), so no colour literal lives here.
 * Interim: package C owns `utils/pdfExport.ts`; swap `downloadQbrPack` for C's builder when it lands.
 */
import type { QbrPackData } from './reportData';

type RGB = [number, number, number];

function token(name: string): RGB | null {
  if (typeof document === 'undefined') return null;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const hex = /^#?([0-9a-f]{6})$/i.exec(raw);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(raw);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
}

const fte = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

export async function downloadQbrPack(
  data: QbrPackData,
  meta: { org: string; workspace: string; generatedAt: string; filename: string },
) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const c = {
    text: token('--color-text'),
    secondary: token('--color-text-secondary'),
    tertiary: token('--color-text-tertiary'),
    border: token('--color-border'),
    header: token('--color-surface-sunken'),
    primary: token('--color-primary'),
    s1: token('--chart-1'),
    s2: token('--chart-2'),
    s3: token('--chart-3'),
    s4: token('--chart-4'),
    bench: token('--chart-bench'),
    target: token('--chart-target'),
  };
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const M = 48;
  const color = (rgb: RGB | null, kind: 'text' | 'fill' | 'draw') => {
    if (!rgb) return;
    if (kind === 'text') doc.setTextColor(...rgb);
    else if (kind === 'fill') doc.setFillColor(...rgb);
    else doc.setDrawColor(...rgb);
  };
  const h1 = (text: string, y: number) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    color(c.text, 'text');
    doc.text(text, M, y);
  };
  const tableStyle = {
    styles: {
      font: 'helvetica',
      fontSize: 9,
      textColor: c.text ?? undefined,
      lineColor: c.border ?? undefined,
      lineWidth: 0.5,
      cellPadding: 4,
    },
    headStyles: { fillColor: c.header ?? undefined, textColor: c.secondary ?? undefined, fontStyle: 'bold' as const },
    margin: { left: M, right: M },
  };
  const lastY = () => (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 0;
  const q = data.quarters;

  // Cover
  color(c.primary, 'fill');
  doc.roundedRect(M, 120, 28, 28, 6, 6, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  color(c.text, 'text');
  doc.text('PMO Capacity Planner · QBR pack', M, 190);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  color(c.secondary, 'text');
  doc.text(`${meta.org} · ${meta.workspace}`, M, 212);
  doc.text(`Generated ${meta.generatedAt}`, M, 230);
  doc.text(
    `Window: ${q[0]?.label} (${q[0]?.calendarLabel}) to ${q[q.length - 1]?.label} (${q[q.length - 1]?.calendarLabel})`,
    M,
    248,
  );
  const sq = data.squad[0];
  if (sq) {
    doc.setFontSize(11);
    color(c.text, 'text');
    doc.text(
      `Squad utilisation ${q[0]?.label}: ${sq.utilisationPct}% of target · demand ${fte(sq.demandFte)} FTE · free ${fte(sq.freeFte)} FTE`,
      M,
      290,
    );
  }

  // Squad utilisation QBR1–4 vs target, with a small stacked bar chart drawn to scale.
  doc.addPage();
  h1('Squad utilisation vs target', 64);
  const chartTop = 90;
  const chartH = 160;
  const max = Math.max(
    1,
    ...data.squad.map((p) => Math.max(p.supplyFte, p.demandFte, p.aboveFte + p.belowFte + p.undeclaredFte)),
  );
  const colW = (W - 2 * M) / Math.max(1, data.squad.length);
  data.squad.forEach((p, i) => {
    const x = M + i * colW + colW / 2 - 18;
    let y = chartTop + chartH;
    const seg = (v: number, rgb: RGB | null) => {
      const h = (v / max) * chartH;
      if (h <= 0) return;
      color(rgb, 'fill');
      doc.rect(x, y - h, 36, h, 'F');
      y -= h + 1;
    };
    seg(p.aboveFte, c.s1);
    seg(p.belowFte, c.s2);
    seg(p.undeclaredFte, c.s3);
    seg(p.freeFte, c.bench);
    const dy = chartTop + chartH - (p.demandFte / max) * chartH;
    color(c.s4, 'draw');
    doc.setLineWidth(2);
    doc.line(x - 6, dy, x + 42, dy);
    doc.setFontSize(9);
    color(c.secondary, 'text');
    doc.text(`${q[i]?.label ?? ''} · ${p.utilisationPct}%`, x + 18, chartTop + chartH + 14, { align: 'center' });
  });
  doc.setFontSize(8);
  color(c.tertiary, 'text');
  doc.text(
    'Blue: above the table · teal: below the table · amber: undeclared craft · grey: free · violet line: demand (FTE)',
    M,
    chartTop + chartH + 32,
  );
  autoTable(doc, {
    ...tableStyle,
    startY: chartTop + chartH + 44,
    head: [['Quarter', 'Supply FTE', 'Load FTE', 'Free FTE', 'Demand FTE', 'Utilisation']],
    body: data.squad.map((p, i) => [
      `${q[i]?.label} (${q[i]?.calendarLabel})`,
      fte(p.supplyFte),
      fte(p.aboveFte + p.belowFte + p.undeclaredFte),
      fte(p.freeFte),
      fte(p.demandFte),
      `${p.utilisationPct}%`,
    ]),
  });

  // Supply vs demand by craft
  h1('Supply vs demand by craft', lastY() + 36);
  autoTable(doc, {
    ...tableStyle,
    startY: lastY() + 48,
    head: [['Craft', ...q.map((x) => `${x.label} supply / demand`), `Reach below ${q[0]?.label}`]],
    body: data.crafts.map((r) => [
      `${r.short} ${r.label}`,
      ...r.points.map((p) => `${fte(p.supplyFte)} / ${fte(p.demandFte)}`),
      fte(r.reachQ1),
    ]),
  });

  // Open demand
  doc.addPage();
  h1('Open demand', 64);
  autoTable(doc, {
    ...tableStyle,
    startY: 76,
    head: [['Project', 'Tribe', 'Quarter', 'Craft', 'Open FTE']],
    body: data.openDemand.length
      ? data.openDemand.map((d) => [d.project, d.tribe, d.quarter, d.craft, fte(d.open)])
      : [['No open demand', '', '', '', '']],
  });

  // Over / under
  h1(`Over capacity and under target · ${q[0]?.label}`, lastY() + 36);
  autoTable(doc, {
    ...tableStyle,
    startY: lastY() + 48,
    head: [['Over capacity', '% of target', 'Under target / available', '% of target']],
    body: Array.from({ length: Math.max(data.over.length, data.under.length, 1) }, (_, i) => [
      data.over[i]?.name ?? '',
      data.over[i] ? `${Math.round(data.over[i].pct)}%` : '',
      data.under[i] ? `${data.under[i].name} (${data.under[i].band})` : '',
      data.under[i] ? `${Math.round(data.under[i].pct)}%` : '',
    ]),
  });

  // Delivery signal and time to staff
  h1('Delivery signal by tribe (Jira)', lastY() + 36);
  autoTable(doc, {
    ...tableStyle,
    startY: lastY() + 48,
    head: [['Tribe', `Planned FTE ${q[0]?.label}`, 'Jira-implied FTE', 'Signal']],
    body: data.delivery.length
      ? data.delivery.map((d) => [
          d.tribe,
          fte(d.planned),
          fte(d.implied),
          d.implied > d.planned * 1.2
            ? 'Jira shows more effort than planned'
            : d.implied < d.planned * 0.8
              ? 'Jira shows less effort than planned'
              : 'In line',
        ])
      : [['No Jira mapping yet', '', '', '']],
  });
  doc.setFontSize(11);
  color(c.text, 'text');
  const tts = data.timeToStaffMedianHours;
  doc.text(
    `Time to staff (median, last 90 days): ${tts === null ? 'no responses yet' : tts < 48 ? `${Math.round(tts)} hours` : `${Math.round(tts / 24)} days`} · ${data.timeToStaffCount} proposals answered`,
    M,
    lastY() + 30,
  );

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    color(c.tertiary, 'text');
    doc.text(`PMO Capacity Planner · QBR pack · page ${i} of ${pages}`, M, doc.internal.pageSize.getHeight() - 24);
  }
  doc.save(meta.filename);
}
