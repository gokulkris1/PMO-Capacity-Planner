/**
 * RP-03#AC3 same-number guarantee: for every person and every basis, the utilisation used by People,
 * the allocation grid totals and the Capacity Outlook person pivot are identical, and "today" comes
 * from utils/clock.today(). ORG-05#AC3: a tribe's staffed FTE equals the Outlook tribe pivot.
 */
import type * as D from '../../shared/contracts/dto';
import { bandFor, DEFAULT_THRESHOLDS } from '../../shared/utilisation';
import { setClock } from '../../utils/clock';
import { loadOnDay } from '../../utils/viewModels/core';
import {
  buildAllocationGrid,
  buildCapacityOutlook,
  buildCraftBalance,
  buildDemandGrid,
  buildHome,
  buildOpenDemand,
  buildPeopleRows,
  buildProjectRows,
  buildTribeView,
  unstaffedByCraft,
  utilisationFor,
  type TimeBasis,
} from '../../utils/viewModels';
import { buildQbrPack, type TableSection } from '../../utils/qbrPack';
import { openDemandLines } from '../../utils/reportData';
import { alloc, craft, demandLine, demoSnapshot, person, project, QUARTERS, snapshot, TODAY, tribe } from './fixtures';

let s: D.WorkspaceSnapshot;
beforeAll(async () => {
  setClock(TODAY);
  s = await demoSnapshot();
});
afterAll(() => setClock());

const t = DEFAULT_THRESHOLDS;

describe('same-number guarantee (RP-03#AC3)', () => {
  it('People, Allocations and Capacity Outlook agree for every person and quarter', () => {
    const people = buildPeopleRows(s, QUARTERS, t);
    const grid = buildAllocationGrid(s, QUARTERS, {
      groupBy: 'chapter',
      pivot: 'person',
      includeTentative: true,
      thresholds: t,
    });
    const gridRows = new Map(
      grid.groups
        .flatMap((g) => g.rows)
        .filter((r) => r.kind === 'person')
        .map((r) => [r.personId, r]),
    );
    const outlook = buildCapacityOutlook(s, QUARTERS, { pivot: 'person', thresholds: t });
    const outlookRows = new Map(outlook.rows.map((r) => [r.id, r]));
    expect(people).toHaveLength(s.people.length);
    for (const row of people) {
      QUARTERS.forEach((q, i) => {
        const basis: TimeBasis = { kind: 'quarter', key: q.key };
        const u = utilisationFor(s, row.person.id, basis, QUARTERS);
        expect(row.quarters[i].relativePct).toBe(u);
        expect(outlookRows.get(row.person.id)!.points[i].utilisationPct).toBe(u);
        expect(gridRows.get(row.person.id)!.cells[i].pct).toBe(row.quarters[i].relativePct);
        expect(gridRows.get(row.person.id)!.cells[i].band).toBe(row.quarters[i].band);
        expect(outlookRows.get(row.person.id)!.points[i].band).toBe(row.quarters[i].band);
      });
    }
  });

  it('QA-002: with targets other than 100 % every view shows load as a % of target', () => {
    const odd = { ...s, people: s.people.map((p, i) => ({ ...p, targetUtil: [80, 90, 60, 120][i % 4] })) };
    const people = buildPeopleRows(odd, QUARTERS, t);
    const grid = buildAllocationGrid(odd, QUARTERS, {
      groupBy: 'none',
      pivot: 'person',
      includeTentative: true,
      thresholds: t,
    });
    const gridRows = new Map(
      grid.groups
        .flatMap((g) => g.rows)
        .filter((r) => r.kind === 'person')
        .map((r) => [r.personId, r]),
    );
    const outlook = new Map(
      buildCapacityOutlook(odd, QUARTERS, { pivot: 'person', thresholds: t }).rows.map((r) => [r.id, r]),
    );
    let differs = 0;
    for (const row of people) {
      QUARTERS.forEach((q, i) => {
        const u = utilisationFor(odd, row.person.id, { kind: 'quarter', key: q.key }, QUARTERS);
        if (row.quarters[i].loadPct !== row.quarters[i].relativePct) differs++;
        expect(row.quarters[i].relativePct).toBe(u);
        expect(gridRows.get(row.person.id)!.cells[i].pct).toBe(u);
        expect(gridRows.get(row.person.id)!.cells[i].band).toBe(bandFor(u, t));
        expect(outlook.get(row.person.id)!.points[i].utilisationPct).toBe(u);
      });
    }
    expect(differs).toBeGreaterThan(0); // the check is meaningful: raw load and % of target differ
    for (const q of QUARTERS) {
      const basis: TimeBasis = { kind: 'quarter', key: q.key };
      const home = buildHome(odd, QUARTERS, basis, t, null);
      const over = odd.people.filter((p) => bandFor(utilisationFor(odd, p.id, basis, QUARTERS), t) === 'over');
      expect(home.kpis.overCount).toBe(over.length);
    }
  });

  it('acceptance check 24: Tom Hayes in QBR1 shows the same number everywhere', () => {
    const tom = buildPeopleRows(s, QUARTERS, t).find((r) => r.person.name === 'Tom Hayes')!;
    expect(tom.quarters[0]).toMatchObject({ loadPct: 58, relativePct: 58, band: 'under' });
    const grid = buildAllocationGrid(s, QUARTERS, {
      groupBy: 'none',
      pivot: 'person',
      includeTentative: true,
      thresholds: t,
    });
    expect(grid.groups[0].rows.find((r) => r.personId === tom.person.id && r.kind === 'person')!.cells[0].pct).toBe(58);
    expect(
      buildCapacityOutlook(s, QUARTERS, { pivot: 'person', thresholds: t }).rows.find((r) => r.id === tom.person.id)!
        .points[0].utilisationPct,
    ).toBe(58);
    expect(utilisationFor(s, tom.person.id, { kind: 'quarter', key: QUARTERS[0].key }, QUARTERS)).toBe(58);
  });

  it('"today" uses the clock and matches the bookings active on that day', () => {
    for (const p of s.people) {
      const today = utilisationFor(s, p.id, { kind: 'today' }, QUARTERS);
      expect(today).toBe(Math.round(((100 * loadOnDay(s, p.id, TODAY)) / p.targetUtil) * 10) / 10);
    }
    // Tom on 16 Oct 2026: 20% Apollo + 25% Skyline; Orion only starts on 2 Nov.
    const tom = s.people.find((p) => p.name === 'Tom Hayes')!;
    expect(utilisationFor(s, tom.id, { kind: 'today' }, QUARTERS)).toBe(45);
    setClock('2026-11-10');
    expect(utilisationFor(s, tom.id, { kind: 'today' }, QUARTERS)).toBe(65);
    setClock(TODAY);
  });

  it('"window" is the mean of the four quarters', () => {
    const rows = buildPeopleRows(s, QUARTERS, t);
    for (const r of rows) {
      const mean = r.quarters.reduce((x, q) => x + q.loadPct, 0) / 4;
      expect(
        Math.abs(utilisationFor(s, r.person.id, { kind: 'window' }, QUARTERS) - (100 * mean) / r.person.targetUtil),
      ).toBeLessThan(0.11);
    }
  });

  it('Home counts and lists use the same bands for every basis', () => {
    const bases: TimeBasis[] = [
      { kind: 'today' },
      ...QUARTERS.map((q) => ({ kind: 'quarter' as const, key: q.key })),
      { kind: 'window' },
    ];
    for (const basis of bases) {
      const home = buildHome(s, QUARTERS, basis, t, null);
      const over = s.people
        .filter((p) => bandFor(utilisationFor(s, p.id, basis, QUARTERS), t) === 'over')
        .map((p) => p.id);
      const bench = s.people
        .filter((p) => bandFor(utilisationFor(s, p.id, basis, QUARTERS), t) === 'bench')
        .map((p) => p.id);
      expect(home.over.map((r) => r.person.id).sort()).toEqual(over.sort());
      expect(home.available.map((r) => r.person.id).sort()).toEqual(bench.sort());
      expect(home.kpis.overCount).toBe(over.length);
    }
  });

  it("a tribe's staffed FTE equals the Outlook tribe pivot (ORG-05#AC3)", () => {
    const outlook = buildCapacityOutlook(s, QUARTERS, { pivot: 'tribe', thresholds: t });
    for (const tribe of s.tribes) {
      const view = buildTribeView(s, QUARTERS, tribe.id);
      const row = outlook.rows.find((r) => r.id === tribe.id)!;
      QUARTERS.forEach((_, i) => {
        expect(row.points[i].supplyFte).toBe(view.staffedFte[i]);
        expect(row.points[i].demandFte).toBe(view.demandFte[i]);
      });
    }
  });

  it('org thresholds change every band (RP-03#AC4)', () => {
    const strict = { benchBelow: 70, onTargetFrom: 100, onTargetTo: 100 };
    const rows = buildPeopleRows(s, QUARTERS, strict);
    const claire = rows.find((r) => r.person.name === 'Claire Ryan')!;
    expect(claire.quarters[0].band).toBe('on-target'); // exactly 100
    const agnese = rows.find((r) => r.person.name === 'Agnese Markusevska')!;
    expect(agnese.quarters[0].band).toBe('under'); // 93 is on target by default, under with 100–100
    expect(buildPeopleRows(s, QUARTERS, t).find((r) => r.person.name === 'Agnese Markusevska')!.quarters[0].band).toBe(
      'on-target',
    );
  });
});

/**
 * QA-004: one definition of unstaffed demand (per project × craft × quarter, utils/viewModels/unstaffed.ts) on Home,
 * Demand, Projects, Tribes, Marketplace, Demand › By craft, the Capacity Outlook helpers, the open-demand CSV and the
 * QBR pack. Checked on the demo workspace and on the QA scenario where a Product Manager over-staffs a project whose
 * demand is for a Scrum Master.
 */
describe('same unstaffed demand everywhere (QA-004)', () => {
  const qaScenario = (): D.WorkspaceSnapshot =>
    snapshot({
      people: [
        person('noma', { name: 'Noma Odigie', primaryCraft: 'sm', targetUtil: 90 }),
        person('maria', { name: 'Maria Kelly', primaryCraft: 'pm' }),
      ],
      projects: [
        project('phoenix', { name: 'Phoenix', tribeId: 'tr1', startDate: '2026-10-01', endDate: '2027-06-30' }),
        project('ledger', { name: 'Ledger', tribeId: 'tr1' }),
      ],
      tribes: [tribe('tr1', 'Payments')],
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
      demand: [
        demandLine('d1', { projectId: 'phoenix', quarterKey: '2026-Q4', craftId: 'sm', fte: 1.5 }),
        demandLine('d2', { projectId: 'ledger', quarterKey: '2026-Q4', craftId: 'pm', fte: 0.5 }),
      ],
      crafts: [craft('pm', 'PM'), craft('sm', 'SM')],
    });

  const check = (snap: D.WorkspaceSnapshot) => {
    QUARTERS.forEach((q, qi) => {
      const open = buildOpenDemand(snap, QUARTERS, { quarterKey: q.key, matchLimit: 0 });
      const total = open.reduce((x, l) => x + l.openFte, 0);
      // Home KPI
      expect(buildHome(snap, QUARTERS, { kind: 'quarter', key: q.key }, t, null).kpis.unstaffedFte).toBeCloseTo(
        total,
        2,
      );
      // Demand page and Projects table (and the Home "projects with a gap" list)
      const grid = buildDemandGrid(snap, QUARTERS);
      expect(grid.reduce((x, d) => x + d.cells[qi].gapFte, 0)).toBeCloseTo(total, 2);
      expect(buildProjectRows(snap, QUARTERS).reduce((x, r) => x + r.quarters[qi].gapFte, 0)).toBeCloseTo(total, 2);
      for (const d of grid)
        expect(d.cells[qi].gapFte).toBeCloseTo(
          open.filter((l) => l.project.id === d.project.id).reduce((x, l) => x + l.openFte, 0),
          2,
        );
      // Tribes
      for (const tr of snap.tribes)
        expect(buildTribeView(snap, QUARTERS, tr.id).gapFte[qi]).toBeCloseTo(
          open.filter((l) => l.project.tribeId === tr.id).reduce((x, l) => x + l.openFte, 0),
          2,
        );
      // Demand › By craft, the QBR pack's craft table and the Outlook craft pivot
      const byCraft = unstaffedByCraft(snap, QUARTERS);
      for (const row of buildCraftBalance(snap, QUARTERS)) {
        const forCraft = open.filter((l) => l.craftId === row.craft.id).reduce((x, l) => x + l.openFte, 0);
        expect(row.quarters[qi].gapFte).toBeCloseTo(forCraft, 2);
        expect(byCraft.get(row.craft.id)?.[qi] ?? 0).toBeCloseTo(forCraft, 2);
      }
      // Open-demand CSV
      const lines = openDemandLines(snap, QUARTERS).filter((x) => x.line.quarterKey === q.key);
      expect(lines.reduce((x, l) => x + l.open, 0)).toBeCloseTo(total, 2);
    });
    // QBR pack: the open-demand table lists exactly the Marketplace lines.
    const pack = buildQbrPack({ snapshot: snap, quarters: QUARTERS, thresholds: t, generatedOn: TODAY });
    const openTable = pack.sections.find((x) => x.kind === 'table' && x.title === 'Open demand') as TableSection;
    expect(openTable.rows).toHaveLength(buildOpenDemand(snap, QUARTERS, { matchLimit: 0 }).length);
  };

  it('the QA scenario: a Product Manager does not staff Scrum Master demand (0.9 FTE open in QBR1)', () => {
    const snap = qaScenario();
    // 0.9 SM open on Phoenix + 0.5 PM on Ledger (Maria's spare PM time on Phoenix does not cover Ledger).
    expect(buildHome(snap, QUARTERS, { kind: 'quarter', key: '2026-Q4' }, t, null).kpis.unstaffedFte).toBe(1.4);
    expect(buildTribeView(snap, QUARTERS, 'tr1').gapFte[0]).toBe(1.4);
    const phoenix = buildDemandGrid(snap, QUARTERS).find((d) => d.project.id === 'phoenix')!.cells[0];
    expect(phoenix).toMatchObject({ demandFte: 1.5, staffedFte: 0.6, gapFte: 0.9, bookedFte: 1.8 });
    check(snap);
  });

  it('the demo workspace', () => check(s));
});
