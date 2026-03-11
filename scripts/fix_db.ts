import { neon } from '@neondatabase/serverless';
import 'dotenv/config';

async function main() {
    const sql = neon(process.env.NETLIFY_DATABASE_URL_UNPOOLED || process.env.NETLIFY_DATABASE_URL || process.env.NEON_DATABASE_URL || '');
    try {
        await sql`ALTER TABLE users ALTER COLUMN role SET DEFAULT 'USER'`;
        console.log("Success: Changed default role to 'USER'");
    } catch (e) {
        console.error("Error:", e);
    }
}

main();
