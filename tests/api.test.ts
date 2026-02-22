import request from 'supertest';
import express from 'express';
import aiRouter from '../server/routes/ai';

const app = express();
app.use(express.json());
app.use('/api/ai', aiRouter);

describe('AI Advisor API', () => {
    it('should return 400 if question is missing', async () => {
        const res = await request(app)
            .post('/api/ai/advice')
            .send({});
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Question is required');
    });
});
