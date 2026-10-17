/**
 * Legacy GET /api/my_workspaces (AC-02#AC7): same response shape as v1.1, computed by the shared authorisation
 * library from the database (never from token claims). The 2.0 client uses /api/v2/me instead.
 */
import { requireActor, withApi } from './_lib/api';
import { notFound } from './_lib/errors';
import { getMe } from './_lib/handlers/me';
import { toLegacyWorkspaceRole } from '../../shared/permissions';

export const handler = withApi({ fn: 'my_workspaces' }, async (ctx) => {
  if (ctx.method !== 'GET') throw notFound('Not found');
  const actor = requireActor(ctx);
  if (actor.isPlatformAdmin) {
    const rows = await ctx.db.query(
      `SELECT w.id, w.name, o.id AS org_id, o.name AS org_name, o.slug AS org_slug, 'PMO_ADMIN' AS role
       FROM workspaces w JOIN organizations o ON o.id = w.org_id ORDER BY o.name, w.name`,
    );
    return { workspaces: rows };
  }
  const me = await getMe(ctx);
  if (!me.org) return { workspaces: [] };
  const org = me.org;
  return {
    workspaces: me.workspaces.map((w) => ({
      id: w.id,
      name: w.name,
      org_id: org.id,
      org_name: org.name,
      org_slug: org.slug,
      role: toLegacyWorkspaceRole(w.role),
    })),
  };
});
