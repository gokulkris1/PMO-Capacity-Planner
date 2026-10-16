if (!process.env.NEON_DATABASE_URL) { console.error('Set NEON_DATABASE_URL (never hard-code credentials)'); process.exit(1); }
import pg from 'pg';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const { Client } = pg;

// pg uses TCP — fully supports DDL, transactions, etc.
const client = new Client({
    connectionString: process.env.NEON_DATABASE_URL,
});

async function run() {
    await client.connect();
    console.log('✅ Connected via TCP\n');

    const script = readFileSync(join(__dirname, 'migrate_workspace_members.sql'), 'utf8');
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
            console.log(`  ✅ [${i + 1}/${stmts.length}] ${stmts[i].slice(0, 75).replace(/\s+/g, ' ')}`);
        } catch (e) {
            skip++;
            const isExpected = e.message.includes('already exists') || e.message.includes('duplicate') || e.message.includes('does not exist');
            console.log(`  ${isExpected ? '⚠️' : '❌'} [${i + 1}/${stmts.length}] ${e.message.slice(0, 90)}`);
        }
    }

    console.log('\n=== Verification ===');
    const { rows: tables } = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`);
    console.log('Tables:', tables.map(t => t.table_name).join(', '));

    const { rows: wm } = await client.query('SELECT COUNT(*) as cnt FROM workspace_members');
    console.log('workspace_members rows:', wm[0].cnt);

    const { rows: users } = await client.query('SELECT email, role FROM users ORDER BY created_at');
    console.log('\nUsers:');
    users.forEach(u => console.log(`  ${u.email} → ${u.role}`));

    console.log(`\n✨ Done — ${ok} OK, ${skip} skipped/warned.\n`);
    await client.end();
}

run().catch(async e => {
    console.error('Fatal:', e.message);
    await client.end().catch(() => { });
    process.exit(1);
});
