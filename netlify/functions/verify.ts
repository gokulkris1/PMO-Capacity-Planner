import type { Handler, HandlerEvent } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import { Resend } from 'resend';
import bcrypt from 'bcryptjs';
import { randomInt } from 'node:crypto';

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL = process.env.FROM_EMAIL || 'PMO Planner <noreply@pmo-planner.com>';
const OTP_TTL_MS = 15 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;

const getDb = () => neon(
    process.env.NETLIFY_DATABASE_URL_UNPOOLED ||
    process.env.NETLIFY_DATABASE_URL ||
    process.env.NEON_DATABASE_URL || ''
);

function getCors(event: HandlerEvent) {
    const origin = event.headers.origin || process.env.URL || '*';
    return {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'OPTIONS, POST',
        'Content-Type': 'application/json',
    };
}

function ok(event: HandlerEvent, body: unknown) {
    return { statusCode: 200, headers: getCors(event), body: JSON.stringify(body) };
}
function fail(event: HandlerEvent, msg: string, status = 400) {
    return { statusCode: status, headers: getCors(event), body: JSON.stringify({ error: msg }) };
}

function generateOTP(): string {
    return randomInt(100000, 1_000_000).toString();
}

export const handler: Handler = async (event: HandlerEvent) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: getCors(event), body: '' };

    const subpath = event.path.replace(/.*\/api\/verify/, '') || '/';
    let body: Record<string, string> = {};
    try { body = JSON.parse(event.body || '{}'); } catch { }

    const sql = getDb();

    // ── SEND OTP ──────────────────────────────────────────────────
    if (subpath === '/send' && event.httpMethod === 'POST') {
        const { email } = body;
        if (!email) return fail(event, 'Email required');

        const cleanEmail = email.toLowerCase().trim();
        if (!RESEND_API_KEY) {
            return fail(event, 'Verification email delivery is unavailable. Contact support.', 503);
        }

        const existing = await sql`SELECT expires_at FROM otps WHERE email = ${cleanEmail}`;
        if (existing.length > 0) {
            const lastSentAt = Number(existing[0].expires_at) - OTP_TTL_MS;
            if (Date.now() - lastSentAt < OTP_RESEND_COOLDOWN_MS) {
                return fail(event, 'Please wait 60 seconds before requesting another code.', 429);
            }
        }

        const otp = generateOTP();
        const otpHash = await bcrypt.hash(otp, 10);
        const expires = Date.now() + OTP_TTL_MS;

        // Store in Postgres safely (Upsert)
        try {
            await sql`
        INSERT INTO otps (email, otp, expires_at, attempts) 
        VALUES (${cleanEmail}, ${otpHash}, ${expires}, 0)
        ON CONFLICT (email) 
        DO UPDATE SET otp = EXCLUDED.otp, expires_at = EXCLUDED.expires_at, attempts = 0
      `;
        } catch (dbErr: any) {
            console.error('DB OTP save error:', dbErr?.message);
            return fail(event, 'Database error securely storing OTP', 500);
        }

        try {
            const resend = new Resend(RESEND_API_KEY);
            const { data, error } = await resend.emails.send({
                from: FROM_EMAIL,
                to: cleanEmail,
                subject: 'Your PMO Planner verification code',
                html: `
            <div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:0 auto;background:#0f172a;padding:32px;border-radius:16px;color:#f1f5f9">
              <div style="font-size:28px;margin-bottom:8px">📊</div>
              <h1 style="font-size:22px;margin:0 0 8px;color:#f1f5f9">Verify your email</h1>
              <p style="color:#94a3b8;margin:0 0 24px">Use this code to complete your PMO Planner sign-up:</p>
              <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:20px;text-align:center;margin-bottom:24px">
                <span style="font-size:36px;font-weight:900;letter-spacing:12px;color:#818cf8">${otp}</span>
              </div>
              <p style="color:#64748b;font-size:13px;margin:0">This code expires in 15 minutes. If you didn't request this, you can safely ignore it.</p>
            </div>
                `,
            });
            if (error) {
                console.error('Resend SDK Error:', error);
                throw new Error(error.message);
            }
            return ok(event, { sent: true });
        } catch (e: any) {
            try {
                await sql`DELETE FROM otps WHERE email = ${cleanEmail}`;
            } catch (cleanupErr: any) {
                console.error('Failed to remove undelivered OTP:', cleanupErr?.message);
            }
            console.error('Email send error:', e?.message);
            return fail(event, 'Failed to send verification email', 500);
        }
    }

    // ── VERIFY OTP ─────────────────────────────────────────────────
    if (subpath === '/check' && event.httpMethod === 'POST') {
        const { email, otp } = body;
        if (!email || !otp) return fail(event, 'Email and code required');

        const cleanEmail = email.toLowerCase().trim();

        try {
            const records = await sql`SELECT * FROM otps WHERE email = ${cleanEmail}`;
            if (records.length === 0) return fail(event, 'No verification code found. Request a new one.', 404);

            const stored = records[0];

            if (Date.now() > Number(stored.expires_at)) {
                await sql`DELETE FROM otps WHERE email = ${cleanEmail}`;
                return fail(event, 'Code expired. Request a new one.', 410);
            }

            const attempts = Number(stored.attempts || 0);
            if (attempts >= MAX_OTP_ATTEMPTS) {
                await sql`DELETE FROM otps WHERE email = ${cleanEmail}`;
                return fail(event, 'Too many incorrect attempts. Request a new code.', 429);
            }

            const storedOtp = String(stored.otp || '');
            const matches = storedOtp.startsWith('$2')
                ? await bcrypt.compare(otp.trim(), storedOtp)
                : storedOtp === otp.trim(); // Allows existing pre-hardening codes to expire naturally.
            if (!matches) {
                const nextAttempts = attempts + 1;
                if (nextAttempts >= MAX_OTP_ATTEMPTS) {
                    await sql`DELETE FROM otps WHERE email = ${cleanEmail}`;
                    return fail(event, 'Too many incorrect attempts. Request a new code.', 429);
                }
                await sql`UPDATE otps SET attempts = ${nextAttempts} WHERE email = ${cleanEmail}`;
                return fail(event, 'Incorrect code.', 400);
            }

            await sql`DELETE FROM otps WHERE email = ${cleanEmail}`;
            return ok(event, { verified: true });

        } catch (dbErr: any) {
            console.error('DB OTP verify error:', dbErr?.message);
            return fail(event, 'Database error during OTP verification', 500);
        }
    }

    return fail(event, 'Not found', 404);
};
