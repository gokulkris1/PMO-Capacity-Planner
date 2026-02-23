import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  const sql = neon(process.env.NEON_DATABASE_URL);
  try {
    console.log('Migrating resources...');
    await sql`ALTER TABLE resources ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE`;
    await sql`ALTER TABLE resources ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE`;
    await sql`ALTER TABLE resources ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id)`;
    
    console.log('Migrating projects...');
    await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE`;
    await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE`;
    await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id)`;

    console.log('Migrating allocations...');
    await sql`ALTER TABLE allocations ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE`;
    await sql`ALTER TABLE allocations ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE`;
    await sql`ALTER TABLE allocations ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id)`;
    
    // Create indexes for fast tenancy lookups
    await sql`CREATE INDEX IF NOT EXISTS idx_res_org ON resources(org_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_proj_org ON projects(org_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_alloc_org ON allocations(org_id)`;

    console.log('Migration complete!');
  } catch (err) {
    console.error('Migration failed:', err);
  }
}
run();
