import type { Handler, HandlerEvent } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_in_prod';

function getDb() {
    const url = process.env.NEON_DATABASE_URL;
    if (!url) throw new Error('NEON_DATABASE_URL not set');
    return neon(url);
}

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Content-Type': 'application/json',
};

function ok(body: unknown, status = 200) {
    return { statusCode: status, headers: CORS, body: JSON.stringify(body) };
}
function err(message: string, status = 400) {
    return { statusCode: status, headers: CORS, body: JSON.stringify({ error: message }) };
}

export const handler: Handler = async (event: HandlerEvent) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

    // Extract sub-route: /api/auth/register → /register
    const subpath = event.path
        .replace(/.*\/api\/auth/, '')
        .replace(/.*\/auth/, '')
        || '/';

    let body: Record<string, string> = {};
    try { body = JSON.parse(event.body || '{}'); } catch { }

    const sql = getDb();

    try {
        // ── REGISTER ─────────────────────────────────────────────
        if (subpath === '/register' && event.httpMethod === 'POST') {
            const { email, password, name } = body;
            if (!email || !password) return err('Email and password are required');

            const existing = await sql`SELECT id FROM users WHERE email = ${email}`;
            if (existing.length > 0) return err('Email already registered');

            const hash = await bcrypt.hash(password, 10);

            // First user ever → PMO (super admin), everyone else → VIEWER
            const count = await sql`SELECT COUNT(*)::int as n FROM users`;
            const role = count[0].n === 0 ? 'PMO' : 'VIEWER';

            const [user] = await sql`
        INSERT INTO users (email, password_hash, name, role)
        VALUES (${email}, ${hash}, ${name || email.split('@')[0]}, ${role})
        RETURNING id, email, name, role
      `;

            const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
            return ok({ token, user: { ...user, plan: 'FREE' } }, 201);
        }

        // ── LOGIN ─────────────────────────────────────────────────
        if (subpath === '/login' && event.httpMethod === 'POST') {
            const { email, password } = body;
            if (!email || !password) return err('Email and password are required');

            const rows = await sql`SELECT * FROM users WHERE email = ${email}`;
            if (rows.length === 0) return err('Invalid email or password', 401);

            const user = rows[0];
            const ok2 = await bcrypt.compare(password, user.password_hash);
            if (!ok2) return err('Invalid email or password', 401);

            const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
            return ok({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role, plan: user.plan || 'FREE' } });
        }

        // ── ADMIN: list all users (PMO only) ──────────────────────
        if (subpath === '/users' && event.httpMethod === 'GET') {
            const authHeader = event.headers.authorization || '';
            if (!authHeader.startsWith('Bearer ')) return err('Unauthorized', 401);
            const payload = jwt.verify(authHeader.slice(7), JWT_SECRET) as { role: string };
            if (payload.role !== 'PMO') return err('Forbidden', 403);

            const users = await sql`
        SELECT id, email, name, role, plan, created_at FROM users ORDER BY created_at DESC
      `;
            return ok({ users });
        }

        // ── ADMIN: update user plan/role (PMO only) ───────────────
        if (subpath.startsWith('/users/') && event.httpMethod === 'PUT') {
            const authHeader = event.headers.authorization || '';
            if (!authHeader.startsWith('Bearer ')) return err('Unauthorized', 401);
            const payload = jwt.verify(authHeader.slice(7), JWT_SECRET) as { role: string };
            if (payload.role !== 'PMO') return err('Forbidden', 403);

            const userId = subpath.split('/')[2];
            const { plan, role } = body;

            const validPlans = ['FREE', 'BASIC', 'PRO', 'MAX'];
            const validRoles = ['PMO', 'PM', 'VIEWER'];

            if (plan && !validPlans.includes(plan)) return err('Invalid plan');
            if (role && !validRoles.includes(role)) return err('Invalid role');

            const [updated] = await sql`
        UPDATE users
        SET plan = COALESCE(${plan || null}, plan),
            role = COALESCE(${role || null}, role)
        WHERE id = ${userId}
        RETURNING id, email, name, role, plan
      `;
            return ok({ user: updated });
        }

        return err('Not found', 404);
    } catch (e: any) {
        console.error('Auth function error:', e);
        return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Server error', detail: e.message }) };
    }
};
