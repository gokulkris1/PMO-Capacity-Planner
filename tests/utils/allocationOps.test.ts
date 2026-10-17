import type * as D from '../../shared/contracts/dto';
import type { AllocationBatchResponse, AllocationOp } from '../../shared/contracts/api';
import { DEFAULT_THRESHOLDS } from '../../shared/utilisation';
import {
  applyAllocationOps,
  applyBatchResponse,
  bookingPctAtQuarterEnd,
  inverseOps,
  setBookingRange,
} from '../../utils/viewModels/allocationOps';
import { buildAllocationGrid, copyForward, setQuarterCell } from '../../utils/viewModels';
import { alloc, person, project, QUARTERS, snapshot } from './fixtures';

const [Q4, Q1, Q2, Q3] = QUARTERS;
let n = 0;
const ctx = { newId: () => `new-${++n}`, now: '2026-10-16T10:00:00.000Z', user: { id: 'u', name: 'U' } };

/** The booking's effective % per quarter (QBR1–4), from the grid view-model. */
function cells(s: D.WorkspaceSnapshot, personId = 'r1', projectId = 'p1', craftId = 'pm'): number[] {
  const g = buildAllocationGrid(s, QUARTERS, {
    groupBy: 'none',
    pivot: 'person',
    includeTentative: true,
    thresholds: DEFAULT_THRESHOLDS,
  });
  const row = g.groups
    .flatMap((x) => x.rows)
    .find((r) => r.kind === 'booking' && r.personId === personId && r.projectId === projectId && r.craftId === craftId);
  return row ? row.cells.map((c) => c.pct) : [0, 0, 0, 0];
}

function apply(s: D.WorkspaceSnapshot, ops: AllocationOp[]): D.WorkspaceSnapshot {
  return { ...s, allocations: applyAllocationOps(s.allocations, ops, ctx) };
}

const base = (allocations: D.AllocationDTO[], p: Partial<D.ProjectDTO> = {}) =>
  snapshot({
    people: [person('r1', { secondaryCrafts: [{ craftId: 'sm', proficiency: 2, maxPct: 40 }] })],
    projects: [project('p1', p)],
    allocations,
  });

describe('setQuarterCell (AL-02#AC1, #AC5)', () => {
  it('splits a long allocation so only the edited quarter changes', () => {
    const s = base([
      alloc('a', {
        resourceId: 'r1',
        projectId: 'p1',
        percentage: 50,
        craftId: 'pm',
        startDate: '2026-07-01',
        endDate: '2027-06-30',
      }),
    ]);
    expect(cells(s)).toEqual([50, 50, 50, 0]);
    const ops = setQuarterCell(s, QUARTERS, {
      resourceId: 'r1',
      projectId: 'p1',
      craftId: 'pm',
      quarterKey: Q1.key,
      pct: 20,
    });
    expect(ops).toEqual([
      { op: 'update', id: 'a', version: 1, patch: { startDate: '2026-07-01', endDate: '2026-12-31' } },
      {
        op: 'create',
        allocation: expect.objectContaining({
          percentage: 50,
          startDate: '2027-04-01',
          endDate: '2027-06-30',
          craftId: 'pm',
        }),
      },
      {
        op: 'create',
        allocation: expect.objectContaining({
          percentage: 20,
          startDate: Q1.start,
          endDate: Q1.end,
          source: 'manual',
          state: 'confirmed',
        }),
      },
    ]);
    expect(cells(apply(s, ops))).toEqual([50, 20, 50, 0]);
  });

  it('reuses an allocation that lies wholly inside the quarter', () => {
    const s = base([
      alloc('a', {
        resourceId: 'r1',
        projectId: 'p1',
        percentage: 30,
        craftId: 'pm',
        startDate: '2027-01-15',
        endDate: '2027-02-15',
      }),
    ]);
    const ops = setQuarterCell(s, QUARTERS, {
      resourceId: 'r1',
      projectId: 'p1',
      craftId: 'pm',
      quarterKey: Q1.key,
      pct: 40,
    });
    expect(ops).toEqual([
      { op: 'update', id: 'a', version: 1, patch: { startDate: Q1.start, endDate: Q1.end, percentage: 40 } },
    ]);
    expect(cells(apply(s, ops))).toEqual([0, 40, 0, 0]);
  });

  it('entering 0 removes only that quarter', () => {
    const s = base([
      alloc('a', {
        resourceId: 'r1',
        projectId: 'p1',
        percentage: 50,
        craftId: 'pm',
        startDate: '2026-10-01',
        endDate: '2027-09-30',
      }),
    ]);
    const ops = setQuarterCell(s, QUARTERS, {
      resourceId: 'r1',
      projectId: 'p1',
      craftId: 'pm',
      quarterKey: Q2.key,
      pct: 0,
    });
    expect(ops.filter((o) => o.op === 'create')).toHaveLength(1); // the remainder after Q2
    expect(cells(apply(s, ops))).toEqual([50, 50, 0, 50]);
    const inside = base([
      alloc('b', {
        resourceId: 'r1',
        projectId: 'p1',
        percentage: 50,
        craftId: 'pm',
        startDate: Q2.start,
        endDate: Q2.end,
      }),
    ]);
    expect(
      setQuarterCell(inside, QUARTERS, {
        resourceId: 'r1',
        projectId: 'p1',
        craftId: 'pm',
        quarterKey: Q2.key,
        pct: 0,
      }),
    ).toEqual([{ op: 'delete', id: 'b', version: 1 }]);
  });

  it('clips a new booking to the project window and shows it as partial', () => {
    const s = base([], { startDate: '2026-11-02', endDate: '2027-04-30' });
    const ops = setQuarterCell(s, QUARTERS, {
      resourceId: 'r1',
      projectId: 'p1',
      craftId: 'pm',
      quarterKey: Q4.key,
      pct: 50,
    });
    expect(ops).toEqual([
      {
        op: 'create',
        allocation: expect.objectContaining({ startDate: '2026-11-02', endDate: '2026-12-31', percentage: 50 }),
      },
    ]);
    const after = apply(s, ops);
    expect(cells(after)[0]).toBe(32.6); // 60 of 92 days at 50%
    const g = buildAllocationGrid(after, QUARTERS, {
      groupBy: 'none',
      pivot: 'person',
      includeTentative: true,
      thresholds: DEFAULT_THRESHOLDS,
    });
    expect(g.groups[0].rows.find((r) => r.kind === 'booking')?.cells[0].partial).toBe(true);
    // A quarter entirely outside the project creates nothing.
    expect(
      setQuarterCell(s, QUARTERS, { resourceId: 'r1', projectId: 'p1', craftId: 'pm', quarterKey: Q3.key, pct: 50 }),
    ).toEqual([]);
  });

  it('returns no ops when the value is unchanged', () => {
    const s = base([
      alloc('a', {
        resourceId: 'r1',
        projectId: 'p1',
        percentage: 30,
        craftId: 'pm',
        startDate: '2026-10-01',
        endDate: '2027-06-30',
      }),
    ]);
    expect(
      setQuarterCell(s, QUARTERS, { resourceId: 'r1', projectId: 'p1', craftId: 'pm', quarterKey: Q1.key, pct: 30 }),
    ).toEqual([]);
  });

  it('splits an open-ended allocation (no allocation or project dates)', () => {
    const s = base([alloc('a', { resourceId: 'r1', projectId: 'p1', percentage: 40, craftId: null })]);
    const ops = setQuarterCell(s, QUARTERS, {
      resourceId: 'r1',
      projectId: 'p1',
      craftId: null,
      quarterKey: Q4.key,
      pct: 60,
    });
    expect(ops[0]).toEqual({ op: 'update', id: 'a', version: 1, patch: { startDate: null, endDate: '2026-09-30' } });
    expect(ops[1]).toEqual({
      op: 'create',
      allocation: expect.objectContaining({ startDate: '2027-01-01', endDate: null, percentage: 40 }),
    });
    expect(cells(apply(s, ops))).toEqual([60, 40, 40, 40]);
  });

  it('only touches the edited craft; declined bookings are ignored; tentative ones are part of the booking', () => {
    const s = base([
      alloc('pm', {
        resourceId: 'r1',
        projectId: 'p1',
        percentage: 50,
        craftId: 'pm',
        startDate: Q4.start,
        endDate: Q4.end,
      }),
      alloc('sm', {
        resourceId: 'r1',
        projectId: 'p1',
        percentage: 20,
        craftId: 'sm',
        startDate: Q4.start,
        endDate: Q4.end,
      }),
      alloc('dec', {
        resourceId: 'r1',
        projectId: 'p1',
        percentage: 70,
        craftId: 'pm',
        startDate: Q4.start,
        endDate: Q4.end,
        state: 'declined',
      }),
      alloc('ten', {
        resourceId: 'r1',
        projectId: 'p1',
        percentage: 10,
        craftId: 'pm',
        startDate: Q1.start,
        endDate: Q1.end,
        state: 'tentative',
      }),
    ]);
    const ops = setQuarterCell(s, QUARTERS, {
      resourceId: 'r1',
      projectId: 'p1',
      craftId: 'pm',
      quarterKey: Q4.key,
      pct: 25,
    });
    expect(ops).toEqual([
      { op: 'update', id: 'pm', version: 1, patch: { startDate: Q4.start, endDate: Q4.end, percentage: 25 } },
    ]);
    const q1 = setQuarterCell(s, QUARTERS, {
      resourceId: 'r1',
      projectId: 'p1',
      craftId: 'pm',
      quarterKey: Q1.key,
      pct: 30,
    });
    expect(q1).toEqual([
      { op: 'update', id: 'ten', version: 1, patch: { startDate: Q1.start, endDate: Q1.end, percentage: 30 } },
    ]);
    expect(cells(apply(s, ops), 'r1', 'p1', 'sm')[0]).toBe(20);
  });

  it("treats a null craft as the person's above-the-table craft", () => {
    const s = base([
      alloc('a', {
        resourceId: 'r1',
        projectId: 'p1',
        percentage: 50,
        craftId: null,
        startDate: Q4.start,
        endDate: Q4.end,
      }),
    ]);
    expect(
      setQuarterCell(s, QUARTERS, { resourceId: 'r1', projectId: 'p1', craftId: 'pm', quarterKey: Q4.key, pct: 50 }),
    ).toEqual([]);
  });

  it('rejects values outside 0–200 (AL-02#AC4)', () => {
    const s = base([]);
    expect(() =>
      setQuarterCell(s, QUARTERS, { resourceId: 'r1', projectId: 'p1', craftId: 'pm', quarterKey: Q4.key, pct: 201 }),
    ).toThrow('Enter 0–200');
    expect(() =>
      setQuarterCell(s, QUARTERS, { resourceId: 'r1', projectId: 'p1', craftId: 'pm', quarterKey: Q4.key, pct: -1 }),
    ).toThrow(RangeError);
    expect(
      setQuarterCell(s, QUARTERS, { resourceId: 'r1', projectId: 'p1', craftId: 'pm', quarterKey: '2030-Q1', pct: 10 }),
    ).toEqual([]);
  });
});

describe('copyForward (AL-03#AC1)', () => {
  it('copies the latest value in the quarter to every later quarter, clipped to the project', () => {
    const s = base(
      [
        alloc('oct', {
          resourceId: 'r1',
          projectId: 'p1',
          percentage: 30,
          craftId: 'pm',
          startDate: '2026-10-01',
          endDate: '2026-11-30',
        }),
        alloc('dec', {
          resourceId: 'r1',
          projectId: 'p1',
          percentage: 50,
          craftId: 'pm',
          startDate: '2026-12-01',
          endDate: '2026-12-31',
        }),
      ],
      { startDate: '2026-10-01', endDate: '2027-08-15' },
    );
    expect(bookingPctAtQuarterEnd(s, { resourceId: 'r1', projectId: 'p1', craftId: 'pm' }, Q4)).toBe(50);
    const ops = copyForward(s, QUARTERS, { resourceId: 'r1', projectId: 'p1', craftId: 'pm', fromQuarterKey: Q4.key });
    expect(ops).toEqual([
      {
        op: 'create',
        allocation: expect.objectContaining({ percentage: 50, startDate: Q1.start, endDate: '2027-08-15' }),
      },
    ]);
    const after = apply(s, ops);
    expect(cells(after).slice(0, 3)).toEqual([36.7, 50, 50]); // Q4 unchanged (30% × 61/92 + 50% × 31/92)
    expect(cells(after)[3]).toBe(25); // 46 of 92 days at 50%
  });

  it('overwrites later quarters that already have a different value', () => {
    const s = base([
      alloc('q4', {
        resourceId: 'r1',
        projectId: 'p1',
        percentage: 40,
        craftId: 'pm',
        startDate: Q4.start,
        endDate: Q4.end,
      }),
      alloc('later', {
        resourceId: 'r1',
        projectId: 'p1',
        percentage: 10,
        craftId: 'pm',
        startDate: Q2.start,
        endDate: Q3.end,
      }),
    ]);
    const after = apply(
      s,
      copyForward(s, QUARTERS, { resourceId: 'r1', projectId: 'p1', craftId: 'pm', fromQuarterKey: Q4.key }),
    );
    expect(cells(after)).toEqual([40, 40, 40, 40]);
  });

  it('does nothing from the last quarter or for an empty booking', () => {
    const s = base([alloc('a', { resourceId: 'r1', projectId: 'p1', percentage: 40, craftId: 'pm' })]);
    expect(
      copyForward(s, QUARTERS, { resourceId: 'r1', projectId: 'p1', craftId: 'pm', fromQuarterKey: Q3.key }),
    ).toEqual([]);
    const empty = base([]);
    expect(
      copyForward(empty, QUARTERS, { resourceId: 'r1', projectId: 'p1', craftId: 'pm', fromQuarterKey: Q4.key }),
    ).toEqual([]);
  });
});

describe('batch application and undo', () => {
  it('applyBatchResponse upserts and deletes', () => {
    const a = alloc('a', { resourceId: 'r1', projectId: 'p1', percentage: 10 });
    const b = alloc('b', { resourceId: 'r1', projectId: 'p1', percentage: 20 });
    const c = alloc('c', { resourceId: 'r1', projectId: 'p1', percentage: 30 });
    const out = applyBatchResponse([a, b], {
      upserted: [{ ...a, percentage: 15, version: 2 }, c],
      deleted: ['b'],
      dataVersion: 7,
    });
    expect(out.map((x) => [x.id, x.percentage])).toEqual([
      ['a', 15],
      ['c', 30],
    ]);
  });

  it('inverseOps restores the previous bookings (PL-06#AC4)', () => {
    const s = base([
      alloc('a', {
        resourceId: 'r1',
        projectId: 'p1',
        percentage: 50,
        craftId: 'pm',
        startDate: '2026-07-01',
        endDate: '2027-06-30',
      }),
      alloc('5d0f6c62-2b6e-4f39-9a51-0c7a2f1e8b11', {
        resourceId: 'r1',
        projectId: 'p1',
        percentage: 20,
        craftId: 'pm',
        startDate: Q3.start,
        endDate: Q3.end,
      }),
    ]);
    const ops: AllocationOp[] = [
      ...setQuarterCell(s, QUARTERS, { resourceId: 'r1', projectId: 'p1', craftId: 'pm', quarterKey: Q1.key, pct: 10 }),
      { op: 'delete', id: '5d0f6c62-2b6e-4f39-9a51-0c7a2f1e8b11', version: 1 },
    ];
    const afterList = applyAllocationOps(s.allocations, ops, ctx);
    const response: AllocationBatchResponse = {
      upserted: afterList.filter((x) => !s.allocations.includes(x)),
      deleted: ['5d0f6c62-2b6e-4f39-9a51-0c7a2f1e8b11'],
      dataVersion: 2,
    };
    const inv = inverseOps(s.allocations, response);
    expect(
      inv.find((o) => o.op === 'create' && o.allocation.id === '5d0f6c62-2b6e-4f39-9a51-0c7a2f1e8b11'),
    ).toBeDefined();
    const restored = { ...s, allocations: applyAllocationOps(afterList, inv, ctx) };
    expect(cells(restored)).toEqual(cells(s));
    expect(restored.allocations.find((x) => x.id === 'a')).toMatchObject({
      startDate: '2026-07-01',
      endDate: '2027-06-30',
      percentage: 50,
    });
  });

  it('inverseOps never patches provenance on update, which the API refuses (QA-003)', () => {
    const before = [
      alloc('pv', { resourceId: 'r1', projectId: 'p1', percentage: 50, source: 'planview', externalRef: 'PV-1' }),
    ];
    const after = { ...before[0], percentage: 10, source: 'manual' as const, version: 2 };
    const inv = inverseOps(before, { upserted: [after], deleted: [], dataVersion: 2 });
    expect(inv).toHaveLength(1);
    const op = inv[0] as Extract<AllocationOp, { op: 'update' }>;
    expect(op.patch).toMatchObject({ percentage: 50 });
    expect(op.patch).not.toHaveProperty('source');
    expect(op.patch).not.toHaveProperty('externalRef');
  });

  it('setBookingRange never chains temporary ids and keeps provenance on split copies', () => {
    const s = base([
      alloc('pv', {
        resourceId: 'r1',
        projectId: 'p1',
        percentage: 30,
        craftId: 'pm',
        startDate: '2026-10-01',
        endDate: '2027-09-30',
        source: 'planview',
        externalRef: 'PVA-1',
      }),
    ]);
    const ops = setBookingRange(s, {
      resourceId: 'r1',
      projectId: 'p1',
      craftId: 'pm',
      from: Q2.start,
      to: Q2.end,
      pct: 0,
    });
    const copy = ops.find((o) => o.op === 'create');
    expect(copy && copy.op === 'create' && copy.allocation).toMatchObject({ source: 'planview', externalRef: 'PVA-1' });
    expect(ops.every((o) => o.op !== 'create' || !o.allocation.id)).toBe(true);
  });
});
