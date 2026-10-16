import type * as D from '../../shared/contracts/dto';
import { DEFAULT_THRESHOLDS } from '../../shared/utilisation';
import { setClock } from '../../utils/clock';
import { parseCsv } from '../../utils/csv';
import { buildQbrPack, type TableSection } from '../../utils/qbrPack';
import { catalogueCsv, REPORT_TITLE, reportCsv, type ReportId } from '../../utils/reports';
import { demoSnapshot, QUARTERS, TODAY } from './fixtures';

let s: D.WorkspaceSnapshot;
beforeAll(async () => {
  setClock(TODAY);
  s = await demoSnapshot();
});
afterAll(() => setClock());

describe('Reports CSV (RP-04#AC1)', () => {
  it.each(Object.keys(REPORT_TITLE) as ReportId[])('%s produces a header and rows', (id) => {
    const rows = parseCsv(reportCsv(id, s, QUARTERS, DEFAULT_THRESHOLDS, TODAY));
    expect(rows.length).toBeGreaterThan(id === 'time-to-staff' ? 0 : 1);
    expect(rows[0].length).toBeGreaterThan(3);
  });

  it('utilisation by person uses the People numbers', () => {
    const rows = parseCsv(reportCsv('utilisation-person', s, QUARTERS, DEFAULT_THRESHOLDS, TODAY));
    const header = rows[0];
    const maria = rows.find((r) => r[0] === 'Maria Kelly')!;
    expect(maria[header.indexOf('QBR1 Q4 2026 load %')]).toBe('110');
    expect(maria[header.indexOf('QBR1 Q4 2026 band')]).toBe('Over capacity');
  });

  it('bookings include state and provenance; catalogue exports per craft (DM-04#AC3)', () => {
    const bookings = parseCsv(reportCsv('bookings', s, QUARTERS, DEFAULT_THRESHOLDS, TODAY));
    expect(bookings[0]).toEqual([
      'person',
      'project',
      'craft',
      'percentage',
      'start',
      'end',
      'state',
      'source',
      'notes',
    ]);
    expect(bookings.some((r) => r[6] === 'Tentative' && r[7] === 'Marketplace')).toBe(true);
    expect(bookings.some((r) => r[7] === 'Planview')).toBe(true);
    const cat = parseCsv(catalogueCsv(s, QUARTERS, QUARTERS[0].key));
    expect(cat.find((r) => r[1] === 'Kerrie Dalton' && r[0] === 'Programme Management')).toEqual([
      'Programme Management',
      'Kerrie Dalton',
      'Above the table',
      '',
      '70',
      '50',
      'Free until Nebula starts in January',
    ]);
  });
});

describe('QBR pack model (RP-04#AC2, SH-10#AC2)', () => {
  it('has the cover and every section, with the product name and no "Orbit"', () => {
    const m = buildQbrPack({ snapshot: s, quarters: QUARTERS, thresholds: DEFAULT_THRESHOLDS, generatedOn: TODAY });
    expect(m.cover).toEqual({
      title: 'PMO Capacity Planner · QBR pack',
      subtitle: 'Demo Organisation · IE Portfolio & Change Office',
      generatedOn: TODAY,
      basis: 'QBR1 = Q4 2026 (FY26 Q4)',
    });
    expect(m.fileName).toBe('qbr-pack-2026-10-16.pdf');
    expect(m.sections.map((x) => x.title)).toEqual([
      'Squad utilisation',
      'Supply and demand, QBR1–QBR4',
      'Squad utilisation vs target',
      'Supply vs demand by craft',
      'Open demand',
      'Over capacity (QBR1 · Q4 2026)',
      'Available (QBR1 · Q4 2026)',
      'Delivery signal by tribe (QBR1)',
      'Time to staff',
    ]);
    expect(JSON.stringify(m)).not.toMatch(/orbit/i);
    const over = m.sections.find((x) => x.title.startsWith('Over capacity')) as TableSection;
    expect(over.rows.map((r) => r[0])).toEqual(['Noma Odigie', 'Maria Kelly']);
    const util = m.sections.find((x) => x.title === 'Squad utilisation vs target') as TableSection;
    expect(util.bands).toHaveLength(4);
    expect(util.rows[0][5]).toBe('70%');
  });

  it('omits the delivery section without Jira and uses fiscal labels when asked (ST-03#AC3)', () => {
    const m = buildQbrPack({
      snapshot: { ...s, delivery: null },
      quarters: QUARTERS,
      thresholds: DEFAULT_THRESHOLDS,
      generatedOn: TODAY,
      fiscalLabels: true,
    });
    expect(m.sections.some((x) => x.title.startsWith('Delivery signal'))).toBe(false);
    expect((m.sections[2] as TableSection).rows[0][0]).toBe('QBR1 · FY26 Q4');
  });

  it('builds a 200 people × 100 projects × 2,000 bookings pack quickly (RP-04#AC2)', () => {
    const people = Array.from({ length: 200 }, (_, i) => ({
      ...s.people[i % s.people.length],
      id: `bp${i}`,
      name: `Person ${i}`,
    }));
    const projects = Array.from({ length: 100 }, (_, i) => ({
      ...s.projects[i % s.projects.length],
      id: `bj${i}`,
      name: `Project ${i}`,
    }));
    const allocations = Array.from({ length: 2000 }, (_, i) => ({
      ...s.allocations[i % s.allocations.length],
      id: `ba${i}`,
      resourceId: `bp${i % 200}`,
      projectId: `bj${i % 100}`,
    }));
    const demand = Array.from({ length: 400 }, (_, i) => ({
      ...s.demand[i % s.demand.length],
      id: `bd${i}`,
      projectId: `bj${i % 100}`,
    }));
    const started = Date.now();
    const m = buildQbrPack({
      snapshot: { ...s, people, projects, allocations, demand },
      quarters: QUARTERS,
      thresholds: DEFAULT_THRESHOLDS,
      generatedOn: TODAY,
    });
    expect(m.sections.length).toBeGreaterThan(5);
    expect(Date.now() - started).toBeLessThan(10_000);
  });
});
