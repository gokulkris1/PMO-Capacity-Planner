/** GET /api/v2/me (AC-04, AC-09, SH-05, PL-07). */
import type { MeResponse, MeWorkspace } from '../../../../shared/contracts/dto';
import { permissionsFor } from '../../../../shared/permissions';
import { entitlementsFor } from '../../../../shared/entitlements';
import type { Ctx } from '../api';
import { requireActor } from '../api';
import { loadUser, toSessionUser } from '../auth';
import { effectiveOrgRole, effectiveWorkspaceRole } from '../authz';
import { one } from '../db';
import { ORG_COLUMNS, featuresOf, planOf, planningOf } from '../dto';
import { appMode } from '../env';
import { unauthorized } from '../errors';

export async function getMe(ctx: Ctx): Promise<MeResponse> {
  const actor = requireActor(ctx);
  const user = await loadUser(ctx.db, actor.userId);
  if (!user) throw unauthorized();
  const org = await one(
    ctx.db,
    `SELECT ${ORG_COLUMNS}, om.role AS org_role FROM organizations o
     LEFT JOIN org_memberships om ON om.org_id = o.id AND om.user_id = $1
     WHERE o.id = coalesce((SELECT m.org_id FROM org_memberships m WHERE m.user_id = $1), $2::uuid)`,
    [actor.userId, user.org_id],
  );
  const mode = appMode();
  if (!org) {
    return {
      user: toSessionUser(user),
      org: null,
      workspaces: [],
      entitlements: entitlementsFor('BASIC', mode),
      appMode: mode,
    };
  }
  const orgId = String(org.id);
  const orgRole = effectiveOrgRole(orgId, org.org_role, user.org_id, user.role) ?? 'MEMBER';
  const rows = await ctx.db.query(
    `SELECT w.id, w.name, wm.access_role, wm.role AS legacy_role,
            (SELECT r.id FROM resources r WHERE r.workspace_id = w.id AND r.linked_user_id = $2 ORDER BY r.id LIMIT 1)
              AS linked_person_id
     FROM workspaces w
     LEFT JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = $2
     WHERE w.org_id = $1
     ORDER BY w.created_at NULLS LAST, w.name, w.id`,
    [orgId, actor.userId],
  );
  const workspaces: MeWorkspace[] = [];
  for (const r of rows) {
    let role = effectiveWorkspaceRole(r.access_role, r.legacy_role);
    let implicit = false;
    if (orgRole === 'ORG_ADMIN' && role !== 'WORKSPACE_ADMIN') {
      implicit = role === null;
      role = 'WORKSPACE_ADMIN';
    } else if (!role && org.default_workspace_visibility !== 'members') {
      role = 'VIEWER';
      implicit = true;
    }
    if (!role) continue;
    workspaces.push({
      id: String(r.id),
      name: String(r.name),
      role,
      implicit,
      permissions: permissionsFor({ isPlatformAdmin: actor.isPlatformAdmin, orgRole, workspaceRole: role }),
      linkedPersonId: r.linked_person_id ? String(r.linked_person_id) : null,
    });
  }
  return {
    user: toSessionUser(user),
    org: {
      id: orgId,
      name: String(org.name),
      slug: String(org.slug ?? ''),
      logoUrl: org.logo_url ? String(org.logo_url) : null,
      role: orgRole,
      plan: planOf(org.plan),
      features: featuresOf(org.features),
      planning: planningOf(org.planning),
    },
    workspaces,
    entitlements: entitlementsFor(planOf(org.plan), mode),
    appMode: mode,
  };
}
