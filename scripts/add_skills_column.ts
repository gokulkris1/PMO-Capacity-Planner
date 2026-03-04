import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';
dotenv.config();

const sql = neon(process.env.DATABASE_URL!);

async function main() {
    console.log('Adding skills column to resources table...');
    try {
        await sql`ALTER TABLE resources ADD COLUMN IF NOT EXISTS skills TEXT[] DEFAULT '{}'::TEXT[]`;
        console.log('Successfully added skills column!');
    } catch (e: any) {
        console.error('Error:', e.message);
    }
}

main();
