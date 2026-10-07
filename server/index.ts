// server/index.ts
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

export const app = express();
app.use(helmet());

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
    standardHeaders: true,
    legacyHeaders: false,
});

app.use(cors());
app.use(express.json());

/**
 * This service is intentionally retired. The production API is implemented by
 * Netlify Functions, where every workspace operation is tenant-scoped and
 * authorized against current database membership. Keeping the old Express
 * routers mounted would expose an unauthenticated, single-tenant data surface.
 */
app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', service: 'legacy-api-retired' });
});

app.use('/api/', apiLimiter, (_req, res) => {
    res.status(410).json({
        error: 'This legacy API is retired. Use the Netlify Functions API instead.',
    });
});

const PORT = process.env.PORT || 4000;
if (process.env.NODE_ENV !== 'test') {
    app.listen(PORT, () => {
        console.log(`🚀 API server listening on port ${PORT}`);
    });
}
