/**
 * Member management, tenant-scoped (AC-06, ST-02).
 * GET /orgs/:orgId/members · PATCH|DELETE /orgs/:orgId/members/:userId
 * GET /workspaces/:wsId/members · PATCH|DELETE /workspaces/:wsId/members/:userId
 * Writes dual-write the v1.1 columns (users.role for ORG_ADMIN, workspace_members.role) for rollback (AC-01#AC5).
 */
import { z } from 'zod';
import type { MemberDTO } from '../../../../shared/contracts/api';
import type { OrgRole, WorkspaceRole } from '../../../../shared/contracts/dto';
import { WORKSPACE_ROLE_RANK, toLegacyWorkspaceRole } from '../../../../shared/permissions';
import type { Ctx } from '../api';
import { auditCtx, noContent, parseWith, requireActor } from '../api';
import { audit } from '../audit';
import { effectiveWorkspaceRole, requireOrg, requireWorkspace } from '../authz';
import type { Queryable } from '../db';
import { iso, one, withTx } from '../db';
import { badRequest, conflict, forbidden, notFound } from '../errors';
import { bestEffort } from '../entity';
import type { Params } from '../router';

const ORG_MEMBERS_SQL = `
  SELECT u.id, u.name, u.email, u.last_sign_in_at,
         coalesce(om.role, CASE WHEN u.role IN ('ORG_ADMIN', 'ADMIN', 'SUPERUSER') THEN 'ORG_ADMIN' ELSE 'MEMBER' END) AS org_role
  FROM users u
  LEFT JOIN org_memberships om ON om.user_id = u.id AND om.org_id = $1
  WHERE (om.org_id = $1
     OR (om.user_id IS NULL AND u.org_id = $1 AND NOT EXISTS (SELECT 1 FROM org_memberships x WHERE x.user_id = u.id)))`;

export async function loadMembers(q: Queryable, orgId: string, userId?: string): Promise<MemberDTO[]> {
  const users = await q.query(
    `${ORG_MEMBERS_SQL} ${userId ? 'AND u.id = $2' : ''} ORDER BY lower(coalesce(u.name, u.email))`,
    userId ? [orgId, userId] : [orgId],
  );
  if (!users.length) return [];
  const ids = users.map((u) => String(u.id));
  const ws = await q.query(
    `SELECT wm.user_id, wm.workspace_id, wm.access_role, wm.role FROM workspace_members wm
     JOIN workspaces w ON w.id = wm.workspace_id WHERE w.org_id = $1 AND wm.user_id::text = ANY($2::text[])`,
    [orgId, ids],
  );
  const linked = await q.query(
    `SELECT r.linked_user_id, r.id FROM resources r JOIN workspaces w ON w.id = r.workspace_id
     WHERE w.org_id = $1 AND r.linked_user_id::text = ANY($2::text[])`,
    [orgId, ids],
  );
  return users.map((u) => ({
    userId: String(u.id),
    name: String(u.name ?? String(u.email).split('@')[0]),
    email: String(u.email),
    orgRole: (u.org_role === 'ORG_ADMIN' ? 'ORG_ADMIN' : 'MEMBER') as OrgRole,
    workspaces: ws
      .filter((w) => String(w.user_id) === String(u.id))
      .map((w) => ({
        workspaceId: String(w.workspace_id),
        role: effectiveWorkspaceRole(w.access_role, w.role) ?? 'VIEWER',
      })),
    linkedPersonIds: linked.filter((l) => String(l.linked_user_id) === String(u.id)).map((l) => String(l.id)),
    lastSignInAt: iso(u.last_sign_in_at),
  }));
}

export async function listOrgMembers(ctx: Ctx, p: Params): Promise<MemberDTO[]> {
  const access = await requireOrg(ctx, p.orgId, ['org.members.manage', 'workspace.members.manage']);
  const all = await loadMembers(ctx.db, p.orgId);
  if (access.permissions.has('org.members.manage')) return all;
  const allowed = new Set(access.adminWorkspaceIds);
  return all
    .map((m) => ({ ...m, workspaces: m.workspaces.filter((w) => allowed.has(w.workspaceId)) }))
    .filter((m) => m.workspaces.length > 0);
}

function rejectForbiddenKeys(body: unknown) {
  const text = JSON.stringify(body ?? {});
  if (/"plan"\s*:/.test(text)) throw badRequest('Plan is managed by billing.', { plan: 'Plan is managed by billing.' });
  if (/SUPERUSER|"isPlatformAdmin"/.test(text))
    throw badRequest('Platform admin cannot be granted here.', { role: 'Not allowed' });
}

const memberPatchSchema = z.object({
  orgRole: z.enum(['ORG_ADMIN', 'MEMBER']).optional(),
  workspaces: z
    .array(
      z.object({
        workspaceId: z.string().uuid(),
        role: z.enum(['WORKSPACE_ADMIN', 'PLANNER', 'CONTRIBUTOR', 'VIEWER']).nullable(),
      }),
    )
    .max(200)
    .optional(),
});

async function countOrgAdmins(q: Queryable, orgId: string): Promise<number> {
  const r = await one<{ n: number }>(
    q,
    `SELECT count(*)::int AS n FROM org_memberships WHERE org_id = $1 AND role = 'ORG_ADMIN'`,
    [orgId],
  );
  return Number(r?.n ?? 0);
}

export async function upsertWorkspaceRole(
  q: Queryable,
  userId: string,
  wsId: string,
  orgId: string,
  role: WorkspaceRole,
  by: string,
) {
  await q.query(
    `INSERT INTO workspace_members (user_id, workspace_id, org_id, role, access_role, invited_by) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, workspace_id) DO UPDATE SET role = EXCLUDED.role, access_role = EXCLUDED.access_role`,
    [userId, wsId, orgId, toLegacyWorkspaceRole(role), role, by],
  );
}

export async function setOrgRole(q: Queryable, userId: string, orgId: string, role: OrgRole) {
  await q.query(
    `INSERT INTO org_memberships (org_id, user_id, role) VALUES ($1, $2, $3)
     ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
    [orgId, userId, role],
  );
  await q.query(`UPDATE users SET org_id = $2 WHERE id = $1 AND org_id IS DISTINCT FROM $2`, [userId, orgId]);
  if (role === 'ORG_ADMIN') {
    await bestEffort(
      q,
      `UPDATE users SET role = 'ORG_ADMIN' WHERE id = $1 AND role NOT IN ('ORG_ADMIN', 'SUPERUSER')`,
      [userId],
    );
  } else {
    await bestEffort(q, `UPDATE users SET role = 'USER' WHERE id = $1 AND role IN ('ORG_ADMIN', 'ADMIN')`, [userId]);
  }
}

export async function patchOrgMember(ctx: Ctx, p: Params): Promise<MemberDTO> {
  rejectForbiddenKeys(ctx.body);
  const access = await requireOrg(ctx, p.orgId, ['org.members.manage', 'workspace.members.manage']);
  const body = parseWith(memberPatchSchema, ctx.body);
  const actor = requireActor(ctx);
  const isOrgAdmin = access.permissions.has('org.members.manage');
  return withTx(async (q) => {
    const [before] = await loadMembers(q, p.orgId, p.userId);
    if (!before) throw notFound('Member not found');
    if (body.orgRole !== undefined && body.orgRole !== before.orgRole) {
      if (!isOrgAdmin) throw forbidden('You need the Org Admin role to do this.');
      if (before.orgRole === 'ORG_ADMIN' && (await countOrgAdmins(q, p.orgId)) <= 1) {
        throw conflict('An organisation needs at least one Org Admin.');
      }
      await setOrgRole(q, p.userId, p.orgId, body.orgRole);
    }
    for (const w of body.workspaces ?? []) {
      const ws = await one(q, `SELECT id FROM workspaces WHERE id = $1 AND org_id = $2`, [w.workspaceId, p.orgId]);
      if (!ws) throw badRequest('Workspace is not in this organisation.', { workspaces: 'Unknown workspace' });
      if (!isOrgAdmin && !access.adminWorkspaceIds.includes(w.workspaceId)) {
        throw forbidden('You need the PMO Admin role in that workspace.');
      }
      if (w.role === null) {
        await q.query(`DELETE FROM workspace_members WHERE user_id = $1 AND workspace_id = $2`, [
          p.userId,
          w.workspaceId,
        ]);
      } else {
        await upsertWorkspaceRole(q, p.userId, w.workspaceId, p.orgId, w.role, actor.userId);
      }
    }
    const [after] = await loadMembers(q, p.orgId, p.userId);
    await audit(q, auditCtx(ctx), {
      action: 'role.change',
      orgId: p.orgId,
      targetType: 'user',
      targetId: p.userId,
      before,
      after,
    });
    return after;
  });
}

export async function removeOrgMember(ctx: Ctx, p: Params) {
  await requireOrg(ctx, p.orgId, 'org.members.manage');
  await withTx(async (q) => {
    const [before] = await loadMembers(q, p.orgId, p.userId);
    if (!before) throw notFound('Member not found');
    if (before.orgRole === 'ORG_ADMIN' && (await countOrgAdmins(q, p.orgId)) <= 1) {
      throw conflict('An organisation needs at least one Org Admin.');
    }
    await q.query(`DELETE FROM org_memberships WHERE org_id = $1 AND user_id = $2`, [p.orgId, p.userId]);
    await q.query(
      `DELETE FROM workspace_members WHERE user_id = $1 AND workspace_id IN (SELECT id FROM workspaces WHERE org_id = $2)`,
      [p.userId, p.orgId],
    );
    await q.query(
      `UPDATE resources SET linked_user_id = NULL WHERE linked_user_id = $1 AND workspace_id IN (SELECT id FROM workspaces WHERE org_id = $2)`,
      [p.userId, p.orgId],
    );
    await q.query(
      `UPDATE users SET org_id = CASE WHEN org_id = $2 THEN NULL ELSE org_id END, token_version = token_version + 1 WHERE id = $1`,
      [p.userId, p.orgId],
    );
    await bestEffort(
      q,
      `UPDATE users SET role = 'USER' WHERE id = $1 AND role IN ('ORG_ADMIN', 'ADMIN', 'PMO_ADMIN', 'WORKSPACE_OWNER')`,
      [p.userId],
    );
    await audit(q, auditCtx(ctx), {
      action: 'member.remove',
      orgId: p.orgId,
      targetType: 'user',
      targetId: p.userId,
      before,
    });
  });
  return noContent();
}

// ── Workspace-level ────────────────────────────────────────────────────────

export async function listWorkspaceMembers(ctx: Ctx, p: Params): Promise<MemberDTO[]> {
  const access = await requireWorkspace(ctx, p.wsId, 'workspace.members.manage');
  const all = await loadMembers(ctx.db, access.orgId);
  return all
    .map((m) => ({ ...m, workspaces: m.workspaces.filter((w) => w.workspaceId === p.wsId) }))
    .filter((m) => m.workspaces.length > 0 || m.orgRole === 'ORG_ADMIN');
}

export async function patchWorkspaceMember(ctx: Ctx, p: Params): Promise<MemberDTO> {
  rejectForbiddenKeys(ctx.body);
  const access = await requireWorkspace(ctx, p.wsId, 'workspace.members.manage');
  const { role } = parseWith(
    z.object({ role: z.enum(['WORKSPACE_ADMIN', 'PLANNER', 'CONTRIBUTOR', 'VIEWER']) }),
    ctx.body,
  );
  const own = access.role ? WORKSPACE_ROLE_RANK[access.role] : 0;
  if (WORKSPACE_ROLE_RANK[role] > own) throw forbidden('You cannot grant a role above your own.');
  const actor = requireActor(ctx);
  return withTx(async (q) => {
    const [before] = await loadMembers(q, access.orgId, p.userId);
    if (!before) throw notFound('Member not found');
    await upsertWorkspaceRole(q, p.userId, p.wsId, access.orgId, role, actor.userId);
    const [after] = await loadMembers(q, access.orgId, p.userId);
    await audit(q, auditCtx(ctx), {
      action: 'role.change',
      orgId: access.orgId,
      workspaceId: p.wsId,
      targetType: 'user',
      targetId: p.userId,
      before: before.workspaces.find((w) => w.workspaceId === p.wsId) ?? null,
      after: { workspaceId: p.wsId, role },
    });
    return after;
  });
}

export async function removeWorkspaceMember(ctx: Ctx, p: Params) {
  const access = await requireWorkspace(ctx, p.wsId, 'workspace.members.manage');
  await withTx(async (q) => {
    const [before] = await loadMembers(q, access.orgId, p.userId);
    if (!before) throw notFound('Member not found');
    await q.query(`DELETE FROM workspace_members WHERE user_id = $1 AND workspace_id = $2`, [p.userId, p.wsId]);
    await audit(q, auditCtx(ctx), {
      action: 'member.remove',
      orgId: access.orgId,
      workspaceId: p.wsId,
      targetType: 'user',
      targetId: p.userId,
      before: before.workspaces.find((w) => w.workspaceId === p.wsId) ?? null,
    });
  });
  return noContent();
}
