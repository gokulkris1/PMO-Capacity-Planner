import type { Handler, HandlerEvent } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET as string;
if (!JWT_SECRET) throw new Error("JWT_SECRET environment variable is missing");

const CORS = {
    'Access-Control-Allow-Origin': process.env.URL || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
};

function ok(body: unknown, status = 200) { return { statusCode: status, headers: CORS, body: JSON.stringify(body) }; }
function fail(msg: string, status = 400) { return { statusCode: status, headers: CORS, body: JSON.stringify({ error: msg }) }; }

type JWTPayload = { id: string; email: string; role: string; org_id?: string };

function verifyToken(authHeader: string): JWTPayload {
    if (!authHeader?.startsWith('Bearer ')) throw new Error('Unauthorized');
    return jwt.verify(authHeader.slice(7), JWT_SECRET) as JWTPayload;
}

function getDb() {
    const url = process.env.NEON_DATABASE_URL || process.env.NETLIFY_DATABASE_URL_UNPOOLED || process.env.NETLIFY_DATABASE_URL;
    if (!url) throw new Error('No DB URL');
    return neon(url);
}

export const handler: Handler = async (event: HandlerEvent) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

    try {
        let actor: JWTPayload;
        try { actor = verifyToken(event.headers.authorization || ''); }
        catch { return fail('Unauthorized', 401); }

        if (actor.role !== 'SUPERUSER') {
            return fail('Forbidden: Superuser access required', 403);
        }

        const sql = getDb();

        if (event.httpMethod === 'GET') {
            // Fetch latest 100 audit logs limit
            const logs = await sql`
                SELECT a.id, a.action, a.details, a.ip_address, a.created_at, 
                       u.email as user_email, u.name as user_name
                FROM audit_logs a
                LEFT JOIN users u ON a.user_id = u.id
                ORDER BY a.created_at DESC
                LIMIT 100
            `;
            return ok({ logs });
        }

        return fail('Method not allowed', 405);

    } catch (e: any) {
        console.error('[audit fn]', e.message);
        return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Server error', detail: e.message }) };
    }
};
