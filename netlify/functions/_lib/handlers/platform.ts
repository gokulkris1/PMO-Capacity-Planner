/**
 * GET /api/v2/platform/overview — platform cockpit counts (platform admins only, from users.is_platform_admin in
 * the database). "Active sessions" counts users who signed in within the session lifetime (7 days): sessions are
 * stateless JWTs, so this is the best available measure. Audited as support.access.
 */
import type { PlatformOverview } from '../../../../shared/contracts/api';
import type { Plan } from '../../../../shared/contracts/dto';
import type { Ctx } from '../api';
import { auditCtx, requireActor } from '../api';
import { auditBestEffort } from '../audit';
import { iso, num, one } from '../db';
import { forbidden } from '../errors';
import { SESSION_MAX_AGE_SEC } from '../http';

export type { PlatformOverview };

export async function platformOverview(ctx: Ctx): Promise<PlatformOverview> {
  const actor = requireActor(ctx);
  if (!actor.isPlatformAdmin) throw forbidden('Forbidden: platform admin access required');
  const c = await one(
    ctx.db,
    `SELECT
       (SELECT count(*) FROM organizations) AS orgs,
       (SELECT count(*) FROM workspaces) AS workspaces,
       (SELECT count(*) FROM users) AS users,
       (SELECT count(*) FROM users WHERE is_platform_admin) AS platform_admins,
       (SELECT count(*) FROM users WHERE last_sign_in_at > now() - make_interval(secs => $1)) AS active_sessions,
       (SELECT count(*) FROM users WHERE last_sign_in_at > now() - interval '24 hours') AS sign_ins_24h,
       (SELECT count(*) FROM users WHERE email_verified_at IS NULL) AS unverified,
       (SELECT count(*) FROM sync_jobs WHERE status = 'queued') AS queued,
       (SELECT count(*) FROM sync_jobs WHERE status = 'running') AS running,
       (SELECT count(*) FROM sync_jobs WHERE status IN ('queued', 'running') AND created_at < now() - interval '2 hours') AS stuck,
       (SELECT count(*) FROM sync_jobs WHERE status = 'succeeded' AND finished_at > now() - interval '24 hours') AS ok24,
       (SELECT count(*) FROM sync_jobs WHERE status = 'failed' AND finished_at > now() - interval '24 hours') AS failed24,
       (SELECT count(*) FROM sync_jobs WHERE status = 'partial' AND finished_at > now() - interval '24 hours') AS partial24,
       (SELECT max(finished_at) FROM sync_jobs WHERE status = 'failed') AS last_failure,
       (SELECT count(*) FROM workspace_integrations WHERE provider = 'jira' AND secret_enc IS NOT NULL) AS jira_ws`,
    [SESSION_MAX_AGE_SEC],
  );
  const orgRows = await ctx.db.query(
    `SELECT o.id, o.name, o.slug, o.plan,
       (SELECT count(*) FROM org_memberships m WHERE m.org_id = o.id) AS members,
       (SELECT count(*) FROM workspaces w WHERE w.org_id = o.id) AS workspaces,
       (SELECT max(e.occurred_at) FROM audit_events e WHERE e.org_id = o.id) AS last_activity
     FROM organizations o ORDER BY o.name LIMIT 500`,
  );
  const eventRows = await ctx.db.query(
    `SELECT e.id::text AS id, e.occurred_at, e.action, coalesce(u.name, u.email, e.actor_type) AS actor, o.name AS org_name
     FROM audit_events e LEFT JOIN users u ON u.id = e.actor_user_id LEFT JOIN organizations o ON o.id = e.org_id
     ORDER BY e.id DESC LIMIT 50`,
  );
  await auditBestEffort(ctx.db, auditCtx(ctx, 'platform_admin'), {
    action: 'support.access',
    targetType: 'platform',
    targetId: 'overview',
  });
  const n = (k: string) => num(c?.[k], 0);
  return {
    orgs: n('orgs'),
    workspaces: n('workspaces'),
    users: n('users'),
    platformAdmins: n('platform_admins'),
    activeSessions: n('active_sessions'),
    signInsLast24h: n('sign_ins_24h'),
    unverifiedUsers: n('unverified'),
    syncHealth: {
      queued: n('queued'),
      running: n('running'),
      stuck: n('stuck'),
      succeeded24h: n('ok24'),
      failed24h: n('failed24'),
      partial24h: n('partial24'),
      lastFailureAt: iso(c?.last_failure),
      workspacesWithJira: n('jira_ws'),
    },
    organisations: orgRows.map((o) => ({
      id: String(o.id),
      name: String(o.name ?? ''),
      slug: String(o.slug ?? ''),
      plan: (['BASIC', 'PRO', 'MAX', 'ENTERPRISE'].includes(String(o.plan)) ? String(o.plan) : 'BASIC') as Plan,
      members: num(o.members, 0),
      workspaces: num(o.workspaces, 0),
      lastActivityAt: iso(o.last_activity),
    })),
    events: eventRows.map((e) => ({
      id: String(e.id),
      at: iso(e.occurred_at) ?? new Date(0).toISOString(),
      actor: String(e.actor ?? 'System'),
      action: String(e.action ?? ''),
      org: e.org_name == null ? null : String(e.org_name),
    })),
    generatedAt: new Date().toISOString(),
  };
}
