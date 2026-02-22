import type { Handler, HandlerEvent } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_in_prod';
// Set SUPER_ADMIN_EMAIL in Netlify env vars → that user always gets SUPERUSER role
const SUPER_ADMIN_EMAIL = (process.env.SUPER_ADMIN_EMAIL || '').toLowerCase().trim();

function getDb() {
    const url = process.env.NEON_DATABASE_URL;
    if (!url) throw new Error('NEON_DATABASE_URL not set in environment');
    return neon(url);
}

const CORS = {
    'Access-Control-Allow-Origin': '*',
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
            const role = isSuperAdmin ? 'SUPERUSER' : isFirst ? 'PMO' : 'VIEWER';
            const plan = isSuperAdmin || isFirst ? 'MAX' : 'FREE';

            const [user] = await sql`
        INSERT INTO users (email, password_hash, name, role, plan)
        VALUES (${email.toLowerCase()}, ${hash}, ${name || email.split('@')[0]}, ${role}, ${plan})
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

            // Auto-upgrade SUPER_ADMIN_EMAIL to SUPERUSER/MAX if not already
            const isSuperAdmin = SUPER_ADMIN_EMAIL && email.toLowerCase() === SUPER_ADMIN_EMAIL;
            if (isSuperAdmin && user.role !== 'SUPERUSER') {
                await sql`UPDATE users SET role = 'SUPERUSER', plan = 'MAX' WHERE id = ${user.id}`;
                user.role = 'SUPERUSER';
                user.plan = 'MAX';
            }

            const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
            return ok({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role, plan: user.plan || 'FREE' } });
        }

        // ── PROTECTED: require auth below ─────────────────────────
        let actor: JWTPayload;
        try {
            actor = verifyToken(event.headers.authorization || '');
        } catch {
            return fail('Unauthorized', 401);
        }
        const isSuperuser = actor.role === 'SUPERUSER';
        const isPMO = actor.role === 'PMO' || isSuperuser;

        // ── ADMIN: list all users ─────────────────────────────────
        if (subpath === '/users' && event.httpMethod === 'GET') {
            if (!isPMO) return fail('Forbidden', 403);
            const users = await sql`
        SELECT id, email, name, role, plan, created_at FROM users ORDER BY created_at DESC
      `;
            return ok({ users });
        }

        // ── SUPERUSER: platform stats ─────────────────────────────
        if (subpath === '/admin/stats' && event.httpMethod === 'GET') {
            if (!isSuperuser) return fail('Forbidden', 403);
            const [stats] = await sql`
        SELECT
          COUNT(*)::int                                          AS total_users,
          COUNT(*) FILTER (WHERE plan = 'FREE')::int           AS free_users,
          COUNT(*) FILTER (WHERE plan = 'BASIC')::int          AS basic_users,
          COUNT(*) FILTER (WHERE plan = 'PRO')::int            AS pro_users,
          COUNT(*) FILTER (WHERE plan = 'MAX')::int            AS max_users,
          COUNT(*) FILTER (WHERE role = 'SUPERUSER')::int      AS superusers,
          COUNT(*) FILTER (WHERE role = 'PMO')::int            AS pmo_count,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::int AS new_this_week
        FROM users
      `;
            const mrr =
                (stats.basic_users * 29) +
                (stats.pro_users * 79) +
                (stats.max_users * 199);
            return ok({ stats: { ...stats, mrr_eur: mrr } });
        }

        // ── ADMIN/SUPERUSER: update user plan or role ─────────────
        if (subpath.match(/^\/users\/[^/]+$/) && event.httpMethod === 'PUT') {
            if (!isPMO) return fail('Forbidden', 403);
            const userId = subpath.split('/')[2];
            const { plan, role, name } = body;

            const validPlans = ['FREE', 'BASIC', 'PRO', 'MAX'];
            const validRoles = isSuperuser
                ? ['SUPERUSER', 'PMO', 'PM', 'VIEWER']
                : ['PMO', 'PM', 'VIEWER'];  // PMO cannot assign SUPERUSER role

            if (plan && !validPlans.includes(plan)) return fail('Invalid plan');
            if (role && !validRoles.includes(role)) return fail('Invalid role');

            const [updated] = await sql`
        UPDATE users
        SET
          plan = COALESCE(${plan || null}, plan),
          role = COALESCE(${role || null}, role),
          name = COALESCE(${name || null}, name)
        WHERE id = ${userId}
        RETURNING id, email, name, role, plan
      `;
            if (!updated) return fail('User not found', 404);
            return ok({ user: updated });
        }

        // ── SUPERUSER: create a user directly ────────────────────
        if (subpath === '/admin/users' && event.httpMethod === 'POST') {
            if (!isSuperuser) return fail('Forbidden', 403);
            const { email, password, name, role = 'VIEWER', plan = 'FREE' } = body;
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
