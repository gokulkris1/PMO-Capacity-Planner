/**
 * Invitations replace temporary passwords and role overwrites (AC-05, SEC-02, SEC-21).
 * POST|GET /orgs/:orgId/invitations · DELETE /orgs/:orgId/invitations/:id
 * GET /invitations/:token · POST /invitations/:token/accept (no session needed)
 * Tokens are 32 random bytes, stored as sha256, valid 7 days, single use. No API path can grant platform admin.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { InvitationLookup, InvitationResponse } from '../../../../shared/contracts/api';
import type { OrgRole, WorkspaceRole } from '../../../../shared/contracts/dto';
import type { Ctx } from '../api';
import { auditCtx, noContent, parseWith, reply, requireActor } from '../api';
import { audit } from '../audit';
import { loadUser, loadUserByEmail, normaliseEmail, type UserRow } from '../auth';
import { requireOrg } from '../authz';
import { randomToken, sha256Hex } from '../crypto';
import type { Queryable } from '../db';
import { iso, json, one, withTx } from '../db';
import { appBaseUrl } from '../env';
import { badRequest, conflict, forbidden, gone, notFound, unauthorized } from '../errors';
import { invitationEmail, sendEmail } from '../email';
import { assertNewPassword, hashPassword, verifyPassword } from '../passwords';
import { FIFTEEN_MIN, rateLimit } from '../rateLimit';
import { issueSession, sessionUserPayload } from '../session';
import type { Params } from '../router';
import { setOrgRole, upsertWorkspaceRole } from './members';

const INVITE_DAYS = 7;
export const INVITE_EXPIRED = 'This invitation link has expired or was already used. Ask your admin for a new one.';

const inviteSchema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  orgRole: z.enum(['ORG_ADMIN', 'MEMBER']),
  workspaces: z
    .array(
      z.object({
        workspaceId: z.string().uuid(),
        role: z.enum(['WORKSPACE_ADMIN', 'PLANNER', 'CONTRIBUTOR', 'VIEWER']),
      }),
    )
    .max(100)
    .default([]),
});

type InviteWs = Array<{ workspaceId: string; role: WorkspaceRole }>;

async function orgUserOf(q: Queryable, userId: string): Promise<string | null> {
  const r = await one<{ org_id: string | null }>(
    q,
    `SELECT coalesce((SELECT org_id FROM org_memberships WHERE user_id = $1), (SELECT org_id FROM users WHERE id = $1)) AS org_id`,
    [userId],
  );
  return r?.org_id ? String(r.org_id) : null;
}

export async function createInvitation(ctx: Ctx, p: Params) {
  const raw = (ctx.body ?? {}) as Record<string, unknown>;
  if (/SUPERUSER|"isPlatformAdmin"/.test(JSON.stringify(raw))) {
    throw badRequest('Platform admin cannot be granted here.', { role: 'Not allowed' });
  }
  if (raw.orgId !== undefined && raw.orgId !== p.orgId) throw forbidden('Organisation mismatch.');
  const access = await requireOrg(ctx, p.orgId, ['org.members.manage', 'workspace.members.manage']);
  const body = parseWith(inviteSchema, ctx.body);
  const actor = requireActor(ctx);
  const isOrgAdmin = access.permissions.has('org.members.manage');
  if (!isOrgAdmin) {
    if (body.orgRole !== 'MEMBER') throw forbidden('You need the Org Admin role to invite Org Admins.');
    if (!body.workspaces.length) throw forbidden('Choose at least one workspace you administer.');
    for (const w of body.workspaces) {
      if (!access.adminWorkspaceIds.includes(w.workspaceId))
        throw forbidden('You need the PMO Admin role in that workspace.');
    }
  }
  const email = normaliseEmail(body.email);
  const token = randomToken(32);
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 86400_000).toISOString();
  const orgName = String(access.org.name ?? '');
  await withTx(async (q) => {
    for (const w of body.workspaces) {
      if (!(await one(q, `SELECT 1 AS x FROM workspaces WHERE id = $1 AND org_id = $2`, [w.workspaceId, p.orgId]))) {
        throw badRequest('Workspace is not in this organisation.', { workspaces: 'Unknown workspace' });
      }
    }
    const existing = await loadUserByEmail(q, email);
    let acceptedNow = false;
    if (existing) {
      const userOrg = await orgUserOf(q, existing.id);
      if (userOrg && userOrg !== p.orgId) throw conflict('This person belongs to another organisation.');
      if (userOrg === p.orgId) {
        // AC-05#AC5: same org -> only workspace memberships change; users.role/org_id/password untouched.
        for (const w of body.workspaces)
          await upsertWorkspaceRole(q, existing.id, w.workspaceId, p.orgId, w.role, actor.userId);
        acceptedNow = true;
      }
    }
    await q.query(
      `INSERT INTO invitations (id, org_id, email, org_role, workspaces, token_hash, invited_by, expires_at, accepted_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)`,
      [
        id,
        p.orgId,
        email,
        body.orgRole,
        JSON.stringify(body.workspaces),
        sha256Hex(token),
        actor.userId,
        expiresAt,
        acceptedNow ? new Date().toISOString() : null,
      ],
    );
    await audit(q, auditCtx(ctx), {
      action: 'member.invite',
      orgId: p.orgId,
      targetType: 'invitation',
      targetId: id,
      after: { email, orgRole: body.orgRole, workspaces: body.workspaces, existingMember: acceptedNow },
    });
  });
  const inviteUrl = `${appBaseUrl()}/invite/${token}`;
  await sendEmail(invitationEmail(email, orgName, actor.name, inviteUrl));
  const res: InvitationResponse = { invitation: { id, email, expiresAt }, inviteUrl };
  return reply(201, res);
}

export async function listInvitations(ctx: Ctx, p: Params) {
  const access = await requireOrg(ctx, p.orgId, ['org.members.manage', 'workspace.members.manage']);
  const rows = await ctx.db.query(
    `SELECT i.id, i.email, i.org_role, i.workspaces, i.expires_at, i.created_at, i.invited_by, u.name AS invited_by_name
     FROM invitations i LEFT JOIN users u ON u.id = i.invited_by
     WHERE i.org_id = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL ORDER BY i.created_at DESC`,
    [p.orgId],
  );
  const isOrgAdmin = access.permissions.has('org.members.manage');
  return rows
    .map((r) => ({
      id: String(r.id),
      email: String(r.email),
      orgRole: r.org_role as OrgRole,
      workspaces: json<InviteWs>(r.workspaces, []),
      expiresAt: iso(r.expires_at),
      createdAt: iso(r.created_at),
      expired: new Date(String(iso(r.expires_at))).getTime() < Date.now(),
      invitedBy: r.invited_by ? { id: String(r.invited_by), name: String(r.invited_by_name ?? '') } : null,
    }))
    .filter((i) => isOrgAdmin || i.workspaces.some((w) => access.adminWorkspaceIds.includes(w.workspaceId)));
}

export async function revokeInvitation(ctx: Ctx, p: Params) {
  const access = await requireOrg(ctx, p.orgId, ['org.members.manage', 'workspace.members.manage']);
  await withTx(async (q) => {
    const inv = await one(
      q,
      `SELECT id, workspaces FROM invitations WHERE id = $1 AND org_id = $2 AND revoked_at IS NULL`,
      [p.id, p.orgId],
    );
    if (!inv) throw notFound('Invitation not found');
    if (!access.permissions.has('org.members.manage')) {
      const ws = json<InviteWs>(inv.workspaces, []);
      if (!ws.length || !ws.every((w) => access.adminWorkspaceIds.includes(w.workspaceId))) throw forbidden();
    }
    await q.query(`UPDATE invitations SET revoked_at = now() WHERE id = $1`, [p.id]);
    await audit(q, auditCtx(ctx), {
      action: 'member.invite_revoke',
      orgId: p.orgId,
      targetType: 'invitation',
      targetId: p.id,
    });
  });
  return noContent();
}

async function findByToken(q: Queryable, token: string) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw notFound(INVITE_EXPIRED);
  const inv = await one(
    q,
    `SELECT i.*, o.name AS org_name FROM invitations i JOIN organizations o ON o.id = i.org_id WHERE i.token_hash = $1`,
    [sha256Hex(token)],
  );
  if (!inv) throw notFound(INVITE_EXPIRED);
  if (inv.accepted_at || inv.revoked_at || new Date(String(iso(inv.expires_at))).getTime() < Date.now())
    throw gone(INVITE_EXPIRED);
  return inv;
}

export async function lookupInvitation(ctx: Ctx, p: Params): Promise<InvitationLookup> {
  await rateLimit(ctx.db, [{ key: `invite:ip:${ctx.ip ?? 'unknown'}`, max: 60, windowSec: FIFTEEN_MIN }]);
  const inv = await findByToken(ctx.db, p.token);
  const ws = json<InviteWs>(inv.workspaces, []);
  const names = ws.length
    ? await ctx.db.query(`SELECT id, name FROM workspaces WHERE id::text = ANY($1::text[]) AND org_id = $2`, [
        ws.map((w) => w.workspaceId),
        inv.org_id,
      ])
    : [];
  const existing = await loadUserByEmail(ctx.db, String(inv.email));
  return {
    email: String(inv.email),
    orgName: String(inv.org_name),
    workspaces: ws
      .map((w) => ({
        id: w.workspaceId,
        name: String(names.find((n) => String(n.id) === w.workspaceId)?.name ?? ''),
        role: w.role,
      }))
      .filter((w) => w.name),
    expiresAt: iso(inv.expires_at) ?? '',
    existingUser: !!existing,
  };
}

export async function acceptInvitation(ctx: Ctx, p: Params) {
  await rateLimit(ctx.db, [
    { key: `invite-accept:token:${sha256Hex(p.token).slice(0, 16)}`, max: 5, windowSec: FIFTEEN_MIN },
    { key: `invite-accept:ip:${ctx.ip ?? 'unknown'}`, max: 20, windowSec: FIFTEEN_MIN },
  ]);
  const body = parseWith(
    z.object({ name: z.string().trim().max(120).optional(), password: z.string().max(200).optional() }),
    ctx.body ?? {},
  );
  const user = await withTx(async (q): Promise<UserRow> => {
    const inv = await findByToken(q, p.token);
    const email = String(inv.email);
    const orgId = String(inv.org_id);
    const orgRole = inv.org_role === 'ORG_ADMIN' ? 'ORG_ADMIN' : 'MEMBER';
    const existing = await loadUserByEmail(q, email);
    let userId: string;
    if (existing) {
      const signedInAsInvitee = ctx.actor?.email === email;
      if (!signedInAsInvitee && !(await verifyPassword(body.password, existing.password_hash))) {
        throw unauthorized('Sign in with your existing password to accept.');
      }
      if (!existing.email_verified_at) throw forbidden('Verify your email first');
      const userOrg = await orgUserOf(q, existing.id);
      if (userOrg && userOrg !== orgId) throw conflict('This person belongs to another organisation.');
      userId = existing.id;
      if (!userOrg) await setOrgRole(q, userId, orgId, orgRole);
    } else {
      const password = assertNewPassword(body.password);
      const hash = await hashPassword(password);
      const rows = await q.query<{ id: string }>(
        `INSERT INTO users (email, password_hash, name, role, plan, org_id, email_verified_at)
         VALUES ($1, $2, $3, $4, 'BASIC', $5, now()) RETURNING id`,
        [email, hash, body.name || email.split('@')[0], orgRole === 'ORG_ADMIN' ? 'ORG_ADMIN' : 'USER', orgId],
      );
      userId = rows[0].id;
      await q.query(`INSERT INTO org_memberships (org_id, user_id, role) VALUES ($1, $2, $3)`, [
        orgId,
        userId,
        orgRole,
      ]);
    }
    for (const w of json<InviteWs>(inv.workspaces, [])) {
      if (await one(q, `SELECT 1 AS x FROM workspaces WHERE id = $1 AND org_id = $2`, [w.workspaceId, orgId])) {
        await upsertWorkspaceRole(q, userId, w.workspaceId, orgId, w.role, String(inv.invited_by ?? userId));
      }
    }
    await q.query(`UPDATE invitations SET accepted_at = now() WHERE id = $1`, [inv.id]);
    await q.query(`UPDATE users SET last_sign_in_at = now() WHERE id = $1`, [userId]);
    await audit(
      q,
      { ...auditCtx(ctx), actorUserId: userId },
      {
        action: 'member.invite_accept',
        orgId,
        targetType: 'invitation',
        targetId: String(inv.id),
      },
    );
    const u = await loadUser(q, userId);
    if (!u) throw notFound(INVITE_EXPIRED);
    return u;
  });
  issueSession(ctx, user);
  return { user: await sessionUserPayload(ctx.db, user) };
}
