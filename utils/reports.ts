/**
 * Report exports (RP-04#AC1, DM-04#AC3, PPL-04#AC4): CSV text for each Reports card. Every number
 * comes from the view-models, so exports match the pages (same-number guarantee).
 *
 * Pure: no React, DOM, Node or Netlify imports. The page downloads the text and reports the export
 * with `POST /audit/export` (RP-04#AC4).
 */
import type * as D from '../shared/contracts/dto';
import type { UtilisationThresholds } from '../shared/utilisation';
import { BAND_LABEL } from '../shared/utilisation';
import { ALLOCATION_SOURCE_LABEL, ALLOCATION_STATE_LABEL } from '../types';
import { toCsv } from './csv';
import { buildCapacityOutlook, buildCatalogue, buildOpenDemand, buildPeopleRows, buildTimeToStaff } from './viewModels';
import { effectiveWindow } from './craftEngine';
import type { QuarterView } from './viewModels/types';

export type ReportId =
  | 'utilisation-person'
  | 'utilisation-tribe'
  | 'utilisation-chapter'
  | 'utilisation-craft'
  | 'open-demand'
  | 'bookings'
  | 'time-to-staff';

export const REPORT_TITLE: Record<ReportId, string> = {
  'utilisation-person': 'Utilisation by person',
  'utilisation-tribe': 'Utilisation by tribe',
  'utilisation-chapter': 'Utilisation by chapter',
  'utilisation-craft': 'Utilisation by craft',
  'open-demand': 'Open demand',
  bookings: 'Bookings',
  'time-to-staff': 'Time to staff',
};

const qHeader = (q: QuarterView, what: string) => `${q.label} ${q.calendarLabel} ${what}`;

export function utilisationByPersonCsv(
  s: D.WorkspaceSnapshot,
  quarters: QuarterView[],
  t: UtilisationThresholds,
): string {
  const rows = buildPeopleRows(s, quarters, t);
  return toCsv(rows, [
    { header: 'person', value: (r) => r.person.name },
    { header: 'job_title', value: (r) => r.person.role },
    { header: 'chapter', value: (r) => r.chapter?.name },
    { header: 'team', value: (r) => r.team?.name },
    { header: 'above_craft', value: (r) => r.primary?.short },
    { header: 'target_pct', value: (r) => r.person.targetUtil },
    ...quarters.flatMap((q, i) => [
      { header: qHeader(q, 'load %'), value: (r: (typeof rows)[number]) => r.quarters[i]?.loadPct },
      { header: qHeader(q, 'utilisation %'), value: (r: (typeof rows)[number]) => r.quarters[i]?.relativePct },
      {
        header: qHeader(q, 'band'),
        value: (r: (typeof rows)[number]) => (r.quarters[i] ? BAND_LABEL[r.quarters[i].band] : ''),
      },
    ]),
  ]);
}

export function utilisationByGroupCsv(
  s: D.WorkspaceSnapshot,
  quarters: QuarterView[],
  pivot: 'tribe' | 'chapter' | 'craft',
  t: UtilisationThresholds,
): string {
  const model = buildCapacityOutlook(s, quarters, { pivot, thresholds: t });
  const rows = model.rows;
  return toCsv(rows, [
    { header: pivot, value: (r) => r.label },
    ...quarters.flatMap((q, i) => [
      {
        header: qHeader(q, pivot === 'tribe' ? 'staffed FTE' : 'supply FTE'),
        value: (r: (typeof rows)[number]) => r.points[i]?.supplyFte,
      },
      {
        header: qHeader(q, 'committed FTE'),
        value: (r: (typeof rows)[number]) =>
          r.points[i]
            ? Math.round((r.points[i].aboveFte + r.points[i].belowFte + r.points[i].undeclaredFte) * 100) / 100
            : '',
      },
      { header: qHeader(q, 'demand FTE'), value: (r: (typeof rows)[number]) => r.points[i]?.demandFte },
      {
        header: qHeader(q, pivot === 'tribe' ? 'coverage %' : 'utilisation %'),
        value: (r: (typeof rows)[number]) => r.points[i]?.utilisationPct,
      },
      {
        header: qHeader(q, 'band'),
        value: (r: (typeof rows)[number]) => (r.points[i] ? BAND_LABEL[r.points[i].band] : ''),
      },
    ]),
  ]);
}

export function openDemandCsv(s: D.WorkspaceSnapshot, quarters: QuarterView[]): string {
  const rows = buildOpenDemand(s, quarters, { matchLimit: 0 });
  return toCsv(rows, [
    { header: 'quarter', value: (r) => `${r.quarter.label} ${r.quarter.calendarLabel}` },
    { header: 'project', value: (r) => r.project.name },
    { header: 'tribe', value: (r) => r.tribe?.name },
    { header: 'stage', value: (r) => r.project.stage },
    { header: 'craft', value: (r) => r.craft?.name ?? r.craftId },
    { header: 'status', value: (r) => [...new Set(r.lines.map((l) => l.status))].join('/') },
    { header: 'demand_fte', value: (r) => r.demandFte },
    { header: 'staffed_fte', value: (r) => r.staffedFte },
    { header: 'proposed_fte', value: (r) => r.proposedFte },
    { header: 'open_fte', value: (r) => r.openFte },
  ]);
}

export function bookingsCsv(s: D.WorkspaceSnapshot): string {
  const people = new Map(s.people.map((p) => [p.id, p]));
  const projects = new Map(s.projects.map((p) => [p.id, p]));
  const crafts = new Map(s.crafts.map((c) => [c.id, c]));
  const rows = [...s.allocations].sort(
    (a, b) =>
      (people.get(a.resourceId)?.name ?? '').localeCompare(people.get(b.resourceId)?.name ?? '') ||
      (projects.get(a.projectId)?.name ?? '').localeCompare(projects.get(b.projectId)?.name ?? ''),
  );
  return toCsv(rows, [
    { header: 'person', value: (a) => people.get(a.resourceId)?.name ?? a.resourceId },
    { header: 'project', value: (a) => projects.get(a.projectId)?.name ?? a.projectId },
    { header: 'craft', value: (a) => crafts.get(a.craftId ?? people.get(a.resourceId)?.primaryCraft ?? '')?.short },
    { header: 'percentage', value: (a) => a.percentage },
    { header: 'start', value: (a) => effectiveWindow(a, projects.get(a.projectId)).start },
    { header: 'end', value: (a) => effectiveWindow(a, projects.get(a.projectId)).end },
    { header: 'state', value: (a) => ALLOCATION_STATE_LABEL[a.state] },
    { header: 'source', value: (a) => ALLOCATION_SOURCE_LABEL[a.source] },
    { header: 'notes', value: (a) => a.notes },
  ]);
}

export function timeToStaffCsv(s: D.WorkspaceSnapshot, asOf: D.ISODate): string {
  const { rows } = buildTimeToStaff(s, asOf);
  return toCsv(rows, [
    { header: 'person', value: (r) => r.person?.name },
    { header: 'project', value: (r) => r.project?.name },
    { header: 'requested_or_proposed_at', value: (r) => r.from },
    { header: 'confirmed_at', value: (r) => r.respondedAt },
    { header: 'days_to_staff', value: (r) => r.days },
  ]);
}

/** DM-04#AC3: the squad catalogue for one quarter. */
export function catalogueCsv(s: D.WorkspaceSnapshot, quarters: QuarterView[], quarterKey: D.QuarterKey): string {
  const rows = buildCatalogue(s, quarters, quarterKey).flatMap((e) => e.people.map((p) => ({ e, p })));
  return toCsv(rows, [
    { header: 'craft', value: (r) => r.e.craft.name },
    { header: 'person', value: (r) => r.p.person.name },
    { header: 'via', value: (r) => (r.p.via === 'above' ? 'Above the table' : 'Below the table') },
    { header: 'proficiency', value: (r) => (r.p.proficiency ? `L${r.p.proficiency}` : '') },
    { header: 'free_pct', value: (r) => r.p.freePct },
    { header: 'offered_pct', value: (r) => r.p.offer?.pct },
    { header: 'offer_note', value: (r) => r.p.offer?.note },
  ]);
}

/** Builds the CSV for a Reports card. */
export function reportCsv(
  id: ReportId,
  s: D.WorkspaceSnapshot,
  quarters: QuarterView[],
  t: UtilisationThresholds,
  asOf: D.ISODate,
): string {
  switch (id) {
    case 'utilisation-person':
      return utilisationByPersonCsv(s, quarters, t);
    case 'utilisation-tribe':
      return utilisationByGroupCsv(s, quarters, 'tribe', t);
    case 'utilisation-chapter':
      return utilisationByGroupCsv(s, quarters, 'chapter', t);
    case 'utilisation-craft':
      return utilisationByGroupCsv(s, quarters, 'craft', t);
    case 'open-demand':
      return openDemandCsv(s, quarters);
    case 'bookings':
      return bookingsCsv(s);
    case 'time-to-staff':
      return timeToStaffCsv(s, asOf);
  }
}
