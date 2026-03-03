process.env.JWT_SECRET = 'test-secret';
process.env.NEON_DATABASE_URL = 'postgres://dummy:dummy@dummy.neon.tech/dummy';

import { handler } from '../../netlify/functions/auth';
import type { HandlerEvent } from '@netlify/functions';

// Mock dependencies that would require real database or external services
jest.mock('@neondatabase/serverless', () => ({
    neon: () => jest.fn().mockResolvedValue([])
}));
jest.mock('resend', () => ({
    Resend: jest.fn().mockImplementation(() => ({
        emails: { send: jest.fn() }
    }))
}));

describe('Auth Handler', () => {

    it('should return CORS headers on OPTIONS request', async () => {
        const event = { httpMethod: 'OPTIONS', path: '/api/auth' } as HandlerEvent;
        const response = await handler(event, {} as any) as any;

        expect(response.statusCode).toBe(200);
        expect(response.headers?.['Access-Control-Allow-Methods']).toBeDefined();
    });

    it('should fail registration if email or password are missing', async () => {
        const event = {
            httpMethod: 'POST',
            path: '/api/auth/register',
            body: JSON.stringify({ name: 'Test User' })
        } as HandlerEvent;
        const response = await handler(event, {} as any) as any;

        expect(response.statusCode).toBe(400);
        expect(JSON.parse(response.body).error).toBe('Email and password are required');
    });

    it('should fail login if email or password are missing', async () => {
        const event = {
            httpMethod: 'POST',
            path: '/api/auth/login',
            body: JSON.stringify({ email: 'test@example.com' })
        } as HandlerEvent;
        const response = await handler(event, {} as any) as any;

        expect(response.statusCode).toBe(400);
        expect(JSON.parse(response.body).error).toBe('Email and password are required');
    });

    it('should return 401 for protected routes without auth token', async () => {
        const event = {
            httpMethod: 'GET',
            path: '/api/auth/users',
            headers: {} // missing authorization
        } as unknown as HandlerEvent;
        const response = await handler(event, {} as any) as any;

        expect(response.statusCode).toBe(401);
        expect(JSON.parse(response.body).error).toBe('Unauthorized');
    });
});
