import type { Handler, HandlerEvent } from '@netlify/functions';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.NEON_DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_in_prod';

export const handler: Handler = async (event: HandlerEvent) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Content-Type': 'application/json',
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    // Route: POST /api/auth/register or /api/auth/login
    const path = event.path.replace('/.netlify/functions/auth', '').replace('/api/auth', '');

    try {
        const body = JSON.parse(event.body || '{}');

        if (path === '/register' || path === '' && event.httpMethod === 'POST') {
            // ── REGISTER ────────────────────────────────────────────
            const { email, password, name } = body;
            if (!email || !password) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email and password are required' }) };
            }

            const check = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
            if (check.rows.length > 0) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email already registered' }) };
            }

            const hash = await bcrypt.hash(password, 10);
            const countRes = await pool.query('SELECT COUNT(*) FROM users');
            const isFirst = parseInt(countRes.rows[0].count) === 0;
            const role = isFirst ? 'PMO' : 'VIEWER';

            const result = await pool.query(
                `INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4) RETURNING id, email, name, role`,
                [email, hash, name || email.split('@')[0], role]
            );

            const user = result.rows[0];
            const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });

            return {
                statusCode: 201, headers,
                body: JSON.stringify({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role, plan: 'FREE' } }),
            };
        }

        if (path === '/login') {
            // ── LOGIN ─────────────────────────────────────────────
            const { email, password } = body;
            if (!email || !password) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email and password are required' }) };
            }

            const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
            if (result.rows.length === 0) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid email or password' }) };
            }

            const user = result.rows[0];
            const ok = await bcrypt.compare(password, user.password_hash);
            if (!ok) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid email or password' }) };
            }

            const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });

            return {
                statusCode: 200, headers,
                body: JSON.stringify({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role, plan: user.plan || 'FREE' } }),
            };
        }

        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Not found' }) };
    } catch (err: any) {
        console.error('Auth function error:', err);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server error', detail: err.message }) };
    }
};
