import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const connectionString = process.env.NEON_DATABASE_URL;
if (!connectionString) {
    throw new Error('NEON_DATABASE_URL is not set in environment variables');
}

const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    try {
        const sql = fs.readFileSync(path.join(__dirname, '../server/migrations_user.sql'), 'utf8');
        await pool.query(sql);
        console.log('User migrations applied successfully to Neon DB.');
    } catch (e) {
        console.error('Migration error:', e);
    } finally {
        await pool.end();
        process.exit(0);
    }
}
run();
