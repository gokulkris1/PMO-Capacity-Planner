import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const connectionString = process.env.NEON_DATABASE_URL;
if (!connectionString) {
    console.error('NEON_DATABASE_URL is not set in environment variables');
    process.exit(1);
}

const sql = neon(connectionString);

async function main() {
    console.log('Starting migration: Creating audit_logs table...');

    try {
        await sql`
            CREATE TABLE IF NOT EXISTS audit_logs (
                id SERIAL PRIMARY KEY,
                user_id UUID REFERENCES users(id) ON DELETE SET NULL,
                action TEXT NOT NULL,
                details JSONB,
                ip_address TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `;
        
        await sql`
            CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
        `;
        
        await sql`
            CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
        `;

        console.log('Successfully created audit_logs table and indexes.');
    } catch (err: any) {
        console.error('Migration failed:', err.message);
        process.exit(1);
    }
}

main().catch(console.error);
