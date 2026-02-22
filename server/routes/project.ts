// server/routes/project.ts
import { Router } from 'express';
import { pool } from '../db';

const router = Router();

// GET all projects
router.get('/', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM projects ORDER BY name');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching projects', err);
        res.status(500).json({ error: 'Failed to fetch projects' });
    }
});

// GET single project
router.get('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('SELECT * FROM projects WHERE id = $1', [id]);
        if (result.rowCount === 0) return res.status(404).json({ error: 'Project not found' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error fetching project', err);
        res.status(500).json({ error: 'Failed to fetch project' });
    }
});

// POST create project
router.post('/', async (req, res) => {
    const { id, name, status, priority, start_date, end_date, budget, color } = req.body;
    try {
        const result = await pool.query(
            `INSERT INTO projects (id, name, status, priority, start_date, end_date, budget, color)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [id, name, status, priority, start_date, end_date, budget, color]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error creating project', err);
        res.status(500).json({ error: 'Failed to create project' });
    }
});

// PUT update project
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { name, status, priority, start_date, end_date, budget, color } = req.body;
    try {
        const result = await pool.query(
            `UPDATE projects SET name=$1, status=$2, priority=$3, start_date=$4, end_date=$5, budget=$6, color=$7 WHERE id=$8 RETURNING *`,
            [name, status, priority, start_date, end_date, budget, color, id]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'Project not found' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error updating project', err);
        res.status(500).json({ error: 'Failed to update project' });
    }
});

// DELETE project
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('DELETE FROM projects WHERE id=$1 RETURNING *', [id]);
        if (result.rowCount === 0) return res.status(404).json({ error: 'Project not found' });
        res.json({ message: 'Project deleted' });
    } catch (err) {
        console.error('Error deleting project', err);
        res.status(500).json({ error: 'Failed to delete project' });
    }
});

export default router;
