import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

const connectionString = process.env.NETLIFY_DATABASE_URL_UNPOOLED || process.env.NETLIFY_DATABASE_URL || process.env.NEON_DATABASE_URL;
if (!connectionString) {
  throw new Error('Set NETLIFY_DATABASE_URL_UNPOOLED, NETLIFY_DATABASE_URL, or NEON_DATABASE_URL before running this diagnostic.');
}
const sql = neon(connectionString);

async function check() {
    console.log('=== Checking tables ===');
    const tables = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `;
    tables.forEach(t => console.log(' -', t.table_name));

    console.log('\n=== workspace_members ===');
    try {
        const wm = await sql`SELECT COUNT(*) as cnt FROM workspace_members`;
        console.log('Rows:', wm[0].cnt);

        const sample = await sql`
      SELECT wm.user_id, u.email, u.role, wm.workspace_id, wm.role as ws_role
      FROM workspace_members wm JOIN users u ON u.id = wm.user_id
      LIMIT 10
    `;
        sample.forEach(m => console.log(` ${m.email} → ws_role=${m.ws_role}`));
    } catch (e) {
        console.log('Error:', e.message);
    }

    console.log('\n=== Users (roles) ===');
    const users = await sql`SELECT email, role FROM users ORDER BY created_at`;
    users.forEach(u => console.log(` ${u.email} → ${u.role}`));

    console.log('\n=== Projects count ===');
    const projs = await sql`SELECT COUNT(*) as cnt FROM projects`;
    console.log('Total projects:', projs[0].cnt);
}

check().catch(e => console.error('Fatal:', e.message));
