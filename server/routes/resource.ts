// server/routes/resource.ts
import { Router } from 'express';
import { pool } from '../db';

const router = Router();

// GET all resources
router.get('/', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM resources ORDER BY name');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching resources', err);
        res.status(500).json({ error: 'Failed to fetch resources' });
    }
});

// GET single resource by id
router.get('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('SELECT * FROM resources WHERE id = $1', [id]);
        if (result.rowCount === 0) return res.status(404).json({ error: 'Resource not found' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error fetching resource', err);
        res.status(500).json({ error: 'Failed to fetch resource' });
    }
});

// POST create resource
router.post('/', async (req, res) => {
    const { id, name, type, team_id, capacity, location, email } = req.body;
    try {
        const result = await pool.query(
            `INSERT INTO resources (id, name, type, team_id, capacity, location, email)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [id, name, type, team_id, capacity, location, email]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error creating resource', err);
        res.status(500).json({ error: 'Failed to create resource' });
    }
});

// PUT update resource
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { name, type, team_id, capacity, location, email } = req.body;
    try {
        const result = await pool.query(
            `UPDATE resources SET name=$1, type=$2, team_id=$3, capacity=$4, location=$5, email=$6 WHERE id=$7 RETURNING *`,
            [name, type, team_id, capacity, location, email, id]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'Resource not found' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error updating resource', err);
        res.status(500).json({ error: 'Failed to update resource' });
    }
});

// DELETE resource
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('DELETE FROM resources WHERE id=$1 RETURNING *', [id]);
        if (result.rowCount === 0) return res.status(404).json({ error: 'Resource not found' });
        res.json({ message: 'Resource deleted' });
    } catch (err) {
        console.error('Error deleting resource', err);
        res.status(500).json({ error: 'Failed to delete resource' });
    }
});

export default router;
