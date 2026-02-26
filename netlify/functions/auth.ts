import type { Handler, HandlerEvent } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Resend } from 'resend';

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL = process.env.FROM_EMAIL || 'PMO Planner <noreply@pmo-planner.com>';

const JWT_SECRET = process.env.JWT_SECRET as string;
if (!JWT_SECRET) throw new Error("JWT_SECRET environment variable is missing");
// Set SUPER_ADMIN_EMAIL in Netlify env vars → that user always gets SUPERUSER role
const SUPER_ADMIN_EMAIL = (process.env.SUPER_ADMIN_EMAIL || '').toLowerCase().trim();

function getDb() {
    // Try manually set var first, then Netlify's auto-injected Neon integration vars
    const url =
        process.env.NEON_DATABASE_URL ||
        process.env.NETLIFY_DATABASE_URL_UNPOOLED ||
        process.env.NETLIFY_DATABASE_URL;
    if (!url) throw new Error('No DB URL found — set NEON_DATABASE_URL or connect Neon via Netlify Integrations');
    return neon(url);
}

const CORS = {
    'Access-Control-Allow-Origin': process.env.URL || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Content-Type': 'application/json',
};

function ok(body: unknown, status = 200) {
    return { statusCode: status, headers: CORS, body: JSON.stringify(body) };
}
function fail(message: string, status = 400) {
    return { statusCode: status, headers: CORS, body: JSON.stringify({ error: message }) };
}

type JWTPayload = { id: string; email: string; role: string };

function verifyToken(authHeader: string): JWTPayload {
    if (!authHeader?.startsWith('Bearer ')) throw new Error('Unauthorized');
    return jwt.verify(authHeader.slice(7), JWT_SECRET) as JWTPayload;
}

function generateOTP(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendAuthOtp(sql: any, email: string, context: '2fa' | 'reset') {
    const cleanEmail = email.toLowerCase().trim();
    const otp = generateOTP();
    const expires = Date.now() + 15 * 60 * 1000;

    await sql`
        INSERT INTO otps (email, otp, expires_at, attempts) 
        VALUES (${cleanEmail}, ${otp}, ${expires}, 0)
        ON CONFLICT (email) 
        DO UPDATE SET otp = EXCLUDED.otp, expires_at = EXCLUDED.expires_at, attempts = 0
    `;

    if (!RESEND_API_KEY) {
        console.log(`[DEV ${context}] OTP for ${cleanEmail}: ${otp}`);
        return otp;
    }

    const resend = new Resend(RESEND_API_KEY);
    const subject = context === 'reset' ? 'Reset your PMO Planner password' : 'Your PMO Planner login code';
    const msg = context === 'reset' ? 'Use this code to reset your password:' : 'Use this code to securely log in:';

    await resend.emails.send({
        from: FROM_EMAIL,
        to: cleanEmail,
        subject,
        html: `
        <div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:0 auto;background:#0f172a;padding:32px;border-radius:16px;color:#f1f5f9">
            <h1 style="font-size:22px;margin:0 0 8px;color:#f1f5f9">${subject}</h1>
            <p style="color:#94a3b8;margin:0 0 24px">${msg}</p>
            <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:20px;text-align:center;margin-bottom:24px">
            <span style="font-size:36px;font-weight:900;letter-spacing:12px;color:#818cf8">${otp}</span>
            </div>
            <p style="color:#64748b;font-size:13px;margin:0">This code expires in 15 minutes.</p>
        </div>`
    });
}

async function verifyAuthOtp(sql: any, email: string, otp: string) {
    const cleanEmail = email.toLowerCase().trim();
    const records = await sql`SELECT * FROM otps WHERE email = ${cleanEmail}`;
    if (records.length === 0) throw new Error('No verification code found. Request a new one.');
    const stored = records[0];
    if (Date.now() > Number(stored.expires_at)) {
        await sql`DELETE FROM otps WHERE email = ${cleanEmail}`;
        throw new Error('Code expired. Request a new one.');
    }
    if (stored.otp !== otp.trim()) {
        await sql`UPDATE otps SET attempts = attempts + 1 WHERE email = ${cleanEmail}`;
        throw new Error('Incorrect verification code.');
    }
    await sql`DELETE FROM otps WHERE email = ${cleanEmail}`;
}

export const handler: Handler = async (event: HandlerEvent) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

    // Normalise sub-route from either redirect pattern
    const subpath = event.path
        .replace(/^.*\/api\/auth/, '')
        .replace(/^.*\/auth/, '')
        || '/';

    let body: Record<string, string> = {};
    try { body = JSON.parse(event.body || '{}'); } catch { }

    const sql = getDb();

    try {

        // ── REGISTER ─────────────────────────────────────────────
        if (subpath === '/register' && event.httpMethod === 'POST') {
            const { email, password, name } = body;
            if (!email || !password) return fail('Email and password are required');

            const existing = await sql`SELECT id FROM users WHERE email = ${email.toLowerCase()}`;
            if (existing.length > 0) return fail('Email already registered');

            const hash = await bcrypt.hash(password, 10);
            const count = await sql`SELECT COUNT(*)::int AS n FROM users`;
            const isSuperAdmin = SUPER_ADMIN_EMAIL && email.toLowerCase() === SUPER_ADMIN_EMAIL;
            const isFirst = count[0].n === 0;
            const role = isSuperAdmin ? 'SUPERUSER' : isFirst ? 'ADMIN' : 'USER';
            const plan = isSuperAdmin ? 'MAX' : 'BASIC';

            const [user] = await sql`
        INSERT INTO users (email, password_hash, name, role, plan, org_id)
        VALUES (${email.toLowerCase()}, ${hash}, ${name || email.split('@')[0]}, 'USER', ${plan}, NULL)
        RETURNING id, email, name, role, plan
      `;

            const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
            return ok({ token, user }, 201);
        }

        // ── LOGIN ─────────────────────────────────────────────────
        if (subpath === '/login' && event.httpMethod === 'POST') {
            const { email, password } = body;
            if (!email || !password) return fail('Email and password are required');

            const rows = await sql`SELECT * FROM users WHERE email = ${email.toLowerCase()}`;
            if (rows.length === 0) return fail('Invalid email or password', 401);

            const user = rows[0];
            const match = await bcrypt.compare(password, user.password_hash);
            if (!match) return fail('Invalid email or password', 401);

            if (user.two_factor_enabled) {
                if (!body.otp) {
                    await sendAuthOtp(sql, user.email, '2fa');
                    return ok({ require2FA: true, email: user.email });
                }
                try {
                    await verifyAuthOtp(sql, user.email, body.otp);
                } catch (e: any) {
                    return fail(e.message, 400);
                }
            }

            // Auto-upgrade SUPER_ADMIN_EMAIL to SUPERUSER/MAX if not already
            const isSuperAdmin = SUPER_ADMIN_EMAIL && email.toLowerCase() === SUPER_ADMIN_EMAIL;
            if (isSuperAdmin && user.role !== 'SUPERUSER') {
                await sql`UPDATE users SET role = 'SUPERUSER', plan = 'MAX' WHERE id = ${user.id}`;
                user.role = 'SUPERUSER';
                user.plan = 'MAX';
            }

            const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
            return ok({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role, plan: user.plan || 'BASIC' } });
        }

        // ── PASSWORD RESET ───────────────────────────────────────
        if (subpath === '/reset/send-otp' && event.httpMethod === 'POST') {
            const { email } = body;
            if (!email) return fail('Email required');
            const records = await sql`SELECT id FROM users WHERE email = ${email.toLowerCase().trim()}`;
            if (records.length > 0) {
                await sendAuthOtp(sql, email, 'reset');
            }
            // Always return success to prevent email enumeration attacks
            return ok({ sent: true });
        }

        if (subpath === '/reset/confirm' && event.httpMethod === 'POST') {
            const { email, otp, newPassword } = body;
            if (!email || !otp || !newPassword) return fail('All fields required');
            try {
                await verifyAuthOtp(sql, email, otp);
                const hash = await bcrypt.hash(newPassword, 10);
                await sql`UPDATE users SET password_hash = ${hash} WHERE email = ${email.toLowerCase().trim()}`;
                return ok({ success: true });
            } catch (e: any) {
                return fail(e.message, 400);
            }
        }

        // ── PROTECTED: require auth below ─────────────────────────
        let actor: JWTPayload;
        try {
            actor = verifyToken(event.headers.authorization || '');
        } catch {
            return fail('Unauthorized', 401);
        }
        const isSuperuser = actor.role === 'SUPERUSER';
        const isAdmin = actor.role === 'ADMIN' || isSuperuser;

        // ── 2FA TOGGLE ────────────────────────────────────────────
        if (subpath === '/2fa/toggle' && event.httpMethod === 'POST') {
            const [updated] = await sql`
                UPDATE users SET two_factor_enabled = NOT COALESCE(two_factor_enabled, false)
                WHERE id = ${actor.id} RETURNING two_factor_enabled
            `;
            return ok({ two_factor_enabled: updated?.two_factor_enabled });
        }

        // ── ADMIN: list all users ─────────────────────────────────
        if (subpath === '/users' && event.httpMethod === 'GET') {
            if (!isAdmin) return fail('Forbidden', 403);

            if (isSuperuser) {
                const users = await sql`
                    SELECT u.id, u.email, u.name, u.role, u.plan, u.created_at, u.org_id, o.slug as org_slug 
                    FROM users u
                    LEFT JOIN organizations o ON u.org_id = o.id
                    ORDER BY u.created_at DESC
                `;
                return ok({ users });
            } else {
                const [caller] = await sql`SELECT org_id FROM users WHERE id = ${actor.id}`;
                if (!caller?.org_id) return fail('No Organization found for this user', 400);

                const users = await sql`
                    SELECT u.id, u.email, u.name, u.role, u.plan, u.created_at, o.slug as org_slug 
                    FROM users u
                    LEFT JOIN organizations o ON u.org_id = o.id
                    WHERE u.org_id = ${caller.org_id}
                    ORDER BY u.created_at DESC
                `;
                return ok({ users });
            }
        }

        // ── ADMIN: invite user to org ─────────────────────────────
        if (subpath === '/users/invite' && event.httpMethod === 'POST') {
            if (!isAdmin) return fail('Forbidden', 403);
            const { email, role = 'USER', name = '' } = body;
            if (!email) return fail('Email required', 400);

            const [caller] = await sql`SELECT org_id, plan FROM users WHERE id = ${actor.id}`;
            if (!caller?.org_id) return fail('No Organization found', 400);

            const existing = await sql`SELECT id FROM users WHERE email = ${email.toLowerCase()}`;
            if (existing.length > 0) return fail('Email already in use', 400);

            // Give them a random password, they can reset it later (or login via future magic link)
            const randomPassword = Math.random().toString(36).slice(-10);
            const hash = await bcrypt.hash(randomPassword, 10);
            const userPlan = caller.plan || 'BASIC';

            const [newUser] = await sql`
                INSERT INTO users (email, password_hash, name, role, plan, org_id)
                VALUES (${email.toLowerCase()}, ${hash}, ${name || email.split('@')[0]}, ${role}, ${userPlan}, ${caller.org_id})
                RETURNING id, email, name, role, plan, created_at
            `;
            return ok({ user: newUser, password: randomPassword }); // In real app, email the password
        }

        // ── SUPERUSER: platform stats ─────────────────────────────
        if (subpath === '/admin/stats' && event.httpMethod === 'GET') {
            if (!isSuperuser) return fail('Forbidden', 403);
            const [stats] = await sql`
        SELECT
          COUNT(*)::int                                          AS total_users,
          COUNT(*) FILTER (WHERE plan = 'BASIC')::int            AS basic_users,
          COUNT(*) FILTER (WHERE plan = 'PRO')::int              AS pro_users,
          COUNT(*) FILTER (WHERE plan = 'MAX')::int              AS max_users,
          COUNT(*) FILTER (WHERE role = 'SUPERUSER')::int        AS superusers,
          COUNT(*) FILTER (WHERE role = 'ADMIN')::int              AS pmo_count,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::int AS new_this_week
        FROM users
      `;
            const mrr =
                (stats.basic_users * 29) +
                (stats.pro_users * 49) +
                (stats.max_users * 199);
            return ok({ stats: { ...stats, mrr_eur: mrr } });
        }

        // ── ADMIN/SUPERUSER: update user plan or role ─────────────
        if (subpath.match(/^\/users\/[^/]+$/) && event.httpMethod === 'PUT') {
            if (!isAdmin) return fail('Forbidden', 403);
            const userId = subpath.split('/')[2];
            let { plan, role, name, email, password } = body;

            // Optional overrides
            const updates: string[] = [];
            const values: any[] = [];
            let i = 1;

            if (plan) {
                const validPlans = ['BASIC', 'PRO', 'MAX'];
                if (validPlans.includes(plan)) {
                    updates.push(`plan = $${i++}`);
                    values.push(plan);
                }
            }
            if (role) {
                const validRoles = isSuperuser
                    ? ['SUPERUSER', 'ADMIN', 'USER']
                    : ['ADMIN', 'USER'];
                if (validRoles.includes(role)) {
                    updates.push(`role = $${i++}`);
                    values.push(role);
                }
            }
            if (name !== undefined) {
                updates.push(`name = $${i++}`);
                values.push(name);
            }
            if (isSuperuser && email) {
                updates.push(`email = $${i++}`);
                values.push(email.toLowerCase().trim());
            }
            if (isSuperuser && password) {
                const hash = await bcrypt.hash(password, 10);
                updates.push(`password_hash = $${i++}`);
                values.push(hash);
            }

            if (updates.length > 0) {
                values.push(userId);
                const queryStr = `UPDATE users SET ${updates.join(', ')} WHERE id = $${i} RETURNING id, email, name, role, plan`;

                try {
                    // Type hack to bypass the strict tagged template typing for dynamic queries in Neon serverless
                    const [updated] = await (sql as any)(queryStr, values);
                    if (!updated) return fail('User not found', 404);
                    return ok({ success: true, user: updated });
                } catch (e: any) {
                    return fail('Update failed: ' + e.message, 500);
                }
            }
            return ok({ success: true });
        }

        // ── SUPERUSER: create a user directly ────────────────────
        if (subpath === '/admin/users' && event.httpMethod === 'POST') {
            if (!isSuperuser) return fail('Forbidden', 403);
            const { email, password, name, role = 'USER', plan = 'BASIC' } = body;
            if (!email || !password) return fail('Email and password required');

            const existing = await sql`SELECT id FROM users WHERE email = ${email.toLowerCase()}`;
            if (existing.length > 0) return fail('Email already registered');

            const hash = await bcrypt.hash(password, 10);
            const [user] = await sql`
        INSERT INTO users (email, password_hash, name, role, plan)
        VALUES (${email.toLowerCase()}, ${hash}, ${name || email.split('@')[0]}, ${role}, ${plan})
        RETURNING id, email, name, role, plan, created_at
      `;
            return ok({ user }, 201);
        }

        // ── SUPERUSER: delete a user ──────────────────────────────
        if (subpath.match(/^\/admin\/users\/[^/]+$/) && event.httpMethod === 'DELETE') {
            if (!isSuperuser) return fail('Forbidden', 403);
            const userId = subpath.split('/')[3];
            await sql`DELETE FROM users WHERE id = ${userId}`;
            return ok({ success: true });
        }

        return fail('Not found', 404);

    } catch (e: any) {
        console.error('[auth fn]', e.message);
        return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Server error', detail: e.message }) };
    }
};
