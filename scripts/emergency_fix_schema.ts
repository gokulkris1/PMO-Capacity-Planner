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
    console.log('🚀 Starting emergency schema migration...');

    try {
        // 1. Update Resources table
        console.log('--- Updating resources table ---');
        await sql`ALTER TABLE resources ADD COLUMN IF NOT EXISTS role TEXT`;
        await sql`ALTER TABLE resources ADD COLUMN IF NOT EXISTS department TEXT`;
        await sql`ALTER TABLE resources ADD COLUMN IF NOT EXISTS total_capacity INTEGER DEFAULT 100`;
        await sql`ALTER TABLE resources ADD COLUMN IF NOT EXISTS avatar_initials TEXT`;
        await sql`ALTER TABLE resources ADD COLUMN IF NOT EXISTS daily_rate_eur NUMERIC`;
        await sql`ALTER TABLE resources ADD COLUMN IF NOT EXISTS skills TEXT[] DEFAULT '{}'::TEXT[]`;

        // Handle migration of old 'capacity' to 'total_capacity' if it exists
        try {
            await sql`UPDATE resources SET total_capacity = capacity WHERE total_capacity = 100 AND capacity IS NOT NULL`;
        } catch (e) {
            console.log('Note: could not migrate "capacity" to "total_capacity" (maybe it doesn\'t exist yet)');
        }

        // 2. Update Projects table
        console.log('--- Updating projects table ---');
        await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS description TEXT`;
        await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS client_name TEXT`;
        await sql`ALTER TABLE projects ALTER COLUMN priority TYPE TEXT USING priority::TEXT`;

        // 3. Update Allocations table
        console.log('--- Updating allocations table ---');

        // Rename allocation_percent to percentage if it exists
        try {
            await sql`ALTER TABLE allocations RENAME COLUMN allocation_percent TO percentage`;
            console.log('Renamed allocation_percent to percentage');
        } catch (e: any) {
            if (e.message.includes('does not exist')) {
                await sql`ALTER TABLE allocations ADD COLUMN IF NOT EXISTS percentage INTEGER`;
                console.log('Added percentage column (allocation_percent did not exist)');
            } else {
                console.log('Note: Renaming/adding percentage column skipped or already done');
            }
        }

        await sql`ALTER TABLE allocations ADD COLUMN IF NOT EXISTS start_date DATE`;
        await sql`ALTER TABLE allocations ADD COLUMN IF NOT EXISTS end_date DATE`;

        // Change ID to TEXT to support frontend IDs (e.g., "a-12345")
        // This is tricky if it's a SERIAL primary key. We might need to drop the default and change type.
        try {
            await sql`ALTER TABLE allocations ALTER COLUMN id TYPE TEXT USING id::TEXT`;
            await sql`ALTER TABLE allocations ALTER COLUMN id DROP DEFAULT`;
            console.log('Updated allocation id to TEXT and dropped serial default');
        } catch (e) {
            console.error('Failed to change allocation ID type:', e.message);
        }

        // 4. Drop the 100% constraint if it exists
        console.log('--- Removing 100% allocation constraint ---');
        try {
            await sql`ALTER TABLE allocations DROP CONSTRAINT IF EXISTS allocations_allocation_percent_check`;
            await sql`ALTER TABLE allocations DROP CONSTRAINT IF EXISTS allocations_percentage_check`;
            console.log('Dropped allocation percentage constraints');
        } catch (e) {
            console.log('Note: No percentage constraint found to drop');
        }

        console.log('✅ Migration complete!');
    } catch (e: any) {
        console.error('❌ Migration failed:', e.message);
        process.exit(1);
    }
}

main();
