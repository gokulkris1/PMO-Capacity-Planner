// server/index.ts
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { pool } from './db';
import resourceRouter from './routes/resource';
import projectRouter from './routes/project';
import allocationRouter from './routes/allocation';
import authRouter from './routes/auth';
import aiRouter from './routes/ai';
import { setupSwagger } from './swagger';

dotenv.config();

const app = express();
app.use(helmet());

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
    standardHeaders: true,
    legacyHeaders: false,
});

app.use('/api/', apiLimiter);

app.use(cors());
app.use(express.json());

app.use('/api/resources', resourceRouter);
app.use('/api/projects', projectRouter);
app.use('/api/allocations', allocationRouter);
app.use('/api/ai', aiRouter);
app.use('/api/auth', authRouter);

setupSwagger(app);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
    console.log(`🚀 API server listening on port ${PORT}`);
});
