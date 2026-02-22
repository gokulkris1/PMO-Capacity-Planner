import type { Handler, HandlerEvent } from '@netlify/functions';

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL = process.env.FROM_EMAIL || 'PMO Planner <noreply@pmo-planner.com>';

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
};

function ok(body: unknown) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify(body) };
}
function fail(msg: string, status = 400) {
    return { statusCode: status, headers: CORS, body: JSON.stringify({ error: msg }) };
}

function generateOTP(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// In-memory OTP store (fine for serverless: OTPs expire in 15 min, low volume)
// For production at scale: use a Redis or DB-backed store
const otpStore: Map<string, { otp: string; expires: number }> = new Map();

export const handler: Handler = async (event: HandlerEvent) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

    const subpath = event.path.replace(/.*\/api\/verify/, '') || '/';
    let body: Record<string, string> = {};
    try { body = JSON.parse(event.body || '{}'); } catch { }

    // ── SEND OTP ──────────────────────────────────────────────────
    if (subpath === '/send' && event.httpMethod === 'POST') {
        const { email } = body;
        if (!email) return fail('Email required');

        const otp = generateOTP();
        const expires = Date.now() + 15 * 60 * 1000; // 15 minutes
        otpStore.set(email.toLowerCase(), { otp, expires });

        if (!RESEND_API_KEY) {
            // Dev mode: log OTP to function logs (visible in Netlify function logs)
            console.log(`[DEV] OTP for ${email}: ${otp}`);
            return ok({ sent: true, dev: true, otp }); // Return OTP in dev mode
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
                    to: email,
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
            if (!res.ok) {
                const e = await res.json();
                throw new Error(e.message || 'Resend failed');
            }
            return ok({ sent: true });
        } catch (e: any) {
            console.error('Email send error:', e.message);
            return fail('Failed to send verification email: ' + e.message, 500);
        }
    }

    // ── VERIFY OTP ─────────────────────────────────────────────────
    if (subpath === '/check' && event.httpMethod === 'POST') {
        const { email, otp } = body;
        if (!email || !otp) return fail('Email and code required');

        const stored = otpStore.get(email.toLowerCase());
        if (!stored) return fail('No verification code found. Request a new one.', 404);
        if (Date.now() > stored.expires) {
            otpStore.delete(email.toLowerCase());
            return fail('Code expired. Request a new one.', 410);
        }
        if (stored.otp !== otp.trim()) return fail('Incorrect code. ' + (3 - (stored as any).attempts || 0) + ' attempts remaining.', 400);

        otpStore.delete(email.toLowerCase());
        return ok({ verified: true });
    }

    return fail('Not found', 404);
};
