/**
 * netlify/functions/workspace.ts
 *
 * Changes from original:
 *  - GET: resolve workspaceRole from workspace_members, return it in response
 *  - POST (save): gate writes on workspace_members role, not users.role
 *  - Added CORS headers helper
 */
import { Handler } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

const sql = neon(process.env.DATABASE_URL!);

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json',
};

// ── helpers ──────────────────────────────────────────────────────────────────

function ok(body: unknown, status = 200) {
    return { statusCode: status, headers: CORS, body: JSON.stringify(body) };
}
function err(msg: string, status = 400) {
    return { statusCode: status, headers: CORS, body: JSON.stringify({ error: msg }) };
}

async function getWorkspaceRole(
    userId: string,
    workspaceId: string,
    platformRole: string,
): Promise<'WORKSPACE_ADMIN' | 'USER' | null> {
    // SUPERUSER always has full access
    if (platformRole === 'SUPERUSER') return 'WORKSPACE_ADMIN';

    const [row] = await sql`
        SELECT role FROM workspace_members
        WHERE user_id = ${userId} AND workspace_id = ${workspaceId}
    `;
    return (row?.role as 'WORKSPACE_ADMIN' | 'USER') ?? null;
}

// ── handler ──────────────────────────────────────────────────────────────────

export const handler: Handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

    // ── Auth ─────────────────────────────────────────────────────────────────
    const authHeader = event.headers['authorization'] || event.headers['Authorization'];
    if (!authHeader?.startsWith('Bearer ')) return err('Unauthorized', 401);

    let userId: string;
    let platformRole: string;
    try {
        const payload = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET!) as {
            id: string;
            role: string;
        };
        userId       = payload.id;
        platformRole = payload.role;
    } catch {
        return err('Invalid token', 401);
    }

    // ── GET workspace data ────────────────────────────────────────────────────
    if (event.httpMethod === 'GET') {
        const orgSlug     = event.queryStringParameters?.orgSlug;
        const workspaceId = event.queryStringParameters?.workspaceId;

        if (!orgSlug) return err('orgSlug is required');

        try {
            // Fetch workspace (by id or first in org)
            let workspace: any;
            if (workspaceId) {
                [workspace] = await sql`
                    SELECT w.*, o.name AS org_name, o.slug AS org_slug
                    FROM workspaces w
                    JOIN organizations o ON o.id = w.org_id
                    WHERE w.id = ${workspaceId} AND o.slug = ${orgSlug}
                `;
            } else {
                [workspace] = await sql`
                    SELECT w.*, o.name AS org_name, o.slug AS org_slug
                    FROM workspaces w
                    JOIN organizations o ON o.id = w.org_id
                    WHERE o.slug = ${orgSlug}
                    ORDER BY w.created_at ASC
                    LIMIT 1
                `;
            }
            if (!workspace) return err('Workspace not found', 404);

            // Resolve the caller's role in this workspace
            const workspaceRole = await getWorkspaceRole(userId, workspace.id, platformRole);

            // If null → user has no membership here
            if (workspaceRole === null && platformRole !== 'ORG_ADMIN') {
                return err('Forbidden — you are not a member of this workspace', 403);
            }
            // ORG_ADMIN has implicit read access even if not in workspace_members
            const effectiveRole = workspaceRole ?? (platformRole === 'ORG_ADMIN' ? 'WORKSPACE_ADMIN' : null);
            if (!effectiveRole) return err('Forbidden', 403);

            // Fetch workspace data
            const [resources, projects, allocations, members] = await Promise.all([
                sql`SELECT * FROM resources WHERE workspace_id = ${workspace.id} ORDER BY name`,
                sql`SELECT * FROM projects WHERE workspace_id = ${workspace.id} ORDER BY name`,
                sql`SELECT * FROM allocations WHERE workspace_id = ${workspace.id}`,
                // Only return members list to admins
                effectiveRole === 'WORKSPACE_ADMIN'
                    ? sql`
                        SELECT u.id, u.email, u.name, u.role AS platform_role, wm.role AS workspace_role
                        FROM workspace_members wm
                        JOIN users u ON u.id = wm.user_id
                        WHERE wm.workspace_id = ${workspace.id}
                        ORDER BY u.name
                      `
                    : Promise.resolve([]),
            ]);

            return ok({
                workspace: {
                    id:       workspace.id,
                    name:     workspace.name,
                    orgId:    workspace.org_id,
                    orgName:  workspace.org_name,
                    orgSlug:  workspace.org_slug,
                },
                workspaceRole: effectiveRole,
                resources,
                projects,
                allocations,
                members,
            });
        } catch (e) {
            console.error('workspace GET error:', e);
            return err('Server error', 500);
        }
    }

    // ── POST — save workspace data ────────────────────────────────────────────
    if (event.httpMethod === 'POST') {
        let body: any;
        try { body = JSON.parse(event.body || '{}'); } catch { return err('Invalid JSON'); }

        const { workspaceId, resources, projects, allocations } = body;
        if (!workspaceId) return err('workspaceId required');

        // Gate on workspace_members role
        const workspaceRole = await getWorkspaceRole(userId, workspaceId, platformRole);
        const canWrite =
            platformRole === 'SUPERUSER' ||
            platformRole === 'ORG_ADMIN' ||
            workspaceRole === 'WORKSPACE_ADMIN';

        if (!canWrite) return err('Forbidden — Workspace Admin role required', 403);

        try {
            // Delete existing and reinsert (same pattern as original)
            await sql`DELETE FROM allocations WHERE workspace_id = ${workspaceId}`;
            await sql`DELETE FROM resources   WHERE workspace_id = ${workspaceId}`;
            await sql`DELETE FROM projects    WHERE workspace_id = ${workspaceId}`;

            if (resources?.length) {
                for (const r of resources) {
                    await sql`
                        INSERT INTO resources (id, name, role, availability, workspace_id)
                        VALUES (${r.id}, ${r.name}, ${r.role}, ${r.availability}, ${workspaceId})
                    `;
                }
            }
            if (projects?.length) {
                for (const p of projects) {
                    await sql`
                        INSERT INTO projects (id, name, start_date, end_date, workspace_id)
                        VALUES (${p.id}, ${p.name}, ${p.startDate}, ${p.endDate}, ${workspaceId})
                    `;
                }
            }
            if (allocations?.length) {
                for (const a of allocations) {
                    await sql`
                        INSERT INTO allocations (id, resource_id, project_id, percentage, workspace_id)
                        VALUES (${a.id}, ${a.resourceId}, ${a.projectId}, ${a.percentage}, ${workspaceId})
                    `;
                }
            }

            return ok({ success: true });
        } catch (e) {
            console.error('workspace POST error:', e);
            return err('Server error', 500);
        }
    }

    return err('Method not allowed', 405);
};
