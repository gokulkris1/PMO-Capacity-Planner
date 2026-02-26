import type { Handler, HandlerEvent } from '@netlify/functions';
import Stripe from 'stripe';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_dummy');
const JWT_SECRET = process.env.JWT_SECRET as string;
if (!JWT_SECRET) throw new Error("JWT_SECRET environment variable is missing");

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'OPTIONS, POST',
    'Content-Type': 'application/json',
};

function fail(msg: string, status = 400) { return { statusCode: status, headers: CORS, body: JSON.stringify({ error: msg }) }; }

const getDb = () => neon(
    process.env.NETLIFY_DATABASE_URL_UNPOOLED ||
    process.env.NETLIFY_DATABASE_URL ||
    process.env.NEON_DATABASE_URL || ''
);

// Price mapping 
const PRICES: Record<string, string> = {
    'PRO': process.env.STRIPE_PRICE_PRO || 'price_dummy_pro',
    'MAX': process.env.STRIPE_PRICE_MAX || 'price_dummy_max',
};

export const handler: Handler = async (event: HandlerEvent) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
    if (event.httpMethod !== 'POST') return fail('Method Not Allowed', 405);

    // 1. Authenticate user
    const authHeader = event.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return fail('Unauthorized', 401);
    const token = authHeader.split(' ')[1];

    let userId: string;
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as { id: string };
        userId = decoded.id;
    } catch {
        return fail('Invalid token', 401);
    }

    try {
        const { plan, orgSlug } = JSON.parse(event.body || '{}');
        if (!plan || !PRICES[plan]) return fail('Invalid plan selected');
        if (!orgSlug) return fail('orgSlug required');

        // 2. Validate tenant access
        const sql = getDb();
        const rows = await sql`
            SELECT u.email, u.org_id 
            FROM users u
            JOIN organizations o ON u.org_id = o.id
            WHERE u.id = ${userId} AND o.slug = ${orgSlug}
        `;

        if (rows.length === 0) return fail('Unauthorized for this tenant', 403);
        const { email, org_id } = rows[0];

        // 3. Generate Stripe Checkout Session
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            billing_address_collection: 'auto',
            customer_email: email,
            line_items: [
                {
                    price: PRICES[plan],
                    quantity: 1,
                },
            ],
            mode: 'subscription',
            success_url: `${process.env.URL || 'http://localhost:5173'}/o/${orgSlug}?upgrade=success`,
            cancel_url: `${process.env.URL || 'http://localhost:5173'}/o/${orgSlug}?upgrade=cancelled`,
            metadata: {
                userId,
                orgId: org_id,
                plan
            }
        });

        return {
            statusCode: 200,
            headers: CORS,
            body: JSON.stringify({ url: session.url })
        };
    } catch (e: any) {
        console.error('Checkout error:', e);
        return fail('Failed to create checkout session: ' + e.message, 500);
    }
};
