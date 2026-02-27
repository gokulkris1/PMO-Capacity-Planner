import { neon } from '@neondatabase/serverless';

const DB_URL = 'postgresql://neondb_owner:npg_yngIoS2H9Kmz@ep-soft-mode-ai5mxefw-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';
const sql = neon(DB_URL);

async function diagnose() {
    console.log('\n=== USERS ===');
    const users = await sql`SELECT id, email, role, org_id FROM users ORDER BY created_at`;
    users.forEach(u => console.log(` ${u.email} | role=${u.role} | org_id=${u.org_id}`));

    console.log('\n=== ORGANIZATIONS ===');
    const orgs = await sql`SELECT id, name, slug FROM organizations`;
    orgs.forEach(o => console.log(` ${o.name} | slug=${o.slug} | id=${o.id}`));

    console.log('\n=== WORKSPACES ===');
    const ws = await sql`SELECT id, name, org_id FROM workspaces`;
    ws.forEach(w => console.log(` ${w.name} | org_id=${w.org_id} | id=${w.id}`));

    console.log('\n=== WORKSPACE_MEMBERS ===');
    const wm = await sql`SELECT wm.user_id, u.email, u.role, wm.workspace_id, wm.role as ws_role FROM workspace_members wm JOIN users u ON u.id = wm.user_id`;
    if (wm.length === 0) console.log(' (empty — this is the problem!)');
    wm.forEach(m => console.log(` ${m.email} | platform=${m.role} | ws_role=${m.ws_role} | ws=${m.workspace_id}`));

    console.log('\n=== PROJECTS (first 5) ===');
    const projs = await sql`SELECT id, name, workspace_id FROM projects LIMIT 5`;
    if (projs.length === 0) console.log(' (no projects found)');
    projs.forEach(p => console.log(` ${p.name} | ws=${p.workspace_id}`));

    console.log('\n=== RESOURCES (first 5) ===');
    const res = await sql`SELECT id, name, workspace_id FROM resources LIMIT 5`;
    if (res.length === 0) console.log(' (no resources found)');
    res.forEach(r => console.log(` ${r.name} | ws=${r.workspace_id}`));
}

diagnose().catch(e => console.error('Error:', e.message));
