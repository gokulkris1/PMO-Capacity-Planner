/**
 * People (PL-04, PPL-03, PPL-04, PPL-06): POST /people · PATCH|DELETE /people/:id · POST /people/bulk ·
 * POST /people/import · POST /people/:id/craft-requests · GET /craft-requests · POST /craft-requests/:id/{approve,reject}
 * v1.1 columns stay in sync: craft_profile (primaryCraft, secondaryCrafts, tribeAffinity as names, targetUtil),
 * avatar_initials.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PeopleBulkRequest, PeopleImportResponse } from '../../../../shared/contracts/api';
import type { PersonDTO, SecondaryCraftDTO } from '../../../../shared/contracts/dto';
import type { Ctx } from '../api';
import { auditCtx, noContent, parseWith, reply, requireActor } from '../api';
import { audit } from '../audit';
import type { WorkspaceAccess } from '../authz';
import { assertEntitled, assertWithinLimit, has, requireWorkspace } from '../authz';
import type { Queryable } from '../db';
import { json, one, withTx } from '../db';
import { badRequest, conflict, forbidden, notFound, payloadTooLarge } from '../errors';
import { bumpDataVersion, newId, requireVersion, staleOrMissing } from '../entity';
import { assertCraft, assertOrgRow, assertOrgUser, loadCraftRequests, loadPeople, loadPerson } from '../loaders';
import type { Params } from '../router';

// Typed explicitly: zod's inference degrades when a file is also checked without strictNullChecks (tsconfig.json).
const secondary = z.object({
  craftId: z.string().min(1),
  proficiency: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  maxPct: z.number().min(0).max(100),
}) as unknown as z.ZodType<SecondaryCraftDTO>;

const personFields = {
  name: z.string().trim().min(1, 'Enter a name').max(120),
  email: z.string().trim().email('Enter a valid email address').max(200).nullable(),
  role: z.string().trim().max(120),
  type: z.enum(['Permanent', 'Contractor', 'Part-Time']),
  department: z.string().trim().max(120),
  location: z.string().trim().max(120).nullable(),
  totalCapacity: z.number().min(0).max(200),
  dailyRate: z.number().min(0).max(100000).nullable(),
  teamId: z.string().nullable(),
  chapterId: z.string().nullable(),
  homeTribeId: z.string().nullable(),
  linkedUserId: z.string().uuid().nullable(),
  primaryCraft: z.string().nullable(),
  secondaryCrafts: z.array(secondary).max(20),
  tribeAffinity: z.array(z.string()).max(50),
  skills: z.array(z.string().trim().min(1).max(60)).max(100),
  targetUtil: z.number().min(0).max(150),
};
const personPatchSchema = z.object(personFields).partial();
const newPersonSchema = personPatchSchema.extend({ name: personFields.name, id: z.string().optional() });

export const DEFAULT_PERSON: Omit<PersonDTO, 'id' | 'name' | 'version' | 'updatedAt' | 'updatedBy'> = {
  email: null,
  role: '',
  type: 'Permanent',
  department: '',
  location: null,
  totalCapacity: 100,
  dailyRate: null,
  teamId: null,
  chapterId: null,
  homeTribeId: null,
  linkedUserId: null,
  primaryCraft: null,
  secondaryCrafts: [],
  tribeAffinity: [],
  skills: [],
  targetUtil: 100,
};

type PersonData = Omit<PersonDTO, 'id' | 'version' | 'updatedAt' | 'updatedBy'>;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

async function validatePerson(q: Queryable, orgId: string, d: Partial<PersonData>, prefix = '') {
  const f = (k: string) => `${prefix}${k}`;
  if (d.primaryCraft) await assertCraft(q, orgId, d.primaryCraft, f('primaryCraft'), true);
  const seen = new Set<string>();
  for (const [i, s] of (d.secondaryCrafts ?? []).entries()) {
    await assertCraft(q, orgId, s.craftId, f(`secondaryCrafts.${i}.craftId`), true);
    if (s.craftId === d.primaryCraft) {
      throw badRequest('Already their above-the-table craft', {
        [f(`secondaryCrafts.${i}.craftId`)]: 'Already their above-the-table craft',
      });
    }
    if (seen.has(s.craftId))
      throw badRequest('Duplicate craft', { [f(`secondaryCrafts.${i}.craftId`)]: 'Listed twice' });
    seen.add(s.craftId);
  }
  if (d.teamId) await assertOrgRow(q, 'org_teams', orgId, d.teamId, f('teamId'));
  if (d.chapterId) await assertOrgRow(q, 'chapters', orgId, d.chapterId, f('chapterId'));
  if (d.homeTribeId) await assertOrgRow(q, 'tribes', orgId, d.homeTribeId, f('homeTribeId'));
  for (const [i, t] of (d.tribeAffinity ?? []).entries())
    await assertOrgRow(q, 'tribes', orgId, t, f(`tribeAffinity.${i}`));
  if (d.linkedUserId) await assertOrgUser(q, orgId, d.linkedUserId, f('linkedUserId'));
}

/** Column values for a full person row, including the v1.1 dual-write columns. */
async function personColumns(
  q: Queryable,
  orgId: string,
  d: PersonData,
  existingProfile: Record<string, unknown> = {},
) {
  const names = d.tribeAffinity.length
    ? await q.query<{ id: string; name: string }>(
        `SELECT id, name FROM tribes WHERE org_id = $1 AND id = ANY($2::text[])`,
        [orgId, d.tribeAffinity],
      )
    : [];
  const profile = {
    ...existingProfile,
    primaryCraft: d.primaryCraft,
    secondaryCrafts: d.secondaryCrafts,
    tribeAffinity: d.tribeAffinity.map((id) => names.find((n) => n.id === id)?.name ?? id),
    targetUtil: d.targetUtil,
  };
  return [
    d.name,
    d.email,
    d.role,
    d.type,
    d.department,
    d.location,
    Math.round(d.totalCapacity),
    d.dailyRate,
    d.teamId,
    d.chapterId,
    d.homeTribeId,
    d.linkedUserId,
    d.skills,
    JSON.stringify(profile),
    d.tribeAffinity,
    initials(d.name),
  ];
}
const PERSON_SET = `name = $4, email = $5, role = $6, type = $7, department = $8, location = $9, total_capacity = $10,
  daily_rate_eur = $11, team_id = $12, chapter_id = $13, home_tribe_id = $14, linked_user_id = $15, skills = $16::text[],
  craft_profile = $17::jsonb, tribe_affinity_ids = $18::text[], avatar_initials = $19`;

async function insertPerson(q: Queryable, access: WorkspaceAccess, id: string, d: PersonData, userId: string) {
  const cols = await personColumns(q, access.orgId, d);
  await q.query(
    `INSERT INTO resources (id, workspace_id, updated_by, name, email, role, type, department, location, total_capacity,
       daily_rate_eur, team_id, chapter_id, home_tribe_id, linked_user_id, skills, craft_profile, tribe_affinity_ids, avatar_initials)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::text[], $17::jsonb, $18::text[], $19)`,
    [id, access.workspaceId, userId, ...cols],
  );
}

async function updatePerson(
  q: Queryable,
  access: WorkspaceAccess,
  id: string,
  version: number,
  d: PersonData,
  userId: string,
) {
  const existing = await one<{ craft_profile: unknown }>(
    q,
    `SELECT craft_profile FROM resources WHERE id = $1 AND workspace_id = $2`,
    [id, access.workspaceId],
  );
  const cols = await personColumns(q, access.orgId, d, json<Record<string, unknown>>(existing?.craft_profile, {}));
  const rows = await q.query(
    `UPDATE resources SET ${PERSON_SET}, version = version + 1, updated_at = now(), updated_by = $20
     WHERE id = $1 AND workspace_id = $2 AND version = $3 RETURNING id`,
    [id, access.workspaceId, version, ...cols, userId],
  );
  return rows.length > 0;
}

function dataOf(p: PersonDTO): PersonData {
  const { id: _id, version: _v, updatedAt: _u, updatedBy: _b, ...rest } = p;
  return rest;
}

async function countPeople(q: Queryable, wsId: string): Promise<number> {
  return Number(
    (await q.query<{ n: number }>(`SELECT count(*)::int AS n FROM resources WHERE workspace_id = $1`, [wsId]))[0].n,
  );
}

export async function createPerson(ctx: Ctx, p: Params) {
  const access = await requireWorkspace(ctx, p.wsId, 'people.write');
  const body = parseWith(newPersonSchema, ctx.body);
  const id = newId(body.id);
  const { id: _ignored, ...rest } = body;
  const d: PersonData = { ...DEFAULT_PERSON, ...rest } as PersonData;
  const actor = requireActor(ctx);
  const person = await withTx(async (q) => {
    assertWithinLimit(access.org, 'maxPeople', (await countPeople(q, p.wsId)) + 1);
    if (await one(q, `SELECT 1 AS x FROM resources WHERE id = $1`, [id]))
      throw conflict('A person with this id already exists.');
    await validatePerson(q, access.orgId, d);
    await insertPerson(q, access, id, d, actor.userId);
    await bumpDataVersion(q, p.wsId);
    const created = await loadPerson(q, p.wsId, id);
    await audit(q, auditCtx(ctx), {
      action: 'person.create',
      orgId: access.orgId,
      workspaceId: p.wsId,
      targetType: 'person',
      targetId: id,
      after: created,
    });
    return created;
  });
  return reply(201, person);
}

export async function patchPerson(ctx: Ctx, p: Params) {
  const access = await requireWorkspace(ctx, p.wsId, 'people.write');
  const body = (ctx.body ?? {}) as { version?: unknown; patch?: unknown };
  const version = requireVersion(body.version);
  const patch = parseWith(personPatchSchema, body.patch ?? {});
  const actor = requireActor(ctx);
  return withTx(async (q) => {
    const before = await loadPerson(q, p.wsId, p.id);
    if (!before) throw notFound('This person no longer exists.');
    const d: PersonData = { ...dataOf(before), ...patch } as PersonData;
    await validatePerson(q, access.orgId, d);
    if (!(await updatePerson(q, access, p.id, version, d, actor.userId))) {
      await staleOrMissing(() => loadPerson(q, p.wsId, p.id), 'person');
    }
    await bumpDataVersion(q, p.wsId);
    const after = await loadPerson(q, p.wsId, p.id);
    await audit(q, auditCtx(ctx), {
      action: 'person.update',
      orgId: access.orgId,
      workspaceId: p.wsId,
      targetType: 'person',
      targetId: p.id,
      before,
      after,
    });
    return after;
  });
}

export async function deletePerson(ctx: Ctx, p: Params) {
  const access = await requireWorkspace(ctx, p.wsId, 'people.write');
  await withTx(async (q) => {
    const before = await loadPerson(q, p.wsId, p.id);
    if (!before) throw notFound('This person no longer exists.');
    if (ctx.query.version !== undefined && requireVersion(ctx.query.version) !== before.version) {
      await staleOrMissing(async () => before, 'person');
    }
    await q.query(`DELETE FROM allocations WHERE workspace_id = $1 AND resource_id = $2`, [p.wsId, p.id]);
    await q.query(`DELETE FROM marketplace_offers WHERE workspace_id = $1 AND person_id = $2`, [p.wsId, p.id]);
    await q.query(`DELETE FROM craft_change_requests WHERE workspace_id = $1 AND person_id = $2`, [p.wsId, p.id]);
    await q.query(`UPDATE external_identities SET person_id = NULL WHERE workspace_id = $1 AND person_id = $2`, [
      p.wsId,
      p.id,
    ]);
    await q.query(`UPDATE chapters SET lead_person_id = NULL WHERE org_id = $1 AND lead_person_id = $2`, [
      access.orgId,
      p.id,
    ]);
    await q.query(`DELETE FROM resources WHERE workspace_id = $1 AND id = $2`, [p.wsId, p.id]);
    await bumpDataVersion(q, p.wsId);
    await audit(q, auditCtx(ctx), {
      action: 'person.delete',
      orgId: access.orgId,
      workspaceId: p.wsId,
      targetType: 'person',
      targetId: p.id,
      before,
    });
  });
  return noContent();
}

// ── Bulk edit (PPL-03) ─────────────────────────────────────────────────────

const bulkSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(500),
  versions: z.record(z.string(), z.number().int()),
  patch: z
    .object({
      chapterId: z.string().nullable().optional(),
      teamId: z.string().nullable().optional(),
      targetUtil: z.number().min(0).max(150).optional(),
      addSecondaryCraft: secondary.optional(),
    })
    .strict(),
});

export async function bulkPeople(ctx: Ctx, p: Params) {
  const access = await requireWorkspace(ctx, p.wsId, 'people.write');
  const body = parseWith(bulkSchema, ctx.body) as PeopleBulkRequest;
  const actor = requireActor(ctx);
  return withTx(async (q) => {
    const out: PersonDTO[] = [];
    for (const id of body.ids) {
      const before = await loadPerson(q, p.wsId, id);
      if (!before) throw notFound(`Person ${id} no longer exists.`);
      const version = body.versions[id];
      if (version === undefined) throw badRequest('Missing version', { [`versions.${id}`]: 'Required' });
      const d = dataOf(before);
      if (body.patch.chapterId !== undefined) d.chapterId = body.patch.chapterId;
      if (body.patch.teamId !== undefined) d.teamId = body.patch.teamId;
      if (body.patch.targetUtil !== undefined) d.targetUtil = body.patch.targetUtil;
      const add = body.patch.addSecondaryCraft;
      if (add && add.craftId !== d.primaryCraft) {
        d.secondaryCrafts = [...d.secondaryCrafts.filter((s) => s.craftId !== add.craftId), add];
      }
      await validatePerson(q, access.orgId, d);
      if (!(await updatePerson(q, access, id, version, d, actor.userId))) {
        const current = await loadPerson(q, p.wsId, id);
        throw conflict('1 person changed since you loaded the page. Reload and try again.', {
          current,
          changedBy: current?.updatedBy ?? null,
          changedAt: current?.updatedAt ?? null,
          fields: { [`versions.${id}`]: 'This record changed' },
          body: { id },
        });
      }
      const after = await loadPerson(q, p.wsId, id);
      if (after) out.push(after);
    }
    await bumpDataVersion(q, p.wsId);
    await audit(q, auditCtx(ctx), {
      action: 'people.bulk_update',
      orgId: access.orgId,
      workspaceId: p.wsId,
      targetType: 'person',
      targetId: null,
      after: { ids: body.ids, patch: body.patch },
    });
    return { people: out };
  });
}

// ── CSV import (PPL-04) ────────────────────────────────────────────────────

const importRow = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().optional().or(z.literal('')),
  jobTitle: z.string().trim().max(120).optional(),
  type: z.enum(['Permanent', 'Contractor', 'Part-Time']).optional(),
  location: z.string().trim().max(120).optional(),
  chapter: z.string().trim().max(120).optional(),
  team: z.string().trim().max(120).optional(),
  homeTribe: z.string().trim().max(120).optional(),
  targetPct: z.number().min(0).max(150).optional(),
  aboveCraft: z.string().trim().max(10).optional(),
  belowCrafts: z.array(secondary).max(20).optional(),
  skills: z.array(z.string().trim().min(1).max(60)).max(100).optional(),
});
const importSchema = z.object({ rows: z.array(z.unknown()).max(1000), createMissingStructure: z.boolean() });

export async function importPeople(ctx: Ctx, p: Params) {
  const access = await requireWorkspace(ctx, p.wsId, 'import.csv');
  assertEntitled(access.org, 'csvImport');
  const body = parseWith(importSchema, ctx.body);
  if (body.rows.length > 1000) throw payloadTooLarge('Import at most 1,000 rows at a time.');
  const actor = requireActor(ctx);
  const result: PeopleImportResponse = { created: 0, updated: 0, skipped: 0, errors: [] };
  await withTx(async (q) => {
    const crafts = await q.query<{ id: string; short: string }>(`SELECT id, short FROM crafts WHERE org_id = $1`, [
      access.orgId,
    ]);
    const craftByShort = new Map(crafts.map((c) => [c.short.toUpperCase(), c.id]));
    const craftIds = new Set(crafts.map((c) => c.id));
    const resolveCraft = (v: string | undefined) =>
      v ? (craftByShort.get(v.toUpperCase()) ?? (craftIds.has(v) ? v : null)) : null;
    const structure = async (
      table: 'tribes' | 'chapters' | 'org_teams',
      label: string,
      rowNo: number,
    ): Promise<string | null> => {
      if (!label) return null;
      const found = await one<{ id: string }>(
        q,
        `SELECT id FROM ${table} WHERE org_id = $1 AND lower(name) = lower($2)`,
        [access.orgId, label],
      );
      if (found) return found.id;
      if (!body.createMissingStructure)
        throw new Error(`Unknown ${table === 'org_teams' ? 'team' : table.slice(0, -1)} '${label}' (row ${rowNo})`);
      const id = randomUUID();
      await q.query(`INSERT INTO ${table} (org_id, id, name, updated_by) VALUES ($1, $2, $3, $4)`, [
        access.orgId,
        id,
        label,
        actor.userId,
      ]);
      return id;
    };
    let count = await countPeople(q, p.wsId);
    for (const [i, raw] of body.rows.entries()) {
      const rowNo = i + 1;
      const parsed = importRow.safeParse(raw);
      if (!parsed.success) {
        result.skipped++;
        result.errors.push({ row: rowNo, message: parsed.error.issues[0]?.message ?? 'Invalid row' });
        continue;
      }
      const r = parsed.data;
      try {
        await q.query('SAVEPOINT import_row');
        const above = resolveCraft(r.aboveCraft);
        if (r.aboveCraft && !above) throw new Error(`Unknown craft '${r.aboveCraft}'`);
        const below: SecondaryCraftDTO[] = [];
        for (const b of r.belowCrafts ?? []) {
          const id = resolveCraft(b.craftId);
          if (!id) throw new Error(`Unknown craft '${b.craftId}'`);
          below.push({ ...b, craftId: id });
        }
        const existing = r.email
          ? await one<{ id: string }>(
              q,
              `SELECT id FROM resources WHERE workspace_id = $1 AND lower(email) = lower($2)`,
              [p.wsId, r.email],
            )
          : await one<{ id: string }>(
              q,
              `SELECT id FROM resources WHERE workspace_id = $1 AND lower(name) = lower($2) ORDER BY id LIMIT 1`,
              [p.wsId, r.name],
            );
        const chapterId = await structure('chapters', r.chapter ?? '', rowNo);
        const teamId = await structure('org_teams', r.team ?? '', rowNo);
        const tribeId = await structure('tribes', r.homeTribe ?? '', rowNo);
        if (existing) {
          const before = await loadPerson(q, p.wsId, existing.id);
          if (!before) throw new Error('Person vanished');
          const d = dataOf(before);
          Object.assign(d, {
            name: r.name,
            email: r.email || d.email,
            role: r.jobTitle ?? d.role,
            type: r.type ?? d.type,
            location: r.location ?? d.location,
            chapterId: chapterId ?? d.chapterId,
            teamId: teamId ?? d.teamId,
            homeTribeId: tribeId ?? d.homeTribeId,
            targetUtil: r.targetPct ?? d.targetUtil,
            primaryCraft: above ?? d.primaryCraft,
            secondaryCrafts: r.belowCrafts ? below : d.secondaryCrafts,
            skills: r.skills ?? d.skills,
          });
          await validatePerson(q, access.orgId, d);
          await updatePerson(q, access, existing.id, before.version, d, actor.userId);
          result.updated++;
        } else {
          assertWithinLimit(access.org, 'maxPeople', count + 1);
          const d: PersonData = {
            ...DEFAULT_PERSON,
            name: r.name,
            email: r.email || null,
            role: r.jobTitle ?? '',
            type: r.type ?? 'Permanent',
            location: r.location ?? null,
            chapterId,
            teamId,
            homeTribeId: tribeId,
            tribeAffinity: tribeId ? [tribeId] : [],
            targetUtil: r.targetPct ?? 100,
            primaryCraft: above,
            secondaryCrafts: below,
            skills: r.skills ?? [],
          };
          await validatePerson(q, access.orgId, d);
          await insertPerson(q, access, randomUUID(), d, actor.userId);
          count++;
          result.created++;
        }
        await q.query('RELEASE SAVEPOINT import_row');
      } catch (e) {
        await q.query('ROLLBACK TO SAVEPOINT import_row');
        const err = e as { status?: number; message?: string; extra?: { fields?: Record<string, string> } };
        if (err.status === 403) throw e; // entitlement: stop the import
        result.skipped++;
        result.errors.push({
          row: rowNo,
          message: Object.values(err.extra?.fields ?? {})[0] ?? err.message ?? 'Invalid row',
        });
      }
    }
    await bumpDataVersion(q, p.wsId);
    await audit(q, auditCtx(ctx), {
      action: 'people.import',
      orgId: access.orgId,
      workspaceId: p.wsId,
      targetType: 'person',
      after: { created: result.created, updated: result.updated, skipped: result.skipped },
    });
  });
  return result;
}

// ── Craft change requests (PPL-06) ─────────────────────────────────────────

export async function submitCraftRequest(ctx: Ctx, p: Params) {
  const access = await requireWorkspace(ctx, p.wsId, ['people.write', 'people.write.own']);
  const own = access.linkedPersonId === p.personId;
  if (!has(access, 'people.write') && !(has(access, 'people.write.own') && own)) {
    throw forbidden('You can only suggest changes to your own crafts.');
  }
  const raw = (ctx.body ?? {}) as Record<string, unknown>;
  for (const k of ['primaryCraft', 'targetUtil']) {
    if (k in raw) throw badRequest('Only below-the-table crafts can be changed here.', { [k]: 'Not allowed' });
  }
  const body = parseWith(z.object({ secondaryCrafts: z.array(secondary).max(20) }).strict(), raw);
  const actor = requireActor(ctx);
  const id = randomUUID();
  const created = await withTx(async (q) => {
    const person = await loadPerson(q, p.wsId, p.personId);
    if (!person) throw notFound('This person no longer exists.');
    await validatePerson(q, access.orgId, { primaryCraft: person.primaryCraft, secondaryCrafts: body.secondaryCrafts });
    await q.query(
      `UPDATE craft_change_requests SET status = 'rejected', decided_at = now(), reason = 'Superseded by a newer request'
                   WHERE workspace_id = $1 AND person_id = $2 AND status = 'pending'`,
      [p.wsId, p.personId],
    );
    await q.query(
      `INSERT INTO craft_change_requests (id, org_id, workspace_id, person_id, current, proposed, submitted_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)`,
      [
        id,
        access.orgId,
        p.wsId,
        p.personId,
        JSON.stringify(person.secondaryCrafts),
        JSON.stringify(body.secondaryCrafts),
        actor.userId,
      ],
    );
    const [req] = await loadCraftRequests(q, p.wsId, { id });
    await audit(q, auditCtx(ctx), {
      action: 'craft.request',
      orgId: access.orgId,
      workspaceId: p.wsId,
      targetType: 'person',
      targetId: p.personId,
      after: req,
    });
    return req;
  });
  return reply(201, created);
}

export async function listCraftRequests(ctx: Ctx, p: Params) {
  const access = await requireWorkspace(ctx, p.wsId, 'data.read');
  const status =
    ctx.query.status && ['pending', 'approved', 'rejected'].includes(ctx.query.status) ? ctx.query.status : undefined;
  if (has(access, 'craftProfile.approve')) return loadCraftRequests(ctx.db, p.wsId, { status });
  if (has(access, 'people.write.own') && access.linkedPersonId) {
    return loadCraftRequests(ctx.db, p.wsId, { status, personId: access.linkedPersonId });
  }
  return [];
}

export async function decideCraftRequest(ctx: Ctx, p: Params) {
  const access = await requireWorkspace(ctx, p.wsId, 'craftProfile.approve');
  const decision = p.decision;
  if (decision !== 'approve' && decision !== 'reject') throw notFound('Not found');
  const reason = String((ctx.body as { reason?: unknown })?.reason ?? '').trim();
  if (decision === 'reject' && !reason) throw badRequest('Give a reason for rejecting.', { reason: 'Required' });
  const actor = requireActor(ctx);
  return withTx(async (q) => {
    const [req] = await loadCraftRequests(q, p.wsId, { id: p.id });
    if (!req) throw notFound('Request not found');
    if (req.status !== 'pending') throw conflict('This request was already decided.');
    if (decision === 'approve') {
      const person = await loadPerson(q, p.wsId, req.personId);
      if (!person) throw conflict('This person no longer exists.');
      const d = { ...dataOf(person), secondaryCrafts: req.proposed };
      await validatePerson(q, access.orgId, d);
      if (!(await updatePerson(q, access, person.id, person.version, d, actor.userId))) {
        await staleOrMissing(() => loadPerson(q, p.wsId, person.id), 'person');
      }
      await bumpDataVersion(q, p.wsId);
    }
    await q.query(
      `UPDATE craft_change_requests SET status = $2, decided_by = $3, decided_at = now(), reason = $4 WHERE id = $1`,
      [p.id, decision === 'approve' ? 'approved' : 'rejected', actor.userId, reason || null],
    );
    const [after] = await loadCraftRequests(q, p.wsId, { id: p.id });
    await audit(q, auditCtx(ctx), {
      action: decision === 'approve' ? 'craft.approve' : 'craft.reject',
      orgId: access.orgId,
      workspaceId: p.wsId,
      targetType: 'person',
      targetId: req.personId,
      before: req,
      after,
    });
    return after;
  });
}

export { loadPeople };
