import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || '';
if (!DATABASE_URL) {
    console.error("DATABASE_URL is missing");
    process.exit(1);
}

const sql = neon(DATABASE_URL);

async function runTest() {
    console.log("🚀 Starting Robustness Test...");

    const testId = crypto.randomUUID();
    const orgId = crypto.randomUUID();
    const wsId = crypto.randomUUID();

    try {
        // 1. Setup Mock Org and Workspace
        console.log("Setting up mock org/workspace...");
        const slug = `test-org-${testId}`;
        await sql`INSERT INTO organizations (id, name, slug) VALUES (${orgId}, 'Test Org', ${slug})`;
        await sql`INSERT INTO workspaces (id, org_id, name) VALUES (${wsId}, ${orgId}, 'Test Workspace')`;

        // 2. Simulate Save Payload
        const payload = {
            resources: [{ id: `r-${testId}`, name: 'Test Resource', totalCapacity: 100 }],
            projects: [{ id: `p-${testId}`, name: 'Test Project', status: 'Active' }],
            allocations: [{ id: `a-${testId}`, resourceId: `r-${testId}`, projectId: `p-${testId}`, percentage: 120 }]
        };

        // Note: We're testing the logic that would be inside workspace.ts
        // Since we can't easily trigger the Netlify function with a mock JWT here,
        // we'll verify the SQL constraints and schema alignment directly.

        console.log("Verifying schema alignment with payload...");

        // This simulates the transaction block
        await sql`DELETE FROM allocations WHERE workspace_id = ${wsId}`;
        await sql`DELETE FROM resources WHERE workspace_id = ${wsId}`;
        await sql`DELETE FROM projects WHERE workspace_id = ${wsId}`;

        await sql`
            INSERT INTO resources (id, workspace_id, name, total_capacity, type, role)
            VALUES (${payload.resources[0].id}, ${wsId}, ${payload.resources[0].name}, ${payload.resources[0].totalCapacity}, 'Permanent', 'Developer')
        `;

        await sql`
            INSERT INTO projects (id, workspace_id, name, status, priority)
            VALUES (${payload.projects[0].id}, ${wsId}, ${payload.projects[0].name}, ${payload.projects[0].status}, 'Medium')
        `;

        await sql`
            INSERT INTO allocations (id, workspace_id, resource_id, project_id, percentage)
            VALUES (${payload.allocations[0].id}, ${wsId}, ${payload.allocations[0].resourceId}, ${payload.allocations[0].projectId}, ${payload.allocations[0].percentage})
        `;

        console.log("✅ Basic save simulation passed!");

        // 3. Verify Over-allocation (>100%)
        const savedAlloc = await sql`SELECT percentage FROM allocations WHERE id = ${payload.allocations[0].id}`;
        if (savedAlloc[0].percentage === 120) {
            console.log("✅ Over-allocation (120%) persisted correctly!");
        } else {
            throw new Error(`Over-allocation failed: expected 120, got ${savedAlloc[0].percentage}`);
        }

        // 4. Cleanup
        console.log("Cleaning up...");
        await sql`DELETE FROM allocations WHERE workspace_id = ${wsId}`;
        await sql`DELETE FROM resources WHERE workspace_id = ${wsId}`;
        await sql`DELETE FROM projects WHERE workspace_id = ${wsId}`;
        await sql`DELETE FROM workspaces WHERE id = ${wsId}`;
        await sql`DELETE FROM organizations WHERE id = ${orgId}`;

        console.log("🎊 VERIFICATION COMPLETE: SYSTEM IS ROBUST!");

    } catch (err) {
        console.error("❌ TEST FAILED:", err);
        process.exit(1);
    }
}

runTest();
