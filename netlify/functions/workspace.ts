import type { Handler, HandlerEvent } from '@netlify/functions';
import { neon, Pool } from '@neondatabase/serverless';
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

const getPool = () => new Pool({
    connectionString:
        process.env.NETLIFY_DATABASE_URL_UNPOOLED ||
        process.env.NETLIFY_DATABASE_URL ||
        process.env.NEON_DATABASE_URL || ''
});

/**
 * Craft-planning columns (see scripts/migrate_crafts.sql). Applied once per Lambda
 * cold start; every statement is idempotent so this is safe to run repeatedly.
 */
let schemaReady = false;
async function ensureCraftSchema(sql: ReturnType<typeof neon>) {
    if (schemaReady) return;
    try {
        await sql`ALTER TABLE resources ADD COLUMN IF NOT EXISTS craft_profile JSONB DEFAULT '{}'::jsonb`;
        await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS stage TEXT`;
        await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS initiated_on DATE`;
        await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS craft_demand JSONB DEFAULT '[]'::jsonb`;
        await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS jira_key TEXT`;
        await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS planview_id TEXT`;
        await sql`ALTER TABLE allocations ADD COLUMN IF NOT EXISTS craft_id TEXT`;
        await sql`ALTER TABLE allocations ADD COLUMN IF NOT EXISTS source TEXT`;
        schemaReady = true;
    } catch (e: any) {
        console.warn('[workspace] craft schema upgrade skipped:', e.message);
    }
}

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
    await ensureCraftSchema(sql);

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
                dailyRate: r.daily_rate_eur ? Number(r.daily_rate_eur) : undefined,
                skills: r.skills || [],
                primaryCraft: r.craft_profile?.primaryCraft || undefined,
                secondaryCrafts: Array.isArray(r.craft_profile?.secondaryCrafts) ? r.craft_profile.secondaryCrafts : [],
                tribeAffinity: Array.isArray(r.craft_profile?.tribeAffinity) ? r.craft_profile.tribeAffinity : [],
                targetUtil: r.craft_profile?.targetUtil ? Number(r.craft_profile.targetUtil) : undefined,
            }));
            const mapProj = projects.map((p: any) => ({
                id: p.id, name: p.name, status: p.status, priority: p.priority,
                description: p.description || '', startDate: p.start_date, endDate: p.end_date,
                clientName: p.client_name, budget: p.budget ? Number(p.budget) : undefined,
                color: p.color,
                stage: p.stage || undefined,
                initiatedOn: p.initiated_on || undefined,
                craftDemand: Array.isArray(p.craft_demand) ? p.craft_demand : [],
                jiraKey: p.jira_key || undefined,
                planviewId: p.planview_id || undefined,
            }));
            const mapAlloc = allocations.map((a: any) => ({
                id: a.id, resourceId: a.resource_id, projectId: a.project_id,
                percentage: Number(a.percentage), startDate: a.start_date, endDate: a.end_date,
                craftId: a.craft_id || undefined, source: a.source || undefined,
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
            // High Severity Fix: Payload size limit (5MB)
            if (event.body && event.body.length > 5 * 1024 * 1024) {
                return fail('Payload too large (max 5MB)', 413);
            }
            const body = JSON.parse(event.body || '{}');
            const { resources = [], projects = [], allocations = [], workspaceId: bodyWsId, forceWipe = false } = body;

            // Resolve workspace
            let wsRows;
            if (bodyWsId) {
                wsRows = await sql`
                    SELECT w.id, w.org_id, 
                           COALESCE((SELECT plan FROM users WHERE org_id = w.org_id AND role IN ('ORG_ADMIN', 'SUPERUSER') ORDER BY role DESC LIMIT 1), 'BASIC') as plan
                    FROM workspaces w
                    WHERE w.id = ${bodyWsId} LIMIT 1
                `;
            } else if (userRole === 'SUPERUSER' && orgSlug) {
                wsRows = await sql`
                    SELECT w.id, 'MAX' as plan, w.org_id FROM workspaces w
                    JOIN organizations o ON o.id = w.org_id WHERE o.slug = ${orgSlug} LIMIT 1
                `;
            } else if (orgSlug) {
                wsRows = await sql`
                    SELECT w.id, u.plan, w.org_id FROM workspaces w
                    JOIN organizations o ON o.id = w.org_id
                    JOIN users u ON u.org_id = w.org_id
                    WHERE u.id = ${userId} AND o.slug = ${orgSlug}
                    LIMIT 1
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

            // High Severity Fix: Re-verify plan from DB specifically for the current org
            const [planRow] = await sql`
                SELECT plan FROM users 
                WHERE org_id = (SELECT org_id FROM workspaces WHERE id = ${wsId}) 
                AND role IN ('ORG_ADMIN', 'SUPERUSER') 
                ORDER BY role DESC LIMIT 1
            `;
            const plan = (planRow?.plan || 'BASIC').toUpperCase();

            // Check write permission
            let hasWriteAccess = false;
            if (userRole === 'SUPERUSER') {
                hasWriteAccess = true;
            } else {
                const [callerUser] = await sql`SELECT org_id FROM users WHERE id = ${userId}`;
                if (['ORG_ADMIN', 'ADMIN'].includes(userRole) && callerUser?.org_id === wsRows[0].org_id) {
                    hasWriteAccess = true;
                } else {
                    const memberRows = await sql`SELECT role FROM workspace_members WHERE user_id = ${userId} AND workspace_id = ${wsId}`;
                    const wsRole = memberRows[0]?.role || 'USER';
                    if (['PMO_ADMIN', 'WORKSPACE_OWNER'].includes(wsRole)) {
                        hasWriteAccess = true;
                    }
                }
            }
            if (!hasWriteAccess) return fail('You do not have write access to this workspace', 403);

            // Plan limits
            const limits: Record<string, { resources: number; projects: number }> = {
                BASIC: { resources: 5, projects: 5 },
                PRO: { resources: 10, projects: 10 },
                MAX: { resources: 999, projects: 999 },
            };
            const lim = limits[plan] || limits.BASIC;

            if (resources.length > lim.resources) return fail(`${plan} plan allows max ${lim.resources} resources`, 403);
            if (projects.length > lim.projects) return fail(`${plan} plan allows max ${lim.projects} projects`, 403);

            // Audit fix: Backend Data Validation & Referential Integrity (BUG #5, #11)
            const resIds = new Set(resources.map((r: any) => r.id));
            const projIds = new Set(projects.map((p: any) => p.id));

            for (const r of resources) {
                if (!r.name || r.name.trim() === '') return fail(`Resource name is required (ID: ${r.id})`, 400);
            }
            for (const p of projects) {
                if (!p.name || p.name.trim() === '') return fail(`Project name is required (ID: ${p.id})`, 400);
            }
            for (const p of projects) {
                for (const d of (p.craftDemand || [])) {
                    if (!/^\d{4}-Q[1-4]$/.test(String(d.quarterKey || ''))) return fail(`Invalid demand quarter "${d.quarterKey}" on project ${p.name}`, 400);
                    if (typeof d.fte !== 'number' || d.fte < 0 || d.fte > 50) return fail(`Invalid demand FTE "${d.fte}" on project ${p.name}`, 400);
                }
            }
            for (const a of allocations) {
                if (a.percentage < 0 || a.percentage > 500) return fail(`Invalid allocation percentage: ${a.percentage}% (max 500%)`, 400);
                if (!resIds.has(a.resourceId)) return fail(`Referential Integrity Error: Allocation (ID: ${a.id}) references unknown resource (ID: ${a.resourceId})`, 400);
                if (!projIds.has(a.projectId)) return fail(`Referential Integrity Error: Allocation (ID: ${a.id}) references unknown project (ID: ${a.projectId})`, 400);
            }

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

            // Atomic Transaction Save using Pool
            const pool = getPool();
            const client = await pool.connect();
            try {
                await client.query('BEGIN');

                // Clear existing
                await client.query('DELETE FROM allocations WHERE workspace_id = $1', [wsId]);
                await client.query('DELETE FROM resources WHERE workspace_id = $1', [wsId]);
                await client.query('DELETE FROM projects WHERE workspace_id = $1', [wsId]);

                // Insert resources (Optimized Bulk)
                if (resources.length > 0) {
                    for (const r of resources) {
                        await client.query(
                            `INSERT INTO resources 
                             (id, workspace_id, name, role, type, department, team_id, total_capacity, avatar_initials, email, location, daily_rate_eur, skills, craft_profile)
                             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
                            [r.id, wsId, r.name, r.role || '', r.type || 'Permanent', r.department || '', r.teamId || null,
                            r.totalCapacity ?? 100, r.avatarInitials || null, r.email || null, r.location || null, r.dailyRate || null, r.skills || [],
                            JSON.stringify({
                                primaryCraft: r.primaryCraft || null,
                                secondaryCrafts: Array.isArray(r.secondaryCrafts) ? r.secondaryCrafts : [],
                                tribeAffinity: Array.isArray(r.tribeAffinity) ? r.tribeAffinity : [],
                                targetUtil: r.targetUtil || null,
                            })]
                        );
                    }
                }

                // Insert projects (Optimized Bulk)
                if (projects.length > 0) {
                    for (const p of projects) {
                        await client.query(
                            `INSERT INTO projects 
                             (id, workspace_id, name, status, priority, description, start_date, end_date, client_name, budget, color, stage, initiated_on, craft_demand, jira_key, planview_id)
                             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
                            [p.id, wsId, p.name, p.status || 'Active', p.priority || 'Medium', p.description || '',
                            p.startDate || null, p.endDate || null, p.clientName || null, p.budget || null, p.color || null,
                            p.stage || null, p.initiatedOn || null, JSON.stringify(Array.isArray(p.craftDemand) ? p.craftDemand : []),
                            p.jiraKey || null, p.planviewId || null]
                        );
                    }
                }

                // Insert allocations (Optimized Bulk)
                if (allocations.length > 0) {
                    for (const a of allocations) {
                        if (!a.percentage || a.percentage <= 0) continue;
                        await client.query(
                            `INSERT INTO allocations 
                             (id, workspace_id, resource_id, project_id, percentage, start_date, end_date, craft_id, source)
                             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                            [a.id, wsId, a.resourceId, a.projectId, a.percentage, a.startDate || null, a.endDate || null, a.craftId || null, a.source || null]
                        );
                    }
                }

                await client.query('COMMIT');
                return ok({ success: true });
            } catch (err: any) {
                await client.query('ROLLBACK');
                console.error(`Save Transaction Failed:`, err);
                return fail(`Save failed: ${err.message}`, 500);
            } finally {
                client.release();
                await pool.end();
            }
        } catch (e: any) {
            console.error(e);
            return fail('Save failed: ' + e.message, 500);
        }
    }

    return fail('Method not allowed', 405);
};
