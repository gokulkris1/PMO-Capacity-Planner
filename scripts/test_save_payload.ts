import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';
dotenv.config();

const databaseUrl = process.env.NETLIFY_DATABASE_URL_UNPOOLED ||
    process.env.NETLIFY_DATABASE_URL ||
    process.env.NEON_DATABASE_URL ||
    process.env.DATABASE_URL;

if (!databaseUrl) {
    console.error('Error: No database URL found in environment variables.');
    process.exit(1);
}

const sql = neon(databaseUrl);

async function main() {
    console.log('🚀 Running test payload to verify save errors are fixed...');

    try {
        // 1. Setup a test workspace
        const orgId = crypto.randomUUID();
        await sql`
            INSERT INTO organizations (id, name, slug) 
            VALUES (${orgId}, 'Test Org Save Payload', 'test-org-save-payload') 
        `;

        const wsId = crypto.randomUUID();
        await sql`
            INSERT INTO workspaces (id, name, org_id) 
            VALUES (${wsId}, 'Test Workspace Save Payload', ${orgId}) 
        `;

        // 2. Define payload mimicking frontend
        const resources = [{
            id: 'r-test-1',
            name: 'Test Resource 1',
            role: 'Tester',
            type: 'Permanent',
            department: 'QA',
            teamId: null,
            totalCapacity: 100,
            avatarInitials: 'TR',
            email: 'test@example.com',
            location: 'Remote',
            dailyRate: 150,
            skills: ['Testing', 'Automation']
        }];

        const projects = [{
            id: 'p-test-1',
            name: 'Test Project 1',
            status: 'Active',
            priority: 'High',
            description: 'A test project to verify saving',
            startDate: '2026-01-01',
            endDate: '2026-12-31',
            clientName: 'Internal Test',
            budget: 50000,
            color: '#10b981'
        }];

        const allocations = [{
            id: 'a-test-1',
            resourceId: 'r-test-1',
            projectId: 'p-test-1',
            percentage: 150, // Test > 100% allocation
            startDate: '2026-01-01',
            endDate: '2026-12-31'
        }];

        console.log('--- Simulating workspace.ts insert loop ---');

        // Test Resource Insert
        for (const r of resources) {
            try {
                await sql`
                    INSERT INTO resources (id, workspace_id, org_id, name, role, type, department, team_id, total_capacity, avatar_initials, email, location, daily_rate_eur, skills)
                    VALUES (${r.id}, ${wsId}, ${orgId}, ${r.name}, ${r.role || ''}, ${r.type || 'Permanent'}, ${r.department || ''}, ${r.teamId || null},
                            ${r.totalCapacity ?? 100}, ${r.avatarInitials || null}, ${r.email || null}, ${r.location || null}, ${r.dailyRate || null}, ${r.skills || []})
                `;
                console.log(`✅ Successfully inserted resource: ${r.name}`);
            } catch (err: any) {
                console.error(`❌ Failed to insert resource ${r.id}:`, err.message);
                throw err;
            }
        }

        // Test Project Insert
        for (const p of projects) {
            try {
                await sql`
                    INSERT INTO projects (id, workspace_id, org_id, name, status, priority, description, start_date, end_date, client_name, budget, color)
                    VALUES (${p.id}, ${wsId}, ${orgId}, ${p.name}, ${p.status || 'Active'}, ${p.priority || 'Medium'}, ${p.description || ''},
                            ${p.startDate || null}, ${p.endDate || null}, ${p.clientName || null}, ${p.budget || null}, ${p.color || null})
                `;
                console.log(`✅ Successfully inserted project: ${p.name}`);
            } catch (err: any) {
                console.error(`❌ Failed to insert project ${p.id}:`, err.message);
                throw err;
            }
        }

        // Test Allocation Insert
        for (const a of allocations) {
            if (!a.percentage || a.percentage <= 0) continue;
            try {
                await sql`
                    INSERT INTO allocations (id, workspace_id, org_id, resource_id, project_id, percentage, start_date, end_date)
                    VALUES (${a.id}, ${wsId}, ${orgId}, ${a.resourceId}, ${a.projectId}, ${a.percentage}, ${a.startDate || null}, ${a.endDate || null})
                `;
                console.log(`✅ Successfully inserted allocation: ${a.id}`);
            } catch (err: any) {
                console.error(`❌ Failed to insert allocation ${a.id}:`, err.message);
                throw err;
            }
        }

        console.log('✅ Save payload mapping verified perfectly!');

        // Cleanup
        console.log('--- Cleaning up test data ---');
        await sql`DELETE FROM organizations WHERE id = ${orgId}`;
        console.log('Cleaned up test organization and cascaded data.');

    } catch (e: any) {
        console.error('❌ Verification script failed:', e.message);
        process.exit(1);
    }
}

main();
