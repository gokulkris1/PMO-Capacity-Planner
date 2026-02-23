import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
dotenv.config();

const sql = neon(process.env.NEON_DATABASE_URL || process.env.DATABASE_URL!);

async function seed() {
    try {
        const email = 'testuser@test.com';
        const password = 'testuser123';
        const orgName = 'Ytest Org';
        const orgSlug = 'ytest-org';

        console.log(`Checking for existing user: ${email}`);
        const existingUser = await sql`SELECT id FROM users WHERE email = ${email}`;

        if (existingUser.length > 0) {
            console.log('Test SuperAdmin user already exists. Checking permissions...');
            await sql`UPDATE users SET role = 'SUPERUSER', plan = 'MAX' WHERE email = ${email}`;
            console.log('Updated to SUPERUSER and MAX plan.');
            return;
        }

        console.log('Creating organization:', orgName);
        const [org] = await sql`
        INSERT INTO organizations (id, name, slug) 
        VALUES (gen_random_uuid(), ${orgName}, ${orgSlug}) 
        ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
        RETURNING id
    `;

        console.log('Creating default workspace...');
        await sql`
        INSERT INTO workspaces (id, org_id, name)
        VALUES (gen_random_uuid(), ${org.id}, 'Default Workspace')
    `;

        console.log('Hashing password...');
        const hash = await bcrypt.hash(password, 10);

        console.log('Inserting user...');
        await sql`
        INSERT INTO users (email, password_hash, name, role, plan, org_id)
        VALUES (
            ${email}, 
            ${hash}, 
            'Test SuperAdmin', 
            'SUPERUSER', 
            'MAX', 
            ${org.id}
        )
    `;

        console.log('');
        console.log('✅ Success! Seeded Super Admin:');
        console.log(`Email: ${email}`);
        console.log(`Password: ${password}`);
        console.log(`Org: ${orgName}`);
    } catch (err: any) {
        console.error('Migration failed:', err.message);
    }
}

seed();
