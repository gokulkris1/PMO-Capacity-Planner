import type { Handler, HandlerEvent } from '@netlify/functions';
import jwt from 'jsonwebtoken';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.NEON_DATABASE_URL || '');
const OPENAI_API_KEY = process.env.VITE_OPENAI_API_KEY || process.env.OPENAI_API_KEY || '';
const JWT_SECRET = process.env.JWT_SECRET as string;
if (!JWT_SECRET) throw new Error("JWT_SECRET environment variable is missing");

const CORS = {
    'Access-Control-Allow-Origin': process.env.URL || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'OPTIONS, POST',
};

function ok(body: unknown) { return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
function fail(msg: string, status = 400) { return { statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: msg }) }; }

export const handler: Handler = async (event: HandlerEvent) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

    // Authenticate user
    const authHeader = event.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return fail('Unauthorized', 401);
    const token = authHeader.split(' ')[1];

    let userId: string;
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        userId = decoded.id;
    } catch {
        return fail('Invalid token', 401);
    }

    if (event.httpMethod !== 'POST') return fail('Method not allowed', 405);

    try {
        const { systemPrompt, userPrompt } = JSON.parse(event.body || '{}');

        // Check Quotas
        const res = await sql`
            SELECT plan, ai_queries_month, last_reset_date 
            FROM users WHERE id = ${userId} LIMIT 1
        `;
        if (res.length === 0) return fail('User not found', 400);

        let { plan, ai_queries_month, last_reset_date } = res[0];

        // Reset quota if older than 30 days
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        if (new Date(last_reset_date) < thirtyDaysAgo) {
            await sql`UPDATE users SET ai_queries_month = 0, last_reset_date = NOW() WHERE id = ${userId}`;
            ai_queries_month = 0;
        }

        const limits: Record<string, number> = { 'BASIC': 25, 'PRO': 100, 'MAX': 999999 };
        const userLimit = limits[plan || 'BASIC'] || 25;

        if (ai_queries_month >= userLimit) {
            return fail(`You have reached your limit of ${userLimit} AI queries this month. Please upgrade your plan.`, 429);
        }

        if (!OPENAI_API_KEY) {
            return ok({ response: "AI advisor is currently disabled. Server is missing OPENAI_API_KEY." });
        }

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                temperature: 0.2, // Low temp for more analytical PMO responses
                max_tokens: 500,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            return fail(`OpenAI API Error: ${errorText}`, 502);
        }

        const data = await response.json();

        // Increment quota logic
        await sql`UPDATE users SET ai_queries_month = ai_queries_month + 1 WHERE id = ${userId}`;

        return ok({ response: data.choices?.[0]?.message?.content || "No response generated." });

    } catch (err: any) {
        console.error('AI Route Error:', err);
        return fail('Internal server error', 500);
    }
};
