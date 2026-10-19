/**
 * Organisations and workspaces (AC-08, AC-09, ST-01, ST-03, ST-05, SH-05, HS-10#AC2, PL-07).
 * POST /orgs · GET|PATCH /orgs/:orgId · GET|POST /orgs/:orgId/workspaces · GET|PATCH|DELETE /workspaces/:wsId
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { OrgDTO, WorkspaceDTO } from '../../../../shared/contracts/dto';
import { FEATURE_FLAGS } from '../../../../shared/features';
import { validateThresholds } from '../../../../shared/utilisation';
import type { Ctx } from '../api';
import { auditCtx, noContent, parseWith, reply, requireActor } from '../api';
import { audit } from '../audit';
import { assertWithinLimit, requireOrg, requireWorkspace } from '../authz';
import { seedCrafts } from '../catalog';
import type { Queryable } from '../db';
import { one, withTx } from '../db';
import { ORG_COLUMNS, WORKSPACE_COLUMNS, featuresOf, orgDTO, planningOf, workspaceDTO } from '../dto';
import { appBaseUrl, optionalEnv } from '../env';
import { badRequest, conflict, forbidden } from '../errors';
import { sendEmail, welcomeEmail } from '../email';
import { bestEffort, slugify, staleOrMissing } from '../entity';
import type { Params } from '../router';

export const AI_NOT_CONFIGURED =
  'The AI assistant is not set up on this deployment (no Anthropic API key). Ask whoever runs PMO Capacity Planner to add one.';

export async function loadOrgDTO(q: Queryable, orgId: string): Promise<OrgDTO | null> {
  const r = await one(
    q,
    `SELECT ${ORG_COLUMNS}, ub.name AS updated_by_name FROM organizations o LEFT JOIN users ub ON ub.id = o.updated_by WHERE o.id = $1`,
    [orgId],
  );
  return r ? orgDTO(r) : null;
}

const createOrgSchema = z.object({
  name: z.string().trim().min(1, 'Enter an organisation name').max(120),
  workspaceName: z.string().trim().max(120).optional(),
});

export async function createOrg(ctx: Ctx) {
  const actor = requireActor(ctx);
  if (!actor.emailVerified) throw forbidden('Verify your email first');
  const existing = await one(ctx.db, `SELECT 1 AS x FROM org_memberships WHERE user_id = $1`, [actor.userId]);
  if (existing || actor.legacyOrgId) throw conflict('You already belong to an organisation.');
  const body = parseWith(createOrgSchema, ctx.body);
  const orgId = randomUUID();
  const wsId = randomUUID();
  const slug = `${slugify(body.name)}-${randomBytes(3).toString('hex')}`;
  const wsName = body.workspaceName || 'PMO';
  await withTx(async (q) => {
    await q.query(`INSERT INTO organizations (id, name, slug, plan, updated_by) VALUES ($1, $2, $3, 'BASIC', $4)`, [
      orgId,
      body.name,
      slug,
      actor.userId,
    ]);
    await q.query(`INSERT INTO org_memberships (org_id, user_id, role) VALUES ($1, $2, 'ORG_ADMIN')`, [
      orgId,
      actor.userId,
    ]);
    await q.query(`UPDATE users SET org_id = $2 WHERE id = $1`, [actor.userId, orgId]);
    await bestEffort(q, `UPDATE users SET role = 'ORG_ADMIN' WHERE id = $1 AND role <> 'SUPERUSER'`, [actor.userId]);
    await q.query(`INSERT INTO workspaces (id, org_id, name) VALUES ($1, $2, $3)`, [wsId, orgId, wsName]);
    await q.query(
      `INSERT INTO workspace_members (user_id, workspace_id, org_id, role, access_role, invited_by)
       VALUES ($1, $2, $3, 'PMO_ADMIN', 'WORKSPACE_ADMIN', $1)`,
      [actor.userId, wsId, orgId],
    );
    await seedCrafts(q, orgId);
    const a = auditCtx(ctx);
    await audit(q, a, {
      action: 'org.create',
      orgId,
      targetType: 'org',
      targetId: orgId,
      after: { name: body.name, slug },
    });
    await audit(q, a, {
      action: 'workspace.create',
      orgId,
      workspaceId: wsId,
      targetType: 'workspace',
      targetId: wsId,
      after: { name: wsName },
    });
  });
  await sendEmail(welcomeEmail(actor.email, body.name, `${appBaseUrl()}/o/${slug}/w/${wsId}/home`));
  const org = await loadOrgDTO(ctx.db, orgId);
  const ws = await one(ctx.db, `SELECT ${WORKSPACE_COLUMNS} FROM workspaces w WHERE w.id = $1`, [wsId]);
  return reply(201, { org, workspace: ws ? workspaceDTO(ws) : null });
}

export async function getOrg(ctx: Ctx, p: Params): Promise<OrgDTO | null> {
  await requireOrg(ctx, p.orgId, 'org.view');
  return loadOrgDTO(ctx.db, p.orgId);
}

const planningSchema = z
  .object({
    fiscalYearStartMonth: z.union([z.literal(1), z.literal(4), z.literal(7), z.literal(10)]),
    thresholds: z.object({ benchBelow: z.number(), onTargetFrom: z.number(), onTargetTo: z.number() }),
    defaultTargetUtil: z.number().min(0).max(150),
    sprintLengthDays: z.number().int().min(1).max(60),
    planviewOwnership: z.enum(['locked', 'overridable']),
  })
  .partial();

const orgPatchSchema = z.object({
  version: z.number().int().min(0),
  patch: z
    .object({
      name: z.string().trim().min(1).max(120).optional(),
      logoUrl: z.string().trim().max(500).nullable().optional(),
      features: z.record(z.string(), z.boolean()).optional(),
      planning: planningSchema.optional(),
      defaultWorkspaceVisibility: z.enum(['org', 'members']).optional(),
    })
    .passthrough(),
});

export async function patchOrg(ctx: Ctx, p: Params): Promise<OrgDTO | null> {
  const access = await requireOrg(ctx, p.orgId, 'org.manage');
  const raw = (ctx.body ?? {}) as { patch?: Record<string, unknown> };
  if (raw.patch && 'plan' in raw.patch)
    throw badRequest('Plan is managed by billing.', { plan: 'Plan is managed by billing.' });
  if (raw.patch && 'slug' in raw.patch)
    throw badRequest('The organisation address cannot change.', { slug: 'Cannot change' });
  const body = parseWith(orgPatchSchema, ctx.body);
  const patch = body.patch;
  const sets: string[] = [];
  const params: unknown[] = [p.orgId, body.version, requireActor(ctx).userId];
  const before = orgDTO(access.org);
  const after: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    params.push(patch.name);
    sets.push(`name = $${params.length}`);
    after.name = patch.name;
  }
  if (patch.logoUrl !== undefined) {
    if (patch.logoUrl !== null && patch.logoUrl !== '' && !/^https:\/\/[^\s]+$/i.test(patch.logoUrl)) {
      throw badRequest('Logo must be an https:// address.', { 'patch.logoUrl': 'Logo must be an https:// address.' });
    }
    params.push(patch.logoUrl || null);
    sets.push(`logo_url = $${params.length}`);
    after.logoUrl = patch.logoUrl || null;
  }
  let featureChange = false;
  if (patch.features !== undefined) {
    const unknown = Object.keys(patch.features).filter((k) => !(FEATURE_FLAGS as readonly string[]).includes(k));
    if (unknown.length)
      throw badRequest('Unknown feature flag.', { 'patch.features': `Unknown: ${unknown.join(', ')}` });
    const next = { ...featuresOf(access.org.features), ...patch.features };
    // QA-029 (HS-11#AC2): the assistant cannot be switched on where it cannot answer.
    if (
      patch.features.aiAssistant === true &&
      !featuresOf(access.org.features).aiAssistant &&
      !optionalEnv('ANTHROPIC_API_KEY')
    )
      throw conflict(AI_NOT_CONFIGURED, { fields: { 'patch.features.aiAssistant': AI_NOT_CONFIGURED } });
    params.push(JSON.stringify(next));
    sets.push(`features = $${params.length}::jsonb`);
    after.features = next;
    featureChange = true;
  }
  if (patch.planning !== undefined) {
    const next = { ...planningOf(access.org.planning), ...patch.planning };
    if (patch.planning.thresholds)
      next.thresholds = { ...planningOf(access.org.planning).thresholds, ...patch.planning.thresholds };
    const msg = validateThresholds(next.thresholds);
    if (msg) throw badRequest(msg, { 'patch.planning.thresholds': msg });
    params.push(JSON.stringify(next));
    sets.push(`planning = $${params.length}::jsonb`);
    after.planning = next;
  }
  if (patch.defaultWorkspaceVisibility !== undefined) {
    params.push(patch.defaultWorkspaceVisibility);
    sets.push(`default_workspace_visibility = $${params.length}`);
    after.defaultWorkspaceVisibility = patch.defaultWorkspaceVisibility;
  }
  if (!sets.length) return loadOrgDTO(ctx.db, p.orgId);
  await withTx(async (q) => {
    const rows = await q.query(
      `UPDATE organizations SET ${sets.join(', ')}, version = version + 1, updated_at = now(), updated_by = $3
       WHERE id = $1 AND version = $2 RETURNING id`,
      params,
    );
    if (!rows.length) await staleOrMissing(() => loadOrgDTO(q, p.orgId), 'organisation');
    await audit(q, auditCtx(ctx), {
      action: featureChange ? 'org.feature_change' : 'org.update',
      orgId: p.orgId,
      targetType: 'org',
      targetId: p.orgId,
      before: Object.fromEntries(Object.keys(after).map((k) => [k, (before as unknown as Record<string, unknown>)[k]])),
      after,
    });
  });
  return loadOrgDTO(ctx.db, p.orgId);
}

export async function listOrgWorkspaces(ctx: Ctx, p: Params): Promise<WorkspaceDTO[]> {
  const access = await requireOrg(ctx, p.orgId, 'org.view');
  const actor = requireActor(ctx);
  const rows = await ctx.db.query(
    `SELECT ${WORKSPACE_COLUMNS}, wm.user_id AS member FROM workspaces w
     LEFT JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = $2
     WHERE w.org_id = $1 ORDER BY w.created_at NULLS LAST, w.name`,
    [p.orgId, actor.userId],
  );
  const all =
    access.orgRole === 'ORG_ADMIN' || access.viaPlatformAdmin || access.org.default_workspace_visibility !== 'members';
  return rows.filter((r) => all || r.member).map(workspaceDTO);
}

export async function createWorkspace(ctx: Ctx, p: Params) {
  const access = await requireOrg(ctx, p.orgId, 'workspace.manage');
  const name = parseWith(z.object({ name: z.string().trim().min(1, 'Enter a name').max(120) }), ctx.body).name;
  const actor = requireActor(ctx);
  const id = randomUUID();
  await withTx(async (q) => {
    const count = await q.query<{ n: number }>(`SELECT count(*)::int AS n FROM workspaces WHERE org_id = $1`, [
      p.orgId,
    ]);
    assertWithinLimit(access.org, 'maxWorkspaces', Number(count[0].n) + 1);
    await q.query(`INSERT INTO workspaces (id, org_id, name) VALUES ($1, $2, $3)`, [id, p.orgId, name]);
    await q.query(
      `INSERT INTO workspace_members (user_id, workspace_id, org_id, role, access_role, invited_by)
       VALUES ($1, $2, $3, 'PMO_ADMIN', 'WORKSPACE_ADMIN', $1)`,
      [actor.userId, id, p.orgId],
    );
    await audit(q, auditCtx(ctx), {
      action: 'workspace.create',
      orgId: p.orgId,
      workspaceId: id,
      targetType: 'workspace',
      targetId: id,
      after: { name },
    });
  });
  const ws = await one(ctx.db, `SELECT ${WORKSPACE_COLUMNS} FROM workspaces w WHERE w.id = $1`, [id]);
  return reply(201, ws ? workspaceDTO(ws) : null);
}

export async function getWorkspace(ctx: Ctx, p: Params): Promise<WorkspaceDTO | null> {
  await requireWorkspace(ctx, p.wsId, 'data.read');
  const ws = await one(ctx.db, `SELECT ${WORKSPACE_COLUMNS} FROM workspaces w WHERE w.id = $1`, [p.wsId]);
  return ws ? workspaceDTO(ws) : null;
}

export async function patchWorkspace(ctx: Ctx, p: Params): Promise<WorkspaceDTO | null> {
  const access = await requireWorkspace(ctx, p.wsId, 'workspace.manage');
  const name = parseWith(z.object({ name: z.string().trim().min(1, 'Enter a name').max(120) }), ctx.body).name;
  await withTx(async (q) => {
    await q.query(`UPDATE workspaces SET name = $2 WHERE id = $1`, [p.wsId, name]);
    await audit(q, auditCtx(ctx), {
      action: 'workspace.update',
      orgId: access.orgId,
      workspaceId: p.wsId,
      targetType: 'workspace',
      targetId: p.wsId,
      before: { name: access.workspaceName },
      after: { name },
    });
  });
  const ws = await one(ctx.db, `SELECT ${WORKSPACE_COLUMNS} FROM workspaces w WHERE w.id = $1`, [p.wsId]);
  return ws ? workspaceDTO(ws) : null;
}

/** Tables holding rows of one workspace, deleted in order inside one transaction. */
const WORKSPACE_TABLES = [
  'allocations',
  'demand_lines',
  'marketplace_offers',
  'craft_change_requests',
  'resources',
  'projects',
  'delivery_snapshots',
  'sync_jobs',
  'integration_mappings',
  'external_identities',
  'tribe_calibrations',
  'planview_previews',
  'workspace_integrations',
  'workspace_members',
];

export async function deleteWorkspace(ctx: Ctx, p: Params) {
  const access = await requireWorkspace(ctx, p.wsId, 'workspace.manage');
  if ((ctx.query.confirmName ?? '').trim() !== access.workspaceName.trim()) {
    throw badRequest('Type the workspace name to confirm.', { confirmName: 'Does not match the workspace name' });
  }
  await withTx(async (q) => {
    for (const t of WORKSPACE_TABLES) await q.query(`DELETE FROM ${t} WHERE workspace_id = $1`, [p.wsId]);
    await q.query(`DELETE FROM workspaces WHERE id = $1`, [p.wsId]);
    await audit(q, auditCtx(ctx), {
      action: 'workspace.delete',
      orgId: access.orgId,
      workspaceId: p.wsId,
      targetType: 'workspace',
      targetId: p.wsId,
      before: { name: access.workspaceName },
    });
  });
  return noContent();
}
