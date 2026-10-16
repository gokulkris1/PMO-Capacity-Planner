/**
 * WP-0 STUB HELPER — computes allocation batch operations that set one booking
 * (person × project × craft) to a percentage over a date range, splitting existing
 * allocations so that only the range changes (AL-02#AC1, AL-03#AC1).
 *
 * Package C owns this file and may keep, rewrite or delete it; only the names exported
 * from `utils/viewModels/index.ts` are public.
 *
 * Pure: no React, DOM, Node or Netlify imports.
 */
import type * as D from '../../shared/contracts/dto';
import type { AllocationOp, NewAllocation } from '../../shared/contracts/api';

/** Adds `n` days to an ISO date ('YYYY-MM-DD'), in UTC so the result never shifts by time zone. */
export function addDays(iso: D.ISODate, n: number): D.ISODate {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const maxDate = (a: D.ISODate | null, b: D.ISODate | null) => (a === null ? b : b === null ? a : a > b ? a : b);
const minDate = (a: D.ISODate | null, b: D.ISODate | null) => (a === null ? b : b === null ? a : a < b ? a : b);

/** Effective window: the allocation's own dates, else the project's, else open-ended (null). */
export function effectiveWindow(
  a: Pick<D.AllocationDTO, 'startDate' | 'endDate'>,
  project: Pick<D.ProjectDTO, 'startDate' | 'endDate'> | undefined,
): { start: D.ISODate | null; end: D.ISODate | null } {
  return { start: a.startDate ?? project?.startDate ?? null, end: a.endDate ?? project?.endDate ?? null };
}

/** The craft a booking counts under: its own craft, else the person's above-the-table craft. */
export function effectiveCraft(a: Pick<D.AllocationDTO, 'craftId'>, person: D.PersonDTO | undefined): D.ID | null {
  return a.craftId ?? person?.primaryCraft ?? null;
}

export interface BookingKey {
  resourceId: D.ID;
  projectId: D.ID;
  craftId: D.ID | null;
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

/**
 * Operations that make booking `k` equal `pct` inside [from, to] (clipped to the project
 * window) and leave it unchanged outside that range. `pct` 0 removes the range.
 */
export function setBookingRange(
  s: D.WorkspaceSnapshot,
  k: BookingKey & { from: D.ISODate; to: D.ISODate; pct: number },
): AllocationOp[] {
  const project = s.projects.find((p) => p.id === k.projectId);
  const createFrom = maxDate(k.from, project?.startDate ?? null) ?? k.from;
  const createTo = minDate(k.to, project?.endDate ?? null) ?? k.to;
  const canCreate = k.pct > 0 && createFrom <= createTo;

  const ops: AllocationOp[] = [];
  let reused = false;

  for (const a of bookingAllocations(s, k)) {
    const w = effectiveWindow(a, project);
    const overlaps = (w.start === null || w.start <= k.to) && (w.end === null || w.end >= k.from);
    if (!overlaps) continue;

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
    if (before && after) {
      ops.push({ op: 'create', allocation: copyOf(a, { startDate: after.start, endDate: after.end }) });
    }
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

/**
 * Applies a batch locally (used by the WP-0 state stub; C may reuse it for optimistic updates).
 * Unknown ids in update/delete ops are ignored.
 */
export function applyAllocationOps(
  allocations: D.AllocationDTO[],
  ops: AllocationOp[],
  ctx: { newId: () => D.ID; now: D.ISODateTime; user: D.UserRef | null },
): D.AllocationDTO[] {
  let out = [...allocations];
  for (const op of ops) {
    if (op.op === 'delete') {
      out = out.filter((a) => a.id !== op.id);
    } else if (op.op === 'update') {
      out = out.map((a) =>
        a.id === op.id ? { ...a, ...op.patch, version: a.version + 1, updatedAt: ctx.now, updatedBy: ctx.user } : a,
      );
    } else {
      const n = op.allocation;
      out.push({
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
      });
    }
  }
  return out;
}
