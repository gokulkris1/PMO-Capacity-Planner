import type { Handler, HandlerEvent } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';

const getDb = () => neon(
    process.env.NETLIFY_DATABASE_URL_UNPOOLED ||
    process.env.NETLIFY_DATABASE_URL ||
    process.env.NEON_DATABASE_URL || ''
);

export const handler: Handler = async (event: HandlerEvent) => {
    const sql = getDb();
    try {
        const users = await sql`SELECT email, role, org_id FROM users WHERE email LIKE '%tom%' OR email LIKE '%gokul%'`;
        const wm = await sql`SELECT user_id, workspace_id, role, org_id FROM workspace_members`;
        const ws = await sql`SELECT id, name, org_id FROM workspaces`;
        return { statusCode: 200, body: JSON.stringify({ users, wm, ws }) };
    } catch (e: any) {
        return { statusCode: 500, body: e.message };
    }
}
