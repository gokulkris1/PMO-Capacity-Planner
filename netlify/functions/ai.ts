import type { Handler, HandlerEvent } from '@netlify/functions';
import jwt from 'jsonwebtoken';
import { neon } from '@neondatabase/serverless';

function getDb() {
    const url = process.env.NETLIFY_DATABASE_URL_UNPOOLED || process.env.NETLIFY_DATABASE_URL || process.env.NEON_DATABASE_URL;
    if (!url) throw new Error('No DB URL');
    return neon(url);
}
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const JWT_SECRET = process.env.JWT_SECRET as string;
if (!JWT_SECRET) throw new Error("JWT_SECRET environment variable is missing");

const CORS = {
    'Access-Control-Allow-Origin': process.env.URL || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'OPTIONS, POST',
};

function ok(body: unknown) { return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
function fail(msg: string, status = 400) { return { statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: msg }) }; }

async function requestAiCompletion(systemPrompt: string, userPrompt: string, signal: AbortSignal): Promise<string | null> {
    if (OPENAI_API_KEY) {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            signal,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
                model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt },
                ],
                temperature: 0.2,
                max_tokens: 500,
            }),
        });
        if (!response.ok) throw new Error('AI provider request failed');
        const data = await response.json();
        return data.choices?.[0]?.message?.content || null;
    }

    if (GEMINI_API_KEY) {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_MODEL || 'gemini-2.0-flash'}:generateContent`, {
            method: 'POST',
            signal,
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': GEMINI_API_KEY,
            },
            body: JSON.stringify({
                systemInstruction: { parts: [{ text: systemPrompt }] },
                contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
                generationConfig: { temperature: 0.2, maxOutputTokens: 500 },
            }),
        });
        if (!response.ok) throw new Error('AI provider request failed');
        const data = await response.json();
        return data.candidates?.[0]?.content?.parts
            ?.map((part: { text?: string }) => part.text || '')
            .join('') || null;
    }

    return null;
}

export const handler: Handler = async (event: HandlerEvent) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

    // Authenticate user
    const authHeader = event.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return fail('Unauthorized', 401);
    const token = authHeader.split(' ')[1];

    let userId: string;
    let quotaReserved = false;
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        userId = decoded.id;
    } catch {
        return fail('Invalid token', 401);
    }

    if (event.httpMethod !== 'POST') return fail('Method not allowed', 405);

    try {
        const { systemPrompt, userPrompt } = JSON.parse(event.body || '{}');
        if (typeof systemPrompt !== 'string' || typeof userPrompt !== 'string' || !userPrompt.trim()) {
            return fail('A system prompt and user prompt are required');
        }
        if (systemPrompt.length > 12_000 || userPrompt.length > 12_000) {
            return fail('Prompt is too long', 413);
        }

        const sql = getDb();

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

        if (!OPENAI_API_KEY && !GEMINI_API_KEY) {
            return fail('AI advisor is not configured', 503);
        }

        // Reserve a query atomically, which prevents parallel requests from
        // bypassing the plan limit between a read and a later increment.
        const quotaReservation = await sql`
            UPDATE users
            SET ai_queries_month = COALESCE(ai_queries_month, 0) + 1
            WHERE id = ${userId} AND COALESCE(ai_queries_month, 0) < ${userLimit}
            RETURNING ai_queries_month
        `;
        if (!quotaReservation.length) {
            return fail(`You have reached your limit of ${userLimit} AI queries this month. Please upgrade your plan.`, 429);
        }
        quotaReserved = true;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8500);

        const content = await requestAiCompletion(systemPrompt, userPrompt, controller.signal)
            .finally(() => clearTimeout(timeoutId));

        return ok({ response: content || 'No response generated.' });

    } catch (err: any) {
        console.error('AI Route Error:', err?.message);
        if (quotaReserved) {
            try {
                const sql = getDb();
                await sql`UPDATE users SET ai_queries_month = GREATEST(COALESCE(ai_queries_month, 0) - 1, 0) WHERE id = ${userId}`;
            } catch (rollbackError: any) {
                console.error('AI quota rollback failed:', rollbackError?.message);
            }
        }
        if (err.name === 'AbortError') {
            return fail('The AI service took too long to respond. Your organization query might be too large.', 504);
        }
        return fail('AI service is temporarily unavailable', 502);
    }
};
