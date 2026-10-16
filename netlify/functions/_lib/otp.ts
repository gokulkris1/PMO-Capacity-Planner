/**
 * One-time codes for 2FA, password reset and email verification (HS-05#AC1-2).
 * 6 digits from crypto.randomInt, stored as sha256(otp + email), compared in constant time, 5 attempts max.
 * One row per email (table `otps`, as in v1.1); `context` stops a reset code being used to sign in.
 * Codes are never returned by any endpoint (SEC-01); without email configured they are only logged in local dev.
 */
import { randomInt } from 'node:crypto';
import { safeEqual, sha256Hex } from './crypto';
import type { Queryable } from './db';
import { one } from './db';
import { isLocalDev } from './env';
import { badRequest, rateLimited } from './errors';
import { emailConfigured, otpEmail, sendEmail } from './email';
import { log } from './log';

export type OtpContext = '2fa' | 'reset' | 'verify';
export const OTP_TTL_MS = 15 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
const RESEND_GAP_MS = 60 * 1000;
export const CODE_EXPIRED = 'This code has expired. Request a new one.';

function hashOtp(otp: string, email: string): string {
  return sha256Hex(`${otp}${email}`);
}

export async function createOtp(q: Queryable, email: string, context: OtpContext): Promise<string> {
  const existing = await one<{ expires_at: unknown }>(q, 'SELECT expires_at FROM otps WHERE email = $1', [email]);
  if (existing) {
    const sentAt = Number(existing.expires_at) - OTP_TTL_MS;
    const wait = RESEND_GAP_MS - (Date.now() - sentAt);
    if (wait > 0) throw rateLimited('Please wait a minute before requesting another code.', wait / 1000);
  }
  const otp = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await q.query(
    `INSERT INTO otps (email, otp, otp_hash, context, expires_at, attempts) VALUES ($1, '', $2, $3, $4, 0)
     ON CONFLICT (email) DO UPDATE SET otp = '', otp_hash = EXCLUDED.otp_hash, context = EXCLUDED.context,
       expires_at = EXCLUDED.expires_at, attempts = 0`,
    [email, hashOtp(otp, email), context, Date.now() + OTP_TTL_MS],
  );
  return otp;
}

export async function verifyOtp(q: Queryable, email: string, otp: string, context: OtpContext): Promise<void> {
  const row = await one<{
    otp: string | null;
    otp_hash: string | null;
    context: string | null;
    expires_at: unknown;
    attempts: number;
  }>(q, 'SELECT otp, otp_hash, context, expires_at, attempts FROM otps WHERE email = $1', [email]);
  if (!row) throw badRequest('No code found. Request a new one.');
  const del = () => q.query('DELETE FROM otps WHERE email = $1', [email]);
  if (Date.now() > Number(row.expires_at) || Number(row.attempts ?? 0) >= OTP_MAX_ATTEMPTS) {
    await del();
    throw badRequest(CODE_EXPIRED);
  }
  const code = String(otp ?? '').trim();
  let ok = false;
  if (row.context && row.context !== context) ok = false;
  else if (row.otp_hash) ok = safeEqual(hashOtp(code, email), row.otp_hash);
  else if (row.otp) ok = safeEqual(code, String(row.otp)); // a code issued by v1.1 just before the upgrade
  if (!ok) {
    await q.query('UPDATE otps SET attempts = coalesce(attempts, 0) + 1 WHERE email = $1', [email]);
    throw badRequest('Incorrect code.', { otp: 'Incorrect code.' });
  }
  await del();
}

/** Emails the code. Without Resend the code is logged only when running locally (CONTEXT=dev). */
export async function deliverOtp(email: string, otp: string, context: OtpContext): Promise<{ sent: boolean }> {
  if (!emailConfigured()) {
    if (isLocalDev()) log('info', { event: 'otp.dev_code', context, code: otp });
    else log('warn', { event: 'otp.not_sent', context, reason: 'RESEND_API_KEY not set' });
    return { sent: false };
  }
  return sendEmail(otpEmail(email, otp, context));
}
