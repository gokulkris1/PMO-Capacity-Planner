// server/routes/allocation.ts
import { Router } from 'express';
import { pool } from '../db';

const router = Router();

// GET all allocations
router.get('/', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM allocations ORDER BY id');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching allocations', err);
        res.status(500).json({ error: 'Failed to fetch allocations' });
    }
});

// POST create allocation
router.post('/', async (req, res) => {
    const { resource_id, project_id, allocation_percent } = req.body;
    try {
        const result = await pool.query(
            `INSERT INTO allocations (resource_id, project_id, allocation_percent)
       VALUES ($1, $2, $3) RETURNING *`,
            [resource_id, project_id, allocation_percent]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error creating allocation', err);
        res.status(500).json({ error: 'Failed to create allocation' });
    }
});

// PUT update allocation
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { allocation_percent } = req.body;
    try {
        const result = await pool.query(
            `UPDATE allocations SET allocation_percent=$1 WHERE id=$2 RETURNING *`,
            [allocation_percent, id]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'Allocation not found' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error updating allocation', err);
        res.status(500).json({ error: 'Failed to update allocation' });
    }
});

// DELETE allocation
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('DELETE FROM allocations WHERE id=$1 RETURNING *', [id]);
        if (result.rowCount === 0) return res.status(404).json({ error: 'Allocation not found' });
        res.json({ message: 'Allocation deleted' });
    } catch (err) {
        console.error('Error deleting allocation', err);
        res.status(500).json({ error: 'Failed to delete allocation' });
    }
});

export default router;
