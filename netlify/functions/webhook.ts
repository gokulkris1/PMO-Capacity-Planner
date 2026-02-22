import type { Handler, HandlerEvent } from '@netlify/functions';
import Stripe from 'stripe';
import { neon } from '@neondatabase/serverless';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2023-10-16' as any });
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
const sql = neon(process.env.NEON_DATABASE_URL || '');

export const handler: Handler = async (event: HandlerEvent) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    const sig = event.headers['stripe-signature'];
    if (!sig || !webhookSecret) {
        return { statusCode: 400, body: 'Missing signature or webhook secret' };
    }

    let stripeEvent: Stripe.Event;

    try {
        stripeEvent = stripe.webhooks.constructEvent(event.body || '', sig, webhookSecret);
    } catch (err: any) {
        console.error(`Webhook signature verification failed: ${err.message}`);
        return { statusCode: 400, body: `Webhook Error: ${err.message}` };
    }

    // Handle the checkout.session.completed event
    if (stripeEvent.type === 'checkout.session.completed') {
        const session = stripeEvent.data.object as Stripe.Checkout.Session;

        // Retrieve custom metadata injected during checkout creation
        const orgId = session.metadata?.orgId;
        const planTier = session.metadata?.planTier;

        if (orgId && planTier) {
            try {
                // Upgrade all users in this Organization to the new B2B Plan Tier
                await sql`
                    UPDATE users 
                    SET plan = ${planTier} 
                    WHERE org_id = ${orgId}
                `;
                console.log(`[Stripe Webhook] Successfully upgraded org ${orgId} to ${planTier}`);
            } catch (dbErr) {
                console.error(`[Stripe Webhook] Database error updating tier for org ${orgId}:`, dbErr);
                return { statusCode: 500, body: 'Database update failed' };
            }
        } else {
            console.warn('[Stripe Webhook] Missing orgId or planTier in session metadata');
        }
    }

    return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
