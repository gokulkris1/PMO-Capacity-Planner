/**
 * Legacy /api/org_manage — platform cockpit routes only (ST-09, SEC-17/18).
 * Org creation moved to POST /api/v2/orgs and workspace creation to POST /api/v2/orgs/:orgId/workspaces:
 * the old create paths answer 410. Everything else requires platform admin and is audited.
 */
import type { Ctx } from './_lib/api';
import { auditCtx, requireActor, withApi } from './_lib/api';
import { audit } from './_lib/audit';
import { UUID_RE } from './_lib/authz';
import { one, withTx } from './_lib/db';
import { bestEffort } from './_lib/entity';
import { GONE_MESSAGE, badRequest, forbidden, gone, notFound } from './_lib/errors';

function platformOnly(ctx: Ctx) {
  if (!requireActor(ctx).isPlatformAdmin) throw forbidden('Forbidden');
}

async function listOrgs(ctx: Ctx) {
  const orgs = await ctx.db.query(
    `SELECT o.id, o.name, o.slug, o.logo_url, o.plan, o.created_at,
       (SELECT count(*)::int FROM org_memberships m WHERE m.org_id = o.id) AS user_count,
       (SELECT count(*)::int FROM org_memberships m WHERE m.org_id = o.id AND m.role = 'ORG_ADMIN') AS admin_count,
       (SELECT count(*)::int FROM workspaces w WHERE w.org_id = o.id) AS workspace_count,
       (SELECT count(*)::int FROM projects p JOIN workspaces w ON w.id = p.workspace_id WHERE w.org_id = o.id) AS project_count,
       (SELECT count(*)::int FROM resources r JOIN workspaces w ON w.id = r.workspace_id WHERE w.org_id = o.id) AS resource_count,
       (SELECT max(e.occurred_at) FROM audit_events e WHERE e.org_id = o.id) AS last_activity
     FROM organizations o ORDER BY o.created_at DESC NULLS LAST`,
  );
  const admins = await ctx.db.query(
    `SELECT u.id, u.email, u.name, m.role, m.org_id FROM org_memberships m JOIN users u ON u.id = m.user_id WHERE m.role = 'ORG_ADMIN' ORDER BY u.name`,
  );
  const workspaces = await ctx.db.query(
    `SELECT w.id, w.name, w.org_id, (SELECT count(*)::int FROM workspace_members wm WHERE wm.workspace_id = w.id) AS member_count
     FROM workspaces w ORDER BY w.name`,
  );
  await audit(ctx.db, auditCtx(ctx, 'platform_admin'), { action: 'support.access', targetType: 'platform', targetId: 'orgs' });
  return {
    orgs: orgs.map((o) => ({
      ...o,
      admins: admins.filter((a) => a.org_id === o.id),
      workspaces: workspaces.filter((w) => w.org_id === o.id),
    })),
  };
}

async function updateOrg(ctx: Ctx, orgId: string) {
  const body = (ctx.body ?? {}) as { plan?: unknown; name?: unknown };
  const plan = typeof body.plan === 'string' ? body.plan.toUpperCase() : null;
  if (plan && !['BASIC', 'PRO', 'MAX', 'ENTERPRISE'].includes(plan)) throw badRequest('Invalid plan', { plan: 'Invalid plan' });
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : null;
  await withTx(async (q) => {
    const before = await one(q, `SELECT name, plan FROM organizations WHERE id = $1`, [orgId]);
    if (!before) throw notFound('Organisation not found');
    await q.query(
      `UPDATE organizations SET name = coalesce($2, name), plan = coalesce($3, plan), version = version + 1, updated_at = now(), updated_by = $4 WHERE id = $1`,
      [orgId, name, plan, requireActor(ctx).userId],
    );
    if (plan) {
      // Rollback safety: v1.1 reads the plan from users.plan (BASIC/PRO/MAX only).
      await bestEffort(q, `UPDATE users SET plan = $2 WHERE org_id = $1`, [orgId, plan === 'ENTERPRISE' ? 'MAX' : plan]);
    }
    await audit(q, auditCtx(ctx, 'platform_admin'), {
      action: plan ? 'org.plan_change' : 'org.update',
      orgId,
      targetType: 'org',
      targetId: orgId,
      before,
      after: { name: name ?? before.name, plan: plan ?? before.plan },
    });
  });
  return { success: true };
}

/** Workspace-scoped tables, deleted before the workspaces of a deleted org (one transaction, ARC-09). */
const WS_TABLES = [
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

async function deleteOrg(ctx: Ctx, orgId: string) {
  await withTx(async (q) => {
    const before = await one(q, `SELECT name, slug FROM organizations WHERE id = $1`, [orgId]);
    if (!before) throw notFound('Organisation not found');
    for (const t of WS_TABLES) {
      await q.query(`DELETE FROM ${t} WHERE workspace_id IN (SELECT id FROM workspaces WHERE org_id = $1)`, [orgId]);
    }
    await q.query(`DELETE FROM workspaces WHERE org_id = $1`, [orgId]);
    await q.query(`UPDATE users SET org_id = NULL, token_version = token_version + 1 WHERE org_id = $1`, [orgId]);
    await bestEffort(q, `UPDATE users SET role = 'USER' WHERE id IN (SELECT user_id FROM org_memberships WHERE org_id = $1) AND role <> 'SUPERUSER'`, [orgId]);
    await q.query(`DELETE FROM org_memberships WHERE org_id = $1`, [orgId]);
    for (const t of ['crafts', 'tribes', 'chapters', 'org_teams', 'invitations']) await q.query(`DELETE FROM ${t} WHERE org_id = $1`, [orgId]);
    await q.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
    await audit(q, auditCtx(ctx, 'platform_admin'), { action: 'org.delete', orgId, targetType: 'org', targetId: orgId, before });
  });
  return { success: true };
}

export const handler = withApi({ fn: 'org_manage' }, async (ctx) => {
  const parts = ctx.subpath.split('/').filter(Boolean);
  if (ctx.method === 'POST') {
    // SEC-17/18: org and workspace creation now go through /api/v2 with ORG_ADMIN checks.
    throw gone(GONE_MESSAGE);
  }
  platformOnly(ctx);
  if (ctx.method === 'GET' && parts.length === 0) return listOrgs(ctx);
  const orgId = parts[0];
  if (!orgId || !UUID_RE.test(orgId)) throw notFound('Not found');
  if (ctx.method === 'PUT' && parts.length === 1) return updateOrg(ctx, orgId);
  if (ctx.method === 'DELETE' && parts.length === 1) return deleteOrg(ctx, orgId);
  if (ctx.method === 'DELETE' && parts.length === 5 && parts[1] === 'admin' && parts[3] === 'workspace') {
    await withTx(async (q) => {
      await q.query(
        `DELETE FROM workspace_members WHERE user_id::text = $1 AND workspace_id::text = $2 AND workspace_id IN (SELECT id FROM workspaces WHERE org_id = $3)`,
        [parts[2], parts[4], orgId],
      );
      await audit(q, auditCtx(ctx, 'platform_admin'), { action: 'member.remove', orgId, workspaceId: parts[4], targetType: 'user', targetId: parts[2] });
    });
    return { success: true };
  }
  throw notFound('Not found');
});
