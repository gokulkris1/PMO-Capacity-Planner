import type { Handler, HandlerEvent } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Resend } from 'resend';

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL = process.env.FROM_EMAIL || 'Orbit Space <noreply@orbitspace.io>';
const JWT_SECRET = process.env.JWT_SECRET as string;
if (!JWT_SECRET) throw new Error("JWT_SECRET environment variable is missing");
const SUPER_ADMIN_EMAIL = (process.env.SUPER_ADMIN_EMAIL || '').toLowerCase().trim();

// ── Valid roles ──────────────────────────────────────────────────────────────
const PLATFORM_ROLES = ['SUPERUSER', 'ORG_ADMIN', 'PMO_ADMIN', 'WORKSPACE_OWNER', 'USER'] as const;
const WORKSPACE_ROLES = ['PMO_ADMIN', 'WORKSPACE_OWNER', 'USER'] as const;

function getDb() {
    const url = process.env.NEON_DATABASE_URL || process.env.NETLIFY_DATABASE_URL_UNPOOLED || process.env.NETLIFY_DATABASE_URL;
    if (!url) throw new Error('No DB URL');
    return neon(url);
}

const CORS = {
    'Access-Control-Allow-Origin': process.env.URL || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Content-Type': 'application/json',
};

function ok(body: unknown, status = 200) { return { statusCode: status, headers: CORS, body: JSON.stringify(body) }; }
function fail(msg: string, status = 400) { return { statusCode: status, headers: CORS, body: JSON.stringify({ error: msg }) }; }

type JWTPayload = { id: string; email: string; role: string; org_id?: string };

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
    const subject = context === 'reset' ? 'Reset your Orbit Space password' : 'Your Orbit Space login code';
    const msg = context === 'reset' ? 'Use this code to reset your password:' : 'Use this code to securely log in:';
    await resend.emails.send({
        from: FROM_EMAIL, to: cleanEmail, subject,
        html: `<div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:0 auto;background:#0f172a;padding:32px;border-radius:16px;color:#f1f5f9">
            <h1 style="font-size:22px;margin:0 0 8px">${subject}</h1>
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
    if (records.length === 0) throw new Error('No verification code found.');
    const stored = records[0];
    if (Date.now() > Number(stored.expires_at)) {
        await sql`DELETE FROM otps WHERE email = ${cleanEmail}`;
        throw new Error('Code expired.');
    }
    if (stored.otp !== otp.trim()) {
        await sql`UPDATE otps SET attempts = attempts + 1 WHERE email = ${cleanEmail}`;
        throw new Error('Incorrect code.');
    }
    await sql`DELETE FROM otps WHERE email = ${cleanEmail}`;
}

// Helper to send invite/set-password email
async function sendInviteEmail(email: string, tempPassword: string, orgName: string) {
    if (!RESEND_API_KEY) {
        console.log(`[DEV invite] ${email} temp-password: ${tempPassword} org: ${orgName}`);
        return;
    }
    const resend = new Resend(RESEND_API_KEY);
    const loginUrl = process.env.URL || 'https://orbitspace.io';
    await resend.emails.send({
        from: FROM_EMAIL, to: email,
        subject: `You've been invited to ${orgName} on Orbit Space`,
        html: `<div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:0 auto;background:#0f172a;padding:32px;border-radius:16px;color:#f1f5f9">
            <h1 style="font-size:22px;margin:0 0 8px">Welcome to Orbit Space 🪐</h1>
            <p style="color:#94a3b8;margin:0 0 24px">You've been invited to <strong>${orgName}</strong>. Sign in with the temporary credentials below and change your password.</p>
            <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:20px;margin-bottom:24px">
                <p style="margin:0 0 8px;color:#94a3b8;font-size:13px">Email</p>
                <p style="margin:0 0 16px;color:#f1f5f9;font-weight:700">${email}</p>
                <p style="margin:0 0 8px;color:#94a3b8;font-size:13px">Temporary Password</p>
                <p style="margin:0;color:#818cf8;font-weight:900;font-size:18px;letter-spacing:2px">${tempPassword}</p>
            </div>
            <a href="${loginUrl}" style="display:block;text-align:center;background:#6366f1;color:#fff;padding:14px;border-radius:12px;text-decoration:none;font-weight:700">Sign In Now →</a>
        </div>`
    });
}

function generateTempPassword(): string {
    return 'Orbit' + Math.random().toString(36).slice(2, 8) + '!';
}

export const handler: Handler = async (event: HandlerEvent) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

    const subpath = event.path.replace(/^.*\/api\/auth/, '').replace(/^.*\/auth/, '') || '/';
    let body: Record<string, any> = {};
    try { body = JSON.parse(event.body || '{}'); } catch { }
    const sql = getDb();

    try {

        // ── REGISTER ─────────────────────────────────────────────────
        // New users: role=USER, org_id=NULL. They see empty shell + Create Org wizard.
        if (subpath === '/register' && event.httpMethod === 'POST') {
            const { email, password, name } = body;
            if (!email || !password) return fail('Email and password are required');

            const existing = await sql`SELECT id FROM users WHERE email = ${email.toLowerCase()}`;
            if (existing.length > 0) return fail('Email already registered');

            const hash = await bcrypt.hash(password, 10);
            const isSuperAdmin = SUPER_ADMIN_EMAIL && email.toLowerCase() === SUPER_ADMIN_EMAIL;
            const role = isSuperAdmin ? 'SUPERUSER' : 'USER';
            const plan = isSuperAdmin ? 'MAX' : 'BASIC';

            const [user] = await sql`
                INSERT INTO users (email, password_hash, name, role, plan, org_id)
                VALUES (${email.toLowerCase()}, ${hash}, ${name || email.split('@')[0]}, ${role}, ${plan}, NULL)
                RETURNING id, email, name, role, plan, org_id
            `;

            const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
            return ok({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role, plan: user.plan, orgId: user.org_id } }, 201);
        }

        // ── LOGIN ────────────────────────────────────────────────────
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
                try { await verifyAuthOtp(sql, user.email, body.otp); }
                catch (e: any) { return fail(e.message, 400); }
            }

            // Auto-upgrade SUPER_ADMIN_EMAIL
            const isSuperAdmin = SUPER_ADMIN_EMAIL && email.toLowerCase() === SUPER_ADMIN_EMAIL;
            if (isSuperAdmin && user.role !== 'SUPERUSER') {
                await sql`UPDATE users SET role = 'SUPERUSER', plan = 'MAX' WHERE id = ${user.id}`;
                user.role = 'SUPERUSER'; user.plan = 'MAX';
            }

            // Get orgSlug for routing
            let orgSlug: string | null = null;
            if (user.org_id) {
                const orgRows = await sql`SELECT slug FROM organizations WHERE id = ${user.org_id}`;
                orgSlug = orgRows[0]?.slug || null;
            }

            const token = jwt.sign(
                { id: user.id, email: user.email, role: user.role, org_id: user.org_id },
                JWT_SECRET, { expiresIn: '7d' }
            );
            return ok({
                token,
                user: { id: user.id, email: user.email, name: user.name, role: user.role, plan: user.plan || 'BASIC', orgId: user.org_id, orgSlug }
            });
        }

        // ── PASSWORD RESET ───────────────────────────────────────────
        if (subpath === '/reset/send-otp' && event.httpMethod === 'POST') {
            const { email } = body;
            if (!email) return fail('Email required');
            const records = await sql`SELECT id FROM users WHERE email = ${email.toLowerCase().trim()}`;
            if (records.length > 0) await sendAuthOtp(sql, email, 'reset');
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
            } catch (e: any) { return fail(e.message, 400); }
        }

        // ── PROTECTED — require auth below ───────────────────────────
        let actor: JWTPayload;
        try { actor = verifyToken(event.headers.authorization || ''); }
        catch { return fail('Unauthorized', 401); }

        const isSuperuser = actor.role === 'SUPERUSER';
        const isOrgAdmin = actor.role === 'ORG_ADMIN' || actor.role === 'ADMIN';
        const isAdmin = isSuperuser || isOrgAdmin;

        // ── 2FA TOGGLE ───────────────────────────────────────────────
        if (subpath === '/2fa/toggle' && event.httpMethod === 'POST') {
            const [updated] = await sql`
                UPDATE users SET two_factor_enabled = NOT COALESCE(two_factor_enabled, false)
                WHERE id = ${actor.id} RETURNING two_factor_enabled
            `;
            return ok({ two_factor_enabled: updated?.two_factor_enabled });
        }

        // ── LIST USERS ───────────────────────────────────────────────
        if (subpath === '/users' && event.httpMethod === 'GET') {
            if (!isAdmin) return fail('Forbidden', 403);
            if (isSuperuser) {
                const users = await sql`
                    SELECT u.id, u.email, u.name, u.role, u.plan, u.created_at, u.org_id, o.slug as org_slug, o.name as org_name
                    FROM users u LEFT JOIN organizations o ON u.org_id = o.id
                    ORDER BY u.created_at DESC
                `;
                return ok({ users });
            } else {
                const [caller] = await sql`SELECT org_id FROM users WHERE id = ${actor.id}`;
                if (!caller?.org_id) return fail('No org found', 400);
                const users = await sql`
                    SELECT u.id, u.email, u.name, u.role, u.plan, u.created_at, o.slug as org_slug
                    FROM users u LEFT JOIN organizations o ON u.org_id = o.id
                    WHERE u.org_id = ${caller.org_id}
                    ORDER BY u.created_at DESC
                `;
                return ok({ users });
            }
        }

        // ── INVITE USER (auto-create account) ────────────────────────
        // Called by ORG_ADMIN (invite PMO/WORKSPACE_OWNER/USER) or PMO_ADMIN (invite WORKSPACE_OWNER/USER)
        if (subpath === '/users/invite' && event.httpMethod === 'POST') {
            const { email, orgId, role = 'USER', workspaceIds = [] } = body;
            if (!email) return fail('email required');

            // Determine caller's org
            const [callerUser] = await sql`SELECT org_id, role FROM users WHERE id = ${actor.id}`;
            const effectiveOrgId = orgId || callerUser?.org_id;
            if (!effectiveOrgId) return fail('No org context', 400);

            // Permission check
            const callerRole = callerUser?.role || actor.role;
            if (callerRole === 'USER' || callerRole === 'WORKSPACE_OWNER') return fail('Forbidden', 403);
            if (callerRole === 'PMO_ADMIN' && (role === 'ORG_ADMIN' || role === 'PMO_ADMIN')) {
                return fail('PMO Admins can only invite WORKSPACE_OWNER or USER', 403);
            }
            if (!PLATFORM_ROLES.includes(role as any)) return fail('Invalid role', 400);

            // Get org name for email
            const [org] = await sql`SELECT name FROM organizations WHERE id = ${effectiveOrgId}`;
            const orgName = org?.name || 'Orbit Space';

            // Auto-create user if doesn't exist
            let userId: string;
            const cleanEmail = email.toLowerCase().trim();
            const existing = await sql`SELECT id FROM users WHERE email = ${cleanEmail}`;

            if (existing.length > 0) {
                userId = existing[0].id;
                // Update their org and role if upgrading
                await sql`UPDATE users SET org_id = ${effectiveOrgId}, role = ${role} WHERE id = ${userId}`;
            } else {
                // Create new account with temp password
                const tempPassword = generateTempPassword();
                const hash = await bcrypt.hash(tempPassword, 10);
                const [newUser] = await sql`
                    INSERT INTO users (email, password_hash, name, role, plan, org_id)
                    VALUES (${cleanEmail}, ${hash}, ${cleanEmail.split('@')[0]}, ${role}, 'BASIC', ${effectiveOrgId})
                    RETURNING id
                `;
                userId = newUser.id;
                // Send invite email with temp password
                await sendInviteEmail(cleanEmail, tempPassword, orgName);
            }

            // Add to workspaces if specified
            const wsRole = role === 'ORG_ADMIN' ? 'PMO_ADMIN' : (role as string);
            const validWsRole = WORKSPACE_ROLES.includes(wsRole as any) ? wsRole : 'USER';

            if (workspaceIds.length > 0) {
                for (const wsId of workspaceIds) {
                    await sql`
                        INSERT INTO workspace_members (user_id, workspace_id, org_id, role, invited_by)
                        VALUES (${userId}, ${wsId}, ${effectiveOrgId}, ${validWsRole}, ${actor.id})
                        ON CONFLICT (user_id, workspace_id) DO UPDATE SET role = ${validWsRole}
                    `;
                }
            } else {
                // If no workspace specified, add to all org workspaces for ORG_ADMIN/PMO_ADMIN
                if (role === 'ORG_ADMIN' || role === 'PMO_ADMIN') {
                    const orgWs = await sql`SELECT id FROM workspaces WHERE org_id = ${effectiveOrgId}`;
                    for (const ws of orgWs) {
                        await sql`
                            INSERT INTO workspace_members (user_id, workspace_id, org_id, role, invited_by)
                            VALUES (${userId}, ${ws.id}, ${effectiveOrgId}, ${validWsRole}, ${actor.id})
                            ON CONFLICT (user_id, workspace_id) DO UPDATE SET role = ${validWsRole}
                        `;
                    }
                }
            }

            return ok({ success: true, message: `${cleanEmail} invited as ${role}` });
        }

        // ── REMOVE MEMBER FROM WORKSPACE ─────────────────────────────
        if (subpath === '/remove-member' && event.httpMethod === 'POST') {
            if (!isAdmin && actor.role !== 'PMO_ADMIN') return fail('Forbidden', 403);
            const { userId: memberId, workspaceId } = body;
            if (!memberId || !workspaceId) return fail('userId and workspaceId required', 400);
            if (memberId === actor.id) return fail('Cannot remove yourself', 400);
            await sql`DELETE FROM workspace_members WHERE user_id = ${memberId} AND workspace_id = ${workspaceId}`;
            return ok({ success: true });
        }

        // ── PLATFORM STATS (superuser) ───────────────────────────────
        if (subpath === '/admin/stats' && event.httpMethod === 'GET') {
            if (!isSuperuser) return fail('Forbidden', 403);
            const [stats] = await sql`
                SELECT
                    COUNT(*)::int AS total_users,
                    COUNT(*) FILTER (WHERE plan = 'BASIC')::int AS basic_users,
                    COUNT(*) FILTER (WHERE plan = 'PRO')::int AS pro_users,
                    COUNT(*) FILTER (WHERE plan = 'MAX')::int AS max_users,
                    COUNT(*) FILTER (WHERE role = 'SUPERUSER')::int AS superusers,
                    COUNT(*) FILTER (WHERE role = 'ORG_ADMIN')::int AS org_admins,
                    COUNT(*) FILTER (WHERE role = 'PMO_ADMIN')::int AS pmo_admins,
                    COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::int AS new_this_week
                FROM users
            `;
            const [orgCount] = await sql`SELECT COUNT(*)::int AS n FROM organizations`;
            const [wsCount] = await sql`SELECT COUNT(*)::int AS n FROM workspaces`;
            const mrr = (stats.basic_users * 29) + (stats.pro_users * 49) + (stats.max_users * 199);
            return ok({ stats: { ...stats, mrr_eur: mrr, total_orgs: orgCount.n, total_workspaces: wsCount.n } });
        }

        // ── UPDATE USER (admin) ──────────────────────────────────────
        if (subpath.match(/^\/users\/[^/]+$/) && event.httpMethod === 'PUT') {
            if (!isAdmin) return fail('Forbidden', 403);
            const userId = subpath.split('/')[2];
            let { plan, role, name, email, password } = body;

            const updates: string[] = [];
            const values: any[] = [];
            let i = 1;
            if (plan && ['BASIC', 'PRO', 'MAX'].includes(plan)) { updates.push(`plan = $${i++}`); values.push(plan); }
            if (role && PLATFORM_ROLES.includes(role as any)) {
                if (!isSuperuser && (role === 'SUPERUSER')) return fail('Only superuser can assign SUPERUSER', 403);
                updates.push(`role = $${i++}`); values.push(role);
            }
            if (name !== undefined) { updates.push(`name = $${i++}`); values.push(name); }
            if (isSuperuser && email) { updates.push(`email = $${i++}`); values.push(email.toLowerCase().trim()); }
            if (isSuperuser && password) { const hash = await bcrypt.hash(password, 10); updates.push(`password_hash = $${i++}`); values.push(hash); }

            if (updates.length > 0) {
                values.push(userId);
                const queryStr = `UPDATE users SET ${updates.join(', ')} WHERE id = $${i} RETURNING id, email, name, role, plan`;
                try {
                    const [updated] = await (sql as any)(queryStr, values);
                    if (!updated) return fail('User not found', 404);
                    return ok({ success: true, user: updated });
                } catch (e: any) { return fail('Update failed: ' + e.message, 500); }
            }
            return ok({ success: true });
        }

        // ── SUPERUSER: create user directly ──────────────────────────
        if (subpath === '/admin/users' && event.httpMethod === 'POST') {
            if (!isSuperuser) return fail('Forbidden', 403);
            const { email, password, name, role = 'USER', plan = 'BASIC', orgId } = body;
            if (!email || !password) return fail('Email and password required');

            const existing = await sql`SELECT id FROM users WHERE email = ${email.toLowerCase()}`;
            if (existing.length > 0) return fail('Email already registered');

            const hash = await bcrypt.hash(password, 10);
            const [user] = await sql`
                INSERT INTO users (email, password_hash, name, role, plan, org_id)
                VALUES (${email.toLowerCase()}, ${hash}, ${name || email.split('@')[0]}, ${role}, ${plan}, ${orgId || null})
                RETURNING id, email, name, role, plan, created_at
            `;
            return ok({ user }, 201);
        }

        // ── SUPERUSER: delete user ───────────────────────────────────
        if (subpath.match(/^\/admin\/users\/[^/]+$/) && event.httpMethod === 'DELETE') {
            if (!isSuperuser) return fail('Forbidden', 403);
            const userId = subpath.split('/')[3];
            await sql`DELETE FROM workspace_members WHERE user_id = ${userId}`;
            await sql`DELETE FROM users WHERE id = ${userId}`;
            return ok({ success: true });
        }

        return fail('Not found', 404);

    } catch (e: any) {
        console.error('[auth fn]', e.message);
        return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Server error', detail: e.message }) };
    }
};
