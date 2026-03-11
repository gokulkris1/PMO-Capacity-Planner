import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';
dotenv.config();

const sql = neon(process.env.NETLIFY_DATABASE_URL_UNPOOLED || process.env.NEON_DATABASE_URL);
async function run() {
  const users = await sql`SELECT id, email, role, plan, org_id FROM users WHERE email = 'tom.hayes@three.ie'`;
  console.log("TOM:", users[0]);
  
  const workspaces = await sql`SELECT w.id, w.name, w.org_id FROM workspace_members wm JOIN workspaces w ON wm.workspace_id = w.id WHERE wm.user_id = ${users[0].id}`;
  console.log("WORKSPACES:", workspaces);
}
run();
