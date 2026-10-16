/**
 * Legacy /api/workspace (PL-03), kept read-only for one release so cached v1.1 bundles can still load data.
 * GET resolves the workspace by `wsId` (ARC-01 fix) or, as a fallback, the caller's first accessible workspace in
 * `orgSlug`, deterministically. POST (full delete-and-reinsert save) answers 410 and changes nothing.
 */
import type { Ctx } from './_lib/api';
import { requireActor, withApi } from './_lib/api';
import { requireWorkspace, resolveWorkspaceAccess, UUID_RE } from './_lib/authz';
import { json, num, numOrNull, one } from './_lib/db';
import { GONE_MESSAGE, forbidden, gone, notFound } from './_lib/errors';
import { toLegacyWorkspaceRole } from '../../shared/permissions';
import { loadMembers } from './_lib/handlers/members';

async function pickWorkspace(ctx: Ctx): Promise<string> {
  const actor = requireActor(ctx);
  if (ctx.query.wsId) {
    if (!UUID_RE.test(ctx.query.wsId)) throw notFound('Workspace not found');
    return ctx.query.wsId;
  }
  const slug = ctx.query.orgSlug;
  const org = slug
    ? await one<{ id: string }>(ctx.db, `SELECT id FROM organizations WHERE slug = $1`, [slug])
    : await one<{ id: string }>(
        ctx.db,
        `SELECT coalesce((SELECT org_id FROM org_memberships WHERE user_id = $1), (SELECT org_id FROM users WHERE id = $1)) AS id`,
        [actor.userId],
      );
  if (!org?.id) throw forbidden('Unauthorized for this organization');
  const candidates = await ctx.db.query<{ id: string }>(
    `SELECT id FROM workspaces WHERE org_id = $1 ORDER BY created_at NULLS LAST, id`,
    [org.id],
  );
  for (const c of candidates) {
    const access = await resolveWorkspaceAccess(ctx.db, actor, c.id);
    if (access !== 'not_found' && access.permissions.has('data.read') && !access.viaPlatformAdmin) return c.id;
  }
  if (actor.isPlatformAdmin && candidates[0]) return candidates[0].id;
  throw forbidden('Unauthorized for this organization');
}

async function getWorkspace(ctx: Ctx) {
  const wsId = await pickWorkspace(ctx);
  const access = await requireWorkspace(ctx, wsId, 'data.read');
  const [resources, projects, allocations, ws] = await Promise.all([
    ctx.db.query(`SELECT * FROM resources WHERE workspace_id = $1 ORDER BY name, id`, [wsId]),
    ctx.db.query(
      `SELECT *, start_date::text AS sd, end_date::text AS ed, initiated_on::text AS io FROM projects WHERE workspace_id = $1 ORDER BY name, id`,
      [wsId],
    ),
    ctx.db.query(
      `SELECT *, start_date::text AS sd, end_date::text AS ed FROM allocations WHERE workspace_id = $1 AND state <> 'declined' ORDER BY id`,
      [wsId],
    ),
    one(ctx.db, `SELECT w.name, o.name AS org_name, o.logo_url, o.primary_color FROM workspaces w JOIN organizations o ON o.id = w.org_id WHERE w.id = $1`, [wsId]),
  ]);
  const canWrite = access.permissions.has('allocations.write');
  const members = access.permissions.has('workspace.members.manage')
    ? (await loadMembers(ctx.db, access.orgId))
        .filter((m) => m.workspaces.some((w) => w.workspaceId === wsId))
        .map((m) => ({
          id: m.userId,
          email: m.email,
          name: m.name,
          workspace_role: toLegacyWorkspaceRole(m.workspaces.find((w) => w.workspaceId === wsId)?.role ?? 'VIEWER'),
        }))
    : [];
  return {
    resources: resources.map((r) => {
      const cp = json<Record<string, unknown>>(r.craft_profile, {});
      return {
        id: r.id,
        name: r.name,
        role: r.role,
        type: r.type,
        department: r.department,
        teamId: r.team_id,
        totalCapacity: num(r.total_capacity, 100),
        avatarInitials: r.avatar_initials,
        email: r.email,
        location: r.location,
        dailyRate: numOrNull(r.daily_rate_eur) ?? undefined,
        skills: r.skills || [],
        primaryCraft: cp.primaryCraft || undefined,
        secondaryCrafts: Array.isArray(cp.secondaryCrafts) ? cp.secondaryCrafts : [],
        tribeAffinity: Array.isArray(cp.tribeAffinity) ? cp.tribeAffinity : [],
        targetUtil: cp.targetUtil ? Number(cp.targetUtil) : undefined,
      };
    }),
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      priority: p.priority,
      description: p.description || '',
      startDate: p.sd,
      endDate: p.ed,
      clientName: p.client_name,
      budget: numOrNull(p.budget) ?? undefined,
      color: p.color,
      stage: p.stage || undefined,
      initiatedOn: p.io || undefined,
      craftDemand: Array.isArray(json(p.craft_demand, [])) ? json(p.craft_demand, []) : [],
      jiraKey: p.jira_key || undefined,
      planviewId: p.planview_id || undefined,
    })),
    allocations: allocations.map((a) => ({
      id: a.id,
      resourceId: a.resource_id,
      projectId: a.project_id,
      percentage: num(a.percentage, 0),
      startDate: a.sd,
      endDate: a.ed,
      craftId: a.craft_id || undefined,
      source: a.source || undefined,
    })),
    orgName: ws?.org_name,
    workspaceName: ws?.name,
    logoUrl: ws?.logo_url,
    primaryColor: ws?.primary_color,
    workspaceRole: access.role ? toLegacyWorkspaceRole(access.role) : 'USER',
    canWrite,
    members,
  };
}

export const handler = withApi({ fn: 'workspace' }, async (ctx) => {
  if (ctx.method === 'GET') return getWorkspace(ctx);
  // PL-03#AC1 / A-8: the v1.1 full delete-and-reinsert save is retired.
  if (ctx.method === 'POST') throw gone(GONE_MESSAGE);
  throw notFound('Not found');
});
