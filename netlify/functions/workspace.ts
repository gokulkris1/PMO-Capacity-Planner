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

    let userId: string;
    let userRole = 'USER';
    let userOrgId: string | null = null;
    try {
        const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET) as { id: string; role?: string; org_id?: string };
        userId = decoded.id;
        userRole = decoded.role || 'USER';
        userOrgId = decoded.org_id || null;
    } catch { return fail('Invalid token', 401); }

    let orgSlug = event.queryStringParameters?.orgSlug;
    const sql = getDb();

    // ── GET — load workspace data ────────────────────────────────────────
    if (event.httpMethod === 'GET') {
        if (!orgSlug) return fail('Organization slug required', 400);
        try {
            // Resolve workspace from slug
            let wsRows;
            if (userRole === 'SUPERUSER') {
                // Superuser can access any org
                wsRows = await sql`
                    SELECT w.id, w.name as ws_name, o.name as org_name, o.slug, o.logo_url, o.primary_color, o.id as org_id
                    FROM workspaces w JOIN organizations o ON o.id = w.org_id
                    WHERE o.slug = ${orgSlug} LIMIT 1
                `;
            } else {
                // Everyone else must belong to this org
                wsRows = await sql`
                    SELECT w.id, w.name as ws_name, o.name as org_name, o.slug, o.logo_url, o.primary_color, o.id as org_id, u.role as db_role
                    FROM workspaces w
                    JOIN users u ON u.org_id = w.org_id
                    JOIN organizations o ON o.id = w.org_id
                    WHERE u.id = ${userId} AND o.slug = ${orgSlug}
                    LIMIT 1
                `;
            }

            if (wsRows.length === 0) return fail('Unauthorized for this organization', 403);

            const wsId = wsRows[0].id;
            const wsName = wsRows[0].ws_name;
            const orgName = wsRows[0].org_name;
            const logoUrl = wsRows[0].logo_url;
            const primaryColor = wsRows[0].primary_color;

            // Sync userRole with DB if available (fixes stale JWTs with legacy 'ADMIN' role)
            if (wsRows[0].db_role) {
                userRole = wsRows[0].db_role;
            } else if (userRole === 'ADMIN') {
                userRole = 'ORG_ADMIN';
            }

            // Resolve workspace role
            let workspaceRole: string = 'USER';
            if (userRole === 'SUPERUSER' || userRole === 'ORG_ADMIN') {
                workspaceRole = 'PMO_ADMIN'; // Full access
            } else {
                const memberRows = await sql`
                    SELECT role FROM workspace_members
                    WHERE user_id = ${userId} AND workspace_id = ${wsId}
                `;
                if (memberRows.length > 0) {
                    workspaceRole = memberRows[0].role;
                } else {
                    // Not in workspace_members but belongs to org — default to USER
                    workspaceRole = 'USER';
                }
            }

            const canWriteData = ['SUPERUSER', 'ORG_ADMIN', 'ADMIN'].includes(userRole) ||
                ['PMO_ADMIN', 'WORKSPACE_OWNER'].includes(workspaceRole);

            const [resources, projects, allocations, members] = await Promise.all([
                sql`SELECT * FROM resources WHERE workspace_id = ${wsId}`,
                sql`SELECT * FROM projects WHERE workspace_id = ${wsId}`,
                sql`SELECT * FROM allocations WHERE workspace_id = ${wsId}`,
                // Members visible to PMO_ADMIN+ only
                canWriteData
                    ? sql`
                        SELECT u.id, u.email, u.name, u.role AS platform_role, wm.role AS workspace_role
                        FROM workspace_members wm JOIN users u ON u.id = wm.user_id
                        WHERE wm.workspace_id = ${wsId} ORDER BY u.name
                      `
                    : Promise.resolve([]),
            ]);

            const mapRes = resources.map((r: any) => ({
                id: r.id, name: r.name, role: r.role, type: r.type, department: r.department,
                teamId: r.team_id, totalCapacity: Number(r.total_capacity),
                avatarInitials: r.avatar_initials, email: r.email, location: r.location,
                dailyRate: r.daily_rate_eur ? Number(r.daily_rate_eur) : undefined
            }));
            const mapProj = projects.map((p: any) => ({
                id: p.id, name: p.name, status: p.status, priority: p.priority,
                description: p.description || '', startDate: p.start_date, endDate: p.end_date,
                clientName: p.client_name, budget: p.budget ? Number(p.budget) : undefined,
                color: p.color
            }));
            const mapAlloc = allocations.map((a: any) => ({
                id: a.id, resourceId: a.resource_id, projectId: a.project_id,
                percentage: Number(a.percentage), startDate: a.start_date, endDate: a.end_date
            }));

            return ok({
                resources: mapRes, projects: mapProj, allocations: mapAlloc,
                orgName, workspaceName: wsName, logoUrl, primaryColor,
                workspaceRole, canWrite: canWriteData, members
            });
        } catch (e: any) {
            console.error(e);
            return fail('Failed to fetch workspace: ' + e.message, 500);
        }
    }

    // ── POST — save workspace data ───────────────────────────────────────
    if (event.httpMethod === 'POST') {
        try {
            const body = JSON.parse(event.body || '{}');
            const { resources = [], projects = [], allocations = [], workspaceId: bodyWsId, forceWipe = false } = body;

            // Resolve workspace
            let wsRows;
            if (bodyWsId) {
                wsRows = await sql`
                    SELECT w.id, u.plan, w.org_id FROM workspaces w
                    JOIN users u ON u.org_id = w.org_id
                    WHERE w.id = ${bodyWsId} AND u.id = ${userId} LIMIT 1
                `;
                if (!wsRows.length && userRole === 'SUPERUSER') {
                    wsRows = await sql`SELECT id, 'MAX' as plan, org_id FROM workspaces WHERE id = ${bodyWsId} LIMIT 1`;
                }
            } else if (userRole === 'SUPERUSER' && orgSlug) {
                wsRows = await sql`
                    SELECT w.id, 'MAX' as plan, w.org_id FROM workspaces w
                    JOIN organizations o ON o.id = w.org_id WHERE o.slug = ${orgSlug} LIMIT 1
                `;
            } else {
                wsRows = await sql`
                    SELECT w.id, u.plan, w.org_id FROM workspaces w
                    JOIN users u ON u.org_id = w.org_id
                    WHERE u.id = ${userId} LIMIT 1
                `;
            }

            if (!wsRows || wsRows.length === 0) return fail('Workspace not found', 404);
            const wsId = wsRows[0].id;
            const plan = (wsRows[0].plan || 'BASIC').toUpperCase();

            // Check write permission
            const canWrite = ['SUPERUSER', 'ORG_ADMIN', 'ADMIN'].includes(userRole);
            if (!canWrite) {
                const memberRows = await sql`SELECT role FROM workspace_members WHERE user_id = ${userId} AND workspace_id = ${wsId}`;
                const wsRole = memberRows[0]?.role || 'USER';
                if (wsRole === 'USER') return fail('You do not have write access to this workspace', 403);
            }

            // Plan limits
            const limits: Record<string, { resources: number; projects: number }> = {
                BASIC: { resources: 5, projects: 5 },
                PRO: { resources: 10, projects: 10 },
                MAX: { resources: 999, projects: 999 },
            };
            const lim = limits[plan] || limits.BASIC;

            if (resources.length > lim.resources) return fail(`${plan} plan allows max ${lim.resources} resources`, 403);
            if (projects.length > lim.projects) return fail(`${plan} plan allows max ${lim.projects} projects`, 403);

            // Backend Safety Guard: Prevent accidental full wipe from frontend race conditions
            if (!forceWipe && resources.length === 0 && projects.length === 0) {
                const existingDb = await sql`
                    SELECT 
                        (SELECT count(*) FROM resources WHERE workspace_id = ${wsId}) as r_count,
                        (SELECT count(*) FROM projects WHERE workspace_id = ${wsId}) as p_count
                `;
                if (existingDb.length > 0 && (Number(existingDb[0].r_count) > 0 || Number(existingDb[0].p_count) > 0)) {
                    return fail('Safety Guard: Payload is empty but DB has data. Preventing accidental DB wipe. Use forceWipe=true if intentional.', 400);
                }
            }

            // Clear + re-insert (transactional save)
            await sql`DELETE FROM allocations WHERE workspace_id = ${wsId}`;
            await sql`DELETE FROM resources WHERE workspace_id = ${wsId}`;
            await sql`DELETE FROM projects WHERE workspace_id = ${wsId}`;

            for (const r of resources) {
                await sql`
                    INSERT INTO resources (id, workspace_id, name, role, type, department, team_id, total_capacity, avatar_initials, email, location, daily_rate_eur)
                    VALUES (${r.id}, ${wsId}, ${r.name}, ${r.role || ''}, ${r.type || 'Permanent'}, ${r.department || ''}, ${r.teamId || null},
                            ${r.totalCapacity ?? 100}, ${r.avatarInitials || null}, ${r.email || null}, ${r.location || null}, ${r.dailyRate || null})
                `;
            }

            for (const p of projects) {
                await sql`
                    INSERT INTO projects (id, workspace_id, name, status, priority, description, start_date, end_date, client_name, budget, color)
                    VALUES (${p.id}, ${wsId}, ${p.name}, ${p.status || 'Active'}, ${p.priority || 'Medium'}, ${p.description || ''},
                            ${p.startDate || null}, ${p.endDate || null}, ${p.clientName || null}, ${p.budget || null}, ${p.color || null})
                `;
            }

            for (const a of allocations) {
                if (!a.percentage || a.percentage <= 0) continue;
                await sql`
                    INSERT INTO allocations (id, workspace_id, resource_id, project_id, percentage, start_date, end_date)
                    VALUES (${a.id}, ${wsId}, ${a.resourceId}, ${a.projectId}, ${a.percentage}, ${a.startDate || null}, ${a.endDate || null})
                `;
            }

            return ok({ success: true });
        } catch (e: any) {
            console.error(e);
            return fail('Save failed: ' + e.message, 500);
        }
    }

    return fail('Method not allowed', 405);
};
