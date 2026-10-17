/**
 * Allocations, marketplace and offers (PL-04, AL-05, DM-03, DM-05, PPL-05).
 * POST /allocations · PATCH|DELETE /allocations/:id · POST /allocations/batch (atomic, ≤ 500 ops)
 * POST /allocations/:id/respond · POST /marketplace/propose · PUT|DELETE /offers/:personId/:quarterKey
 */
import { z } from 'zod';
import type { AllocationBatchResponse, AllocationOp } from '../../../../shared/contracts/api';
import type { AllocationDTO, MarketplaceOfferDTO } from '../../../../shared/contracts/dto';
import { QUARTER_KEY_RE } from '../../../../shared/contracts/dto';
import type { Ctx } from '../api';
import { auditCtx, noContent, parseWith, reply, requireActor } from '../api';
import { audit } from '../audit';
import type { WorkspaceAccess } from '../authz';
import { has, requireWorkspace } from '../authz';
import type { Queryable } from '../db';
import { one, withTx } from '../db';
import { OFFER_COLUMNS, offerDTO } from '../dto';
import { appBaseUrl } from '../env';
import { badRequest, conflict, forbidden, notFound, payloadTooLarge } from '../errors';
import { proposalEmail, sendEmail } from '../email';
import { ISO_DATE_RE, bumpDataVersion, newId, quarterRange, requireVersion, staleOrMissing } from '../entity';
import { assertCraft, isOwnPerson, loadAllocation, loadAllocations, loadDemandLine } from '../loaders';
import type { Params } from '../router';
import { PLANVIEW_LOCKED, planviewLocked, withOpIndex } from './projects';

const isoDate = z.string().regex(ISO_DATE_RE, 'Use YYYY-MM-DD');
const allocationFields = {
  resourceId: z.string().min(1),
  projectId: z.string().min(1),
  percentage: z.number().min(0, 'Enter 0–200').max(200, 'Enter 0–200'),
  startDate: isoDate.nullable(),
  endDate: isoDate.nullable(),
  craftId: z.string().nullable(),
  source: z.enum(['manual', 'marketplace', 'jira']),
  state: z.enum(['tentative', 'confirmed', 'declined']),
  notes: z.string().max(2000).nullable(),
  externalRef: z.string().max(200).nullable(),
  demandLineId: z.string().nullable(),
};
/** Fields that record where a booking came from: set on create or by the system, read-only afterwards (QA-003). */
export const PROVENANCE_FIELDS = ['source', 'externalRef'] as const;
export const PROVENANCE_READ_ONLY = 'Where a booking came from is recorded by the system and cannot be changed.';

const allocationPatchSchema = z
  .object({ ...allocationFields, source: z.enum(['manual', 'marketplace', 'planview', 'jira']) })
  .partial();
const newAllocationSchema = z.object(allocationFields).partial().extend({
  resourceId: allocationFields.resourceId,
  projectId: allocationFields.projectId,
  percentage: allocationFields.percentage,
  id: z.string().optional(),
});

type AllocData = Pick<
  AllocationDTO,
  | 'resourceId'
  | 'projectId'
  | 'percentage'
  | 'startDate'
  | 'endDate'
  | 'craftId'
  | 'source'
  | 'state'
  | 'notes'
  | 'externalRef'
  | 'demandLineId'
>;

async function validateAllocation(q: Queryable, access: WorkspaceAccess, d: AllocData, craftChanged: boolean) {
  if (
    !(await one(q, `SELECT 1 AS x FROM resources WHERE workspace_id = $1 AND id = $2`, [
      access.workspaceId,
      d.resourceId,
    ]))
  ) {
    throw badRequest('Not in this workspace', { resourceId: 'Not in this workspace' });
  }
  if (
    !(await one(q, `SELECT 1 AS x FROM projects WHERE workspace_id = $1 AND id = $2`, [
      access.workspaceId,
      d.projectId,
    ]))
  ) {
    throw badRequest('Not in this workspace', { projectId: 'Not in this workspace' });
  }
  if (d.craftId) await assertCraft(q, access.orgId, d.craftId, 'craftId', !craftChanged);
  if (d.startDate && d.endDate && d.endDate < d.startDate) {
    throw badRequest('End date must be on or after the start date', {
      endDate: 'End date must be on or after the start date',
    });
  }
  if (d.demandLineId && !(await loadDemandLine(q, access.workspaceId, d.demandLineId))) {
    throw badRequest('Unknown demand line', { demandLineId: 'Not in this workspace' });
  }
}

const ALLOC_VALUES = (d: AllocData) => [
  d.resourceId,
  d.projectId,
  Math.round(d.percentage),
  d.startDate,
  d.endDate,
  d.craftId,
  d.source,
  d.state,
  d.notes,
  d.externalRef,
  d.demandLineId,
];

async function createAllocationRow(
  q: Queryable,
  access: WorkspaceAccess,
  raw: unknown,
  userId: string,
): Promise<string> {
  const body = parseWith(newAllocationSchema, raw);
  const id = newId(body.id);
  const d: AllocData = {
    resourceId: body.resourceId,
    projectId: body.projectId,
    percentage: body.percentage,
    startDate: body.startDate ?? null,
    endDate: body.endDate ?? null,
    craftId: body.craftId ?? null,
    source: body.source ?? 'manual',
    state: body.state ?? 'confirmed',
    notes: body.notes ?? null,
    externalRef: body.externalRef ?? null,
    demandLineId: body.demandLineId ?? null,
  };
  if (d.percentage <= 0) throw badRequest('Enter 0–200', { percentage: 'A new booking needs more than 0%' });
  await validateAllocation(q, access, d, true);
  if (await one(q, `SELECT 1 AS x FROM allocations WHERE id = $1`, [id]))
    throw conflict('A booking with this id already exists.');
  await q.query(
    `INSERT INTO allocations (id, workspace_id, updated_by, resource_id, project_id, percentage, start_date, end_date, craft_id,
       source, state, notes, external_ref, demand_line_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [id, access.workspaceId, userId, ...ALLOC_VALUES(d)],
  );
  return id;
}

async function updateAllocationRow(
  q: Queryable,
  access: WorkspaceAccess,
  id: string,
  version: number,
  raw: unknown,
  userId: string,
): Promise<{ before: AllocationDTO; after: AllocationDTO }> {
  const patch = parseWith(allocationPatchSchema, raw ?? {});
  const before = await loadAllocation(q, access.workspaceId, id);
  if (!before) throw notFound('This booking no longer exists.');
  const changed = (k: keyof typeof patch) => patch[k] !== undefined && patch[k] !== before[k as keyof AllocationDTO];
  // AL-05#AC2 (QA-003): under the "locked" rule a Planview booking is read-only for every role, whatever the field,
  // provenance included. Only the Planview import writes it; a PMO Admin can switch the rule to "Overridable".
  if (
    before.source === 'planview' &&
    planviewLocked(access) &&
    (Object.keys(patch) as Array<keyof typeof patch>).some(changed)
  )
    throw conflict(PLANVIEW_LOCKED);
  // Provenance (where the booking came from) is recorded by the system, never set through the API.
  for (const k of PROVENANCE_FIELDS) {
    if (changed(k)) throw badRequest(PROVENANCE_READ_ONLY, { [k]: 'Not allowed' });
  }
  const d: AllocData = { ...before, ...patch } as AllocData;
  const changesBooking = (['resourceId', 'projectId', 'percentage', 'startDate', 'endDate', 'craftId'] as const).some(
    changed,
  );
  if (before.source === 'planview' && changesBooking) {
    d.source = 'manual'; // AL-05#AC2: overriding a Planview booking makes it manual; external_ref is kept
  }
  if (d.percentage <= 0) throw badRequest('Enter 0–200', { percentage: 'Use DELETE to remove a booking' });
  await validateAllocation(q, access, d, patch.craftId !== undefined && patch.craftId !== before.craftId);
  const confirming = before.state === 'tentative' && d.state === 'confirmed';
  const responded = before.state === 'tentative' && d.state !== 'tentative';
  const rows = await q.query(
    `UPDATE allocations SET resource_id = $4, project_id = $5, percentage = $6, start_date = $7, end_date = $8, craft_id = $9,
       source = $10, state = $11, notes = $12, external_ref = $13, demand_line_id = $14,
       responded_at = CASE WHEN $16 THEN now() ELSE responded_at END,
       time_to_staff_days = CASE WHEN $17 THEN round((extract(epoch FROM now() - coalesce(
         (SELECT dl.created_at FROM demand_lines dl WHERE dl.id = allocations.demand_line_id), proposed_at, now())) / 86400)::numeric, 2)
         ELSE time_to_staff_days END,
       version = version + 1, updated_at = now(), updated_by = $15
     WHERE id = $1 AND workspace_id = $2 AND version = $3 RETURNING id`,
    [id, access.workspaceId, version, ...ALLOC_VALUES(d), userId, responded, confirming],
  );
  if (!rows.length) await staleOrMissing(() => loadAllocation(q, access.workspaceId, id), 'booking');
  return { before, after: (await loadAllocation(q, access.workspaceId, id)) as AllocationDTO };
}

async function deleteAllocationRow(
  q: Queryable,
  access: WorkspaceAccess,
  id: string,
  version: number | null,
): Promise<AllocationDTO> {
  const before = await loadAllocation(q, access.workspaceId, id);
  if (!before) throw notFound('This booking no longer exists.');
  if (version !== null && version !== before.version) await staleOrMissing(async () => before, 'booking');
  if (before.source === 'planview' && planviewLocked(access)) throw conflict(PLANVIEW_LOCKED);
  await q.query(`DELETE FROM allocations WHERE workspace_id = $1 AND id = $2`, [access.workspaceId, id]);
  return before;
}

export async function createAllocation(ctx: Ctx, p: Params) {
  const access = await requireWorkspace(ctx, p.wsId, 'allocations.write');
  const actor = requireActor(ctx);
  const created = await withTx(async (q) => {
    const id = await createAllocationRow(q, access, ctx.body, actor.userId);
    await bumpDataVersion(q, p.wsId);
    const after = await loadAllocation(q, p.wsId, id);
    await audit(q, auditCtx(ctx), {
      action: 'allocation.create',
      orgId: access.orgId,
      workspaceId: p.wsId,
      targetType: 'allocation',
      targetId: id,
      after,
    });
    return after;
  });
  return reply(201, created);
}

export async function patchAllocation(ctx: Ctx, p: Params) {
  const access = await requireWorkspace(ctx, p.wsId, 'allocations.write');
  const body = (ctx.body ?? {}) as { version?: unknown; patch?: unknown };
  const version = requireVersion(body.version);
  const actor = requireActor(ctx);
  return withTx(async (q) => {
    const { before, after } = await updateAllocationRow(q, access, p.id, version, body.patch, actor.userId);
    await bumpDataVersion(q, p.wsId);
    await audit(q, auditCtx(ctx), {
      action: 'allocation.update',
      orgId: access.orgId,
      workspaceId: p.wsId,
      targetType: 'allocation',
      targetId: p.id,
      before,
      after,
    });
    return after;
  });
}

export async function deleteAllocation(ctx: Ctx, p: Params) {
  const access = await requireWorkspace(ctx, p.wsId, 'allocations.write');
  await withTx(async (q) => {
    const before = await deleteAllocationRow(
      q,
      access,
      p.id,
      ctx.query.version !== undefined ? requireVersion(ctx.query.version) : null,
    );
    await bumpDataVersion(q, p.wsId);
    await audit(q, auditCtx(ctx), {
      action: 'allocation.delete',
      orgId: access.orgId,
      workspaceId: p.wsId,
      targetType: 'allocation',
      targetId: p.id,
      before,
    });
  });
  return noContent();
}

export async function allocationBatch(ctx: Ctx, p: Params): Promise<AllocationBatchResponse> {
  const access = await requireWorkspace(ctx, p.wsId, 'allocations.write');
  const body = (ctx.body ?? {}) as { ops?: unknown; label?: unknown };
  if (!Array.isArray(body.ops)) throw badRequest('ops must be an array', { ops: 'Required' });
  if (body.ops.length > 500) throw payloadTooLarge('A batch can hold at most 500 changes.');
  const actor = requireActor(ctx);
  return withTx(async (q) => {
    const touched: string[] = [];
    const deleted: string[] = [];
    for (const [i, op] of (body.ops as AllocationOp[]).entries()) {
      try {
        if (op?.op === 'create') touched.push(await createAllocationRow(q, access, op.allocation, actor.userId));
        else if (op?.op === 'update') {
          touched.push(
            (await updateAllocationRow(q, access, String(op.id), requireVersion(op.version), op.patch, actor.userId))
              .after.id,
          );
        } else if (op?.op === 'delete') {
          await deleteAllocationRow(q, access, String(op.id), requireVersion(op.version));
          deleted.push(String(op.id));
        } else throw badRequest('Unknown op', { op: 'Use create, update or delete' });
      } catch (e) {
        withOpIndex(e, i);
      }
    }
    const dataVersion = await bumpDataVersion(q, p.wsId);
    const live = [...new Set(touched)].filter((id) => !deleted.includes(id));
    const upserted = live.length ? await loadAllocations(q, p.wsId, live) : [];
    await audit(q, auditCtx(ctx), {
      action: 'allocation.batch',
      orgId: access.orgId,
      workspaceId: p.wsId,
      targetType: 'allocation',
      after: {
        label: typeof body.label === 'string' ? body.label.slice(0, 200) : null,
        upserted: upserted.length,
        deleted: deleted.length,
      },
    });
    return { upserted, deleted, dataVersion };
  });
}

// ── Respond / propose (DM-03, PPL-05) ──────────────────────────────────────

export async function respondAllocation(ctx: Ctx, p: Params) {
  const access = await requireWorkspace(ctx, p.wsId, ['allocations.write', 'allocations.respond.own']);
  const actor = requireActor(ctx);
  return withTx(async (q) => {
    const before = await loadAllocation(q, p.wsId, p.id);
    if (!before) throw notFound('This booking no longer exists.');
    // Ownership before body validation, so a non-owner always gets 403 (PL-12).
    if (!has(access, 'allocations.write') && !(await isOwnPerson(q, p.wsId, before.resourceId, actor.userId))) {
      throw forbidden('You can only respond to bookings proposed to you.');
    }
    const body = parseWith(
      z.object({ decision: z.enum(['accept', 'decline']), reason: z.string().max(1000).optional() }),
      ctx.body,
    );
    if (before.state !== 'tentative') throw conflict('This booking was already answered.');
    const accept = body.decision === 'accept';
    await q.query(
      `UPDATE allocations SET state = $3, responded_at = now(),
         notes = CASE WHEN $4::text IS NULL THEN notes ELSE trim(coalesce(notes, '') || E'\\n' || $4::text) END,
         time_to_staff_days = CASE WHEN $3 = 'confirmed' THEN round((extract(epoch FROM now() - coalesce(
           (SELECT dl.created_at FROM demand_lines dl WHERE dl.id = allocations.demand_line_id), proposed_at, now())) / 86400)::numeric, 2)
           ELSE time_to_staff_days END,
         version = version + 1, updated_at = now(), updated_by = $5
       WHERE id = $1 AND workspace_id = $2`,
      [
        p.id,
        p.wsId,
        accept ? 'confirmed' : 'declined',
        accept || !body.reason ? null : `Declined: ${body.reason}`,
        actor.userId,
      ],
    );
    await bumpDataVersion(q, p.wsId);
    const after = await loadAllocation(q, p.wsId, p.id);
    await audit(q, auditCtx(ctx), {
      action: accept ? 'allocation.accept' : 'allocation.decline',
      orgId: access.orgId,
      workspaceId: p.wsId,
      targetType: 'allocation',
      targetId: p.id,
      before,
      after,
    });
    return after;
  });
}

const proposeSchema = z.object({
  demandLineId: z.string().nullable(),
  projectId: z.string().min(1),
  resourceId: z.string().min(1),
  craftId: z.string().min(1),
  quarterKey: z.string().regex(QUARTER_KEY_RE, 'Use YYYY-Qn'),
  percentage: z.number().gt(0, 'Enter 1–200').max(200, 'Enter 1–200'),
  startDate: isoDate,
  endDate: isoDate,
});

export async function propose(ctx: Ctx, p: Params) {
  const access = await requireWorkspace(ctx, p.wsId, 'allocations.propose');
  const body = parseWith(proposeSchema, ctx.body);
  const actor = requireActor(ctx);
  const { from, to } = quarterRange(body.quarterKey);
  if (body.endDate < body.startDate)
    throw badRequest('End date must be on or after the start date', { endDate: 'Before start date' });
  if (body.startDate > to || body.endDate < from)
    throw badRequest('Dates must overlap the quarter', { startDate: 'Outside the quarter' });
  const created = await withTx(async (q) => {
    if (body.demandLineId) {
      const line = await loadDemandLine(q, p.wsId, body.demandLineId);
      if (!line) throw badRequest('Unknown demand line', { demandLineId: 'Not in this workspace' });
      if (line.projectId !== body.projectId || line.quarterKey !== body.quarterKey) {
        throw badRequest('The demand line is for another project or quarter', { demandLineId: 'Does not match' });
      }
      const dup = await one(
        q,
        `SELECT 1 AS x FROM allocations WHERE workspace_id = $1 AND resource_id = $2 AND demand_line_id = $3 AND state = 'tentative'`,
        [p.wsId, body.resourceId, body.demandLineId],
      );
      if (dup) throw conflict('This person is already proposed for this demand.');
    }
    const id = await createAllocationRow(
      q,
      access,
      {
        resourceId: body.resourceId,
        projectId: body.projectId,
        percentage: body.percentage,
        startDate: body.startDate,
        endDate: body.endDate,
        craftId: body.craftId,
        source: 'marketplace',
        state: 'tentative',
        demandLineId: body.demandLineId,
      },
      actor.userId,
    );
    await q.query(`UPDATE allocations SET proposed_at = now(), proposed_by = $2 WHERE id = $1`, [id, actor.userId]);
    await bumpDataVersion(q, p.wsId);
    const after = await loadAllocation(q, p.wsId, id);
    await audit(q, auditCtx(ctx), {
      action: 'marketplace.propose',
      orgId: access.orgId,
      workspaceId: p.wsId,
      targetType: 'allocation',
      targetId: id,
      after,
    });
    return after as AllocationDTO;
  });
  // DM-03#AC3: tell the person (linked user) and the project owner, when email is configured.
  const info = await one<{ person: string; project: string; person_email: string | null; owner_email: string | null }>(
    ctx.db,
    `SELECT r.name AS person, pr.name AS project, lu.email AS person_email, ou.email AS owner_email
     FROM resources r JOIN projects pr ON pr.id = $3 AND pr.workspace_id = $1
     LEFT JOIN users lu ON lu.id = r.linked_user_id LEFT JOIN users ou ON ou.id = pr.owner_user_id
     WHERE r.workspace_id = $1 AND r.id = $2`,
    [p.wsId, body.resourceId, body.projectId],
  );
  if (info) {
    const base = `${appBaseUrl()}/o/${String(access.org.slug ?? '')}/w/${p.wsId}`;
    for (const [to, path] of [
      [info.person_email, '/me'],
      [info.owner_email, `/org/projects?project=${encodeURIComponent(body.projectId)}`],
    ] as const) {
      if (to) await sendEmail(proposalEmail(to, info.person, info.project, `${base}${path}`));
    }
  }
  return reply(201, created);
}

// ── Offers (DM-05, PPL-05#AC5) ─────────────────────────────────────────────

async function loadOffer(
  q: Queryable,
  wsId: string,
  personId: string,
  quarterKey: string,
): Promise<MarketplaceOfferDTO | null> {
  const r = await one(
    q,
    `SELECT ${OFFER_COLUMNS} FROM marketplace_offers o LEFT JOIN users cb ON cb.id = o.created_by
     WHERE o.workspace_id = $1 AND o.person_id = $2 AND o.quarter_key = $3`,
    [wsId, personId, quarterKey],
  );
  return r ? offerDTO(r) : null;
}

async function offerAccess(ctx: Ctx, p: Params) {
  const access = await requireWorkspace(ctx, p.wsId, ['offers.write', 'offers.write.own']);
  if (!has(access, 'offers.write') && !(await isOwnPerson(ctx.db, p.wsId, p.personId, requireActor(ctx).userId))) {
    throw forbidden('You can only offer your own capacity.');
  }
  if (!QUARTER_KEY_RE.test(p.quarterKey)) throw badRequest('Use YYYY-Qn', { quarterKey: 'Use YYYY-Qn' });
  return access;
}

export async function putOffer(ctx: Ctx, p: Params) {
  const access = await offerAccess(ctx, p);
  const body = parseWith(
    z.object({
      pct: z.number().gt(0).max(200),
      craftIds: z.array(z.string()).max(20).default([]),
      note: z.string().max(1000).nullable().default(null),
    }),
    ctx.body,
  );
  const actor = requireActor(ctx);
  return withTx(async (q) => {
    if (!(await one(q, `SELECT 1 AS x FROM resources WHERE workspace_id = $1 AND id = $2`, [p.wsId, p.personId]))) {
      throw notFound('This person no longer exists.');
    }
    for (const [i, c] of body.craftIds.entries()) await assertCraft(q, access.orgId, c, `craftIds.${i}`, true);
    await q.query(
      `INSERT INTO marketplace_offers (workspace_id, person_id, quarter_key, pct, craft_ids, note, created_by)
       VALUES ($1, $2, $3, $4, $5::text[], $6, $7)
       ON CONFLICT (workspace_id, person_id, quarter_key) DO UPDATE SET pct = EXCLUDED.pct, craft_ids = EXCLUDED.craft_ids,
         note = EXCLUDED.note, created_by = EXCLUDED.created_by, created_at = now()`,
      [p.wsId, p.personId, p.quarterKey, Math.round(body.pct), body.craftIds, body.note, actor.userId],
    );
    await bumpDataVersion(q, p.wsId);
    const after = await loadOffer(q, p.wsId, p.personId, p.quarterKey);
    await audit(q, auditCtx(ctx), {
      action: 'offer.upsert',
      orgId: access.orgId,
      workspaceId: p.wsId,
      targetType: 'person',
      targetId: p.personId,
      after,
    });
    return after;
  });
}

export async function deleteOffer(ctx: Ctx, p: Params) {
  const access = await offerAccess(ctx, p);
  await withTx(async (q) => {
    const before = await loadOffer(q, p.wsId, p.personId, p.quarterKey);
    if (!before) throw notFound('No offer for this quarter.');
    await q.query(`DELETE FROM marketplace_offers WHERE workspace_id = $1 AND person_id = $2 AND quarter_key = $3`, [
      p.wsId,
      p.personId,
      p.quarterKey,
    ]);
    await bumpDataVersion(q, p.wsId);
    await audit(q, auditCtx(ctx), {
      action: 'offer.delete',
      orgId: access.orgId,
      workspaceId: p.wsId,
      targetType: 'person',
      targetId: p.personId,
      before,
    });
  });
  return noContent();
}
