import type { Handler, HandlerEvent } from '@netlify/functions';
import jwt from 'jsonwebtoken';

const OPENAI_API_KEY = process.env.VITE_OPENAI_API_KEY || process.env.OPENAI_API_KEY || '';
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_for_dev_only';

const CORS = {
    // Lock down CORS in production. Assuming same domain for Netlify.
    'Access-Control-Allow-Origin': process.env.URL || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'OPTIONS, POST',
    'Content-Type': 'application/json',
};

function ok(body: unknown) { return { statusCode: 200, headers: CORS, body: JSON.stringify(body) }; }
function fail(msg: string, status = 400) { return { statusCode: status, headers: CORS, body: JSON.stringify({ error: msg }) }; }

export const handler: Handler = async (event: HandlerEvent) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

    // Authenticate user
    const authHeader = event.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return fail('Unauthorized', 401);
    const token = authHeader.split(' ')[1];

    try {
        jwt.verify(token, JWT_SECRET);
    } catch {
        return fail('Invalid token', 401);
    }

    if (event.httpMethod !== 'POST') return fail('Method not allowed', 405);

    try {
        const { systemPrompt, userPrompt } = JSON.parse(event.body || '{}');

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
        return ok({ response: data.choices?.[0]?.message?.content || "No response generated." });

    } catch (err: any) {
        console.error('AI Route Error:', err);
        return fail('Internal server error', 500);
    }
};
