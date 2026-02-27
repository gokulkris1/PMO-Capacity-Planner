import type { Handler, HandlerEvent } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET as string;
if (!JWT_SECRET) throw new Error("JWT_SECRET environment variable is missing");

const CORS = {
    'Access-Control-Allow-Origin': process.env.URL || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

    const authHeader = event.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return fail('Unauthorized', 401);
    const token = authHeader.split(' ')[1];

    let userId: string;
    let userRole = 'USER';
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as { id: string, role?: string };
        userId = decoded.id;
        userRole = decoded.role || 'USER';
    } catch {
        return fail('Invalid token', 401);
    }

    let orgSlug = event.queryStringParameters?.orgSlug;
    const sql = getDb();

    if (event.httpMethod === 'GET') {
        if (!orgSlug) return fail('Organization slug required', 400);
        try {
            // Get user's org and workspace, explicitly validating the slug
            // Superusers bypass the org restriction check completely.
            let wsRows;
            if (userRole === 'SUPERUSER') {
                wsRows = await sql`
                    SELECT w.id, w.name as ws_name, o.name as org_name, o.slug, o.logo_url, o.primary_color 
                    FROM workspaces w
                    JOIN organizations o ON o.id = w.org_id
                    WHERE o.slug = ${orgSlug}
                    LIMIT 1
                `;
            } else {
                wsRows = await sql`
                    SELECT w.id, w.name as ws_name, o.name as org_name, o.slug, o.logo_url, o.primary_color 
                    FROM workspaces w
                    JOIN users u ON u.org_id = w.org_id
                    JOIN organizations o ON o.id = w.org_id
                    WHERE u.id = ${userId} AND o.slug = ${orgSlug}
                    LIMIT 1
                `;
            }

            let wsId, wsName, orgName, logoUrl, primaryColor;

            if (wsRows.length > 0) {
                wsId = wsRows[0].id;
                wsName = wsRows[0].ws_name;
                orgName = wsRows[0].org_name;
                logoUrl = wsRows[0].logo_url;
                primaryColor = wsRows[0].primary_color;
            } else {
                return fail('Unauthorized for this organization limit', 403);
            }

            // Resolve workspace role from workspace_members
            let workspaceRole: 'WORKSPACE_ADMIN' | 'USER' | null = null;
            if (userRole === 'SUPERUSER' || userRole === 'ORG_ADMIN') {
                workspaceRole = 'WORKSPACE_ADMIN';
            } else {
                const [memberRow] = await sql`
                    SELECT role FROM workspace_members
                    WHERE user_id = ${userId} AND workspace_id = ${wsId}
                `;
                workspaceRole = (memberRow?.role as 'WORKSPACE_ADMIN' | 'USER') ?? null;
                if (!workspaceRole) return fail('Forbidden — you are not a member of this workspace', 403);
            }

            const [resources, projects, allocations, members] = await Promise.all([
                sql`SELECT * FROM resources WHERE workspace_id = ${wsId}`,
                sql`SELECT * FROM projects WHERE workspace_id = ${wsId}`,
                sql`SELECT * FROM allocations WHERE workspace_id = ${wsId}`,
                // Return members list only to admins
                workspaceRole === 'WORKSPACE_ADMIN'
                    ? sql`
                        SELECT u.id, u.email, u.name, u.role AS platform_role, wm.role AS workspace_role
                        FROM workspace_members wm
                        JOIN users u ON u.id = wm.user_id
                        WHERE wm.workspace_id = ${wsId}
                        ORDER BY u.name
                      `
                    : Promise.resolve([]),
            ]);

            const mapRes = resources.map(r => ({
                id: r.id, name: r.name, role: r.role, type: r.type, department: r.department,
                teamId: r.team_id, totalCapacity: Number(r.total_capacity),
                avatarInitials: r.avatar_initials, email: r.email, location: r.location,
                dailyRate: r.daily_rate_eur ? Number(r.daily_rate_eur) : undefined
            }));
            const mapProj = projects.map(p => ({
                id: p.id, name: p.name, status: p.status, priority: p.priority,
                description: p.description || '', startDate: p.start_date, endDate: p.end_date,
                clientName: p.client_name, budget: p.budget ? Number(p.budget) : undefined,
                color: p.color
            }));
            const mapAlloc = allocations.map(a => ({
                id: a.id, resourceId: a.resource_id, projectId: a.project_id, percentage: Number(a.percentage),
                startDate: a.start_date, endDate: a.end_date
            }));

            return ok({ resources: mapRes, projects: mapProj, allocations: mapAlloc, orgName, workspaceName: wsName, logoUrl, primaryColor, workspaceRole, members });
        } catch (e: any) {
            console.error(e);
            return fail('Failed to fetch workspace: ' + e.message, 500);
        }
    }

    if (event.httpMethod === 'POST') {
        try {
            const body = JSON.parse(event.body || '{}');
            const { resources = [], projects = [], allocations = [], workspaceId: bodyWsId } = body;

            // Resolve workspace + user plan. If workspaceId provided in body, use it (workspace switcher support).
            let wsRows;
            if (bodyWsId) {
                wsRows = await sql`
                    SELECT w.id, u.plan, w.org_id FROM workspaces w
                    JOIN users u ON u.org_id = w.org_id
                    WHERE w.id = ${bodyWsId} AND u.id = ${userId}
                    LIMIT 1
                `;
                // SUPERUSER can save to any workspace
                if (!wsRows.length && userRole === 'SUPERUSER') {
                    wsRows = await sql`SELECT id, 'MAX' as plan, org_id FROM workspaces WHERE id = ${bodyWsId} LIMIT 1`;
                }
            } else if (userRole === 'SUPERUSER' && orgSlug) {
                wsRows = await sql`
                    SELECT w.id, 'MAX' as plan, w.org_id FROM workspaces w
                    JOIN organizations o ON o.id = w.org_id
                    WHERE o.slug = ${orgSlug}
                    LIMIT 1
                `;
            } else {
                wsRows = await sql`
                    SELECT w.id, u.plan, w.org_id FROM workspaces w
                    JOIN users u ON u.org_id = w.org_id
                    WHERE u.id = ${userId}
                    LIMIT 1
                `;
            }

            const wsId = wsRows.length > 0 ? wsRows[0].id : null;
            const orgId = wsRows.length > 0 ? wsRows[0].org_id : null;
            const userPlan = wsRows.length > 0 ? wsRows[0].plan : 'BASIC';

            // Gate writes on workspace_members role
            if (userRole !== 'SUPERUSER' && userRole !== 'ORG_ADMIN') {
                const [member] = await sql`
                    SELECT role FROM workspace_members
                    WHERE user_id = ${userId} AND workspace_id = ${wsId}
                `;
                if (member?.role !== 'WORKSPACE_ADMIN') {
                    return fail('Forbidden — Workspace Admin role required to save', 403);
                }
            }

            if (!wsId || !orgId) return fail('Unauthorized no workspace found for user', 403);

            // ── FREEMIUM LIMIT ENFORCEMENT ──
            if (userPlan === 'BASIC' || !userPlan) {
                if (resources.length > 5) {
                    return fail('Free Plan Limit Exceeded: Maximum 5 resources allowed. Please upgrade to Pro.', 403);
                }
                const ownProjects = projects.filter((p: any) => p.id !== 'demo');
                if (ownProjects.length > 5) {
                    return fail('Basic Plan Limit Exceeded: Maximum 5 custom projects allowed. Please upgrade to Pro.', 403);
                }
            }

            // Wipe current data for the workspace
            await sql`DELETE FROM allocations WHERE workspace_id = ${wsId}`;
            await sql`DELETE FROM projects WHERE workspace_id = ${wsId}`;
            await sql`DELETE FROM resources WHERE workspace_id = ${wsId}`;

            if (resources.length > 0) {
                await Promise.all(resources.map((r: any) => sql`
          INSERT INTO resources (id, user_id, workspace_id, org_id, name, role, type, department, team_id, total_capacity, avatar_initials, email, location, daily_rate_eur)
          VALUES (${r.id}, ${userId}, ${wsId}, ${orgId}, ${r.name}, ${r.role || null}, ${r.type}, ${r.department || null}, ${r.teamId || null}, ${r.totalCapacity}, ${r.avatarInitials || null}, ${r.email || null}, ${r.location || null}, ${r.dailyRate || null})
        `));
            }

            if (projects.length > 0) {
                await Promise.all(projects.map((p: any) => sql`
          INSERT INTO projects (id, user_id, workspace_id, org_id, name, status, priority, description, start_date, end_date, client_name, budget, color)
          VALUES (${p.id}, ${userId}, ${wsId}, ${orgId}, ${p.name}, ${p.status}, ${p.priority}, ${p.description || null}, ${p.startDate || null}, ${p.endDate || null}, ${p.clientName || null}, ${p.budget || null}, ${p.color || null})
        `));
            }

            if (allocations.length > 0) {
                await Promise.all(allocations.map((a: any) => sql`
          INSERT INTO allocations (id, user_id, workspace_id, org_id, resource_id, project_id, percentage, start_date, end_date)
          VALUES (${a.id}, ${userId}, ${wsId}, ${orgId}, ${a.resourceId}, ${a.projectId}, ${Number(a.percentage) || 0}, ${a.startDate || null}, ${a.endDate || null})
        `));
            }

            return ok({ success: true, count: { r: resources.length, p: projects.length, a: allocations.length } });
        } catch (e: any) {
            console.error(e);
            return fail('Failed to sync workspace: ' + e.message, 500);
        }
    }

    return fail('Not Found', 404);
};
