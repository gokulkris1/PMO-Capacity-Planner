import type { Handler, HandlerEvent } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET as string;
if (!JWT_SECRET) throw new Error("JWT_SECRET environment variable is missing");

const CORS = {
    'Access-Control-Allow-Origin': process.env.URL || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'OPTIONS, POST',
    'Content-Type': 'application/json',
};

function ok(body: unknown) { return { statusCode: 200, headers: CORS, body: JSON.stringify(body) }; }
function fail(msg: string, status = 400) { return { statusCode: status, headers: CORS, body: JSON.stringify({ error: msg }) }; }

const getDb = () => neon(
    process.env.NETLIFY_DATABASE_URL_UNPOOLED ||
    process.env.NETLIFY_DATABASE_URL ||
    process.env.NEON_DATABASE_URL || ''
);

function generateSlug(name: string) {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') + '-' + Math.floor(Math.random() * 1000);
}

export const handler: Handler = async (event: HandlerEvent) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
    if (event.httpMethod !== 'POST') return fail('Method Not Allowed', 405);

    const authHeader = event.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return fail('Unauthorized', 401);
    const token = authHeader.split(' ')[1];

    let userId: string;
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as { id: string };
        userId = decoded.id;
    } catch {
        return fail('Invalid token', 401);
    }

    try {
        const { orgName, logoUrl, primaryColor } = JSON.parse(event.body || '{}');
        if (!orgName || typeof orgName !== 'string') return fail('Organization name required');

        const sql = getDb();
        const orgSlug = generateSlug(orgName);

        // 1. Create Organization
        const [org] = await sql`
            INSERT INTO organizations (id, name, slug, logo_url, primary_color) 
            VALUES (gen_random_uuid(), ${orgName}, ${orgSlug}, ${logoUrl || null}, ${primaryColor || null}) 
            RETURNING id, slug
        `;

        // 2. Create Default Workspace for Org
        await sql`
            INSERT INTO workspaces (id, org_id, name)
            VALUES (gen_random_uuid(), ${org.id}, 'Default Workspace')
        `;

        // 3. Retrieve Email
        const emailRows = await sql`SELECT email FROM users WHERE id = ${userId}`;
        const userEmail = emailRows.length > 0 ? emailRows[0].email : null;

        // 4. Bind User to Organization
        const assignedRole = userEmail === 'gokulkris1@gmail.com' ? 'SUPERUSER' : 'ADMIN';
        await sql`
            UPDATE users SET org_id = ${org.id}, role = ${assignedRole} WHERE id = ${userId}
        `;

        // 5. Fire Welcome Email
        if (process.env.INTERNAL_API_SECRET && userEmail) {
            try {
                const baseUrl = process.env.URL || 'http://localhost:5173';
                await fetch(`${baseUrl}/api/email_receipt`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${process.env.INTERNAL_API_SECRET}`
                    },
                    body: JSON.stringify({ type: 'WELCOME', email: userEmail, orgName })
                });
            } catch (err) {
                console.error('Non-blocking Email Dispatch Error:', err);
            }
        }

        return ok({ success: true, orgSlug: org.slug });
    } catch (e: any) {
        console.error('Org creation failed', e);
        return fail('Failed to create organization: ' + e.message, 500);
    }
};
