/**
 * /api/auth/* — sign-in, sessions, password reset, 2FA, registration (AC-03, HS-05, HS-13, HS-14, AC-07).
 *
 * Compatibility (production constraint "same logins"): the v1.1 request shapes are kept. `POST /login` returns
 * `{ user }` with the v1.1 user fields and sets the session cookies; the session token is never in a response body
 * (AC-03#AC1, QA-001). v1.1 tokens (no `tv`) already held by a browser are accepted and can be exchanged for a cookie
 * session at `POST /session`. Legacy admin routes that allowed
 * privilege escalation answer 410 (SEC-02/03).
 */
import { z } from 'zod';
import type { Ctx } from './_lib/api';
import { assertCsrf, auditCtx, noContent, parseWith, reply, requireActor, withApi } from './_lib/api';
import { audit, auditBestEffort } from './_lib/audit';
import {
  loadUser,
  loadUserByEmail,
  normaliseEmail,
  revokeLegacyToken,
  revokeSession,
  tokenFrom,
  verifyToken,
  type UserRow,
} from './_lib/auth';
import { getDb, withTx } from './_lib/db';
import { publicSignupAllowed } from './_lib/env';
import { GONE_MESSAGE, badRequest, forbidden, gone, notConfigured, notFound, unauthorized } from './_lib/errors';
import { clearSessionCookies } from './_lib/http';
import { EMAIL_NOT_SET_UP, createOtp, deliverOtp, otpDeliverable, verifyOtp } from './_lib/otp';
import { assertNewPassword, hashPassword, verifyPassword } from './_lib/passwords';
import { FIFTEEN_MIN, rateLimit, releaseRateLimit } from './_lib/rateLimit';
import { issueSession, sessionUserPayload } from './_lib/session';
import { registrationNoticeEmail, sendEmail } from './_lib/email';

const INVALID = 'Invalid email or password';

const loginSchema = z.object({
  email: z.string().trim().min(1, 'Email is required'),
  password: z.string().min(1, 'Password is required'),
  otp: z.string().trim().optional(),
});

async function login(ctx: Ctx) {
  const body = parseWith(loginSchema, ctx.body, 'Email and password are required');
  const email = normaliseEmail(body.email);
  const loginLimits = [
    { key: `login:email:${email}`, max: 10, windowSec: FIFTEEN_MIN },
    { key: `login:ip:${ctx.ip ?? 'unknown'}`, max: 30, windowSec: FIFTEEN_MIN },
  ];
  await rateLimit(ctx.db, loginLimits);
  const user = await loadUserByEmail(ctx.db, email);
  const ok = await verifyPassword(body.password, user?.password_hash);
  if (!user || !ok) {
    await auditBestEffort(getDb(), auditCtx(ctx), {
      action: 'auth.login_failed',
      orgId: user?.org_id ?? null,
      targetType: 'user',
      targetId: user?.id ?? null,
    });
    throw unauthorized(INVALID);
  }
  if (user.two_factor_enabled) {
    if (!body.otp) {
      // Say so now rather than asking for a code that can never arrive.
      if (!otpDeliverable()) throw notConfigured(EMAIL_NOT_SET_UP, '2FA code not sent: no email provider configured');
      const otp = await createOtp(ctx.db, email, '2fa');
      await deliverOtp(email, otp, '2fa');
      // The password was right; wrong codes are capped by the code's own attempt limit.
      await releaseRateLimit(ctx.db, loginLimits);
      return { require2FA: true, email: user.email };
    }
    try {
      await verifyOtp(ctx.db, email, body.otp, '2fa');
    } catch (e) {
      await auditBestEffort(getDb(), auditCtx(ctx), {
        action: 'auth.login_failed',
        orgId: user.org_id,
        targetType: 'user',
        targetId: user.id,
        after: { reason: '2fa' },
      });
      throw e;
    }
  }
  await withTx(async (q) => {
    await q.query('UPDATE users SET last_sign_in_at = now() WHERE id = $1', [user.id]);
    await audit(
      q,
      { ...auditCtx(ctx), actorUserId: user.id },
      { action: 'auth.login', orgId: user.org_id, targetType: 'user', targetId: user.id },
    );
  });
  // Only failed attempts use up the sign-in allowance.
  await releaseRateLimit(ctx.db, loginLimits);
  // AC-03#AC1 (QA-001): the session lives only in the HttpOnly cookie; the body never carries the JWT.
  issueSession(ctx, user);
  return { user: await sessionUserPayload(ctx.db, user) };
}

const registerSchema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string(),
  name: z.string().trim().max(120).optional(),
});

async function register(ctx: Ctx) {
  if (!publicSignupAllowed()) throw forbidden('Sign-up is by invitation only.');
  // An account that can never receive its verification code would be stuck: refuse before creating it.
  if (!otpDeliverable()) throw notConfigured(EMAIL_NOT_SET_UP, 'Registration refused: no email provider configured');
  const body = parseWith(registerSchema, ctx.body);
  assertNewPassword(body.password);
  const email = normaliseEmail(body.email);
  await rateLimit(ctx.db, [
    { key: `register:email:${email}`, max: 5, windowSec: FIFTEEN_MIN },
    { key: `register:ip:${ctx.ip ?? 'unknown'}`, max: 20, windowSec: FIFTEEN_MIN },
  ]);
  const existing = await loadUserByEmail(ctx.db, email);
  if (existing) {
    // HS-13#AC3: identical response; the owner is told by email.
    await sendEmail(registrationNoticeEmail(email));
    return reply(201, { emailVerificationRequired: true });
  }
  const hash = await hashPassword(body.password);
  await withTx(async (q) => {
    const rows = await q.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, name, role, plan, org_id, email_verified_at)
       VALUES ($1, $2, $3, 'USER', 'BASIC', NULL, NULL) ON CONFLICT (email) DO NOTHING RETURNING id`,
      [email, hash, body.name || email.split('@')[0]],
    );
    if (rows[0]) {
      await audit(
        q,
        { ...auditCtx(ctx), actorUserId: rows[0].id },
        { action: 'auth.register', targetType: 'user', targetId: rows[0].id },
      );
    }
  });
  try {
    const otp = await createOtp(ctx.db, email, 'verify');
    await deliverOtp(email, otp, 'verify');
  } catch {
    // a verification code can be requested again from the verify page
  }
  return reply(201, { emailVerificationRequired: true });
}

async function sessionExchange(ctx: Ctx) {
  const actor = requireActor(ctx);
  const user = await loadUser(ctx.db, actor.userId);
  if (!user) throw unauthorized();
  if (actor.authMethod === 'bearer') {
    const found = tokenFrom({ headers: ctx.headers, cookies: ctx.cookies });
    const claims = found ? verifyToken(found.token) : null;
    if (found && claims && !claims.jti) await revokeLegacyToken(ctx.db, found.token, claims, user.id);
  }
  issueSession(ctx, user);
  return { user: await sessionUserPayload(ctx.db, user) };
}

async function refresh(ctx: Ctx) {
  if (!ctx.actor) {
    ctx.setCookies.push(...clearSessionCookies());
    throw unauthorized('Your session has ended. Sign in again.');
  }
  const user = await loadUser(ctx.db, ctx.actor.userId);
  if (!user) {
    ctx.setCookies.push(...clearSessionCookies());
    throw unauthorized();
  }
  const token = issueSession(ctx, user);
  // v1.1 clients (bearer) read `token` from the refresh response; cookie clients do not need it.
  return ctx.actor.authMethod === 'bearer' ? { ok: true, token } : { ok: true };
}

async function logout(ctx: Ctx, everywhere = false) {
  // POST /logout-all must revoke: it needs a valid session (401 otherwise) rather than silently clearing cookies.
  if (everywhere) requireActor(ctx);
  const all = everywhere || !!(ctx.body as { allDevices?: unknown })?.allDevices || ctx.query.all === 'true';
  if (all && ctx.actor) {
    const actor = ctx.actor;
    await withTx(async (q) => {
      await q.query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [actor.userId]);
      await audit(q, auditCtx(ctx), { action: 'auth.logout_all', targetType: 'user', targetId: actor.userId });
    });
  } else {
    // QA-019: plain sign-out revokes this session on the server, so a copied cookie stops working too.
    const found = tokenFrom({ headers: ctx.headers, cookies: ctx.cookies });
    const claims = found ? verifyToken(found.token) : null;
    if (claims?.jti) await revokeSession(ctx.db, claims, ctx.actor?.userId ?? null);
  }
  ctx.setCookies.push(...clearSessionCookies());
  return noContent();
}

async function resetSend(ctx: Ctx) {
  const email = normaliseEmail(String((ctx.body as { email?: unknown })?.email ?? ''));
  if (!email) throw badRequest('Email required', { email: 'Email required' });
  // The same answer for every address, so it reveals nothing about accounts (SEC-01).
  if (!otpDeliverable()) throw notConfigured(EMAIL_NOT_SET_UP, 'Reset code not sent: no email provider configured');
  await rateLimit(ctx.db, [
    { key: `reset:email:${email}`, max: 5, windowSec: FIFTEEN_MIN },
    { key: `reset:ip:${ctx.ip ?? 'unknown'}`, max: 20, windowSec: FIFTEEN_MIN },
  ]);
  const user = await loadUserByEmail(ctx.db, email);
  if (user) {
    try {
      const otp = await createOtp(ctx.db, email, 'reset');
      await deliverOtp(email, otp, 'reset');
    } catch {
      // throttled or mail failure: same response either way (no enumeration, SEC-01)
    }
  }
  return { sent: true };
}

async function resetConfirm(ctx: Ctx) {
  const b = (ctx.body ?? {}) as { email?: unknown; otp?: unknown; newPassword?: unknown };
  const email = normaliseEmail(String(b.email ?? ''));
  if (!email || !b.otp || !b.newPassword) throw badRequest('All fields required');
  await rateLimit(ctx.db, [
    { key: `reset:email:${email}`, max: 5, windowSec: FIFTEEN_MIN },
    { key: `reset:ip:${ctx.ip ?? 'unknown'}`, max: 20, windowSec: FIFTEEN_MIN },
  ]);
  const password = assertNewPassword(b.newPassword, 'newPassword');
  await verifyOtp(ctx.db, email, String(b.otp), 'reset');
  const user = await loadUserByEmail(ctx.db, email);
  if (!user) throw badRequest('No code found. Request a new one.');
  const hash = await hashPassword(password);
  await withTx(async (q) => {
    await q.query(
      `UPDATE users SET password_hash = $2, password_changed_at = now(), token_version = token_version + 1 WHERE id = $1`,
      [user.id, hash],
    );
    await audit(
      q,
      { ...auditCtx(ctx), actorUserId: user.id },
      {
        action: 'auth.password_reset',
        orgId: user.org_id,
        targetType: 'user',
        targetId: user.id,
      },
    );
  });
  return { success: true };
}

async function twoFactor(ctx: Ctx, legacyToggle: boolean) {
  const actor = requireActor(ctx);
  const user = await loadUserByEmail(ctx.db, actor.email);
  if (!user) throw unauthorized();
  const b = (ctx.body ?? {}) as { enabled?: unknown; password?: unknown };
  const enabled = legacyToggle ? !user.two_factor_enabled : b.enabled === true;
  if (!legacyToggle && typeof b.enabled !== 'boolean')
    throw badRequest('enabled must be true or false', { enabled: 'Required' });
  // Turning it on without a way to deliver codes would lock the user out at their next sign-in.
  if (enabled && !user.two_factor_enabled && !otpDeliverable())
    throw notConfigured(
      'Two-step verification needs email, which is not set up on this site yet. Contact your administrator.',
      '2FA not enabled: no email provider configured',
    );
  if (!enabled && user.two_factor_enabled) {
    // HS-14: switching 2FA off needs the password.
    if (typeof b.password !== 'string' || !b.password) {
      throw badRequest('Enter your password to turn off two-step verification.', { password: 'Required' });
    }
    if (!(await verifyPassword(b.password, user.password_hash))) throw unauthorized('Incorrect password.');
  }
  await withTx(async (q) => {
    await q.query('UPDATE users SET two_factor_enabled = $2 WHERE id = $1', [actor.userId, enabled]);
    await audit(q, auditCtx(ctx), {
      action: 'auth.2fa_change',
      orgId: user.org_id,
      targetType: 'user',
      targetId: actor.userId,
      before: { enabled: !!user.two_factor_enabled },
      after: { enabled },
    });
  });
  return legacyToggle ? { two_factor_enabled: enabled } : { twoFactorEnabled: enabled };
}

async function changePassword(ctx: Ctx) {
  const actor = requireActor(ctx);
  const b = (ctx.body ?? {}) as { currentPassword?: unknown; newPassword?: unknown };
  const user = await loadUserByEmail(ctx.db, actor.email);
  if (!user) throw unauthorized();
  if (!(await verifyPassword(b.currentPassword, user.password_hash))) {
    throw unauthorized('Your current password is incorrect.');
  }
  const password = assertNewPassword(b.newPassword, 'newPassword');
  const hash = await hashPassword(password);
  const updated = await withTx(async (q) => {
    const rows = await q.query<UserRow & Record<string, unknown>>(
      `UPDATE users SET password_hash = $2, password_changed_at = now(), token_version = token_version + 1 WHERE id = $1
       RETURNING id, email, name, role, plan, org_id, is_platform_admin, token_version, email_verified_at, two_factor_enabled`,
      [actor.userId, hash],
    );
    await audit(q, auditCtx(ctx), {
      action: 'auth.password_change',
      orgId: user.org_id,
      targetType: 'user',
      targetId: actor.userId,
    });
    return rows[0];
  });
  // Other sessions end (token_version bumped); this one continues with a fresh token.
  const token = issueSession(ctx, updated);
  return ctx.actor?.authMethod === 'bearer' ? { success: true, token } : { success: true };
}

// ── Legacy admin routes (v1.1 SettingsHub / SuperAdminPanel) ────────────────

async function listUsers(ctx: Ctx) {
  const actor = requireActor(ctx);
  if (actor.isPlatformAdmin) {
    const users = await ctx.db.query(
      `SELECT u.id, u.email, u.name, u.role, u.plan, u.created_at, u.org_id, o.slug AS org_slug, o.name AS org_name
       FROM users u LEFT JOIN organizations o ON u.org_id = o.id ORDER BY u.created_at DESC LIMIT 1000`,
    );
    return { users };
  }
  const m = await ctx.db.query<{ org_id: string; role: string }>(
    `SELECT org_id, role FROM org_memberships WHERE user_id = $1`,
    [actor.userId],
  );
  if (!m[0] || m[0].role !== 'ORG_ADMIN') throw forbidden();
  const users = await ctx.db.query(
    `SELECT u.id, u.email, u.name, u.role, u.plan, u.created_at, o.slug AS org_slug
     FROM org_memberships om JOIN users u ON u.id = om.user_id JOIN organizations o ON o.id = om.org_id
     WHERE om.org_id = $1 ORDER BY u.created_at DESC`,
    [m[0].org_id],
  );
  return { users };
}

async function adminStats(ctx: Ctx) {
  const actor = requireActor(ctx);
  if (!actor.isPlatformAdmin) throw forbidden();
  const [stats] = await ctx.db.query<Record<string, number>>(
    `SELECT count(*)::int AS total_users,
            count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS new_this_week,
            count(*) FILTER (WHERE is_platform_admin)::int AS platform_admins
     FROM users`,
  );
  const [orgs] = await ctx.db.query<Record<string, number>>(
    `SELECT count(*)::int AS total_orgs,
            count(*) FILTER (WHERE plan = 'BASIC')::int AS basic_orgs,
            count(*) FILTER (WHERE plan = 'PRO')::int AS pro_orgs,
            count(*) FILTER (WHERE plan = 'MAX')::int AS max_orgs
     FROM organizations`,
  );
  const [ws] = await ctx.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM workspaces`);
  return { stats: { ...stats, ...orgs, total_workspaces: ws.n } };
}

async function adminDeleteUser(ctx: Ctx, userId: string) {
  const actor = requireActor(ctx);
  if (!actor.isPlatformAdmin) throw forbidden();
  if (userId === actor.userId) throw badRequest('You cannot delete your own account.');
  const target = await loadUser(ctx.db, userId);
  if (!target) throw notFound('User not found');
  await withTx(async (q) => {
    await q.query('DELETE FROM workspace_members WHERE user_id = $1', [userId]);
    await q.query('DELETE FROM org_memberships WHERE user_id = $1', [userId]);
    await q.query('UPDATE resources SET linked_user_id = NULL WHERE linked_user_id = $1', [userId]);
    await q.query('DELETE FROM users WHERE id = $1', [userId]);
    await audit(q, auditCtx(ctx, 'platform_admin'), {
      action: 'platform.user_delete',
      orgId: target.org_id,
      targetType: 'user',
      targetId: userId,
      before: { email: target.email, role: target.role },
    });
  });
  return { success: true };
}

// Sign-in style routes are not session-authenticated, so CSRF is enforced per route (see assertCsrf below).
export const handler = withApi({ fn: 'auth', auth: 'optional', csrf: false }, async (ctx) => {
  const p = ctx.subpath;
  const m = ctx.method;
  if (['/2fa', '/2fa/toggle', '/password'].includes(p) || p.startsWith('/admin/')) assertCsrf(ctx);
  if (p === '/logout' && (ctx.query.all === 'true' || (ctx.body as { allDevices?: unknown })?.allDevices))
    assertCsrf(ctx);
  if (p === '/logout-all') assertCsrf(ctx);
  if (p === '/' && m === 'GET' && ctx.query.refresh === 'true') return refresh(ctx);
  if (p === '/login' && m === 'POST') return login(ctx);
  if (p === '/register' && m === 'POST') return register(ctx);
  if (p === '/session' && m === 'POST') return sessionExchange(ctx);
  if (p === '/refresh' && m === 'POST') return refresh(ctx);
  if (p === '/logout' && m === 'POST') return logout(ctx);
  // Sign out everywhere: bumps token_version, so every cookie session and v1.1 bearer token stops working.
  if (p === '/logout-all' && m === 'POST') return logout(ctx, true);
  if (p === '/reset/send-otp' && m === 'POST') return resetSend(ctx);
  if (p === '/reset/confirm' && m === 'POST') return resetConfirm(ctx);
  if (p === '/2fa' && m === 'POST') return twoFactor(ctx, false);
  if (p === '/2fa/toggle' && m === 'POST') return twoFactor(ctx, true);
  if (p === '/password' && m === 'POST') return changePassword(ctx);
  if (p === '/users' && m === 'GET') return listUsers(ctx);
  if (p === '/admin/stats' && m === 'GET') return adminStats(ctx);
  if (/^\/admin\/users\/[^/]+$/.test(p) && m === 'DELETE') return adminDeleteUser(ctx, p.split('/')[3]);
  // SEC-02 / SEC-03 / SEC-21: replaced by /api/v2 invitations and member management.
  if (p === '/users/invite' || p === '/remove-member' || p === '/admin/users' || /^\/users\/[^/]+$/.test(p)) {
    throw gone(GONE_MESSAGE);
  }
  throw notFound('Not found');
});
