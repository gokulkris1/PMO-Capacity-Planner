/**
 * Projects and demand lines (PL-04, PPL-07, DM-01, AL-05).
 * POST /projects · PATCH|DELETE /projects/:id · POST /demand · PATCH|DELETE /demand/:id · POST /demand/batch
 * Dual-writes for v1.1: projects.client_name (tribe name) and projects.craft_demand (from demand_lines).
 */
import { z } from 'zod';
import type { DemandOp } from '../../../../shared/contracts/api';
import type { DemandLineDTO, ProjectDTO } from '../../../../shared/contracts/dto';
import { QUARTER_KEY_RE } from '../../../../shared/contracts/dto';
import type { Ctx } from '../api';
import { auditCtx, noContent, parseWith, reply, requireActor } from '../api';
import { audit } from '../audit';
import type { WorkspaceAccess } from '../authz';
import { assertWithinLimit, requireWorkspace } from '../authz';
import type { Queryable } from '../db';
import { one, withTx } from '../db';
import { planningOf } from '../dto';
import { HttpError, badRequest, conflict, notFound, payloadTooLarge } from '../errors';
import { ISO_DATE_RE, bumpDataVersion, newId, requireVersion, staleOrMissing } from '../entity';
import {
  assertCraft,
  assertOrgRow,
  assertOrgUser,
  loadDemand,
  loadDemandLine,
  loadProject,
  syncProjectCraftDemand,
} from '../loaders';
import type { Params } from '../router';

const isoDate = z.string().regex(ISO_DATE_RE, 'Use YYYY-MM-DD');
const projectFields = {
  name: z.string().trim().min(1, 'Enter a name').max(200),
  status: z.enum(['Active', 'On Hold', 'Planning', 'Completed']),
  priority: z.enum(['Critical', 'High', 'Medium', 'Low']),
  description: z.string().max(5000),
  startDate: isoDate.nullable(),
  endDate: isoDate.nullable(),
  budget: z.number().min(0).nullable(),
  tribeId: z.string().nullable(),
  stage: z.enum(['Pipeline', 'Initiated', 'Mobilising', 'In Flight', 'Closing']).nullable(),
  initiatedOn: isoDate.nullable(),
  ownerUserId: z.string().uuid().nullable(),
  jiraKey: z.string().trim().max(40).nullable(),
  planviewId: z.string().trim().max(200).nullable(),
};
const projectPatchSchema = z.object(projectFields).partial();
const newProjectSchema = projectPatchSchema.extend({ name: projectFields.name, id: z.string().optional() });

type ProjectData = Omit<ProjectDTO, 'id' | 'version' | 'updatedAt' | 'updatedBy'>;
const DEFAULT_PROJECT: Omit<ProjectData, 'name'> = {
  status: 'Active',
  priority: 'Medium',
  description: '',
  startDate: null,
  endDate: null,
  budget: null,
  tribeId: null,
  stage: null,
  initiatedOn: null,
  ownerUserId: null,
  jiraKey: null,
  planviewId: null,
  source: 'manual',
};

function dataOf(p: ProjectDTO): ProjectData {
  const { id: _i, version: _v, updatedAt: _u, updatedBy: _b, ...rest } = p;
  return rest;
}

export const CHOOSE_TRIBE = 'Choose a tribe';
export const PLANVIEW_LOCKED = 'Locked: sourced from Planview';

async function validateProject(q: Queryable, orgId: string, d: ProjectData) {
  if (!d.tribeId && d.source !== 'planview') throw badRequest(CHOOSE_TRIBE, { tribeId: CHOOSE_TRIBE });
  if (d.tribeId) await assertOrgRow(q, 'tribes', orgId, d.tribeId, 'tribeId');
  if (d.startDate && d.endDate && d.endDate < d.startDate) {
    throw badRequest('End date must be on or after the start date', {
      endDate: 'End date must be on or after the start date',
    });
  }
  if (d.ownerUserId) await assertOrgUser(q, orgId, d.ownerUserId, 'ownerUserId');
}

async function projectValues(q: Queryable, orgId: string, d: ProjectData) {
  const tribe = d.tribeId
    ? await one<{ name: string }>(q, `SELECT name FROM tribes WHERE org_id = $1 AND id = $2`, [orgId, d.tribeId])
    : null;
  return [
    d.name,
    d.status,
    d.priority,
    d.description,
    d.startDate,
    d.endDate,
    d.budget,
    d.tribeId,
    tribe?.name ?? null,
    d.stage,
    d.initiatedOn,
    d.ownerUserId,
    d.jiraKey,
    d.planviewId,
    d.source,
  ];
}

export async function insertProject(q: Queryable, access: WorkspaceAccess, id: string, d: ProjectData, userId: string) {
  await q.query(
    `INSERT INTO projects (id, workspace_id, updated_by, name, status, priority, description, start_date, end_date, budget, tribe_id,
       client_name, stage, initiated_on, owner_user_id, jira_key, planview_id, source, craft_demand)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, '[]'::jsonb)`,
    [id, access.workspaceId, userId, ...(await projectValues(q, access.orgId, d))],
  );
}

export async function updateProjectRow(
  q: Queryable,
  access: WorkspaceAccess,
  id: string,
  version: number,
  d: ProjectData,
  userId: string,
) {
  const rows = await q.query(
    `UPDATE projects SET name = $4, status = $5, priority = $6, description = $7, start_date = $8, end_date = $9, budget = $10,
       tribe_id = $11, client_name = $12, stage = $13, initiated_on = $14, owner_user_id = $15, jira_key = $16, planview_id = $17,
       source = $18, version = version + 1, updated_at = now(), updated_by = $19
     WHERE id = $1 AND workspace_id = $2 AND version = $3 RETURNING id`,
    [id, access.workspaceId, version, ...(await projectValues(q, access.orgId, d)), userId],
  );
  return rows.length > 0;
}

export function planviewLocked(access: WorkspaceAccess): boolean {
  return planningOf(access.org.planning).planviewOwnership !== 'overridable';
}

export async function createProject(ctx: Ctx, p: Params) {
  const access = await requireWorkspace(ctx, p.wsId, 'projects.write');
  const body = parseWith(newProjectSchema, ctx.body);
  const id = newId(body.id);
  const { id: _ignored, ...rest } = body;
  const d: ProjectData = { ...DEFAULT_PROJECT, ...rest, source: 'manual' } as ProjectData;
  const actor = requireActor(ctx);
  const created = await withTx(async (q) => {
    const n = await q.query<{ n: number }>(`SELECT count(*)::int AS n FROM projects WHERE workspace_id = $1`, [p.wsId]);
    assertWithinLimit(access.org, 'maxProjects', Number(n[0].n) + 1);
    if (await one(q, `SELECT 1 AS x FROM projects WHERE id = $1`, [id]))
      throw conflict('A project with this id already exists.');
    await validateProject(q, access.orgId, d);
    await insertProject(q, access, id, d, actor.userId);
    await bumpDataVersion(q, p.wsId);
    const after = await loadProject(q, p.wsId, id);
    await audit(q, auditCtx(ctx), {
      action: 'project.create',
      orgId: access.orgId,
      workspaceId: p.wsId,
      targetType: 'project',
      targetId: id,
      after,
    });
    return after;
  });
  return reply(201, created);
}

export async function patchProject(ctx: Ctx, p: Params) {
  const access = await requireWorkspace(ctx, p.wsId, 'projects.write');
  const body = (ctx.body ?? {}) as { version?: unknown; patch?: unknown };
  const version = requireVersion(body.version);
  const patch = parseWith(projectPatchSchema, body.patch ?? {});
  const actor = requireActor(ctx);
  return withTx(async (q) => {
    const before = await loadProject(q, p.wsId, p.id);
    if (!before) throw notFound('This project no longer exists.');
    if (before.source === 'planview' && planviewLocked(access)) {
      const datesChanged =
        (patch.startDate !== undefined && patch.startDate !== before.startDate) ||
        (patch.endDate !== undefined && patch.endDate !== before.endDate);
      if (datesChanged) throw conflict(PLANVIEW_LOCKED);
    }
    const d: ProjectData = { ...dataOf(before), ...patch } as ProjectData;
    await validateProject(q, access.orgId, d);
    if (!(await updateProjectRow(q, access, p.id, version, d, actor.userId))) {
      await staleOrMissing(() => loadProject(q, p.wsId, p.id), 'project');
    }
    await bumpDataVersion(q, p.wsId);
    const after = await loadProject(q, p.wsId, p.id);
    await audit(q, auditCtx(ctx), {
      action: 'project.update',
      orgId: access.orgId,
      workspaceId: p.wsId,
      targetType: 'project',
      targetId: p.id,
      before,
      after,
    });
    return after;
  });
}

export async function deleteProject(ctx: Ctx, p: Params) {
  const access = await requireWorkspace(ctx, p.wsId, 'projects.write');
  await withTx(async (q) => {
    const before = await loadProject(q, p.wsId, p.id);
    if (!before) throw notFound('This project no longer exists.');
    if (ctx.query.version !== undefined && requireVersion(ctx.query.version) !== before.version) {
      await staleOrMissing(async () => before, 'project');
    }
    await q.query(`DELETE FROM allocations WHERE workspace_id = $1 AND project_id = $2`, [p.wsId, p.id]);
    await q.query(`DELETE FROM demand_lines WHERE workspace_id = $1 AND project_id = $2`, [p.wsId, p.id]);
    await q.query(`UPDATE integration_mappings SET project_id = NULL WHERE workspace_id = $1 AND project_id = $2`, [
      p.wsId,
      p.id,
    ]);
    await q.query(`DELETE FROM projects WHERE workspace_id = $1 AND id = $2`, [p.wsId, p.id]);
    await bumpDataVersion(q, p.wsId);
    await audit(q, auditCtx(ctx), {
      action: 'project.delete',
      orgId: access.orgId,
      workspaceId: p.wsId,
      targetType: 'project',
      targetId: p.id,
      before,
    });
  });
  return noContent();
}

// ── Demand lines ───────────────────────────────────────────────────────────

const demandFields = {
  projectId: z.string().min(1),
  quarterKey: z.string().regex(QUARTER_KEY_RE, 'Use YYYY-Qn'),
  craftId: z.string().min(1),
  fte: z.number().min(0, 'Use 0–50 FTE').max(50, 'Use 0–50 FTE'),
  status: z.enum(['Forecast', 'Confirmed']),
  ownerUserId: z.string().uuid().nullable(),
  note: z.string().max(1000).nullable(),
};
const newDemandSchema = z.object({
  ...demandFields,
  status: demandFields.status.default('Forecast'),
  ownerUserId: demandFields.ownerUserId.default(null),
  note: demandFields.note.default(null),
  id: z.string().optional(),
});
const demandPatchSchema = z.object(demandFields).partial();

type DemandData = Omit<DemandLineDTO, 'id' | 'version' | 'updatedAt' | 'updatedBy' | 'createdAt'>;

async function validateDemand(
  q: Queryable,
  access: WorkspaceAccess,
  d: DemandData,
  craftChanged: boolean,
  prefix = '',
) {
  const project = await one(q, `SELECT 1 AS x FROM projects WHERE workspace_id = $1 AND id = $2`, [
    access.workspaceId,
    d.projectId,
  ]);
  if (!project) throw badRequest('Not in this workspace', { [`${prefix}projectId`]: 'Not in this workspace' });
  await assertCraft(q, access.orgId, d.craftId, `${prefix}craftId`, !craftChanged);
  if (d.ownerUserId) await assertOrgUser(q, access.orgId, d.ownerUserId, `${prefix}ownerUserId`);
}

async function duplicateCheck(q: Queryable, d: DemandData, id: string, prefix = '') {
  const dup = await one(
    q,
    `SELECT id FROM demand_lines WHERE project_id = $1 AND quarter_key = $2 AND craft_id = $3 AND id <> $4`,
    [d.projectId, d.quarterKey, d.craftId, id],
  );
  if (dup)
    throw conflict('This project already has demand for that craft and quarter.', {
      fields: { [`${prefix}craftId`]: 'Already exists' },
    });
}

async function createDemandLine(
  q: Queryable,
  access: WorkspaceAccess,
  raw: unknown,
  userId: string,
  prefix = '',
): Promise<DemandLineDTO> {
  const body = parseWith(newDemandSchema, raw);
  const id = newId(body.id);
  const { id: _i, ...d } = body;
  await validateDemand(q, access, d, true, prefix);
  await duplicateCheck(q, d, id, prefix);
  await q.query(
    `INSERT INTO demand_lines (id, org_id, workspace_id, project_id, quarter_key, craft_id, fte, status, owner_user_id, note, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      id,
      access.orgId,
      access.workspaceId,
      d.projectId,
      d.quarterKey,
      d.craftId,
      d.fte,
      d.status,
      d.ownerUserId,
      d.note,
      userId,
    ],
  );
  await syncProjectCraftDemand(q, d.projectId);
  return (await loadDemandLine(q, access.workspaceId, id)) as DemandLineDTO;
}

async function updateDemandLine(
  q: Queryable,
  access: WorkspaceAccess,
  id: string,
  version: number,
  raw: unknown,
  userId: string,
  prefix = '',
) {
  const patch = parseWith(demandPatchSchema, raw ?? {});
  const before = await loadDemandLine(q, access.workspaceId, id);
  if (!before) throw notFound('This demand line no longer exists.');
  const d: DemandData = { ...before, ...patch };
  await validateDemand(q, access, d, patch.craftId !== undefined && patch.craftId !== before.craftId, prefix);
  await duplicateCheck(q, d, id, prefix);
  const rows = await q.query(
    `UPDATE demand_lines SET project_id = $4, quarter_key = $5, craft_id = $6, fte = $7, status = $8, owner_user_id = $9, note = $10,
       version = version + 1, updated_at = now(), updated_by = $11
     WHERE id = $1 AND workspace_id = $2 AND version = $3 RETURNING id`,
    [
      id,
      access.workspaceId,
      version,
      d.projectId,
      d.quarterKey,
      d.craftId,
      d.fte,
      d.status,
      d.ownerUserId,
      d.note,
      userId,
    ],
  );
  if (!rows.length) await staleOrMissing(() => loadDemandLine(q, access.workspaceId, id), 'demand line');
  await syncProjectCraftDemand(q, d.projectId);
  if (d.projectId !== before.projectId) await syncProjectCraftDemand(q, before.projectId);
  return { before, after: (await loadDemandLine(q, access.workspaceId, id)) as DemandLineDTO };
}

async function deleteDemandLine(q: Queryable, access: WorkspaceAccess, id: string, version: number | null) {
  const before = await loadDemandLine(q, access.workspaceId, id);
  if (!before) throw notFound('This demand line no longer exists.');
  if (version !== null && version !== before.version) await staleOrMissing(async () => before, 'demand line');
  await q.query(`UPDATE allocations SET demand_line_id = NULL WHERE workspace_id = $1 AND demand_line_id = $2`, [
    access.workspaceId,
    id,
  ]);
  await q.query(`DELETE FROM demand_lines WHERE workspace_id = $1 AND id = $2`, [access.workspaceId, id]);
  await syncProjectCraftDemand(q, before.projectId);
  return before;
}

export async function createDemand(ctx: Ctx, p: Params) {
  const access = await requireWorkspace(ctx, p.wsId, 'demand.write');
  const actor = requireActor(ctx);
  const line = await withTx(async (q) => {
    const created = await createDemandLine(q, access, ctx.body, actor.userId);
    await bumpDataVersion(q, p.wsId);
    await audit(q, auditCtx(ctx), {
      action: 'demand.create',
      orgId: access.orgId,
      workspaceId: p.wsId,
      targetType: 'demand_line',
      targetId: created.id,
      after: created,
    });
    return created;
  });
  return reply(201, line);
}

export async function patchDemand(ctx: Ctx, p: Params) {
  const access = await requireWorkspace(ctx, p.wsId, 'demand.write');
  const body = (ctx.body ?? {}) as { version?: unknown; patch?: unknown };
  const version = requireVersion(body.version);
  const actor = requireActor(ctx);
  return withTx(async (q) => {
    const { before, after } = await updateDemandLine(q, access, p.id, version, body.patch, actor.userId);
    await bumpDataVersion(q, p.wsId);
    await audit(q, auditCtx(ctx), {
      action: 'demand.update',
      orgId: access.orgId,
      workspaceId: p.wsId,
      targetType: 'demand_line',
      targetId: p.id,
      before,
      after,
    });
    return after;
  });
}

export async function deleteDemand(ctx: Ctx, p: Params) {
  const access = await requireWorkspace(ctx, p.wsId, 'demand.write');
  await withTx(async (q) => {
    const before = await deleteDemandLine(
      q,
      access,
      p.id,
      ctx.query.version !== undefined ? requireVersion(ctx.query.version) : null,
    );
    await bumpDataVersion(q, p.wsId);
    await audit(q, auditCtx(ctx), {
      action: 'demand.delete',
      orgId: access.orgId,
      workspaceId: p.wsId,
      targetType: 'demand_line',
      targetId: p.id,
      before,
    });
  });
  return noContent();
}

/** Re-throws an op failure with the failing op index in `fields` (PL-04#AC4). */
export function withOpIndex(e: unknown, i: number): never {
  if (e instanceof HttpError) {
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(e.extra.fields ?? { _: e.message }))
      fields[`ops.${i}${k === '_' ? '' : `.${k}`}`] = v;
    if (!Object.keys(fields).length) fields[`ops.${i}`] = e.message;
    throw new HttpError(e.status, e.code, e.message, {
      ...e.extra,
      fields,
      body: { ...(e.extra.body ?? {}), opIndex: i },
    });
  }
  throw e;
}

export async function demandBatch(ctx: Ctx, p: Params) {
  const access = await requireWorkspace(ctx, p.wsId, 'demand.write');
  const ops = (ctx.body as { ops?: unknown })?.ops;
  if (!Array.isArray(ops)) throw badRequest('ops must be an array', { ops: 'Required' });
  if (ops.length > 500) throw payloadTooLarge('A batch can hold at most 500 changes.');
  const actor = requireActor(ctx);
  return withTx(async (q) => {
    const upsertedIds: string[] = [];
    const deleted: string[] = [];
    for (const [i, op] of (ops as DemandOp[]).entries()) {
      try {
        if (op?.op === 'create') upsertedIds.push((await createDemandLine(q, access, op.line, actor.userId)).id);
        else if (op?.op === 'update') {
          upsertedIds.push(
            (await updateDemandLine(q, access, String(op.id), requireVersion(op.version), op.patch, actor.userId)).after
              .id,
          );
        } else if (op?.op === 'delete') {
          await deleteDemandLine(q, access, String(op.id), requireVersion(op.version));
          deleted.push(String(op.id));
        } else throw badRequest('Unknown op', { op: 'Use create, update or delete' });
      } catch (e) {
        withOpIndex(e, i);
      }
    }
    const dataVersion = await bumpDataVersion(q, p.wsId);
    const upserted = (await loadDemand(q, p.wsId, [...new Set(upsertedIds)])).filter((l) => !deleted.includes(l.id));
    await audit(q, auditCtx(ctx), {
      action: 'demand.batch',
      orgId: access.orgId,
      workspaceId: p.wsId,
      targetType: 'demand_line',
      after: {
        label: (ctx.body as { label?: unknown })?.label ?? null,
        upserted: upserted.length,
        deleted: deleted.length,
      },
    });
    return { upserted, deleted, dataVersion };
  });
}
