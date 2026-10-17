/**
 * Legacy GET /api/audit — the platform-wide audit view (AC-10 technical note): platform admins only, now reading
 * `audit_events` (v1.1 LOGIN rows were copied there by migration 0003). Org admins use /api/v2/orgs/:orgId/audit.
 */
import { requireActor, withApi } from './_lib/api';
import { forbidden, notFound } from './_lib/errors';

export const handler = withApi({ fn: 'audit' }, async (ctx) => {
  if (ctx.method !== 'GET') throw notFound('Not found');
  if (!requireActor(ctx).isPlatformAdmin) throw forbidden('Forbidden: platform admin access required');
  const logs = await ctx.db.query(
    `SELECT e.id::text AS id, e.action, e.after AS details, e.ip AS ip_address, e.occurred_at AS created_at,
            e.org_id, e.workspace_id, u.email AS user_email, u.name AS user_name
     FROM audit_events e LEFT JOIN users u ON u.id = e.actor_user_id
     ORDER BY e.id DESC LIMIT 200`,
  );
  return { logs };
});
