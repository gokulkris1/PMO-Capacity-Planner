/**
 * GET /api/v2/platform/overview — platform cockpit counts (platform admins only, from users.is_platform_admin in
 * the database). "Active sessions" counts users who signed in within the session lifetime (7 days): sessions are
 * stateless JWTs, so this is the best available measure. Audited as support.access.
 */
import type { Ctx } from '../api';
import { auditCtx, requireActor } from '../api';
import { auditBestEffort } from '../audit';
import { iso, num, one } from '../db';
import { forbidden } from '../errors';
import { SESSION_MAX_AGE_SEC } from '../http';

export interface PlatformOverview {
  orgs: number;
  workspaces: number;
  users: number;
  platformAdmins: number;
  activeSessions: number;
  signInsLast24h: number;
  unverifiedUsers: number;
  syncHealth: {
    queued: number;
    running: number;
    stuck: number;
    succeeded24h: number;
    failed24h: number;
    partial24h: number;
    lastFailureAt: string | null;
    workspacesWithJira: number;
  };
  generatedAt: string;
}

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
    generatedAt: new Date().toISOString(),
  };
}
