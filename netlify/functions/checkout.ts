import type { Handler, HandlerEvent } from '@netlify/functions';
import Stripe from 'stripe';
import jwt from 'jsonwebtoken';
import { neon } from '@neondatabase/serverless';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2023-10-16' as any });
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_for_dev_only';
const sql = neon(process.env.NEON_DATABASE_URL || '');

const CORS = {
    'Access-Control-Allow-Origin': process.env.URL || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'OPTIONS, POST',
};

function ok(body: unknown) { return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
function fail(msg: string, status = 400) { return { statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: msg }) }; }

// Price lookups (In reality, replace these with real Price IDs from your Stripe Dashboard)
const PLAN_PRICES: Record<string, string> = {
    'BASIC': process.env.STRIPE_PRICE_BASIC || 'price_basic_mock',
    'PRO': process.env.STRIPE_PRICE_PRO || 'price_pro_mock',
    'MAX': process.env.STRIPE_PRICE_MAX || 'price_max_mock',
};

export const handler: Handler = async (event: HandlerEvent) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
    if (event.httpMethod !== 'POST') return fail('Method not allowed', 405);

    // Authenticate user
    const authHeader = event.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return fail('Unauthorized', 401);
    const token = authHeader.split(' ')[1];

    let userId: string;
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        userId = decoded.userId;
    } catch {
        return fail('Invalid token', 401);
    }

    try {
        const { planTier } = JSON.parse(event.body || '{}');
        const priceId = PLAN_PRICES[planTier];

        if (!priceId) {
            return fail('Invalid plan tier specified', 400);
        }

        if (!process.env.STRIPE_SECRET_KEY) {
            return fail('Stripe payments are not configured on this server.', 500);
        }

        // Fetch User and Org info
        const users = await sql`SELECT email, org_id FROM users WHERE id = ${userId} LIMIT 1`;
        if (users.length === 0) return fail('User not found', 400);

        const { email, org_id } = users[0];

        // Create Stripe Checkout Session
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            customer_email: email,
            line_items: [
                {
                    price: priceId,
                    quantity: 1,
                },
            ],
            mode: 'subscription',
            success_url: `${process.env.URL || 'http://localhost:3000'}?checkout=success`,
            cancel_url: `${process.env.URL || 'http://localhost:3000'}?checkout=cancelled`,
            metadata: {
                userId,
                orgId: org_id,
                planTier
            }
        });

        return ok({ url: session.url });
    } catch (e: any) {
        console.error('Stripe Checkout Error:', e);
        return fail('Failed to create checkout session: ' + e.message, 500);
    }
};
