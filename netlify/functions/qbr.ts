import type { Handler, HandlerEvent } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET as string;

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

function auth(event: HandlerEvent) {
    const h = event.headers.authorization;
    if (!h?.startsWith('Bearer ')) return null;
    try {
        return jwt.verify(h.split(' ')[1], JWT_SECRET) as { id: string; role?: string; org_id?: string };
    } catch { return null; }
}

export const handler: Handler = async (event: HandlerEvent) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

    const user = auth(event);
    if (!user) return fail('Unauthorized', 401);

    const sql = getDb();
    const subpath = event.path.replace(/^.*\/api\/qbr/, '');
    const wsId = event.queryStringParameters?.wsId;
    const orgId = event.queryStringParameters?.orgId;

    try {
        // ═══════════════════════════════════════════════════════════
        // GET endpoints
        // ═══════════════════════════════════════════════════════════
        if (event.httpMethod === 'GET') {

            // GET /api/qbr/overview — full org structure
            if (subpath === '/overview') {
                const tribes = await sql`
                    SELECT t.*, COUNT(DISTINCT m.id)::int as member_count, COUNT(DISTINCT s.id)::int as squad_count
                    FROM qbr_tribes t
                    LEFT JOIN qbr_members m ON m.tribe_id = t.id
                    LEFT JOIN qbr_squads s ON s.tribe_id = t.id
                    WHERE t.workspace_id = ${wsId}
                    GROUP BY t.id ORDER BY t.name`;
                const chapters = await sql`
                    SELECT c.*, COUNT(DISTINCT m.id)::int as member_count
                    FROM qbr_chapters c
                    LEFT JOIN qbr_members m ON m.chapter_id = c.id
                    WHERE c.workspace_id = ${wsId}
                    GROUP BY c.id ORDER BY c.name`;
                const coe = await sql`
                    SELECT g.*, COUNT(DISTINCT m.id)::int as member_count
                    FROM qbr_coe_groups g
                    LEFT JOIN qbr_members m ON m.coe_id = g.id
                    WHERE g.workspace_id = ${wsId}
                    GROUP BY g.id ORDER BY g.name`;
                const quarters = await sql`
                    SELECT * FROM qbr_quarters WHERE workspace_id = ${wsId} ORDER BY start_date`;
                const memberCount = await sql`
                    SELECT COUNT(*)::int as total FROM qbr_members WHERE workspace_id = ${wsId}`;
                const projectCount = await sql`
                    SELECT COUNT(*)::int as total FROM qbr_projects WHERE workspace_id = ${wsId}`;

                return ok({
                    tribes, chapters, coe, quarters,
                    stats: {
                        members: memberCount[0]?.total || 0,
                        projects: projectCount[0]?.total || 0,
                        tribes: tribes.length,
                        chapters: chapters.length,
                        coe: coe.length,
                    }
                });
            }

            // GET /api/qbr/quarter/:id — quarter details with sprints & bookings
            if (subpath.match(/^\/quarter\/[^/]+$/)) {
                const qId = subpath.split('/')[2];
                const quarter = await sql`SELECT * FROM qbr_quarters WHERE id = ${qId}`;
                if (!quarter.length) return fail('Quarter not found', 404);

                const sprints = await sql`
                    SELECT * FROM qbr_sprints WHERE quarter_id = ${qId} ORDER BY sprint_number`;
                const bookings = await sql`
                    SELECT b.*, p.name as project_name, p.color as project_color, m.name as member_name
                    FROM qbr_bookings b
                    JOIN qbr_projects p ON p.id = b.project_id
                    JOIN qbr_members m ON m.id = b.member_id
                    WHERE b.sprint_id = ANY(SELECT id FROM qbr_sprints WHERE quarter_id = ${qId})
                    AND b.scenario_id IS NULL
                    ORDER BY m.name, b.sprint_id`;

                return ok({ quarter: quarter[0], sprints, bookings });
            }

            // GET /api/qbr/members — all members with org structure
            if (subpath === '/members') {
                const members = await sql`
                    SELECT m.*,
                        t.name as tribe_name, t.color as tribe_color,
                        c.name as chapter_name, c.color as chapter_color,
                        g.name as coe_name, g.color as coe_color
                    FROM qbr_members m
                    LEFT JOIN qbr_tribes t ON t.id = m.tribe_id
                    LEFT JOIN qbr_chapters c ON c.id = m.chapter_id
                    LEFT JOIN qbr_coe_groups g ON g.id = m.coe_id
                    WHERE m.workspace_id = ${wsId}
                    ORDER BY t.name, c.name, m.name`;
                return ok({ members });
            }

            // GET /api/qbr/projects — all projects
            if (subpath === '/projects') {
                const projects = await sql`
                    SELECT p.*, t.name as tribe_name, o.title as okr_title
                    FROM qbr_projects p
                    LEFT JOIN qbr_tribes t ON t.id = p.tribe_id
                    LEFT JOIN qbr_okrs o ON o.id = p.okr_id
                    WHERE p.workspace_id = ${wsId}
                    ORDER BY p.name`;
                return ok({ projects });
            }

            // GET /api/qbr/okrs — OKR hierarchy
            if (subpath === '/okrs') {
                const okrs = await sql`
                    SELECT o.*, t.name as tribe_name
                    FROM qbr_okrs o
                    LEFT JOIN qbr_tribes t ON t.id = o.tribe_id
                    WHERE o.workspace_id = ${wsId}
                    ORDER BY o.level, o.title`;
                return ok({ okrs });
            }

            // GET /api/qbr/squads — all squads with members
            if (subpath === '/squads') {
                const squads = await sql`
                    SELECT s.*, t.name as tribe_name, p.name as project_name
                    FROM qbr_squads s
                    LEFT JOIN qbr_tribes t ON t.id = s.tribe_id
                    LEFT JOIN qbr_projects p ON p.id = s.project_id
                    WHERE s.workspace_id = ${wsId}
                    ORDER BY s.name`;
                const squadMembers = await sql`
                    SELECT sm.*, m.name as member_name, m.member_type,
                        c.name as chapter_name, t.name as tribe_name, g.name as coe_name
                    FROM qbr_squad_members sm
                    JOIN qbr_members m ON m.id = sm.member_id
                    LEFT JOIN qbr_chapters c ON c.id = m.chapter_id
                    LEFT JOIN qbr_tribes t ON t.id = m.tribe_id
                    LEFT JOIN qbr_coe_groups g ON g.id = m.coe_id
                    WHERE sm.squad_id = ANY(SELECT id FROM qbr_squads WHERE workspace_id = ${wsId})`;
                return ok({ squads, squadMembers });
            }

            // GET /api/qbr/scenarios — all scenarios for a quarter
            if (subpath === '/scenarios') {
                const quarterId = event.queryStringParameters?.quarterId;
                const scenarios = await sql`
                    SELECT * FROM qbr_scenarios
                    WHERE workspace_id = ${wsId} AND (${quarterId}::uuid IS NULL OR quarter_id = ${quarterId})
                    ORDER BY created_at DESC`;
                return ok({ scenarios });
            }

            // GET /api/qbr/scenario/:id — scenario bookings
            if (subpath.match(/^\/scenario\/[^/]+$/)) {
                const sId = subpath.split('/')[2];
                const bookings = await sql`
                    SELECT b.*, p.name as project_name, p.color as project_color, m.name as member_name
                    FROM qbr_bookings b
                    JOIN qbr_projects p ON p.id = b.project_id
                    JOIN qbr_members m ON m.id = b.member_id
                    WHERE b.scenario_id = ${sId}
                    ORDER BY m.name, b.sprint_id`;
                return ok({ bookings });
            }
        }

        // ═══════════════════════════════════════════════════════════
        // POST endpoints
        // ═══════════════════════════════════════════════════════════
        if (event.httpMethod === 'POST') {
            const body = JSON.parse(event.body || '{}');

            // POST /api/qbr/booking — create/update booking
            if (subpath === '/booking') {
                const { memberId, projectId, sprintId, percentage, scenarioId, notes } = body;
                if (!memberId || !projectId || !sprintId) return fail('memberId, projectId, sprintId required');

                if (percentage <= 0) {
                    // Delete booking
                    await sql`DELETE FROM qbr_bookings
                        WHERE member_id = ${memberId} AND project_id = ${projectId}
                        AND sprint_id = ${sprintId}
                        AND (scenario_id = ${scenarioId || null} OR (${scenarioId || null}::uuid IS NULL AND scenario_id IS NULL))`;
                    return ok({ success: true, deleted: true });
                }

                const [booking] = await sql`
                    INSERT INTO qbr_bookings (org_id, workspace_id, member_id, project_id, sprint_id, percentage, scenario_id, notes)
                    VALUES (${orgId}, ${wsId}, ${memberId}, ${projectId}, ${sprintId}, ${percentage}, ${scenarioId || null}, ${notes || null})
                    ON CONFLICT (member_id, project_id, sprint_id, scenario_id)
                    DO UPDATE SET percentage = EXCLUDED.percentage, notes = EXCLUDED.notes
                    RETURNING *`;
                return ok({ success: true, booking });
            }

            // POST /api/qbr/scenario — create scenario (clone live bookings)
            if (subpath === '/scenario') {
                const { name, description, quarterId } = body;
                if (!name || !quarterId) return fail('name and quarterId required');

                const [scenario] = await sql`
                    INSERT INTO qbr_scenarios (org_id, workspace_id, name, description, quarter_id, created_by)
                    VALUES (${orgId}, ${wsId}, ${name}, ${description || null}, ${quarterId}, ${user.id})
                    RETURNING *`;

                // Clone current live bookings into scenario
                await sql`
                    INSERT INTO qbr_bookings (org_id, workspace_id, member_id, project_id, sprint_id, percentage, scenario_id, notes)
                    SELECT org_id, workspace_id, member_id, project_id, sprint_id, percentage, ${scenario.id}, notes
                    FROM qbr_bookings
                    WHERE sprint_id = ANY(SELECT id FROM qbr_sprints WHERE quarter_id = ${quarterId})
                    AND scenario_id IS NULL`;

                return ok({ success: true, scenario }, 201);
            }

            // POST /api/qbr/scenario/:id/commit — commit a scenario
            if (subpath.match(/^\/scenario\/[^/]+\/commit$/)) {
                const sId = subpath.split('/')[2];
                const [sc] = await sql`SELECT * FROM qbr_scenarios WHERE id = ${sId}`;
                if (!sc) return fail('Scenario not found', 404);

                // Delete current live bookings for this quarter
                await sql`
                    DELETE FROM qbr_bookings
                    WHERE sprint_id = ANY(SELECT id FROM qbr_sprints WHERE quarter_id = ${sc.quarter_id})
                    AND scenario_id IS NULL`;

                // Move scenario bookings to live (set scenario_id = NULL)
                await sql`
                    UPDATE qbr_bookings SET scenario_id = NULL
                    WHERE scenario_id = ${sId}`;

                // Mark scenario as committed
                await sql`UPDATE qbr_scenarios SET is_committed = true WHERE id = ${sId}`;

                return ok({ success: true });
            }

            // POST /api/qbr/squad — create squad
            if (subpath === '/squad') {
                const { name, tribeId, projectId, okrId, members: memberList } = body;
                if (!name) return fail('Squad name required');

                const [squad] = await sql`
                    INSERT INTO qbr_squads (org_id, workspace_id, name, tribe_id, project_id, okr_id)
                    VALUES (${orgId}, ${wsId}, ${name}, ${tribeId || null}, ${projectId || null}, ${okrId || null})
                    RETURNING *`;

                if (memberList?.length) {
                    for (const m of memberList) {
                        await sql`
                            INSERT INTO qbr_squad_members (squad_id, member_id, squad_role)
                            VALUES (${squad.id}, ${m.memberId}, ${m.role || 'MEMBER'})
                            ON CONFLICT DO NOTHING`;
                    }
                }

                return ok({ success: true, squad }, 201);
            }

            // POST /api/qbr/seed — seed demo data (dev only)
            if (subpath === '/seed') {
                return await seedDemoData(sql, orgId, wsId);
            }
        }

        // ═══════════════════════════════════════════════════════════
        // DELETE endpoints
        // ═══════════════════════════════════════════════════════════
        if (event.httpMethod === 'DELETE') {
            // DELETE /api/qbr/scenario/:id
            if (subpath.match(/^\/scenario\/[^/]+$/)) {
                const sId = subpath.split('/')[2];
                await sql`DELETE FROM qbr_bookings WHERE scenario_id = ${sId}`;
                await sql`DELETE FROM qbr_scenarios WHERE id = ${sId}`;
                return ok({ success: true });
            }
        }

        return fail('Not found', 404);
    } catch (e: any) {
        console.error('[qbr]', e);
        return fail('Server error: ' + e.message, 500);
    }
};

// ═══════════════════════════════════════════════════════════════
// Seed Demo Data
// ═══════════════════════════════════════════════════════════════
async function seedDemoData(sql: ReturnType<typeof neon>, orgId: string | undefined, wsId: string | undefined) {
    if (!orgId || !wsId) return fail('orgId and wsId required for seeding');

    // Clean existing QBR data for this workspace
    await sql`DELETE FROM qbr_bookings WHERE workspace_id = ${wsId}`;
    await sql`DELETE FROM qbr_squad_members WHERE squad_id IN (SELECT id FROM qbr_squads WHERE workspace_id = ${wsId})`;
    await sql`DELETE FROM qbr_squads WHERE workspace_id = ${wsId}`;
    await sql`DELETE FROM qbr_projects WHERE workspace_id = ${wsId}`;
    await sql`DELETE FROM qbr_okrs WHERE workspace_id = ${wsId}`;
    await sql`DELETE FROM qbr_scenarios WHERE workspace_id = ${wsId}`;
    await sql`DELETE FROM qbr_sprints WHERE quarter_id IN (SELECT id FROM qbr_quarters WHERE workspace_id = ${wsId})`;
    await sql`DELETE FROM qbr_quarters WHERE workspace_id = ${wsId}`;
    await sql`DELETE FROM qbr_members WHERE workspace_id = ${wsId}`;
    await sql`DELETE FROM qbr_coe_groups WHERE workspace_id = ${wsId}`;
    await sql`DELETE FROM qbr_chapters WHERE workspace_id = ${wsId}`;
    await sql`DELETE FROM qbr_tribes WHERE workspace_id = ${wsId}`;

    // ── Tribes ──
    const [tPayments] = await sql`INSERT INTO qbr_tribes (org_id, workspace_id, name, description, lead_name, color) VALUES (${orgId}, ${wsId}, 'Payments', 'All payment-related products and services', 'Sarah Mitchell', '#6366f1') RETURNING id`;
    const [tLending] = await sql`INSERT INTO qbr_tribes (org_id, workspace_id, name, description, lead_name, color) VALUES (${orgId}, ${wsId}, 'Lending & Credit', 'Loan origination, credit decisioning, servicing', 'James O''Brien', '#3b82f6') RETURNING id`;
    const [tDigital] = await sql`INSERT INTO qbr_tribes (org_id, workspace_id, name, description, lead_name, color) VALUES (${orgId}, ${wsId}, 'Digital Experience', 'Mobile app, web portal, customer self-service', 'Aisha Patel', '#8b5cf6') RETURNING id`;

    // ── Chapters ──
    const [cEng] = await sql`INSERT INTO qbr_chapters (org_id, workspace_id, name, description, lead_name, color) VALUES (${orgId}, ${wsId}, 'Engineering', 'Full-stack and backend engineers', 'Tom Hayes', '#10b981') RETURNING id`;
    const [cDesign] = await sql`INSERT INTO qbr_chapters (org_id, workspace_id, name, description, lead_name, color) VALUES (${orgId}, ${wsId}, 'Design & UX', 'Product designers, UX researchers', 'Fiona Kelly', '#ec4899') RETURNING id`;
    const [cQA] = await sql`INSERT INTO qbr_chapters (org_id, workspace_id, name, description, lead_name, color) VALUES (${orgId}, ${wsId}, 'Quality Assurance', 'Test automation, manual QA', 'Derek Nolan', '#f59e0b') RETURNING id`;
    const [cPM] = await sql`INSERT INTO qbr_chapters (org_id, workspace_id, name, description, lead_name, color) VALUES (${orgId}, ${wsId}, 'Project Management', 'Delivery leads, scrum masters', 'Claire Ryan', '#ef4444') RETURNING id`;

    // ── CoE Groups ──
    const [coeSec] = await sql`INSERT INTO qbr_coe_groups (org_id, workspace_id, name, description, lead_name, color) VALUES (${orgId}, ${wsId}, 'Security & Compliance', 'InfoSec, PCI-DSS, GDPR specialists', 'Ravi Shankar', '#dc2626') RETURNING id`;
    const [coeData] = await sql`INSERT INTO qbr_coe_groups (org_id, workspace_id, name, description, lead_name, color) VALUES (${orgId}, ${wsId}, 'Data & Analytics', 'Data engineers, ML engineers, BI analysts', 'Lisa Chen', '#0891b2') RETURNING id`;

    // ── Members (25) ──
    const memberInserts = [
        // Payments tribe + Engineering chapter
        { name: 'Liam Murphy', email: 'liam.m@company.ie', role: 'Senior Backend Engineer', tribe: tPayments.id, ch: cEng.id, coe: null, type: 'INTERNAL', color: '#6366f1', skills: ['Java', 'Kafka', 'PostgreSQL'] },
        { name: 'Emma Walsh', email: 'emma.w@company.ie', role: 'Full-Stack Engineer', tribe: tPayments.id, ch: cEng.id, coe: null, type: 'INTERNAL', color: '#818cf8', skills: ['React', 'Node.js', 'TypeScript'] },
        { name: 'Ciaran Burke', email: 'ciaran.b@company.ie', role: 'Platform Engineer', tribe: tPayments.id, ch: cEng.id, coe: null, type: 'INTERNAL', color: '#a78bfa', skills: ['AWS', 'Terraform', 'Docker'] },
        // Payments tribe + Design chapter
        { name: 'Aoife Brennan', email: 'aoife.b@company.ie', role: 'Product Designer', tribe: tPayments.id, ch: cDesign.id, coe: null, type: 'INTERNAL', color: '#ec4899', skills: ['Figma', 'User Research', 'Prototyping'] },
        // Payments tribe + PM chapter
        { name: 'Gokul Gurijala', email: 'gokul.g@company.ie', role: 'Delivery Lead', tribe: tPayments.id, ch: cPM.id, coe: null, type: 'INTERNAL', color: '#f43f5e', skills: ['Agile', 'SAFe', 'JIRA'] },
        // Lending tribe + Engineering chapter
        { name: 'Sean Doyle', email: 'sean.d@company.ie', role: 'Lead Engineer', tribe: tLending.id, ch: cEng.id, coe: null, type: 'INTERNAL', color: '#3b82f6', skills: ['Python', 'FastAPI', 'PostgreSQL'] },
        { name: 'Niamh Carroll', email: 'niamh.c@company.ie', role: 'Backend Engineer', tribe: tLending.id, ch: cEng.id, coe: null, type: 'INTERNAL', color: '#60a5fa', skills: ['Java', 'Spring Boot', 'MySQL'] },
        { name: 'Raj Kapoor', email: 'raj.k@vendor.com', role: 'Contract Developer', tribe: tLending.id, ch: cEng.id, coe: null, type: 'VENDOR', color: '#93c5fd', skills: ['React', 'Node.js'], daily_rate: 650 },
        // Lending tribe + QA chapter
        { name: 'Michelle Keane', email: 'michelle.k@company.ie', role: 'QA Lead', tribe: tLending.id, ch: cQA.id, coe: null, type: 'INTERNAL', color: '#f59e0b', skills: ['Selenium', 'Cypress', 'API Testing'] },
        // Lending tribe + PM chapter
        { name: 'Tom Hayes', email: 'tom.h@company.ie', role: 'Chapter Lead – Delivery', tribe: tLending.id, ch: cPM.id, coe: null, type: 'INTERNAL', color: '#ef4444', skills: ['Agile', 'SAFe', 'Stakeholder Mgmt'] },
        // Digital tribe + Engineering chapter
        { name: 'Oisin Flynn', email: 'oisin.f@company.ie', role: 'Mobile Engineer', tribe: tDigital.id, ch: cEng.id, coe: null, type: 'INTERNAL', color: '#8b5cf6', skills: ['React Native', 'Swift', 'Kotlin'] },
        { name: 'Saoirse Kelly', email: 'saoirse.k@company.ie', role: 'Frontend Engineer', tribe: tDigital.id, ch: cEng.id, coe: null, type: 'INTERNAL', color: '#a78bfa', skills: ['React', 'TypeScript', 'CSS'] },
        { name: 'Priya Sharma', email: 'priya.s@vendor.com', role: 'UI Developer (Contract)', tribe: tDigital.id, ch: cEng.id, coe: null, type: 'CONTRACTOR', color: '#c4b5fd', skills: ['Vue', 'Angular'], daily_rate: 550 },
        // Digital tribe + Design chapter
        { name: 'Kate Murphy', email: 'kate.m@company.ie', role: 'Senior UX Designer', tribe: tDigital.id, ch: cDesign.id, coe: null, type: 'INTERNAL', color: '#f472b6', skills: ['Figma', 'Accessibility', 'Design Systems'] },
        { name: 'David Chen', email: 'david.c@company.ie', role: 'UX Researcher', tribe: tDigital.id, ch: cDesign.id, coe: null, type: 'INTERNAL', color: '#fb7185', skills: ['User Interviews', 'Survey Design', 'Analytics'] },
        // Digital tribe + PM chapter
        { name: 'Linda O\'Dwyer', email: 'linda.o@company.ie', role: 'Scrum Master', tribe: tDigital.id, ch: cPM.id, coe: null, type: 'INTERNAL', color: '#fb923c', skills: ['Scrum', 'Kanban', 'Facilitation'] },
        // CoE Security — no tribe (shared)
        { name: 'Ravi Shankar', email: 'ravi.s@company.ie', role: 'Security Architect', tribe: null, ch: null, coe: coeSec.id, type: 'INTERNAL', color: '#dc2626', skills: ['PCI-DSS', 'GDPR', 'Penetration Testing'] },
        { name: 'Maria Fernandez', email: 'maria.f@company.ie', role: 'Compliance Analyst', tribe: null, ch: null, coe: coeSec.id, type: 'INTERNAL', color: '#f87171', skills: ['Risk Assessment', 'Audit', 'SOX'] },
        // CoE Data — no tribe (shared)
        { name: 'Lisa Chen', email: 'lisa.c@company.ie', role: 'Lead Data Engineer', tribe: null, ch: null, coe: coeData.id, type: 'INTERNAL', color: '#0891b2', skills: ['Spark', 'Snowflake', 'dbt'] },
        { name: 'Patrick Ward', email: 'patrick.w@company.ie', role: 'ML Engineer', tribe: null, ch: null, coe: coeData.id, type: 'INTERNAL', color: '#06b6d4', skills: ['Python', 'TensorFlow', 'MLOps'] },
        { name: 'Ankit Patel', email: 'ankit.p@vendor.com', role: 'Data Analyst (Contract)', tribe: null, ch: null, coe: coeData.id, type: 'VENDOR', color: '#22d3ee', skills: ['SQL', 'Tableau', 'Power BI'], daily_rate: 500 },
        // Additional QA in Payments
        { name: 'Brian O\'Sullivan', email: 'brian.o@company.ie', role: 'Test Engineer', tribe: tPayments.id, ch: cQA.id, coe: null, type: 'INTERNAL', color: '#fbbf24', skills: ['Cypress', 'Jest', 'Playwright'] },
        // Additional cross-tribe vendor
        { name: 'Carlos Mendez', email: 'carlos.m@vendor.com', role: 'DevOps Consultant', tribe: null, ch: cEng.id, coe: null, type: 'VENDOR', color: '#34d399', skills: ['Kubernetes', 'Jenkins', 'GitOps'], daily_rate: 750 },
        // Two more for variety
        { name: 'Fiona Kelly', email: 'fiona.k@company.ie', role: 'Design Lead', tribe: tDigital.id, ch: cDesign.id, coe: null, type: 'INTERNAL', color: '#e879f9', skills: ['Design Systems', 'Figma', 'Leadership'] },
        { name: 'Derek Nolan', email: 'derek.n@company.ie', role: 'QA Manager', tribe: null, ch: cQA.id, coe: null, type: 'INTERNAL', color: '#fcd34d', skills: ['Test Strategy', 'Team Leadership', 'Automation'] },
    ];

    const memberIds: Record<string, string> = {};
    for (const m of memberInserts) {
        const [row] = await sql`
            INSERT INTO qbr_members (org_id, workspace_id, name, email, role_title, tribe_id, chapter_id, coe_id, member_type, daily_rate, skills, avatar_color)
            VALUES (${orgId}, ${wsId}, ${m.name}, ${m.email}, ${m.role}, ${m.tribe}, ${m.ch}, ${m.coe}, ${m.type}, ${(m as any).daily_rate || null}, ${m.skills}, ${m.color})
            RETURNING id`;
        memberIds[m.name] = row.id;
    }

    // ── Quarters (Q1 & Q2 2026) ──
    const [q1] = await sql`INSERT INTO qbr_quarters (org_id, workspace_id, label, start_date, end_date, is_active) VALUES (${orgId}, ${wsId}, 'Q1 2026', '2026-01-05', '2026-03-27', false) RETURNING id`;
    const [q2] = await sql`INSERT INTO qbr_quarters (org_id, workspace_id, label, start_date, end_date, is_active) VALUES (${orgId}, ${wsId}, 'Q2 2026', '2026-03-30', '2026-06-19', true) RETURNING id`;

    // ── Sprints ──
    const q1Sprints: string[] = [];
    const q1SprintDates = [
        ['2026-01-05', '2026-01-16'], ['2026-01-19', '2026-01-30'], ['2026-02-02', '2026-02-13'],
        ['2026-02-16', '2026-02-27'], ['2026-03-02', '2026-03-13'], ['2026-03-16', '2026-03-27'],
    ];
    for (let i = 0; i < 6; i++) {
        const [s] = await sql`INSERT INTO qbr_sprints (quarter_id, sprint_number, label, start_date, end_date)
            VALUES (${q1.id}, ${i + 1}, ${'S' + (i + 1) + ' (' + q1SprintDates[i][0].slice(5) + ')'}, ${q1SprintDates[i][0]}, ${q1SprintDates[i][1]}) RETURNING id`;
        q1Sprints.push(s.id);
    }

    const q2Sprints: string[] = [];
    const q2SprintDates = [
        ['2026-03-30', '2026-04-10'], ['2026-04-13', '2026-04-24'], ['2026-04-27', '2026-05-08'],
        ['2026-05-11', '2026-05-22'], ['2026-05-25', '2026-06-05'], ['2026-06-08', '2026-06-19'],
    ];
    for (let i = 0; i < 6; i++) {
        const [s] = await sql`INSERT INTO qbr_sprints (quarter_id, sprint_number, label, start_date, end_date)
            VALUES (${q2.id}, ${i + 1}, ${'S' + (i + 1) + ' (' + q2SprintDates[i][0].slice(5) + ')'}, ${q2SprintDates[i][0]}, ${q2SprintDates[i][1]}) RETURNING id`;
        q2Sprints.push(s.id);
    }

    // ── Leadership OKRs ──
    const [okrGrow] = await sql`INSERT INTO qbr_okrs (org_id, workspace_id, title, description, level, quarter_id) VALUES (${orgId}, ${wsId}, 'Grow digital revenue by 25%', 'Increase digital channel revenue across all product lines', 'LEADERSHIP', ${q2.id}) RETURNING id`;
    const [okrCx] = await sql`INSERT INTO qbr_okrs (org_id, workspace_id, title, description, level, quarter_id) VALUES (${orgId}, ${wsId}, 'Improve customer experience NPS to 75+', 'Drive NPS improvements through faster, more reliable services', 'LEADERSHIP', ${q2.id}) RETURNING id`;
    const [okrRisk] = await sql`INSERT INTO qbr_okrs (org_id, workspace_id, title, description, level, quarter_id) VALUES (${orgId}, ${wsId}, 'Reduce operational risk by 40%', 'Strengthen security, compliance, and operational resilience', 'LEADERSHIP', ${q2.id}) RETURNING id`;

    // ── Tribe OKRs ──
    const [okrPay1] = await sql`INSERT INTO qbr_okrs (org_id, workspace_id, title, description, level, parent_okr_id, tribe_id, quarter_id) VALUES (${orgId}, ${wsId}, 'Launch real-time payments v2', 'Modernize payment rails for instant settlement', 'TRIBE', ${okrGrow.id}, ${tPayments.id}, ${q2.id}) RETURNING id`;
    const [okrPay2] = await sql`INSERT INTO qbr_okrs (org_id, workspace_id, title, description, level, parent_okr_id, tribe_id, quarter_id) VALUES (${orgId}, ${wsId}, 'Achieve PCI-DSS Level 1 re-certification', 'Annual compliance audit and remediation', 'TRIBE', ${okrRisk.id}, ${tPayments.id}, ${q2.id}) RETURNING id`;
    const [okrLend1] = await sql`INSERT INTO qbr_okrs (org_id, workspace_id, title, description, level, parent_okr_id, tribe_id, quarter_id) VALUES (${orgId}, ${wsId}, 'Reduce loan approval time to <24hrs', 'Automate credit decisioning pipeline', 'TRIBE', ${okrCx.id}, ${tLending.id}, ${q2.id}) RETURNING id`;
    const [okrDig1] = await sql`INSERT INTO qbr_okrs (org_id, workspace_id, title, description, level, parent_okr_id, tribe_id, quarter_id) VALUES (${orgId}, ${wsId}, 'Ship mobile app v3 with biometric login', 'Major mobile app update with improved auth', 'TRIBE', ${okrCx.id}, ${tDigital.id}, ${q2.id}) RETURNING id`;
    const [okrDig2] = await sql`INSERT INTO qbr_okrs (org_id, workspace_id, title, description, level, parent_okr_id, tribe_id, quarter_id) VALUES (${orgId}, ${wsId}, 'Launch AI-powered customer insights dashboard', 'Self-service analytics for relationship managers', 'TRIBE', ${okrGrow.id}, ${tDigital.id}, ${q2.id}) RETURNING id`;

    // ── Projects ──
    const [pRTP] = await sql`INSERT INTO qbr_projects (org_id, workspace_id, name, description, tribe_id, okr_id, status, priority, start_quarter_id, end_quarter_id, color) VALUES (${orgId}, ${wsId}, 'Real-Time Payments v2', 'Modernize payment rails', ${tPayments.id}, ${okrPay1.id}, 'ACTIVE', 'CRITICAL', ${q1.id}, ${q2.id}, '#6366f1') RETURNING id`;
    const [pPCI] = await sql`INSERT INTO qbr_projects (org_id, workspace_id, name, description, tribe_id, okr_id, status, priority, start_quarter_id, end_quarter_id, color) VALUES (${orgId}, ${wsId}, 'PCI-DSS Remediation', 'Security compliance project', ${tPayments.id}, ${okrPay2.id}, 'ACTIVE', 'HIGH', ${q2.id}, ${q2.id}, '#ef4444') RETURNING id`;
    const [pLoan] = await sql`INSERT INTO qbr_projects (org_id, workspace_id, name, description, tribe_id, okr_id, status, priority, start_quarter_id, end_quarter_id, color) VALUES (${orgId}, ${wsId}, 'Automated Credit Engine', 'ML-powered credit decisioning', ${tLending.id}, ${okrLend1.id}, 'ACTIVE', 'CRITICAL', ${q1.id}, ${q2.id}, '#3b82f6') RETURNING id`;
    const [pMobile] = await sql`INSERT INTO qbr_projects (org_id, workspace_id, name, description, tribe_id, okr_id, status, priority, start_quarter_id, end_quarter_id, color) VALUES (${orgId}, ${wsId}, 'Mobile App v3', 'Biometric login & redesigned UX', ${tDigital.id}, ${okrDig1.id}, 'PLANNING', 'HIGH', ${q2.id}, ${q2.id}, '#8b5cf6') RETURNING id`;
    const [pInsights] = await sql`INSERT INTO qbr_projects (org_id, workspace_id, name, description, tribe_id, okr_id, status, priority, start_quarter_id, end_quarter_id, color) VALUES (${orgId}, ${wsId}, 'AI Customer Insights', 'Self-service analytics dashboard', ${tDigital.id}, ${okrDig2.id}, 'PLANNING', 'MEDIUM', ${q2.id}, ${q2.id}, '#0891b2') RETURNING id`;
    const [pLegacy] = await sql`INSERT INTO qbr_projects (org_id, workspace_id, name, description, tribe_id, okr_id, status, priority, start_quarter_id, end_quarter_id, color) VALUES (${orgId}, ${wsId}, 'Legacy System Decommission', 'Sunset old COBOL batch processor', ${tLending.id}, ${okrLend1.id}, 'ACTIVE', 'LOW', ${q1.id}, ${q2.id}, '#6b7280') RETURNING id`;
    const [pAPI] = await sql`INSERT INTO qbr_projects (org_id, workspace_id, name, description, tribe_id, okr_id, status, priority, start_quarter_id, end_quarter_id, color) VALUES (${orgId}, ${wsId}, 'Open Banking API Gateway', 'PSD2-compliant API platform', ${tPayments.id}, ${okrGrow.id}, 'ACTIVE', 'HIGH', ${q1.id}, ${q2.id}, '#10b981') RETURNING id`;
    const [pDesign] = await sql`INSERT INTO qbr_projects (org_id, workspace_id, name, description, tribe_id, okr_id, status, priority, start_quarter_id, end_quarter_id, color) VALUES (${orgId}, ${wsId}, 'Design System 2.0', 'Unified component library', ${tDigital.id}, ${okrCx.id}, 'ACTIVE', 'MEDIUM', ${q1.id}, ${q2.id}, '#ec4899') RETURNING id`;

    // ── Bookings (Q1 — already booked, Q2 — partially booked for horse trading) ──
    // Q1 bookings (all 6 sprints filled — represents "carried over" bookings)
    const q1Bookings = [
        // Liam Murphy — 60% RTP, 40% API Gateway (full Q1)
        ...q1Sprints.map(s => ({ member: 'Liam Murphy', project: pRTP.id, sprint: s, pct: 60 })),
        ...q1Sprints.map(s => ({ member: 'Liam Murphy', project: pAPI.id, sprint: s, pct: 40 })),
        // Emma Walsh — 80% RTP (full Q1)
        ...q1Sprints.map(s => ({ member: 'Emma Walsh', project: pRTP.id, sprint: s, pct: 80 })),
        // Sean Doyle — 70% Loan Engine, 30% Legacy (full Q1)
        ...q1Sprints.map(s => ({ member: 'Sean Doyle', project: pLoan.id, sprint: s, pct: 70 })),
        ...q1Sprints.map(s => ({ member: 'Sean Doyle', project: pLegacy.id, sprint: s, pct: 30 })),
        // Oisin Flynn — 100% Design System (full Q1)
        ...q1Sprints.map(s => ({ member: 'Oisin Flynn', project: pDesign.id, sprint: s, pct: 100 })),
    ];

    // Q2 bookings (sprints 1-3 partially booked – rest open for horse trading)
    const q2PartialBookings = [
        // Liam Murphy — continuing RTP at 50% for S1-S4
        ...q2Sprints.slice(0, 4).map(s => ({ member: 'Liam Murphy', project: pRTP.id, sprint: s, pct: 50 })),
        // Emma Walsh — 40% RTP S1-S3, then available
        ...q2Sprints.slice(0, 3).map(s => ({ member: 'Emma Walsh', project: pRTP.id, sprint: s, pct: 40 })),
        // Sean Doyle — 60% Loan Engine S1-S6 (continues)
        ...q2Sprints.map(s => ({ member: 'Sean Doyle', project: pLoan.id, sprint: s, pct: 60 })),
        // Niamh Carroll — 50% Loan Engine S1-S4
        ...q2Sprints.slice(0, 4).map(s => ({ member: 'Niamh Carroll', project: pLoan.id, sprint: s, pct: 50 })),
        // Saoirse Kelly — 70% Mobile App S1-S6
        ...q2Sprints.map(s => ({ member: 'Saoirse Kelly', project: pMobile.id, sprint: s, pct: 70 })),
        // Kate Murphy — 50% Mobile App S1-S4, 30% Design System S1-S6
        ...q2Sprints.slice(0, 4).map(s => ({ member: 'Kate Murphy', project: pMobile.id, sprint: s, pct: 50 })),
        ...q2Sprints.map(s => ({ member: 'Kate Murphy', project: pDesign.id, sprint: s, pct: 30 })),
        // Ravi Shankar (CoE Security) — 80% PCI-DSS S1-S4
        ...q2Sprints.slice(0, 4).map(s => ({ member: 'Ravi Shankar', project: pPCI.id, sprint: s, pct: 80 })),
        // Lisa Chen (CoE Data) — 40% AI Insights S1-S6
        ...q2Sprints.map(s => ({ member: 'Lisa Chen', project: pInsights.id, sprint: s, pct: 40 })),
        // Gokul — 30% RTP S1-S6 (PM oversight)
        ...q2Sprints.map(s => ({ member: 'Gokul Gurijala', project: pRTP.id, sprint: s, pct: 30 })),
        // Tom Hayes — 20% Loan Engine (oversight), 20% Legacy Decommission
        ...q2Sprints.map(s => ({ member: 'Tom Hayes', project: pLoan.id, sprint: s, pct: 20 })),
        ...q2Sprints.map(s => ({ member: 'Tom Hayes', project: pLegacy.id, sprint: s, pct: 20 })),
    ];

    for (const b of [...q1Bookings, ...q2PartialBookings]) {
        await sql`INSERT INTO qbr_bookings (org_id, workspace_id, member_id, project_id, sprint_id, percentage)
            VALUES (${orgId}, ${wsId}, ${memberIds[b.member]}, ${b.project}, ${b.sprint}, ${b.pct})
            ON CONFLICT DO NOTHING`;
    }

    // ── Squads ──
    const [sqRTP] = await sql`INSERT INTO qbr_squads (org_id, workspace_id, name, tribe_id, project_id, okr_id) VALUES (${orgId}, ${wsId}, 'Squad RTP', ${tPayments.id}, ${pRTP.id}, ${okrPay1.id}) RETURNING id`;
    await sql`INSERT INTO qbr_squad_members (squad_id, member_id, squad_role) VALUES (${sqRTP.id}, ${memberIds['Gokul Gurijala']}, 'LEAD') ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO qbr_squad_members (squad_id, member_id, squad_role) VALUES (${sqRTP.id}, ${memberIds['Liam Murphy']}, 'MEMBER') ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO qbr_squad_members (squad_id, member_id, squad_role) VALUES (${sqRTP.id}, ${memberIds['Emma Walsh']}, 'MEMBER') ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO qbr_squad_members (squad_id, member_id, squad_role) VALUES (${sqRTP.id}, ${memberIds['Aoife Brennan']}, 'MEMBER') ON CONFLICT DO NOTHING`;

    const [sqLoan] = await sql`INSERT INTO qbr_squads (org_id, workspace_id, name, tribe_id, project_id, okr_id) VALUES (${orgId}, ${wsId}, 'Squad Credit Engine', ${tLending.id}, ${pLoan.id}, ${okrLend1.id}) RETURNING id`;
    await sql`INSERT INTO qbr_squad_members (squad_id, member_id, squad_role) VALUES (${sqLoan.id}, ${memberIds['Tom Hayes']}, 'LEAD') ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO qbr_squad_members (squad_id, member_id, squad_role) VALUES (${sqLoan.id}, ${memberIds['Sean Doyle']}, 'MEMBER') ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO qbr_squad_members (squad_id, member_id, squad_role) VALUES (${sqLoan.id}, ${memberIds['Niamh Carroll']}, 'MEMBER') ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO qbr_squad_members (squad_id, member_id, squad_role) VALUES (${sqLoan.id}, ${memberIds['Raj Kapoor']}, 'MEMBER') ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO qbr_squad_members (squad_id, member_id, squad_role) VALUES (${sqLoan.id}, ${memberIds['Patrick Ward']}, 'ADVISOR') ON CONFLICT DO NOTHING`;

    const [sqMobile] = await sql`INSERT INTO qbr_squads (org_id, workspace_id, name, tribe_id, project_id, okr_id) VALUES (${orgId}, ${wsId}, 'Squad Mobile v3', ${tDigital.id}, ${pMobile.id}, ${okrDig1.id}) RETURNING id`;
    await sql`INSERT INTO qbr_squad_members (squad_id, member_id, squad_role) VALUES (${sqMobile.id}, ${memberIds['Linda O\\'Dwyer']}, 'LEAD') ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO qbr_squad_members (squad_id, member_id, squad_role) VALUES (${sqMobile.id}, ${memberIds['Oisin Flynn']}, 'MEMBER') ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO qbr_squad_members (squad_id, member_id, squad_role) VALUES (${sqMobile.id}, ${memberIds['Saoirse Kelly']}, 'MEMBER') ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO qbr_squad_members (squad_id, member_id, squad_role) VALUES (${sqMobile.id}, ${memberIds['Kate Murphy']}, 'MEMBER') ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO qbr_squad_members (squad_id, member_id, squad_role) VALUES (${sqMobile.id}, ${memberIds['Ravi Shankar']}, 'ADVISOR') ON CONFLICT DO NOTHING`;

    return ok({ success: true, message: 'QBR demo data seeded successfully', stats: { members: Object.keys(memberIds).length, quarters: 2, sprints: 12, projects: 8, squads: 3 } });
}
