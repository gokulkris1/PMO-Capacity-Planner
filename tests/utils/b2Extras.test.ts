/** View-models and builders added for B2 (handoff-C.md §3): matching, staffing, paste batch, CSV, QBR pack. */
import type * as D from '../../shared/contracts/dto';
import { DEFAULT_THRESHOLDS } from '../../shared/utilisation';
import {
  buildCatalogue,
  buildDemandGrid,
  diffAllocations,
  rankMatches,
  setQuarterCell,
  setQuarterCells,
  staffedFteByProjectCraft,
} from '../../utils/viewModels';
import { applyAllocationOps } from '../../utils/viewModels/allocationOps';
import { PEOPLE_CSV_COLUMNS, peopleTemplateCsv, validatePeopleCsv } from '../../utils/csvPeople';
import { bookingsCsv, buildQbrPack, openDemandCsv, utilisationByPersonCsv } from '../../utils/reportData';
import { qbrPackModel } from '../../utils/qbrPackPdf';
import { QUARTERS, demoSnapshot } from './fixtures';

let s: D.WorkspaceSnapshot;
beforeAll(async () => {
  s = await demoSnapshot();
});

let seq = 0;
const newId = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
const ctx = () => ({ newId, now: s.serverTime, user: null });

describe('rankMatches', () => {
  it('ranks above-the-table people first, excludes the full and the excluded, suggests a 5% step', () => {
    const cat = buildCatalogue(s, QUARTERS, QUARTERS[0].key);
    const entry = cat.find((c) => c.people.some((p) => p.via === 'above') && c.people.some((p) => p.via === 'below'));
    expect(entry).toBeDefined();
    const project = s.projects[0];
    const all = rankMatches(entry, project, 0.5, new Set());
    expect(all.length).toBeGreaterThan(0);
    for (let i = 1; i < all.length; i++) expect(all[i - 1].score).toBeGreaterThanOrEqual(all[i].score);
    for (const m of all) {
      expect(m.freePct).toBeGreaterThanOrEqual(5);
      expect(m.suggestedPct % 5).toBe(0);
      expect(m.suggestedPct).toBeLessThanOrEqual(50);
      expect(m.reasons[0]).toMatch(/^(Above the table|L[123] below the table)$/);
    }
    const first = all[0];
    expect(
      rankMatches(entry, project, 0.5, new Set([first.person.id])).some((m) => m.person.id === first.person.id),
    ).toBe(false);
    expect(rankMatches(undefined, project, 1, new Set())).toEqual([]);
  });
});

describe('staffedFteByProjectCraft', () => {
  it('sums to the demand grid staffed FTE (demanded crafts) and booked FTE (all crafts) per project', () => {
    const staffed = staffedFteByProjectCraft(s, QUARTERS);
    const all = staffedFteByProjectCraft(s, QUARTERS, { includeTentative: true });
    const grid = buildDemandGrid(s, QUARTERS);
    for (const row of grid) {
      row.cells.forEach((c, qi) => {
        const demanded = new Set(c.lines.map((l) => l.craftId));
        const keys = [...staffed.keys()].filter(
          (k) => k.startsWith(`${row.project.id}|`) && demanded.has(k.split('|')[1]),
        );
        expect(keys.reduce((x, k) => x + staffed.get(k)![qi], 0)).toBeCloseTo(c.staffedFte, 1);
        const booked = [...all.keys()].filter((k) => k.startsWith(`${row.project.id}|`));
        expect(booked.reduce((x, k) => x + all.get(k)![qi], 0)).toBeCloseTo(c.bookedFte, 1);
      });
    }
  });

  it('tentative bookings count only when asked', () => {
    const tentative = s.allocations.filter((a) => a.state === 'tentative');
    expect(tentative.length).toBeGreaterThan(0);
    const sum = (m: Map<string, number[]>) => [...m.values()].reduce((x, r) => x + r.reduce((y, v) => y + v, 0), 0);
    expect(sum(staffedFteByProjectCraft(s, QUARTERS, { includeTentative: true }))).toBeGreaterThanOrEqual(
      sum(staffedFteByProjectCraft(s, QUARTERS)),
    );
  });
});

describe('setQuarterCells (paste)', () => {
  it('equals applying setQuarterCell one cell at a time, as one net batch', () => {
    const a = s.allocations.find((x) => x.state === 'confirmed' && x.projectId)!;
    const cells = [
      { resourceId: a.resourceId, projectId: a.projectId, craftId: a.craftId, quarterKey: QUARTERS[1].key, pct: 30 },
      { resourceId: a.resourceId, projectId: a.projectId, craftId: a.craftId, quarterKey: QUARTERS[2].key, pct: 0 },
    ];
    const batch = setQuarterCells(s, QUARTERS, cells, newId);
    expect(batch.length).toBeGreaterThan(0);
    const viaBatch = applyAllocationOps(s.allocations, batch, ctx());

    let step = s;
    for (const c of cells) {
      const ops = setQuarterCell(step, QUARTERS, c);
      step = { ...step, allocations: applyAllocationOps(step.allocations, ops, ctx()) };
    }
    const shape = (list: D.AllocationDTO[]) =>
      list
        .filter((x) => x.resourceId === a.resourceId && x.projectId === a.projectId)
        .map((x) => `${x.startDate}|${x.endDate}|${x.percentage}|${x.state}`)
        .sort();
    expect(shape(viaBatch)).toEqual(shape(step.allocations));
  });

  it('diffAllocations is empty for the same list and inverts deletes/creates', () => {
    expect(diffAllocations(s.allocations, s.allocations)).toEqual([]);
    const [first, ...rest] = s.allocations;
    const ops = diffAllocations(s.allocations, rest);
    expect(ops).toEqual([{ op: 'delete', id: first.id, version: first.version }]);
    expect(diffAllocations(rest, s.allocations).map((o) => o.op)).toEqual(['create']);
  });

  it('rejects an out-of-range cell', () => {
    const a = s.allocations[0];
    expect(() =>
      setQuarterCells(
        s,
        QUARTERS,
        [{ resourceId: a.resourceId, projectId: a.projectId, craftId: null, quarterKey: QUARTERS[0].key, pct: 201 }],
        newId,
      ),
    ).toThrow('Enter 0–200');
  });
});

describe('B2-compatible CSV and QBR builders', () => {
  it('validatePeopleCsv: header error, per-row errors, create vs update', () => {
    expect(validatePeopleCsv('', s).headerError).toBe('The file is empty.');
    expect(validatePeopleCsv('email\nx@y.z', s).headerError).toMatch(/Missing column "name"/);
    expect(peopleTemplateCsv().split(/\r?\n/)[0]).toBe(PEOPLE_CSV_COLUMNS.join(','));
    const existing = s.people[0];
    const text = [
      PEOPLE_CSV_COLUMNS.join(','),
      `${existing.name},${existing.email ?? ''}`,
      'Brand New Person,new.person@example.com',
    ].join('\n');
    const v = validatePeopleCsv(text, s);
    expect(v.headerError).toBeNull();
    expect(v.rows.map((r) => r.line)).toEqual([2, 3]);
    expect(v.rows[1].match).toBe('create');
  });

  it('report CSVs open with the header row and guard formulas', () => {
    expect(utilisationByPersonCsv(s, QUARTERS, DEFAULT_THRESHOLDS).split(/\r?\n/)[0]).toMatch(/^person,job_title,/);
    expect(openDemandCsv(s, QUARTERS).length).toBeGreaterThan(0);
    const evil = { ...s, people: s.people.map((p, i) => (i === 0 ? { ...p, name: '=HYPERLINK("x")' } : p)) };
    expect(bookingsCsv(evil)).toContain(`"'=HYPERLINK(""x"")"`);
  });

  it('buildQbrPack + qbrPackModel produce the pack sections', () => {
    const data = buildQbrPack(s, QUARTERS, DEFAULT_THRESHOLDS, s.delivery ?? { byProjectQbr1: [] });
    expect(data.quarters).toHaveLength(4);
    expect(data.crafts.length).toBeGreaterThan(0);
    const model = qbrPackModel(data, {
      org: 'Demo Org',
      workspace: 'PMO',
      generatedAt: '2026-10-16',
      filename: 'qbr.pdf',
    });
    expect(model.cover.title).toBeTruthy();
    expect(model.fileName).toBe('qbr.pdf');
    expect(model.sections.length).toBeGreaterThan(2);
  });
});
