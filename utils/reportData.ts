/**
 * Report datasets for RP-04 with the same names, signatures and CSV columns as B2's interim
 * `pages/reports/_parts/reportData.ts`, so the Reports page switches import only. Built on the
 * view-models (same numbers as the pages). `utils/qbrPackPdf.ts` renders `buildQbrPack()` output.
 *
 * Pure: no React, DOM, Node or Netlify imports.
 */
import type * as D from '../shared/contracts/dto';
import { BAND_LABEL, type UtilisationThresholds } from '../shared/utilisation';
import { toCsvRows, type CsvCell } from './csv';
import { effectiveWindow } from './craftEngine';
import {
  buildCapacityOutlook,
  buildCatalogue,
  buildPeopleRows,
  staffedFteByProjectCraft,
  type OutlookPoint,
} from './viewModels';
import type { QuarterView } from './viewModels/types';

const r1 = (n: number) => Math.round(n * 10) / 10;
const csv = (header: string[], rows: CsvCell[][]) => toCsvRows(rows, header);

export function utilisationByPersonCsv(s: D.WorkspaceSnapshot, q: QuarterView[], t: UtilisationThresholds): string {
  return csv(
    [
      'person',
      'job_title',
      'chapter',
      'team',
      'target_pct',
      ...q.flatMap((x) => [`${x.label}_load_pct`, `${x.label}_of_target_pct`, `${x.label}_band`]),
    ],
    buildPeopleRows(s, q, t).map((r) => [
      r.person.name,
      r.person.role,
      r.chapter?.name ?? '',
      r.team?.name ?? '',
      r.person.targetUtil,
      ...r.quarters.flatMap((x) => [r1(x.loadPct), Math.round(x.relativePct), BAND_LABEL[x.band]]),
    ]),
  );
}

export function utilisationByGroupCsv(
  s: D.WorkspaceSnapshot,
  q: QuarterView[],
  t: UtilisationThresholds,
  pivot: 'tribe' | 'chapter' | 'craft',
): string {
  const m = buildCapacityOutlook(s, q, { pivot, thresholds: t });
  const line = (label: string, p: OutlookPoint, i: number): CsvCell[] => [
    label,
    q[i]?.label ?? p.quarterKey,
    p.quarterKey,
    r1(p.supplyFte),
    r1(p.aboveFte + p.belowFte + p.undeclaredFte),
    r1(p.freeFte),
    r1(p.demandFte),
    p.utilisationPct,
    BAND_LABEL[p.band],
  ];
  return csv(
    [pivot, 'qbr', 'quarter', 'supply_fte', 'load_fte', 'free_fte', 'demand_fte', 'utilisation_pct', 'band'],
    [
      ...m.squad.map((p, i) => line('Squad', p, i)),
      ...m.rows.flatMap((r) => r.points.map((p, i) => line(r.label, p, i))),
    ],
  );
}

export interface OpenDemandLineRow {
  line: D.DemandLineDTO;
  quarter: QuarterView | undefined;
  staffed: number;
  proposed: number;
  open: number;
}

/** Per demand line: staffed (confirmed, that craft), proposed (tentative) and open FTE (DM-03#AC5). */
export function openDemandLines(
  s: D.WorkspaceSnapshot,
  q: QuarterView[],
  _t?: UtilisationThresholds,
): OpenDemandLineRow[] {
  const confirmed = staffedFteByProjectCraft(s, q, { includeTentative: false });
  const all = staffedFteByProjectCraft(s, q, { includeTentative: true });
  const qi = new Map(q.map((x, i) => [x.key, i]));
  return s.demand
    .filter((l) => qi.has(l.quarterKey))
    .map((l) => {
      const i = qi.get(l.quarterKey) ?? 0;
      const k = `${l.projectId}|${l.craftId}`;
      const staffed = confirmed.get(k)?.[i] ?? 0;
      const proposed = Math.max(0, (all.get(k)?.[i] ?? 0) - staffed);
      return { line: l, quarter: q[i], staffed, proposed, open: Math.max(0, l.fte - staffed - proposed) };
    });
}

export function openDemandCsv(s: D.WorkspaceSnapshot, q: QuarterView[], t?: UtilisationThresholds): string {
  const p = new Map(s.projects.map((x) => [x.id, x]));
  const tr = new Map(s.tribes.map((x) => [x.id, x.name]));
  const cr = new Map(s.crafts.map((x) => [x.id, x]));
  return csv(
    [
      'project',
      'tribe',
      'qbr',
      'quarter',
      'craft',
      'status',
      'demand_fte',
      'staffed_fte',
      'proposed_fte',
      'open_fte',
      'note',
    ],
    openDemandLines(s, q, t)
      .filter((x) => x.open > 0.04 || x.proposed > 0.04)
      .map((x) => [
        p.get(x.line.projectId)?.name ?? x.line.projectId,
        tr.get(p.get(x.line.projectId)?.tribeId ?? '') ?? '',
        x.quarter?.label ?? '',
        x.line.quarterKey,
        cr.get(x.line.craftId)?.name ?? x.line.craftId,
        x.line.status,
        r1(x.line.fte),
        r1(x.staffed),
        r1(x.proposed),
        r1(x.open),
        x.line.note ?? '',
      ]),
  );
}

export function bookingsCsv(s: D.WorkspaceSnapshot): string {
  const people = new Map(s.people.map((x) => [x.id, x]));
  const projects = new Map(s.projects.map((x) => [x.id, x]));
  const crafts = new Map(s.crafts.map((x) => [x.id, x.name]));
  return csv(
    ['person', 'project', 'craft', 'percent', 'start', 'end', 'state', 'source', 'notes'],
    s.allocations.map((a) => {
      const pr = projects.get(a.projectId);
      const craftId = a.craftId ?? people.get(a.resourceId)?.primaryCraft ?? '';
      const w = effectiveWindow(a, pr);
      return [
        people.get(a.resourceId)?.name ?? a.resourceId,
        pr?.name ?? a.projectId,
        crafts.get(craftId) ?? craftId,
        a.percentage,
        w.start ?? '',
        w.end ?? '',
        a.state,
        a.source,
        a.notes ?? '',
      ];
    }),
  );
}

/**
 * Responded proposals with the hours from the demand line's creation (else the proposal) to the
 * response (DM-03#AC4).
 */
export function timeToStaffRows(s: D.WorkspaceSnapshot): Array<{ a: D.AllocationDTO; hours: number }> {
  const lines = new Map(s.demand.map((l) => [l.id, l]));
  return s.allocations
    .filter((a) => a.proposedAt && a.respondedAt)
    .map((a) => {
      const from = (a.demandLineId && lines.get(a.demandLineId)?.createdAt) || a.proposedAt || '';
      return { a, hours: Math.max(0, (Date.parse(a.respondedAt ?? '') - Date.parse(from)) / 3_600_000) };
    });
}

export function medianHours(rows: Array<{ hours: number }>): number | null {
  if (rows.length === 0) return null;
  const v = rows.map((r) => r.hours).sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export function timeToStaffCsv(s: D.WorkspaceSnapshot): string {
  const people = new Map(s.people.map((x) => [x.id, x.name]));
  const projects = new Map(s.projects.map((x) => [x.id, x.name]));
  return csv(
    ['person', 'project', 'proposed_at', 'responded_at', 'hours_to_staff', 'outcome'],
    timeToStaffRows(s).map(({ a, hours }) => [
      people.get(a.resourceId) ?? a.resourceId,
      projects.get(a.projectId) ?? a.projectId,
      a.proposedAt ?? '',
      a.respondedAt ?? '',
      r1(hours),
      a.state === 'confirmed' ? 'accepted' : 'declined',
    ]),
  );
}

/** Everything the QBR pack PDF prints (RP-04#AC2), in B2's `QbrPackData` shape. */
export function buildQbrPack(
  s: D.WorkspaceSnapshot,
  q: QuarterView[],
  t: UtilisationThresholds,
  delivery: { byProjectQbr1: D.DeliverySummaryDTO['byProjectQbr1'] },
) {
  const outlook = buildCapacityOutlook(s, q, { pivot: 'craft', thresholds: t });
  const people = buildPeopleRows(s, q, t);
  const cat = buildCatalogue(s, q, q[0]?.key ?? '');
  const reach = new Map(cat.map((c) => [c.craft.id, c.reachBelowFte]));
  const open = openDemandLines(s, q, t).filter((x) => x.open > 0.04);
  const projects = new Map(s.projects.map((x) => [x.id, x]));
  const tribes = new Map(s.tribes.map((x) => [x.id, x.name]));
  const crafts = new Map(s.crafts.map((x) => [x.id, x]));
  const byTribe = new Map<string, { planned: number; implied: number }>();
  for (const d of delivery.byProjectQbr1) {
    const tid = projects.get(d.projectId)?.tribeId ?? '';
    const cur = byTribe.get(tid) ?? { planned: 0, implied: 0 };
    cur.planned += d.plannedFte;
    cur.implied += d.impliedFte;
    byTribe.set(tid, cur);
  }
  const ninetyDays = Date.parse(s.serverTime) - 90 * 86_400_000;
  const tts = timeToStaffRows(s).filter(
    (x) => Date.parse(x.a.respondedAt ?? '') >= ninetyDays && x.a.state === 'confirmed',
  );
  return {
    quarters: q,
    squad: outlook.squad,
    crafts: outlook.rows
      .filter((r) => r.points.some((p) => p.supplyFte > 0 || p.demandFte > 0))
      .map((r) => ({
        label: r.label,
        short: crafts.get(r.id)?.short ?? '',
        points: r.points,
        reachQ1: reach.get(r.id) ?? 0,
      })),
    openDemand: open
      .sort((a, z) => z.open - a.open)
      .map((x) => ({
        project: projects.get(x.line.projectId)?.name ?? '',
        tribe: tribes.get(projects.get(x.line.projectId)?.tribeId ?? '') ?? '',
        quarter: x.quarter?.label ?? '',
        craft: crafts.get(x.line.craftId)?.name ?? '',
        open: x.open,
      })),
    over: people
      .filter((r) => r.quarters[0]?.band === 'over')
      .map((r) => ({ name: r.person.name, pct: r.quarters[0].relativePct })),
    under: people
      .filter((r) => r.quarters[0]?.band === 'under' || r.quarters[0]?.band === 'bench')
      .map((r) => ({ name: r.person.name, pct: r.quarters[0].relativePct, band: BAND_LABEL[r.quarters[0].band] })),
    delivery: [...byTribe.entries()].map(([tid, v]) => ({ tribe: tribes.get(tid) ?? 'Unmapped', ...v })),
    timeToStaffMedianHours: medianHours(tts),
    timeToStaffCount: tts.length,
  };
}
export type QbrPackData = ReturnType<typeof buildQbrPack>;
