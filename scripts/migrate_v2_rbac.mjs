import pg from 'pg';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const { Client } = pg;

const client = new Client({
    connectionString: 'postgresql://neondb_owner:npg_yngIoS2H9Kmz@ep-soft-mode-ai5mxefw.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require',
});

async function run() {
    await client.connect();
    console.log('✅ Connected via TCP\n');

    const script = readFileSync(join(__dirname, 'migrate_v2_rbac.sql'), 'utf8');
    const stmts = script
        .split('\n')
        .filter(l => !l.trim().startsWith('--'))
        .join('\n')
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0);

    console.log(`🚀 Running ${stmts.length} statements...\n`);
    let ok = 0, skip = 0;

    for (let i = 0; i < stmts.length; i++) {
        try {
            await client.query(stmts[i]);
            ok++;
            console.log(`  ✅ [${i + 1}/${stmts.length}] ${stmts[i].slice(0, 80).replace(/\s+/g, ' ')}`);
        } catch (e) {
            skip++;
            const msg = e.message || '';
            const expected = msg.includes('already exists') || msg.includes('duplicate') || msg.includes('does not exist');
            console.log(`  ${expected ? '⚠️' : '❌'} [${i + 1}/${stmts.length}] ${msg.slice(0, 100)}`);
        }
    }

    console.log('\n=== Verification ===');

    const { rows: tables } = await client.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`
    );
    console.log('Tables:', tables.map(t => t.table_name).join(', '));

    const { rows: wm } = await client.query('SELECT COUNT(*) as cnt FROM workspace_members');
    console.log('workspace_members rows:', wm[0].cnt);

    const { rows: users } = await client.query('SELECT email, role, org_id FROM users ORDER BY created_at');
    console.log('\nUsers:');
    users.forEach(u => console.log(`  ${u.email} → role=${u.role} org=${u.org_id || 'NULL'}`));

    const { rows: members } = await client.query(`
    SELECT u.email, wm.role as ws_role, w.name as ws_name
    FROM workspace_members wm
    JOIN users u ON u.id = wm.user_id
    JOIN workspaces w ON w.id = wm.workspace_id
  `);
    console.log('\nWorkspace Members:');
    members.forEach(m => console.log(`  ${m.email} → ${m.ws_role} in "${m.ws_name}"`));

    console.log(`\n✨ Done — ${ok} OK, ${skip} skipped.\n`);
    await client.end();
}

run().catch(async e => {
    console.error('Fatal:', e.message);
    await client.end().catch(() => { });
    process.exit(1);
});
