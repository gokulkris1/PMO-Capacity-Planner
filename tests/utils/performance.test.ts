/**
 * AL-01#AC6 / PL-04#AC1 sizing: 200 people × 100 projects × 2,000 bookings. The view-models behind
 * first paint must stay well inside the 2 s budget (generous limits here so slow CI does not flake).
 */
import type * as D from '../../shared/contracts/dto';
import { DEFAULT_THRESHOLDS } from '../../shared/utilisation';
import { setClock } from '../../utils/clock';
import {
  buildAllocationGrid,
  buildCapacityOutlook,
  buildCatalogue,
  buildDemandGrid,
  buildHome,
  buildOpenDemand,
  buildPeopleRows,
} from '../../utils/viewModels';
import { demoSnapshot, QUARTERS, TODAY } from './fixtures';

let big: D.WorkspaceSnapshot;
beforeAll(async () => {
  setClock(TODAY);
  const s = await demoSnapshot();
  big = {
    ...s,
    people: Array.from({ length: 200 }, (_, i) => ({
      ...s.people[i % s.people.length],
      id: `bp${i}`,
      name: `Person ${i}`,
    })),
    projects: Array.from({ length: 100 }, (_, i) => ({
      ...s.projects[i % s.projects.length],
      id: `bj${i}`,
      name: `Project ${i}`,
    })),
    allocations: Array.from({ length: 2000 }, (_, i) => ({
      ...s.allocations[i % s.allocations.length],
      id: `ba${i}`,
      resourceId: `bp${i % 200}`,
      projectId: `bj${i % 100}`,
    })),
    demand: Array.from({ length: 400 }, (_, i) => ({
      ...s.demand[i % s.demand.length],
      id: `bd${i}`,
      projectId: `bj${i % 100}`,
    })),
  };
});
afterAll(() => setClock());

function timed(fn: () => unknown): number {
  const t0 = Date.now();
  fn();
  return Date.now() - t0;
}

describe('view-model performance at 200 × 100 × 2,000', () => {
  it.each([
    ['buildPeopleRows', () => buildPeopleRows(big, QUARTERS, DEFAULT_THRESHOLDS)],
    [
      'buildAllocationGrid',
      () =>
        buildAllocationGrid(big, QUARTERS, {
          groupBy: 'team',
          pivot: 'person',
          includeTentative: true,
          thresholds: DEFAULT_THRESHOLDS,
        }),
    ],
    [
      'buildAllocationGrid (project)',
      () =>
        buildAllocationGrid(big, QUARTERS, {
          groupBy: 'tribe',
          pivot: 'project',
          includeTentative: true,
          thresholds: DEFAULT_THRESHOLDS,
        }),
    ],
    [
      'buildCapacityOutlook',
      () => buildCapacityOutlook(big, QUARTERS, { pivot: 'craft', thresholds: DEFAULT_THRESHOLDS }),
    ],
    ['buildDemandGrid', () => buildDemandGrid(big, QUARTERS)],
    ['buildCatalogue', () => buildCatalogue(big, QUARTERS, QUARTERS[0].key)],
    ['buildHome', () => buildHome(big, QUARTERS, { kind: 'today' }, DEFAULT_THRESHOLDS, null)],
    ['buildOpenDemand with matches', () => buildOpenDemand(big, QUARTERS, { quarterKey: QUARTERS[0].key })],
  ])('%s', (_name, fn) => {
    expect(timed(fn)).toBeLessThan(2000);
  });
});
