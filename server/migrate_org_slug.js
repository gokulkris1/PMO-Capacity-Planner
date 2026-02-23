import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  const sql = neon(process.env.NEON_DATABASE_URL);
  try {
    console.log('Adding slug to organizations...');
    await sql`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS slug TEXT UNIQUE`;
    
    // Backfill existing demo organizations with a random slug so they don't break
    await sql`UPDATE organizations SET slug = gen_random_uuid()::text WHERE slug IS NULL`;

    console.log('Migration complete!');
  } catch (err) {
    console.error('Migration failed:', err);
  }
}
run();
