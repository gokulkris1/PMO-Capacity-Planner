/**
 * Allocation batch operations: quarter-cell edits, copy-forward, local application of a batch
 * (optimistic updates and DemoTransport) and inverse batches (undo).
 *
 * A "booking" is the set of allocations of one person on one project under one craft (the craft
 * of an allocation is its own `craftId`, else the person's above-the-table craft). Editing a
 * quarter cell changes only that quarter: allocations that straddle the quarter are split, the
 * new value is clipped to the project window, and an allocation lying wholly inside the quarter
 * is reused rather than deleted and re-created (AL-02#AC1, #AC5; AL-03#AC1).
 *
 * Pure: no React, DOM, Node or Netlify imports.
 */
import type * as D from '../../shared/contracts/dto';
import type { AllocationBatchResponse, AllocationOp, NewAllocation } from '../../shared/contracts/api';
import { effectiveWindow, allocationCraft } from '../craftEngine';
import { addDays, dayNumber } from '../quarters';
import type { QuarterView } from './types';

export { addDays, effectiveWindow };

const maxDate = (a: D.ISODate | null, b: D.ISODate | null) => (a === null ? b : b === null ? a : a > b ? a : b);
const minDate = (a: D.ISODate | null, b: D.ISODate | null) => (a === null ? b : b === null ? a : a < b ? a : b);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const MAX_CELL_PCT = 200;
export const MAX_BATCH_OPS = 500;

export function isUuid(id: string): boolean {
  return UUID_RE.test(id);
}

export interface BookingKey {
  resourceId: D.ID;
  projectId: D.ID;
  craftId: D.ID | null;
}

/** The craft a booking counts under (its own craft, else the person's above-the-table craft). */
export function effectiveCraft(a: Pick<D.AllocationDTO, 'craftId'>, person: D.PersonDTO | undefined): D.ID | null {
  return allocationCraft(a, person) ?? null;
}

/** Allocations (not declined) that belong to one booking key. */
export function bookingAllocations(s: D.WorkspaceSnapshot, k: BookingKey): D.AllocationDTO[] {
  const person = s.people.find((p) => p.id === k.resourceId);
  const target = k.craftId ?? person?.primaryCraft ?? null;
  return s.allocations.filter(
    (a) =>
      a.resourceId === k.resourceId &&
      a.projectId === k.projectId &&
      a.state !== 'declined' &&
      effectiveCraft(a, person) === target,
  );
}

function overlaps(w: { start: D.ISODate | null; end: D.ISODate | null }, from: D.ISODate, to: D.ISODate): boolean {
  return (w.start === null || w.start <= to) && (w.end === null || w.end >= from);
}

/**
 * Operations that make booking `k` equal `pct` inside [from, to] (clipped to the project window)
 * and leave it unchanged outside that range. `pct` 0 removes the range. Returns [] when the booking
 * already has exactly that value over the range.
 */
export function setBookingRange(
  s: D.WorkspaceSnapshot,
  k: BookingKey & { from: D.ISODate; to: D.ISODate; pct: number },
): AllocationOp[] {
  const project = s.projects.find((p) => p.id === k.projectId);
  const createFrom = maxDate(k.from, project?.startDate ?? null) ?? k.from;
  const createTo = minDate(k.to, project?.endDate ?? null) ?? k.to;
  const canCreate = k.pct > 0 && createFrom <= createTo;
  const existing = bookingAllocations(s, k).filter((a) => overlaps(effectiveWindow(a, project), k.from, k.to));

  // Already exactly this value over the whole (clipped) range: nothing to do.
  if (canCreate && existing.length === 1) {
    const only = existing[0];
    const w = effectiveWindow(only, project);
    const covers = (w.start === null || w.start <= createFrom) && (w.end === null || w.end >= createTo);
    if (covers && only.percentage === k.pct) return [];
  }
  if (!canCreate && existing.length === 0) return [];

  const ops: AllocationOp[] = [];
  let reused = false;
  for (const a of existing) {
    const w = effectiveWindow(a, project);
    const before = w.start === null || w.start < k.from ? { start: w.start, end: addDays(k.from, -1) } : null;
    const after = w.end === null || w.end > k.to ? { start: addDays(k.to, 1), end: w.end } : null;

    if (!before && !after) {
      if (canCreate && !reused) {
        reused = true;
        ops.push({
          op: 'update',
          id: a.id,
          version: a.version,
          patch: { startDate: createFrom, endDate: createTo, percentage: k.pct },
        });
      } else {
        ops.push({ op: 'delete', id: a.id, version: a.version });
      }
      continue;
    }
    const keep = before ?? after!;
    ops.push({ op: 'update', id: a.id, version: a.version, patch: { startDate: keep.start, endDate: keep.end } });
    if (before && after)
      ops.push({ op: 'create', allocation: copyOf(a, { startDate: after.start, endDate: after.end }) });
  }

  if (canCreate && !reused) {
    ops.push({
      op: 'create',
      allocation: {
        resourceId: k.resourceId,
        projectId: k.projectId,
        percentage: k.pct,
        craftId: k.craftId,
        startDate: createFrom,
        endDate: createTo,
        source: 'manual',
        state: 'confirmed',
        notes: null,
      },
    });
  }
  return ops;
}

/** setQuarterCell ops (AL-02). Throws a RangeError for values outside 0–200. */
export function quarterCellOps(
  s: D.WorkspaceSnapshot,
  quarters: QuarterView[],
  a: BookingKey & { quarterKey: D.QuarterKey; pct: number },
): AllocationOp[] {
  if (!Number.isFinite(a.pct) || a.pct < 0 || a.pct > MAX_CELL_PCT) throw new RangeError('Enter 0–200');
  const q = quarters.find((x) => x.key === a.quarterKey);
  if (!q) return [];
  return setBookingRange(s, { ...a, from: q.start, to: q.end, pct: Math.round(a.pct * 10) / 10 });
}

/**
 * The booking's nominal % in a quarter: the sum of the allocations active on the latest day of the
 * quarter on which the booking has any allocation (so "30% Oct–Nov, 50% Dec" copies 50%).
 */
export function bookingPctAtQuarterEnd(s: D.WorkspaceSnapshot, k: BookingKey, q: QuarterView): number {
  const project = s.projects.find((p) => p.id === k.projectId);
  const inQuarter = bookingAllocations(s, k)
    .map((a) => ({ a, w: effectiveWindow(a, project) }))
    .filter(({ w }) => overlaps(w, q.start, q.end));
  if (inQuarter.length === 0) return 0;
  const lastDay = inQuarter.reduce((m, { w }) => Math.max(m, dayNumber(minDate(w.end, q.end) ?? q.end)), -Infinity);
  return inQuarter
    .filter(
      ({ w }) => (w.start === null || dayNumber(w.start) <= lastDay) && (w.end === null || dayNumber(w.end) >= lastDay),
    )
    .reduce((x, { a }) => x + a.percentage, 0);
}

/** copyForward ops (AL-03): the booking's value in `fromQuarterKey` applied to every later quarter in the window. */
export function copyForwardOps(
  s: D.WorkspaceSnapshot,
  quarters: QuarterView[],
  a: BookingKey & { fromQuarterKey: D.QuarterKey },
): AllocationOp[] {
  const i = quarters.findIndex((x) => x.key === a.fromQuarterKey);
  const later = i >= 0 ? quarters.slice(i + 1) : [];
  if (later.length === 0) return [];
  const pct = bookingPctAtQuarterEnd(s, a, quarters[i]);
  return setBookingRange(s, {
    resourceId: a.resourceId,
    projectId: a.projectId,
    craftId: a.craftId,
    from: later[0].start,
    to: later[later.length - 1].end,
    pct,
  });
}

function copyOf(a: D.AllocationDTO, dates: { startDate: D.ISODate | null; endDate: D.ISODate | null }): NewAllocation {
  return {
    resourceId: a.resourceId,
    projectId: a.projectId,
    percentage: a.percentage,
    craftId: a.craftId,
    source: a.source,
    state: a.state,
    notes: a.notes,
    externalRef: a.externalRef,
    demandLineId: a.demandLineId,
    proposedAt: a.proposedAt,
    proposedBy: a.proposedBy,
    respondedAt: a.respondedAt,
    ...dates,
  };
}

/** Builds a full AllocationDTO from a create op (server-owned fields filled from `ctx`). */
export function materialise(
  n: NewAllocation,
  ctx: { newId: () => D.ID; now: D.ISODateTime; user: D.UserRef | null },
): D.AllocationDTO {
  return {
    id: n.id ?? ctx.newId(),
    resourceId: n.resourceId,
    projectId: n.projectId,
    percentage: n.percentage,
    startDate: n.startDate ?? null,
    endDate: n.endDate ?? null,
    craftId: n.craftId ?? null,
    source: n.source ?? 'manual',
    state: n.state ?? 'confirmed',
    notes: n.notes ?? null,
    externalRef: n.externalRef ?? null,
    demandLineId: n.demandLineId ?? null,
    proposedAt: n.proposedAt ?? null,
    proposedBy: n.proposedBy ?? null,
    respondedAt: n.respondedAt ?? null,
    version: 1,
    updatedAt: ctx.now,
    updatedBy: ctx.user,
  };
}

/**
 * Applies a batch locally (optimistic updates; DemoTransport). Unknown ids in update/delete ops
 * are ignored here; DemoTransport validates them before calling.
 */
export function applyAllocationOps(
  allocations: D.AllocationDTO[],
  ops: AllocationOp[],
  ctx: { newId: () => D.ID; now: D.ISODateTime; user: D.UserRef | null },
): D.AllocationDTO[] {
  let out = [...allocations];
  for (const op of ops) {
    if (op.op === 'delete') out = out.filter((a) => a.id !== op.id);
    else if (op.op === 'update')
      out = out.map((a) =>
        a.id === op.id
          ? { ...a, ...op.patch, id: a.id, version: a.version + 1, updatedAt: ctx.now, updatedBy: ctx.user }
          : a,
      );
    else out.push(materialise(op.allocation, ctx));
  }
  return out;
}

/** Applies a batch response to a list: drops `deleted`, upserts `upserted`. */
export function applyBatchResponse(allocations: D.AllocationDTO[], r: AllocationBatchResponse): D.AllocationDTO[] {
  const gone = new Set(r.deleted);
  const up = new Map(r.upserted.map((a) => [a.id, a]));
  const out = allocations.filter((a) => !gone.has(a.id)).map((a) => up.get(a.id) ?? a);
  for (const a of r.upserted) if (!allocations.some((x) => x.id === a.id)) out.push(a);
  return out;
}

const RESTORABLE: Array<keyof NewAllocation> = [
  'resourceId',
  'projectId',
  'percentage',
  'startDate',
  'endDate',
  'craftId',
  'source',
  'state',
  'notes',
  'externalRef',
  'demandLineId',
  'proposedAt',
  'proposedBy',
  'respondedAt',
];

function restorable(a: D.AllocationDTO): Partial<NewAllocation> {
  const out: Record<string, unknown> = {};
  for (const k of RESTORABLE) out[k] = a[k as keyof D.AllocationDTO];
  return out as Partial<NewAllocation>;
}

/**
 * The batch that undoes a successful batch (PL-06#AC4): created rows are deleted, updated rows get
 * their previous values back, deleted rows are re-created (keeping the id when it is a UUID).
 */
export function inverseOps(before: D.AllocationDTO[], r: AllocationBatchResponse): AllocationOp[] {
  const prev = new Map(before.map((a) => [a.id, a]));
  const ops: AllocationOp[] = [];
  for (const a of r.upserted) {
    const old = prev.get(a.id);
    if (old) ops.push({ op: 'update', id: a.id, version: a.version, patch: restorable(old) });
    else ops.push({ op: 'delete', id: a.id, version: a.version });
  }
  for (const id of r.deleted) {
    const old = prev.get(id);
    if (!old) continue;
    const allocation = { ...restorable(old) } as NewAllocation;
    if (isUuid(old.id)) allocation.id = old.id;
    ops.push({ op: 'create', allocation });
  }
  return ops;
}
