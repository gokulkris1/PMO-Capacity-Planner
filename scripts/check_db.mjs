import { neon } from '@neondatabase/serverless';

// Use same unpooled URL
const UNPOOLED = 'postgresql://neondb_owner:npg_yngIoS2H9Kmz@ep-soft-mode-ai5mxefw.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require';
const sql = neon(UNPOOLED);

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
