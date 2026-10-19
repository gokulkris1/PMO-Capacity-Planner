/**
 * /api/verify/send and /api/verify/check — email verification (AC-07, HS-05). Codes are never returned (SEC-01).
 * `send` answers the same for known and unknown emails; `check` marks `users.email_verified_at`.
 */
import type { Ctx } from './_lib/api';
import { auditCtx, withApi } from './_lib/api';
import { audit } from './_lib/audit';
import { normaliseEmail } from './_lib/auth';
import { one, withTx } from './_lib/db';
import { emailConfigured } from './_lib/email';
import { badRequest, notFound, serviceUnavailable } from './_lib/errors';
import { createOtp, deliverOtp, verifyOtp } from './_lib/otp';
import { FIFTEEN_MIN, rateLimit } from './_lib/rateLimit';

function emailFrom(ctx: Ctx): string {
  const raw = (ctx.body as { email?: unknown })?.email;
  const email = normaliseEmail(typeof raw === 'string' && raw ? raw : (ctx.actor?.email ?? ''));
  if (!email) throw badRequest('Email required', { email: 'Email required' });
  return email;
}

async function limits(ctx: Ctx, email: string) {
  await rateLimit(ctx.db, [
    { key: `verify:email:${email}`, max: 5, windowSec: FIFTEEN_MIN },
    { key: `verify:ip:${ctx.ip ?? 'unknown'}`, max: 20, windowSec: FIFTEEN_MIN },
  ]);
}

async function send(ctx: Ctx) {
  const email = emailFrom(ctx);
  await limits(ctx, email);
  if (!emailConfigured()) {
    throw serviceUnavailable('Email delivery is not configured. Contact your administrator.', 'no email provider configured');
  }
  const user = await one<{ id: string; email_verified_at: unknown }>(
    ctx.db,
    'SELECT id, email_verified_at FROM users WHERE lower(email) = $1 ORDER BY (email = $1) DESC LIMIT 1',
    [email],
  );
  if (user && !user.email_verified_at) {
    try {
      const otp = await createOtp(ctx.db, email, 'verify');
      await deliverOtp(email, otp, 'verify');
    } catch {
      // throttled: same answer (no enumeration)
    }
  }
  return { sent: true };
}

async function check(ctx: Ctx) {
  const email = emailFrom(ctx);
  const otp = String((ctx.body as { otp?: unknown })?.otp ?? '').trim();
  if (!otp) throw badRequest('Email and code required', { otp: 'Required' });
  await limits(ctx, email);
  await verifyOtp(ctx.db, email, otp, 'verify');
  await withTx(async (q) => {
    const rows = await q.query<{ id: string; org_id: string | null }>(
      'UPDATE users SET email_verified_at = coalesce(email_verified_at, now()) WHERE lower(email) = $1 RETURNING id, org_id',
      [email],
    );
    if (rows[0]) {
      await audit(
        q,
        { ...auditCtx(ctx), actorUserId: rows[0].id },
        {
          action: 'auth.email_verified',
          orgId: rows[0].org_id,
          targetType: 'user',
          targetId: rows[0].id,
        },
      );
    }
  });
  return { verified: true };
}

export const handler = withApi({ fn: 'verify', auth: 'optional', csrf: false }, async (ctx) => {
  if (ctx.subpath === '/send' && ctx.method === 'POST') return send(ctx);
  if (ctx.subpath === '/check' && ctx.method === 'POST') return check(ctx);
  throw notFound('Not found');
});
