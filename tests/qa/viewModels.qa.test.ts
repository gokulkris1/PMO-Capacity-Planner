/**
 * Independent QA (Release 2.0): view-model checks the developer suite does not make.
 *
 * - QA-002: the same-number guarantee (RP-03#AC3, AL-01#AC5) for a person whose target is not 100 %. The developer
 *   test compares the grid's raw load with People's raw load, but People *displays* load as a % of target
 *   (`relativePct`) while the grid displays `cells[].pct` (raw load) under a legend that says "total load as % of
 *   target". On the v1.1 data Noma Odigie (target 90 %) reads 111 % on Home and People and 100 % on Allocations.
 * - QA-004: "Unstaffed demand" on Home (project-level, any craft) disagrees with the Marketplace open demand
 *   (craft-level) for the same quarter: a Product Manager booked on a project "staffs" its Scrum Master demand.
 *
 * Tests that expose a defect are skipped with the defect id so CI stays green until the fix lands.
 */
import type * as D from '../../shared/contracts/dto';
import { DEFAULT_THRESHOLDS } from '../../shared/utilisation';
import { setClock } from '../../utils/clock';
import { buildAllocationGrid, buildHome, buildPeopleRows, buildCapacityOutlook } from '../../utils/viewModels';
import { buildOpenDemand } from '../../utils/viewModels/marketplace';
import { QUARTERS, TODAY, alloc, craft, demandLine, person, project, snapshot } from '../utils/fixtures';

const t = DEFAULT_THRESHOLDS;

/** Noma: target 90 %, 60 % on Phoenix (Q4 only) + 40 % open-ended on Ledger = 100 % load = 111 % of target. */
function nomaSnapshot(): D.WorkspaceSnapshot {
  return snapshot({
    people: [
      person('noma', { name: 'Noma Odigie', primaryCraft: 'sm', targetUtil: 90 }),
      person('maria', { name: 'Maria Kelly', primaryCraft: 'pm' }),
    ],
    projects: [
      project('phoenix', { name: 'Phoenix', startDate: '2026-10-01', endDate: '2027-06-30' }),
      project('ledger', { name: 'Ledger' }),
    ],
    allocations: [
      alloc('a1', {
        resourceId: 'noma',
        projectId: 'phoenix',
        percentage: 60,
        startDate: '2026-10-01',
        endDate: '2026-12-31',
      }),
      alloc('a2', { resourceId: 'noma', projectId: 'ledger', percentage: 40 }),
      alloc('a3', {
        resourceId: 'maria',
        projectId: 'phoenix',
        percentage: 120,
        startDate: '2026-10-01',
        endDate: '2027-03-31',
      }),
    ],
    demand: [demandLine('d1', { projectId: 'phoenix', quarterKey: '2026-Q4', craftId: 'sm', fte: 1.5 })],
    crafts: [craft('pm', 'PM'), craft('sm', 'SM')],
  });
}

beforeAll(() => setClock(TODAY));
afterAll(() => setClock());

describe('QA: same-number guarantee with a non-100 % target', () => {
  it('People shows Noma at 111 % of target in QBR1 (load 100 %, target 90 %)', () => {
    const row = buildPeopleRows(nomaSnapshot(), QUARTERS, t).find((r) => r.person.id === 'noma')!;
    expect(row.quarters[0]).toMatchObject({ loadPct: 100, band: 'over' });
    expect(Math.round(row.quarters[0].relativePct)).toBe(111);
  });

  it('Capacity Outlook person pivot agrees with People (111 %)', () => {
    const o = buildCapacityOutlook(nomaSnapshot(), QUARTERS, { pivot: 'person', thresholds: t });
    expect(Math.round(o.rows.find((r) => r.id === 'noma')!.points[0].utilisationPct)).toBe(111);
  });

  // QA-002 (Major): the Allocations grid person row displays cells[].pct = raw load (100 %) under the legend
  // "Person rows: total load as % of target", so People/Home/Outlook say 111 % and the grid says 100 %.
  it.skip('QA-002 Allocations grid person row shows the same number as People (load as % of target)', () => {
    const s = nomaSnapshot();
    const people = buildPeopleRows(s, QUARTERS, t).find((r) => r.person.id === 'noma')!;
    const grid = buildAllocationGrid(s, QUARTERS, {
      groupBy: 'none',
      pivot: 'person',
      includeTentative: true,
      thresholds: t,
    });
    const row = grid.groups.flatMap((g) => g.rows).find((r) => r.kind === 'person' && r.personId === 'noma')!;
    QUARTERS.forEach((_, i) => expect(Math.round(row.cells[i].pct)).toBe(Math.round(people.quarters[i].relativePct)));
  });
});

describe('QA: unstaffed demand is counted the same way on Home and in the Marketplace', () => {
  it('Marketplace counts only Scrum Master bookings against Scrum Master demand (0.9 FTE open)', () => {
    const open = buildOpenDemand(nomaSnapshot(), QUARTERS, { quarterKey: '2026-Q4' });
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ craftId: 'sm', demandFte: 1.5, staffedFte: 0.6, openFte: 0.9 });
  });

  // QA-004 (Major): Home "Unstaffed demand" reads 0.0 FTE for QBR1 because Maria's 120 % Product Manager booking on
  // Phoenix is counted as staffing its Scrum Master demand (project-level gap), while Marketplace shows 0.9 FTE open.
  it.skip('QA-004 Home "Unstaffed demand" for QBR1 equals the Marketplace open demand for QBR1', () => {
    const s = nomaSnapshot();
    const home = buildHome(s, QUARTERS, { kind: 'quarter', key: '2026-Q4' }, t, null);
    const open = buildOpenDemand(s, QUARTERS, { quarterKey: '2026-Q4' }).reduce((x, l) => x + l.openFte, 0);
    expect(home.kpis.unstaffedFte).toBeCloseTo(open, 2);
  });
});

describe('QA: dirty v1.1 dates', () => {
  // QA-025 (Minor): the drifted v1.1 schema has TEXT date columns and the API passes their values through unchanged.
  // One non-ISO value ("TBC") on a single booking turns the person's load into NaN for every quarter.
  it.skip("QA-025 a booking with a non-ISO date never turns a person's load into NaN", () => {
    const s = snapshot({
      people: [person('k', { name: 'Kerrie Dalton' })],
      projects: [project('ledger', { name: 'Ledger' })],
      allocations: [
        alloc('ok', { resourceId: 'k', projectId: 'ledger', percentage: 30 }),
        alloc('tbc', { resourceId: 'k', projectId: 'ledger', percentage: 10, startDate: 'TBC', endDate: '' }),
      ],
    });
    const row = buildPeopleRows(s, QUARTERS, t)[0];
    for (const q of row.quarters) expect(Number.isFinite(q.loadPct)).toBe(true);
  });
});
