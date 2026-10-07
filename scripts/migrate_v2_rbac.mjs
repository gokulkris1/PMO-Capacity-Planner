import pg from 'pg';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const { Client } = pg;

dotenv.config({ path: join(__dirname, '..', '.env.local') });
dotenv.config({ path: join(__dirname, '..', '.env') });

const connectionString =
    process.env.NETLIFY_DATABASE_URL_UNPOOLED ||
    process.env.NETLIFY_DATABASE_URL ||
    process.env.NEON_DATABASE_URL;

if (!connectionString) {
    throw new Error('Set NETLIFY_DATABASE_URL_UNPOOLED, NETLIFY_DATABASE_URL, or NEON_DATABASE_URL before running this migration.');
}

const client = new Client({
    connectionString,
});

async function run() {
    await client.connect();
    console.log('Connected via TCP. Review the migration and confirm a backup exists before execution.\n');

    const script = readFileSync(join(__dirname, 'migrate_v2_rbac.sql'), 'utf8');
    await client.query(script);
    console.log('RBAC migration transaction committed.\n');

    console.log('\n=== Verification ===');

    const { rows: tables } = await client.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`
    );
    console.log('Tables:', tables.map(t => t.table_name).join(', '));

    const { rows: wm } = await client.query('SELECT COUNT(*) as cnt FROM workspace_members');
    console.log('workspace_members rows:', wm[0].cnt);

        const { rows: platformRoleCounts } = await client.query('SELECT role, COUNT(*)::int AS count FROM users GROUP BY role ORDER BY role');
        console.log('\nPlatform role counts:', platformRoleCounts);

        const { rows: workspaceRoleCounts } = await client.query('SELECT role, COUNT(*)::int AS count FROM workspace_members GROUP BY role ORDER BY role');
        console.log('Workspace role counts:', workspaceRoleCounts);

        const { rows: mismatchedMemberships } = await client.query(`
                SELECT COUNT(*)::int AS count
                FROM workspace_members wm
                JOIN workspaces w ON w.id = wm.workspace_id
                WHERE wm.org_id <> w.org_id
        `);
        console.log('Cross-org membership mismatches:', mismatchedMemberships[0].count);

    console.log('\nVerification complete.\n');
    await client.end();
}

run().catch(async e => {
    console.error('Fatal:', e.message);
    await client.end().catch(() => { });
    process.exit(1);
});
