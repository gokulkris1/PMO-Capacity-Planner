import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';
dotenv.config();

const sql = neon(process.env.NEON_DATABASE_URL || process.env.DATABASE_URL!);

async function run() {
    try {
        console.log('Adding logo_url and primary_color to organizations...');
        await sql`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS logo_url TEXT`;
        await sql`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS primary_color VARCHAR(50)`;
        console.log('Migration complete.');
    } catch (err) {
        console.error('Migration failed:', err);
    }
}
run();
