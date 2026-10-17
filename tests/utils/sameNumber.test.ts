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
  buildHome,
  buildPeopleRows,
  buildTribeView,
  utilisationFor,
  type TimeBasis,
} from '../../utils/viewModels';
import { demoSnapshot, QUARTERS, TODAY } from './fixtures';

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
