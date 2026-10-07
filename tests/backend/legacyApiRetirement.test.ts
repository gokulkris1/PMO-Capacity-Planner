import request from 'supertest';
import { app } from '../../server/index';

describe('retired legacy Express API', () => {
    it('keeps the infrastructure health check available without exposing data', async () => {
        const response = await request(app).get('/health');

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ status: 'ok', service: 'legacy-api-retired' });
    });

    it.each([
        ['/api/resources'],
        ['/api/projects'],
        ['/api/allocations'],
        ['/api/ai/advice'],
        ['/api/auth/register'],
    ])('fails closed for %s', async (path) => {
        const response = await request(app).get(path);

        expect(response.status).toBe(410);
        expect(response.body.error).toMatch(/legacy API is retired/i);
    });
});