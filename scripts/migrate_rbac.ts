import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const sql = neon(
    process.env.NETLIFY_DATABASE_URL_UNPOOLED ||
    process.env.NETLIFY_DATABASE_URL ||
    process.env.NEON_DATABASE_URL || ''
);

async function migrateRBAC() {
    try {
        console.log('Starting RBAC & Pricing Migration...');

        // 1. Drop old constraints
        console.log('Dropping old CHECK constraints...');
        try {
            await sql`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`;
            await sql`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_plan_check`;
            await sql`ALTER TABLE workspaces DROP CONSTRAINT IF EXISTS workspaces_plan_check`;
        } catch (e: any) {
            console.log('Error dropping constraints (might not exist):', e.message);
        }

        // 2. Migrate existing roles
        console.log('Migrating roles...');
        await sql`UPDATE users SET role = 'ADMIN' WHERE role IN ('PMO')`;
        await sql`UPDATE users SET role = 'USER' WHERE role IN ('PM', 'VIEWER')`;

        // 3. Migrate existing plans
        console.log('Migrating plans...');
        await sql`UPDATE users SET plan = 'BASIC' WHERE plan = 'FREE'`;

        try {
            await sql`UPDATE workspaces SET plan = 'BASIC' WHERE plan = 'FREE'`;
        } catch (e: any) {
            console.log('Workspaces plan column might not exist yet.');
        }

        // 4. Force Tom Hayes to SUPERUSER & MAX
        console.log('Granting Tom Hayes SUPERUSER status and MAX plan...');
        await sql`
            UPDATE users 
            SET role = 'SUPERUSER', plan = 'MAX' 
            WHERE email ILIKE 'tom.hayes%' OR email ILIKE '%tomhayes%'
        `;

        // 5. Add new constraints
        console.log('Adding new CHECK constraints...');
        await sql`
            ALTER TABLE users 
            ADD CONSTRAINT users_role_check 
            CHECK (role IN ('SUPERUSER', 'ADMIN', 'USER'))
        `;

        await sql`
            ALTER TABLE users 
            ADD CONSTRAINT users_plan_check 
            CHECK (plan IN ('BASIC', 'PRO', 'MAX'))
        `;

        try {
            await sql`
                ALTER TABLE workspaces 
                ADD CONSTRAINT workspaces_plan_check 
                CHECK (plan IN ('BASIC', 'PRO', 'MAX'))
            `;
        } catch (e: any) {
            console.log('Workspaces plan constraint failed to add (column might not exist).');
        }

        console.log('✅ RBAC Migration Completed Successfully!');
    } catch (e) {
        console.error('Migration failed:', e);
        process.exit(1);
    }
}

migrateRBAC();
