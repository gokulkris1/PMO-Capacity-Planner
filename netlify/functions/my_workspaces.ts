import type { Handler, HandlerEvent } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET as string;
if (!JWT_SECRET) throw new Error("JWT_SECRET missing");

const CORS = {
    'Access-Control-Allow-Origin': process.env.URL || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
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
    if (event.httpMethod !== 'GET') return fail('Method not allowed', 405);

    const authHeader = event.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return fail('Unauthorized', 401);

    let userId: string, userRole: string;
    try {
        const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET) as { id: string; role?: string };
        userId = decoded.id;
        userRole = decoded.role || 'USER';
    } catch { return fail('Invalid token', 401); }

    const sql = getDb();

    try {
        // SUPERUSER sees ALL workspaces across all orgs
        if (userRole === 'SUPERUSER') {
            const workspaces = await sql`
                SELECT w.id, w.name, o.id as org_id, o.name as org_name, o.slug as org_slug, 'PMO_ADMIN' as role
                FROM workspaces w JOIN organizations o ON o.id = w.org_id
                ORDER BY o.name, w.name
            `;
            return ok({ workspaces });
        }

        // Sync userRole with DB if it's the legacy ADMIN role
        if (userRole === 'ADMIN') {
            const [caller] = await sql`SELECT role, org_id FROM users WHERE id = ${userId}`;
            if (caller) {
                userRole = caller.role;
                if (!caller.org_id) return ok({ workspaces: [] });
            }
        }

        // ORG_ADMIN sees ALL workspaces in their org
        if (userRole === 'ORG_ADMIN') {
            const [caller] = await sql`SELECT org_id FROM users WHERE id = ${userId}`;
            if (!caller?.org_id) return ok({ workspaces: [] });

            const workspaces = await sql`
                SELECT w.id, w.name, o.id as org_id, o.name as org_name, o.slug as org_slug, 'PMO_ADMIN' as role
                FROM workspaces w JOIN organizations o ON o.id = w.org_id
                WHERE w.org_id = ${caller.org_id}
                ORDER BY w.name
            `;
            return ok({ workspaces });
        }

        // PMO_ADMIN / WORKSPACE_OWNER / USER — only their assigned workspaces
        const workspaces = await sql`
            SELECT w.id, w.name, o.id as org_id, o.name as org_name, o.slug as org_slug, wm.role
            FROM workspace_members wm
            JOIN workspaces w ON w.id = wm.workspace_id
            JOIN organizations o ON o.id = wm.org_id
            WHERE wm.user_id = ${userId}
            ORDER BY o.name, w.name
        `;
        return ok({ workspaces });

    } catch (e: any) {
        console.error(e);
        return fail('Failed: ' + e.message, 500);
    }
};
