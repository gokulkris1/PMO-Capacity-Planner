// server/db.ts
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.NEON_DATABASE_URL;
if (!connectionString) {
    throw new Error('NEON_DATABASE_URL is not set in environment variables');
}

export const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }, // Neon requires SSL
});

pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
    process.exit(-1);
});
