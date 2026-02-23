import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';

dotenv.config();

const sql = neon(process.env.NEON_DATABASE_URL || process.env.DATABASE_URL!);

async function wipeDatabase() {
    try {
        console.log('Initiating database wipe...');

        // Cascade truncate all main tables to completely reset the application state
        await sql`
            TRUNCATE TABLE 
                allocations, 
                projects, 
                resources, 
                workspaces, 
                users, 
                organizations 
            CASCADE;
        `;

        console.log('✅ Successfully wiped all tenant, user, and capacity data from the database. Starting fresh.');
        process.exit(0);
    } catch (err) {
        console.error('❌ Failed to wipe database:', err);
        process.exit(1);
    }
}

wipeDatabase();
