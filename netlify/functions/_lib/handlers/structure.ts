/**
 * Org structure and craft catalogue (ORG-02): GET|POST /orgs/:orgId/{tribes,chapters,teams,crafts},
 * PATCH|DELETE /orgs/:orgId/{kind}/:id. Reads need org.view; writes need structure.write
 * (WORKSPACE_ADMIN in any workspace of the org, or ORG_ADMIN).
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Ctx } from '../api';
import { auditCtx, noContent, parseWith, reply, requireActor } from '../api';
import { audit } from '../audit';
import { requireOrg } from '../authz';
import type { Queryable } from '../db';
import { one, withTx } from '../db';
import { chapterDTO, craftDTO, teamDTO, tribeDTO } from '../dto';
import { badRequest, conflict, notFound } from '../errors';
import { buildSet, requireVersion, slugify, staleOrMissing } from '../entity';
import type { Params } from '../router';

type Kind = 'tribes' | 'chapters' | 'teams' | 'crafts';
type R = Record<string, unknown>;

interface KindConfig {
  table: string;
  label: string;
  /** DTO field -> column. */
  cols: Record<string, string>;
  dto: (r: R) => unknown;
  order: string;
  create: z.ZodType<Record<string, unknown>>;
  patch: z.ZodType<Record<string, unknown>>;
  /** Count of references (to block DELETE). $1 = org id, $2 = entity id. */
  refs: string[];
}

const name = z.string().trim().min(1, 'Enter a name').max(120);
const SHORT_RE = /^[A-Z0-9]{2,4}$/;
const SHORT_MESSAGE = 'Use 2–4 uppercase letters or digits.';

const ORG_WS = `(SELECT id FROM workspaces WHERE org_id = $1)`;

export const KINDS: Record<Kind, KindConfig> = {
  tribes: {
    table: 'tribes',
    label: 'tribe',
    cols: { name: 'name', leadName: 'lead_name', archived: 'archived' },
    dto: tribeDTO,
    order: 'lower(x.name)',
    create: z.object({ name, leadName: z.string().trim().max(120).nullable().optional() }),
    patch: z.object({
      name: name.optional(),
      leadName: z.string().trim().max(120).nullable().optional(),
      archived: z.boolean().optional(),
    }),
    refs: [
      `SELECT count(*)::int AS n FROM projects WHERE tribe_id = $2 AND workspace_id IN ${ORG_WS}`,
      `SELECT count(*)::int AS n FROM resources WHERE (home_tribe_id = $2 OR $2 = ANY(coalesce(tribe_affinity_ids, '{}'))) AND workspace_id IN ${ORG_WS}`,
    ],
  },
  chapters: {
    table: 'chapters',
    label: 'chapter',
    cols: { name: 'name', craftId: 'craft_id', leadPersonId: 'lead_person_id', archived: 'archived' },
    dto: chapterDTO,
    order: 'lower(x.name)',
    create: z.object({
      name,
      craftId: z.string().nullable().optional(),
      leadPersonId: z.string().nullable().optional(),
    }),
    patch: z.object({
      name: name.optional(),
      craftId: z.string().nullable().optional(),
      leadPersonId: z.string().nullable().optional(),
      archived: z.boolean().optional(),
    }),
    refs: [`SELECT count(*)::int AS n FROM resources WHERE chapter_id = $2 AND workspace_id IN ${ORG_WS}`],
  },
  teams: {
    table: 'org_teams',
    label: 'team',
    cols: { name: 'name', archived: 'archived' },
    dto: teamDTO,
    order: 'lower(x.name)',
    create: z.object({ name }),
    patch: z.object({ name: name.optional(), archived: z.boolean().optional() }),
    refs: [`SELECT count(*)::int AS n FROM resources WHERE team_id = $2 AND workspace_id IN ${ORG_WS}`],
  },
  crafts: {
    table: 'crafts',
    label: 'craft',
    cols: {
      name: 'name',
      short: 'short',
      description: 'description',
      family: 'family',
      archived: 'archived',
      sortOrder: 'sort_order',
    },
    dto: craftDTO,
    order: 'x.sort_order, lower(x.name)',
    create: z.object({
      id: z
        .string()
        .regex(/^[a-z0-9][a-z0-9-]{1,39}$/, 'Use lowercase letters, digits and hyphens')
        .optional(),
      name,
      short: z.string().trim(),
      description: z.string().trim().max(500).nullable().optional(),
      family: z.string().trim().max(120).nullable().optional(),
      sortOrder: z.number().int().optional(),
    }),
    patch: z.object({
      name: name.optional(),
      short: z.string().trim().optional(),
      description: z.string().trim().max(500).nullable().optional(),
      family: z.string().trim().max(120).nullable().optional(),
      archived: z.boolean().optional(),
      sortOrder: z.number().int().optional(),
    }),
    refs: [
      `SELECT count(*)::int AS n FROM allocations WHERE craft_id = $2 AND workspace_id IN ${ORG_WS}`,
      `SELECT count(*)::int AS n FROM demand_lines WHERE craft_id = $2 AND org_id = $1`,
      `SELECT count(*)::int AS n FROM resources WHERE workspace_id IN ${ORG_WS} AND (craft_profile ->> 'primaryCraft' = $2
         OR coalesce(craft_profile -> 'secondaryCrafts', '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('craftId', $2::text)))`,
      `SELECT count(*)::int AS n FROM chapters WHERE craft_id = $2 AND org_id = $1`,
    ],
  },
};

function kindOf(p: Params): KindConfig {
  const k = KINDS[p.kind as Kind];
  if (!k) throw notFound('Not found');
  return k;
}

async function loadOne(q: Queryable, k: KindConfig, orgId: string, id: string) {
  const r = await one(
    q,
    `SELECT x.*, ub.name AS updated_by_name FROM ${k.table} x LEFT JOIN users ub ON ub.id = x.updated_by
     WHERE x.org_id = $1 AND x.id = $2`,
    [orgId, id],
  );
  return r ? (k.dto(r) as { version: number; updatedAt: string; updatedBy: null }) : null;
}

async function assertUnique(
  q: Queryable,
  k: KindConfig,
  orgId: string,
  id: string | null,
  data: Record<string, unknown>,
) {
  if (typeof data.name === 'string') {
    const dup = await one(
      q,
      `SELECT 1 AS x FROM ${k.table} WHERE org_id = $1 AND lower(name) = lower($2) AND id <> coalesce($3, '')`,
      [orgId, data.name, id],
    );
    if (dup) throw conflict('Already exists', { fields: { name: 'Already exists' } });
  }
  if (k.table === 'crafts' && typeof data.short === 'string') {
    if (!SHORT_RE.test(data.short)) throw badRequest(SHORT_MESSAGE, { short: SHORT_MESSAGE });
    const dup = await one(
      q,
      `SELECT 1 AS x FROM crafts WHERE org_id = $1 AND upper(short) = upper($2) AND id <> coalesce($3, '')`,
      [orgId, data.short, id],
    );
    if (dup) throw badRequest('Short code already used by another craft.', { short: 'Already used' });
  }
}

async function validateRefs(q: Queryable, orgId: string, data: Record<string, unknown>) {
  if (typeof data.craftId === 'string') {
    if (!(await one(q, `SELECT 1 AS x FROM crafts WHERE org_id = $1 AND id = $2`, [orgId, data.craftId]))) {
      throw badRequest('Unknown craft', { craftId: 'Unknown craft' });
    }
  }
  if (typeof data.leadPersonId === 'string') {
    if (
      !(await one(q, `SELECT 1 AS x FROM resources WHERE id = $2 AND workspace_id IN ${ORG_WS}`, [
        orgId,
        data.leadPersonId,
      ]))
    ) {
      throw badRequest('Unknown person', { leadPersonId: 'Unknown person' });
    }
  }
}

export async function listStructure(ctx: Ctx, p: Params) {
  const k = kindOf(p);
  await requireOrg(ctx, p.orgId, 'org.view');
  const rows = await ctx.db.query(
    `SELECT x.*, ub.name AS updated_by_name FROM ${k.table} x LEFT JOIN users ub ON ub.id = x.updated_by
     WHERE x.org_id = $1 ORDER BY ${k.order}`,
    [p.orgId],
  );
  return rows.map(k.dto);
}

export async function createStructure(ctx: Ctx, p: Params) {
  const k = kindOf(p);
  await requireOrg(ctx, p.orgId, 'structure.write');
  const data = parseWith(k.create, ctx.body);
  const actor = requireActor(ctx);
  const created = await withTx(async (q) => {
    await assertUnique(q, k, p.orgId, null, data);
    await validateRefs(q, p.orgId, data);
    let id: string = randomUUID();
    if (k.table === 'crafts') {
      const base = (data.id as string | undefined) ?? slugify(String(data.name));
      id = base;
      for (let i = 2; await one(q, `SELECT 1 AS x FROM crafts WHERE org_id = $1 AND id = $2`, [p.orgId, id]); i++) {
        if (data.id) throw conflict('Already exists', { fields: { id: 'Already exists' } });
        id = `${base}-${i}`;
      }
      if (data.sortOrder === undefined) {
        const max = await one<{ m: number }>(
          q,
          `SELECT coalesce(max(sort_order), 0)::int AS m FROM crafts WHERE org_id = $1`,
          [p.orgId],
        );
        data.sortOrder = Number(max?.m ?? 0) + 1;
      }
    }
    const cols = ['org_id', 'id', 'updated_by'];
    const params: unknown[] = [p.orgId, id, actor.userId];
    for (const [field, col] of Object.entries(k.cols)) {
      if (data[field] !== undefined) {
        cols.push(col);
        params.push(data[field]);
      }
    }
    await q.query(
      `INSERT INTO ${k.table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
      params,
    );
    const dto = await loadOne(q, k, p.orgId, id);
    await audit(q, auditCtx(ctx), {
      action: `${k.label}.create`,
      orgId: p.orgId,
      targetType: k.label,
      targetId: id,
      after: dto,
    });
    return dto;
  });
  return reply(201, created);
}

export async function patchStructure(ctx: Ctx, p: Params) {
  const k = kindOf(p);
  await requireOrg(ctx, p.orgId, 'structure.write');
  const body = (ctx.body ?? {}) as { version?: unknown; patch?: unknown };
  const version = requireVersion(body.version);
  const data = parseWith(k.patch, body.patch ?? {});
  const actor = requireActor(ctx);
  return withTx(async (q) => {
    const before = await loadOne(q, k, p.orgId, p.id);
    if (!before) throw notFound(`This ${k.label} no longer exists.`);
    const changingShort = typeof data.short === 'string' && data.short !== (before as unknown as R).short;
    await assertUnique(q, k, p.orgId, p.id, { ...data, short: changingShort ? data.short : undefined });
    await validateRefs(q, p.orgId, data);
    const values: Record<string, unknown> = {};
    for (const [field, col] of Object.entries(k.cols)) if (data[field] !== undefined) values[col] = data[field];
    const set = buildSet(values, 5);
    const rows = await q.query(
      // QA-014: saving an imported craft (any field) is the admin's review of it.
      `UPDATE ${k.table} SET ${set.sql ? `${set.sql}, ` : ''}${k.table === 'crafts' ? 'needs_review = false, ' : ''}version = version + 1, updated_at = now(), updated_by = $4
       WHERE org_id = $1 AND id = $2 AND version = $3 RETURNING id`,
      [p.orgId, p.id, version, actor.userId, ...set.params],
    );
    if (!rows.length) await staleOrMissing(() => loadOne(q, k, p.orgId, p.id), k.label);
    const after = await loadOne(q, k, p.orgId, p.id);
    await audit(q, auditCtx(ctx), {
      action: `${k.label}.update`,
      orgId: p.orgId,
      targetType: k.label,
      targetId: p.id,
      before,
      after,
    });
    return after;
  });
}

export async function deleteStructure(ctx: Ctx, p: Params) {
  const k = kindOf(p);
  await requireOrg(ctx, p.orgId, 'structure.write');
  await withTx(async (q) => {
    const before = await loadOne(q, k, p.orgId, p.id);
    if (!before) throw notFound(`This ${k.label} no longer exists.`);
    if (ctx.query.version !== undefined && Number(ctx.query.version) !== before.version) {
      await staleOrMissing(async () => before, k.label);
    }
    let n = 0;
    for (const sql of k.refs) n += Number((await q.query<{ n: number }>(sql, [p.orgId, p.id]))[0]?.n ?? 0);
    if (n > 0) throw conflict(`In use by ${n} records. Archive it instead.`);
    await q.query(`DELETE FROM ${k.table} WHERE org_id = $1 AND id = $2`, [p.orgId, p.id]);
    if (k.table === 'tribes') await q.query(`DELETE FROM tribe_calibrations WHERE tribe_id = $1`, [p.id]);
    await audit(q, auditCtx(ctx), {
      action: `${k.label}.delete`,
      orgId: p.orgId,
      targetType: k.label,
      targetId: p.id,
      before,
    });
  });
  return noContent();
}
