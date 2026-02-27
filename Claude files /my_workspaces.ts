import { Handler } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

const sql = neon(process.env.DATABASE_URL!);

export const handler: Handler = async (event) => {
    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    // ── Auth ──────────────────────────────────────────────────────────────────
    const authHeader = event.headers['authorization'] || event.headers['Authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
        return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    let userId: string;
    try {
        const payload = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET!) as { id: string };
        userId = payload.id;
    } catch {
        return { statusCode: 401, body: JSON.stringify({ error: 'Invalid token' }) };
    }

    // ── Fetch workspaces ──────────────────────────────────────────────────────
    try {
        // SUPERUSER / ORG_ADMIN: pull from workspace_members (backfilled) — same query
        const workspaces = await sql`
            SELECT
                w.id,
                w.name,
                o.id   AS org_id,
                o.name AS org_name,
                o.slug AS org_slug,
                wm.role
            FROM workspace_members wm
            JOIN workspaces     w ON w.id  = wm.workspace_id
            JOIN organizations  o ON o.id  = wm.org_id
            WHERE wm.user_id = ${userId}
            ORDER BY o.name, w.name
        `;

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workspaces }),
        };
    } catch (err) {
        console.error('my_workspaces error:', err);
        return { statusCode: 500, body: JSON.stringify({ error: 'Server error' }) };
    }
};
