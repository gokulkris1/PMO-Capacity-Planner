// server/index.ts
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { pool } from './db';
import resourceRouter from './routes/resource';
import projectRouter from './routes/project';
import allocationRouter from './routes/allocation';
import aiRouter from './routes/ai';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/resources', resourceRouter);
app.use('/api/projects', projectRouter);
app.use('/api/allocations', allocationRouter);
app.use('/api/ai', aiRouter);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
    console.log(`🚀 API server listening on port ${PORT}`);
});
