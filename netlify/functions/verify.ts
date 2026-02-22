import type { Handler, HandlerEvent } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL = process.env.FROM_EMAIL || 'PMO Planner <noreply@pmo-planner.com>';

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
    return Math.floor(100000 + Math.random() * 900000).toString();
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
        const otp = generateOTP();
        const expires = Date.now() + 15 * 60 * 1000; // 15 minutes

        // Store in Postgres safely (Upsert)
        try {
            await sql`
        INSERT INTO otps (email, otp, expires_at, attempts) 
        VALUES (${cleanEmail}, ${otp}, ${expires}, 0)
        ON CONFLICT (email) 
        DO UPDATE SET otp = EXCLUDED.otp, expires_at = EXCLUDED.expires_at, attempts = 0
      `;
        } catch (dbErr: any) {
            console.error('DB OTP Save Error:', dbErr);
            return fail(event, 'Database error securely storing OTP', 500);
        }

        if (!RESEND_API_KEY) {
            console.log(`[DEV] OTP for ${cleanEmail}: ${otp}`);
            return ok(event, { sent: true, dev: true, otp });
        }

        try {
            const res = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${RESEND_API_KEY}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
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
                }),
            });
            if (!res.ok) throw new Error(await res.text());
            return ok(event, { sent: true });
        } catch (e: any) {
            console.error('Email send error:', e.message);
            return fail(event, 'Failed to send verification email: ' + e.message, 500);
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

            const attempts = stored.attempts || 0;
            if (stored.otp !== otp.trim()) {
                await sql`UPDATE otps SET attempts = attempts + 1 WHERE email = ${cleanEmail}`;
                return fail(event, 'Incorrect code. ' + Math.max(0, 3 - attempts - 1) + ' attempts remaining.', 400);
            }

            await sql`DELETE FROM otps WHERE email = ${cleanEmail}`;
            return ok(event, { verified: true });

        } catch (dbErr: any) {
            console.error('DB OTP Verify Error:', dbErr);
            return fail(event, 'Database error during OTP verification', 500);
        }
    }

    return fail(event, 'Not found', 404);
};
