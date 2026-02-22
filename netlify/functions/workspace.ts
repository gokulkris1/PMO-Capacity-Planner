import type { Handler, HandlerEvent } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_for_dev_only';

const CORS = {
    'Access-Control-Allow-Origin': '*',
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
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as { id: string };
        userId = decoded.id;
    } catch {
        return fail('Invalid token', 401);
    }

    const sql = getDb();

    if (event.httpMethod === 'GET') {
        try {
            // Get user's org and workspace
            let wsRows = await sql`
                SELECT w.id, w.name as ws_name, o.name as org_name 
                FROM workspaces w
                JOIN users u ON u.org_id = w.org_id
                JOIN organizations o ON o.id = w.org_id
                WHERE u.id = ${userId}
                LIMIT 1
            `;
            let wsId, wsName, orgName;

            if (wsRows.length > 0) {
                wsId = wsRows[0].id;
                wsName = wsRows[0].ws_name;
                orgName = wsRows[0].org_name;
            } else {
                // Legacy User Fallback (if they existed before Orgs)
                const [org] = await sql`INSERT INTO organizations (id, name) VALUES (gen_random_uuid(), 'Legacy Org') RETURNING id, name`;
                const [ws] = await sql`INSERT INTO workspaces (id, org_id, name) VALUES (gen_random_uuid(), ${org.id}, 'Default Workspace') RETURNING id, name`;
                await sql`UPDATE users SET org_id = ${org.id} WHERE id = ${userId}`;
                wsId = ws.id;
                wsName = ws.name;
                orgName = org.name;
            }

            const resources = await sql`SELECT * FROM resources WHERE workspace_id = ${wsId}`;
            const projects = await sql`SELECT * FROM projects WHERE workspace_id = ${wsId}`;
            const allocations = await sql`SELECT * FROM allocations WHERE workspace_id = ${wsId}`;

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

            return ok({ resources: mapRes, projects: mapProj, allocations: mapAlloc, orgName, workspaceName: wsName });
        } catch (e: any) {
            console.error(e);
            return fail('Failed to fetch workspace: ' + e.message, 500);
        }
    }

    if (event.httpMethod === 'POST') {
        try {
            const body = JSON.parse(event.body || '{}');
            const { resources = [], projects = [], allocations = [] } = body;

            // Get user's Workspace ID
            let wsRows = await sql`
                SELECT w.id FROM workspaces w
                JOIN users u ON u.org_id = w.org_id
                WHERE u.id = ${userId}
                LIMIT 1
            `;
            const wsId = wsRows.length > 0 ? wsRows[0].id : null;
            if (!wsId) return fail('No workspace found for user', 400);

            // Wipe current data for the workspace
            await sql`DELETE FROM allocations WHERE workspace_id = ${wsId}`;
            await sql`DELETE FROM projects WHERE workspace_id = ${wsId}`;
            await sql`DELETE FROM resources WHERE workspace_id = ${wsId}`;

            if (resources.length > 0) {
                await Promise.all(resources.map((r: any) => sql`
          INSERT INTO resources (id, user_id, workspace_id, name, role, type, department, team_id, total_capacity, avatar_initials, email, location, daily_rate_eur)
          VALUES (${r.id}, ${userId}, ${wsId}, ${r.name}, ${r.role || null}, ${r.type}, ${r.department || null}, ${r.teamId || null}, ${r.totalCapacity}, ${r.avatarInitials || null}, ${r.email || null}, ${r.location || null}, ${r.dailyRate || null})
        `));
            }

            if (projects.length > 0) {
                await Promise.all(projects.map((p: any) => sql`
          INSERT INTO projects (id, user_id, workspace_id, name, status, priority, description, start_date, end_date, client_name, budget, color)
          VALUES (${p.id}, ${userId}, ${wsId}, ${p.name}, ${p.status}, ${p.priority}, ${p.description || null}, ${p.startDate || null}, ${p.endDate || null}, ${p.clientName || null}, ${p.budget || null}, ${p.color || null})
        `));
            }

            if (allocations.length > 0) {
                await Promise.all(allocations.map((a: any) => sql`
          INSERT INTO allocations (id, user_id, workspace_id, resource_id, project_id, percentage, start_date, end_date)
          VALUES (${a.id}, ${userId}, ${wsId}, ${a.resourceId}, ${a.projectId}, ${a.percentage}, ${a.startDate || null}, ${a.endDate || null})
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
