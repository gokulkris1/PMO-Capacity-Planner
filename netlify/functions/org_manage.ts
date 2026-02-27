import type { Handler, HandlerEvent } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET as string;
if (!JWT_SECRET) throw new Error("JWT_SECRET missing");

const CORS = {
    'Access-Control-Allow-Origin': process.env.URL || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Content-Type': 'application/json',
};

function ok(body: unknown, status = 200) { return { statusCode: status, headers: CORS, body: JSON.stringify(body) }; }
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
        // ── GET: List all orgs (SUPERUSER only) ──────────────────────
        if (event.httpMethod === 'GET') {
            if (userRole !== 'SUPERUSER') return fail('Forbidden', 403);

            const orgs = await sql`
                SELECT o.id, o.name, o.slug, o.logo_url, o.primary_color, o.created_at,
                    (SELECT COUNT(*)::int FROM users u WHERE u.org_id = o.id) as user_count,
                    (SELECT COUNT(*)::int FROM users u WHERE u.org_id = o.id AND u.role = 'ORG_ADMIN') as admin_count,
                    (SELECT COUNT(*)::int FROM workspaces w WHERE w.org_id = o.id) as workspace_count,
                    (SELECT COUNT(*)::int FROM projects p JOIN workspaces w ON w.id = p.workspace_id WHERE w.org_id = o.id) as project_count,
                    (SELECT COUNT(*)::int FROM resources r JOIN workspaces w ON w.id = r.workspace_id WHERE w.org_id = o.id) as resource_count
                FROM organizations o ORDER BY o.created_at DESC
            `;

            // Get admins per org
            const admins = await sql`
                SELECT u.id, u.email, u.name, u.role, u.org_id 
                FROM users u WHERE u.role IN ('ORG_ADMIN', 'ADMIN') ORDER BY u.name
            `;

            // Get workspaces per org
            const workspaces = await sql`
                SELECT w.id, w.name, w.org_id,
                    (SELECT COUNT(*)::int FROM workspace_members wm WHERE wm.workspace_id = w.id) as member_count
                FROM workspaces w ORDER BY w.name
            `;

            return ok({
                orgs: orgs.map(o => ({
                    ...o,
                    admins: admins.filter(a => a.org_id === o.id),
                    workspaces: workspaces.filter(w => w.org_id === o.id),
                }))
            });
        }

        // ── POST: Create a new org ───────────────────────────────────
        // Can be called by SUPERUSER (top-down) or any user without an org (bottom-up)
        if (event.httpMethod === 'POST') {
            const subpath = event.path.replace(/^.*\/api\/org_manage/, '');

            // POST /api/org_manage/:orgId/workspace — create workspace in org
            if (subpath.match(/^\/[^/]+\/workspace$/)) {
                const orgId = subpath.split('/')[1];
                const { name } = JSON.parse(event.body || '{}');
                if (!name) return fail('Workspace name required');

                // Permission: SUPERUSER, ORG_ADMIN (own org), PMO_ADMIN (own org)
                if (userRole !== 'SUPERUSER') {
                    const [caller] = await sql`SELECT org_id, role FROM users WHERE id = ${userId}`;
                    if (caller.org_id !== orgId && !['ORG_ADMIN', 'ADMIN', 'PMO_ADMIN'].includes(caller.role)) {
                        return fail('Forbidden', 403);
                    }
                }

                const [ws] = await sql`
                    INSERT INTO workspaces (id, org_id, name)
                    VALUES (gen_random_uuid(), ${orgId}, ${name})
                    RETURNING id, name
                `;

                // Add creator as PMO_ADMIN in the new workspace
                await sql`
                    INSERT INTO workspace_members (user_id, workspace_id, org_id, role, invited_by)
                    VALUES (${userId}, ${ws.id}, ${orgId}, 'PMO_ADMIN', ${userId})
                    ON CONFLICT DO NOTHING
                `;

                return ok({ success: true, workspace: ws }, 201);
            }

            // POST /api/org_manage — create org
            const { orgName, adminEmail, plan, logoUrl, primaryColor } = JSON.parse(event.body || '{}');
            if (!orgName) return fail('Organization name required');

            // Bottom-up: any user without org. Top-down: superuser only
            const [caller] = await sql`SELECT org_id, role FROM users WHERE id = ${userId}`;
            if (caller.org_id && userRole !== 'SUPERUSER') {
                return fail('You already belong to an organization', 400);
            }

            const orgSlug = generateSlug(orgName);

            // Create org
            const [org] = await sql`
                INSERT INTO organizations (id, name, slug, logo_url, primary_color)
                VALUES (gen_random_uuid(), ${orgName}, ${orgSlug}, ${logoUrl || null}, ${primaryColor || null})
                RETURNING id, slug, name
            `;

            // Create default workspace
            const [ws] = await sql`
                INSERT INTO workspaces (id, org_id, name)
                VALUES (gen_random_uuid(), ${org.id}, 'Default Workspace')
                RETURNING id
            `;

            if (userRole === 'SUPERUSER' && adminEmail) {
                // Top-down: assign admin to this org
                const cleanEmail = adminEmail.toLowerCase().trim();
                const existing = await sql`SELECT id FROM users WHERE email = ${cleanEmail}`;
                let adminId: string;

                if (existing.length > 0) {
                    adminId = existing[0].id;
                    await sql`UPDATE users SET org_id = ${org.id}, role = 'ORG_ADMIN' WHERE id = ${adminId}`;
                } else {
                    // Auto-create admin
                    const bcrypt = await import('bcryptjs');
                    const tempPw = 'Orbit' + Math.random().toString(36).slice(2, 8) + '!';
                    const hash = await bcrypt.hash(tempPw, 10);
                    const [newUser] = await sql`
                        INSERT INTO users (email, password_hash, name, role, plan, org_id)
                        VALUES (${cleanEmail}, ${hash}, ${cleanEmail.split('@')[0]}, 'ORG_ADMIN', ${plan || 'BASIC'}, ${org.id})
                        RETURNING id
                    `;
                    adminId = newUser.id;
                    console.log(`[DEV] Created admin ${cleanEmail} with temp password: ${tempPw}`);
                }

                // Add admin as PMO_ADMIN in default workspace
                await sql`
                    INSERT INTO workspace_members (user_id, workspace_id, org_id, role)
                    VALUES (${adminId}, ${ws.id}, ${org.id}, 'PMO_ADMIN')
                    ON CONFLICT DO NOTHING
                `;
            } else {
                // Bottom-up: creator becomes ORG_ADMIN
                await sql`UPDATE users SET org_id = ${org.id}, role = 'ORG_ADMIN' WHERE id = ${userId}`;
                await sql`
                    INSERT INTO workspace_members (user_id, workspace_id, org_id, role)
                    VALUES (${userId}, ${ws.id}, ${org.id}, 'PMO_ADMIN')
                    ON CONFLICT DO NOTHING
                `;
            }

            return ok({ success: true, orgSlug: org.slug, orgId: org.id }, 201);
        }

        // ── PUT: Update org (superuser) ──────────────────────────────
        if (event.httpMethod === 'PUT') {
            if (userRole !== 'SUPERUSER') return fail('Forbidden', 403);
            const subpath = event.path.replace(/^.*\/api\/org_manage/, '');
            const orgId = subpath.replace(/^\//, '');
            if (!orgId) return fail('Org ID required');

            const { plan, name } = JSON.parse(event.body || '{}');

            if (plan) {
                // Update all users in this org to the new plan
                await sql`UPDATE users SET plan = ${plan} WHERE org_id = ${orgId}`;
            }
            if (name) {
                await sql`UPDATE organizations SET name = ${name} WHERE id = ${orgId}`;
            }

            return ok({ success: true });
        }

        // ── DELETE: Delete org (superuser) ────────────────────────────
        if (event.httpMethod === 'DELETE') {
            if (userRole !== 'SUPERUSER') return fail('Forbidden', 403);
            const subpath = event.path.replace(/^.*\/api\/org_manage/, '');
            const orgId = subpath.replace(/^\//, '');
            if (!orgId) return fail('Org ID required');

            // Cascade: members → allocations → resources → projects → workspaces → users.org_id → org
            await sql`DELETE FROM workspace_members WHERE org_id = ${orgId}`;
            const wsIds = await sql`SELECT id FROM workspaces WHERE org_id = ${orgId}`;
            for (const ws of wsIds) {
                await sql`DELETE FROM allocations WHERE workspace_id = ${ws.id}`;
                await sql`DELETE FROM resources WHERE workspace_id = ${ws.id}`;
                await sql`DELETE FROM projects WHERE workspace_id = ${ws.id}`;
            }
            await sql`DELETE FROM workspaces WHERE org_id = ${orgId}`;
            await sql`UPDATE users SET org_id = NULL, role = 'USER' WHERE org_id = ${orgId}`;
            await sql`DELETE FROM organizations WHERE id = ${orgId}`;

            return ok({ success: true });
        }

        return fail('Method not allowed', 405);
    } catch (e: any) {
        console.error('[org_manage]', e);
        return fail('Failed: ' + e.message, 500);
    }
};
