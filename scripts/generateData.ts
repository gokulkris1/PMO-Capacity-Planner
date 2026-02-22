import { Pool } from 'pg';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();

const pool = new Pool({
    connectionString: process.env.NEON_DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

async function run() {
    console.log('Generating synthetic data (10k resources, 2k projects)...');

    // Clear tables
    await pool.query('DELETE FROM allocations');
    await pool.query('DELETE FROM projects');
    await pool.query('DELETE FROM resources');

    console.log('Inserting projects...');
    const projectValues = [];
    for (let i = 0; i < 2000; i++) {
        projectValues.push(`('${uuidv4()}', 'Project ${i}', 'Active', 'Medium', 'Synthetic project')`);

        // Batch insert 500 at a time
        if (projectValues.length >= 500 || i === 1999) {
            await pool.query(`INSERT INTO projects (id, name, status, priority, description) VALUES ${projectValues.join(',')}`);
            projectValues.length = 0;
        }
    }

    console.log('Inserting resources...');
    const resValues = [];
    for (let i = 0; i < 10000; i++) {
        resValues.push(`('${uuidv4()}', 'Resource ${i}', 'Developer', 'Permanent', 'Engineering', 100)`);

        // Batch insert 500 at a time
        if (resValues.length >= 500 || i === 9999) {
            await pool.query(`INSERT INTO resources (id, name, role, type, department, total_capacity) VALUES ${resValues.join(',')}`);
            resValues.length = 0;
        }
    }

    console.log('Done!');
    process.exit(0);
}

run().catch(e => {
    console.error(e);
    process.exit(1);
});
