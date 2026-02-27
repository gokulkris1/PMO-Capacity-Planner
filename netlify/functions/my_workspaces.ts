import type { Handler, HandlerEvent } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET as string;
if (!JWT_SECRET) throw new Error('JWT_SECRET environment variable is missing');

const CORS = {
    'Access-Control-Allow-Origin': process.env.URL || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'OPTIONS, GET',
    'Content-Type': 'application/json',
};

function ok(body: unknown) { return { statusCode: 200, headers: CORS, body: JSON.stringify(body) }; }
function fail(msg: string, status = 400) { return { statusCode: status, headers: CORS, body: JSON.stringify({ error: msg }) }; }

const getDb = () => neon(
    process.env.NETLIFY_DATABASE_URL_UNPOOLED ||
    process.env.NETLIFY_DATABASE_URL ||
    process.env.NEON_DATABASE_URL || ''
);

export const handler: Handler = async (event: HandlerEvent) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
    if (event.httpMethod !== 'GET') return fail('Method Not Allowed', 405);

    const authHeader = event.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return fail('Unauthorized', 401);
    const token = authHeader.split(' ')[1];

    let userId: string;
    let userRole: string;
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as { id: string; role?: string };
        userId = decoded.id;
        userRole = decoded.role || 'MEMBER';
    } catch {
        return fail('Invalid token', 401);
    }

    try {
        const sql = getDb();
        let workspaces;

        if (userRole === 'SUPERUSER') {
            // Superuser sees ALL workspaces with WORKSPACE_ADMIN implicit role
            workspaces = await sql`
                SELECT
                    w.id,
                    w.name,
                    o.id   AS org_id,
                    o.name AS org_name,
                    o.slug AS org_slug,
                    'WORKSPACE_ADMIN' AS role
                FROM workspaces w
                JOIN organizations o ON o.id = w.org_id
                ORDER BY o.name, w.name
            `;
        } else {
            // Normal users: return workspaces they are explicitly a member of
            workspaces = await sql`
                SELECT
                    w.id,
                    w.name,
                    o.id   AS org_id,
                    o.name AS org_name,
                    o.slug AS org_slug,
                    wm.role
                FROM workspace_members wm
                JOIN workspaces    w ON w.id = wm.workspace_id
                JOIN organizations o ON o.id = wm.org_id
                WHERE wm.user_id = ${userId}
                ORDER BY o.name, w.name
            `;
        }

        return ok({ workspaces });
    } catch (e: any) {
        console.error('my_workspaces error', e);
        return fail('Server error: ' + e.message, 500);
    }
};
