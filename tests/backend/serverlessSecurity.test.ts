process.env.JWT_SECRET = 'test-security-secret';
process.env.NEON_DATABASE_URL = 'postgres://dummy:dummy@dummy.neon.tech/dummy';
process.env.STRIPE_WEBHOOK_SECRET = '';
delete process.env.RESEND_API_KEY;
delete process.env.OPENAI_API_KEY;
delete process.env.GEMINI_API_KEY;

import { handler as aiHandler } from '../../netlify/functions/ai';
import jwt from 'jsonwebtoken';
import { handler as authHandler } from '../../netlify/functions/auth';
import { handler as checkoutHandler } from '../../netlify/functions/checkout';
import { handler as debugDbHandler } from '../../netlify/functions/debug_db';
import { handler as jiraHandler } from '../../netlify/functions/jira';
import { handler as qbrHandler } from '../../netlify/functions/qbr';
import { handler as themeExtractHandler } from '../../netlify/functions/theme_extract';
import { handler as webhookHandler } from '../../netlify/functions/webhook';

const mockSql = jest.fn();

jest.mock('@neondatabase/serverless', () => ({
    neon: jest.fn(() => mockSql),
}));

jest.mock('resend', () => ({
    Resend: jest.fn().mockImplementation(() => ({
        emails: { send: jest.fn() },
    })),
}));

const makeToken = (id = 'user-1') => jwt.sign({ id }, process.env.JWT_SECRET!);
const json = (response: any) => JSON.parse(response.body);

describe('serverless security boundaries', () => {
    beforeEach(() => {
        mockSql.mockReset();
        mockSql.mockResolvedValue([]);
    });

    it('keeps the former database diagnostic endpoint permanently retired', async () => {
        const response = await debugDbHandler({} as any, {} as any) as any;

        expect(response.statusCode).toBe(410);
        expect(json(response).error).not.toMatch(/database|email|password/i);
    });

    it.each([
        ['Jira import', jiraHandler, '/api/jira'],
        ['theme extraction', themeExtractHandler, '/api/theme_extract'],
        ['QBR data', qbrHandler, '/api/qbr/overview'],
    ])('rejects unauthenticated requests to %s', async (_name, handler, path) => {
        const response = await handler({
            httpMethod: 'POST',
            path,
            headers: {},
            body: '{}',
        } as any, {} as any) as any;

        expect(response.statusCode).toBe(401);
    });

    it('rejects a private-network Jira target before sending credentials', async () => {
        mockSql.mockImplementation(async (strings: TemplateStringsArray) => {
            const query = strings.join(' ');
            if (query.includes('SELECT role, org_id FROM users')) return [{ role: 'USER', org_id: 'org-1' }];
            return [];
        });

        const response = await jiraHandler({
            httpMethod: 'POST',
            path: '/api/jira',
            headers: { authorization: `Bearer ${makeToken()}` },
            body: JSON.stringify({
                domain: 'https://127.0.0.1',
                email: 'person@example.com',
                token: 'jira-token',
                projectKey: 'PMO',
            }),
        } as any, {} as any) as any;

        expect(response.statusCode).toBe(400);
        expect(json(response).error).toMatch(/private network/i);
    });

    it('rejects a private-network theme target before fetching it', async () => {
        mockSql.mockImplementation(async (strings: TemplateStringsArray) => {
            const query = strings.join(' ');
            if (query.includes('SELECT id, org_id FROM users')) return [{ id: 'user-1', org_id: 'org-1' }];
            return [];
        });

        const response = await themeExtractHandler({
            httpMethod: 'POST',
            path: '/api/theme_extract',
            headers: { authorization: `Bearer ${makeToken()}` },
            body: JSON.stringify({ url: 'https://127.0.0.1' }),
        } as any, {} as any) as any;

        expect(response.statusCode).toBe(400);
        expect(json(response).error).toMatch(/private network/i);
    });

    it('does not disclose a reset code when reset delivery is unavailable', async () => {
        const response = await authHandler({
            httpMethod: 'POST',
            path: '/api/auth/reset/send-otp',
            headers: {},
            body: JSON.stringify({ email: 'person@example.com' }),
        } as any, {} as any) as any;

        const body = json(response);
        expect(response.statusCode).toBe(503);
        expect(JSON.stringify(body)).not.toMatch(/otp|code|password/i);
    });

    it('retires direct superuser account creation', async () => {
        mockSql.mockImplementation(async (strings: TemplateStringsArray) => {
            const query = strings.join(' ');
            if (query.includes('SELECT role, org_id FROM users')) return [{ role: 'SUPERUSER', org_id: null }];
            return [];
        });

        const response = await authHandler({
            httpMethod: 'POST',
            path: '/api/auth/admin/users',
            headers: { authorization: `Bearer ${makeToken('super-1')}` },
            body: '{}',
        } as any, {} as any) as any;

        expect(response.statusCode).toBe(410);
        expect(json(response).error).toMatch(/retired/i);
    });

    it('rejects direct administrator password changes', async () => {
        mockSql.mockImplementation(async (strings: TemplateStringsArray) => {
            const query = strings.join(' ');
            if (query.includes('SELECT role, org_id FROM users')) return [{ role: 'ORG_ADMIN', org_id: 'org-1' }];
            return [];
        });

        const response = await authHandler({
            httpMethod: 'PUT',
            path: '/api/auth/users/user-2',
            headers: { authorization: `Bearer ${makeToken()}` },
            body: JSON.stringify({ password: 'not-allowed' }),
        } as any, {} as any) as any;

        expect(response.statusCode).toBe(400);
        expect(json(response).error).toMatch(/reset/i);
    });

    it('denies checkout creation to an ordinary tenant user', async () => {
        mockSql.mockImplementation(async (strings: TemplateStringsArray) => {
            const query = strings.join(' ');
            if (query.includes('SELECT u.email, u.org_id, u.role')) {
                return [{ email: 'person@example.com', org_id: 'org-1', role: 'USER' }];
            }
            return [];
        });

        const response = await checkoutHandler({
            httpMethod: 'POST',
            headers: { authorization: `Bearer ${makeToken()}` },
            body: JSON.stringify({ plan: 'PRO', orgSlug: 'acme' }),
        } as any, {} as any) as any;

        expect(response.statusCode).toBe(403);
        expect(json(response).error).toMatch(/administrator/i);
    });

    it('fails AI requests safely when no provider is configured', async () => {
        mockSql.mockImplementation(async (strings: TemplateStringsArray) => {
            const query = strings.join(' ');
            if (query.includes('SELECT plan, ai_queries_month, last_reset_date')) {
                return [{ plan: 'BASIC', ai_queries_month: 0, last_reset_date: new Date().toISOString() }];
            }
            return [];
        });

        const response = await aiHandler({
            httpMethod: 'POST',
            headers: { authorization: `Bearer ${makeToken()}` },
            body: JSON.stringify({ systemPrompt: 'You are concise.', userPrompt: 'Summarize capacity.' }),
        } as any, {} as any) as any;

        expect(response.statusCode).toBe(503);
        expect(json(response).error).toBe('AI advisor is not configured');
    });

    it('does not accept webhooks without a configured signing secret', async () => {
        const response = await webhookHandler({
            httpMethod: 'POST',
            headers: { 'stripe-signature': 'invalid' },
            body: '{}',
        } as any, {} as any) as any;

        expect(response.statusCode).toBe(503);
    });

    it('denies QBR data to a user without membership in the requested workspace', async () => {
        mockSql.mockImplementation(async (strings: TemplateStringsArray) => {
            const query = strings.join(' ');
            if (query.includes('SELECT role, org_id FROM users')) return [{ role: 'USER', org_id: 'org-1' }];
            if (query.includes('SELECT org_id FROM workspaces')) return [{ org_id: 'org-1' }];
            if (query.includes('FROM workspace_members')) return [];
            return [];
        });

        const response = await qbrHandler({
            httpMethod: 'GET',
            path: '/api/qbr/overview',
            headers: { authorization: `Bearer ${makeToken()}` },
            queryStringParameters: { wsId: 'workspace-1' },
        } as any, {} as any) as any;

        expect(response.statusCode).toBe(403);
    });

    it('denies QBR writes to a workspace member without write authority', async () => {
        mockSql.mockImplementation(async (strings: TemplateStringsArray) => {
            const query = strings.join(' ');
            if (query.includes('SELECT role, org_id FROM users')) return [{ role: 'USER', org_id: 'org-1' }];
            if (query.includes('SELECT org_id FROM workspaces')) return [{ org_id: 'org-1' }];
            if (query.includes('FROM workspace_members')) return [{ role: 'USER' }];
            return [];
        });

        const response = await qbrHandler({
            httpMethod: 'POST',
            path: '/api/qbr/booking',
            headers: { authorization: `Bearer ${makeToken()}` },
            queryStringParameters: { wsId: 'workspace-1' },
            body: '{}',
        } as any, {} as any) as any;

        expect(response.statusCode).toBe(403);
        expect(json(response).error).toMatch(/write permission/i);
    });

    it('allows a workspace owner to save a booking in their own workspace', async () => {
        mockSql.mockImplementation(async (strings: TemplateStringsArray) => {
            const query = strings.join(' ');
            if (query.includes('SELECT role, org_id FROM users')) return [{ role: 'USER', org_id: 'org-1' }];
            if (query.includes('SELECT org_id FROM workspaces')) return [{ org_id: 'org-1' }];
            if (query.includes('FROM workspace_members')) return [{ role: 'WORKSPACE_OWNER' }];
            if (query.includes('FROM qbr_members m')) return [{ exists: 1 }];
            if (query.includes('WITH removed_booking')) return [{ id: 'booking-1', percentage: 50 }];
            return [];
        });

        const response = await qbrHandler({
            httpMethod: 'POST',
            path: '/api/qbr/booking',
            headers: { authorization: `Bearer ${makeToken()}` },
            queryStringParameters: { wsId: 'workspace-1' },
            body: JSON.stringify({
                memberId: 'member-1',
                projectId: 'project-1',
                sprintId: 'sprint-1',
                percentage: 50,
            }),
        } as any, {} as any) as any;

        expect(response.statusCode).toBe(200);
        expect(json(response).booking).toMatchObject({ id: 'booking-1', percentage: 50 });
    });

    it('allows a workspace owner to read QBR data in their own workspace', async () => {
        mockSql.mockImplementation(async (strings: TemplateStringsArray) => {
            const query = strings.join(' ');
            if (query.includes('SELECT role, org_id FROM users')) return [{ role: 'USER', org_id: 'org-1' }];
            if (query.includes('SELECT org_id FROM workspaces')) return [{ org_id: 'org-1' }];
            if (query.includes('FROM workspace_members')) return [{ role: 'WORKSPACE_OWNER' }];
            return [];
        });

        const response = await qbrHandler({
            httpMethod: 'GET',
            path: '/api/qbr/overview',
            headers: { authorization: `Bearer ${makeToken()}` },
            queryStringParameters: { wsId: 'workspace-1' },
        } as any, {} as any) as any;

        expect(response.statusCode).toBe(200);
        expect(json(response).stats).toEqual({
            members: 0,
            projects: 0,
            tribes: 0,
            chapters: 0,
            coe: 0,
        });
    });

    it('disables QBR demo seeding in a Netlify production context', async () => {
        mockSql.mockImplementation(async (strings: TemplateStringsArray) => {
            const query = strings.join(' ');
            if (query.includes('SELECT role, org_id FROM users')) return [{ role: 'SUPERUSER', org_id: null }];
            if (query.includes('SELECT org_id FROM workspaces')) return [{ org_id: 'org-1' }];
            return [];
        });
        const previousContext = process.env.CONTEXT;
        process.env.CONTEXT = 'production';

        try {
            const response = await qbrHandler({
                httpMethod: 'POST',
                path: '/api/qbr/seed',
                headers: { authorization: `Bearer ${makeToken('super-1')}` },
                queryStringParameters: { wsId: 'workspace-1' },
                body: '{}',
            } as any, {} as any) as any;

            expect(response.statusCode).toBe(403);
            expect(json(response).error).toMatch(/disabled/i);
        } finally {
            if (previousContext === undefined) delete process.env.CONTEXT;
            else process.env.CONTEXT = previousContext;
        }
    });
});
