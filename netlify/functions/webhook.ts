import type { Handler, HandlerEvent } from '@netlify/functions';
import Stripe from 'stripe';
import { neon } from '@neondatabase/serverless';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_dummy');
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_dummy';

const getDb = () => neon(
    process.env.NETLIFY_DATABASE_URL_UNPOOLED ||
    process.env.NETLIFY_DATABASE_URL ||
    process.env.NEON_DATABASE_URL || ''
);

export const handler: Handler = async (event: HandlerEvent) => {
    // 1. Stripe Webhooks must be POST requests
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Make a POST request' };

    const sig = event.headers['stripe-signature'];
    if (!sig || !event.body) return { statusCode: 400, body: 'Missing signature or body' };

    let stripeEvent: Stripe.Event;

    try {
        // 2. Cryptographically verify the event originated from Stripe
        stripeEvent = stripe.webhooks.constructEvent(event.body, sig, endpointSecret);
    } catch (err: any) {
        console.error(`Webhook Error: ${err.message}`);
        return { statusCode: 400, body: `Webhook Error: ${err.message}` };
    }

    // 3. Handle specific event types
    if (stripeEvent.type === 'checkout.session.completed') {
        const session = stripeEvent.data.object as Stripe.Checkout.Session;

        // Retrieve custom metadata passed during Checkout creation
        const { orgId, plan } = session.metadata || {};

        if (orgId && plan) {
            try {
                const sql = getDb();
                console.log(`[SUBSCRIPTION UPGRADE] Upgrading org ${orgId} to plan ${plan}`);

                // 4. Upgrade every user attached to this Organization tenant to the new plan
                const affectedUsers = await sql`
                    UPDATE users 
                    SET plan = ${plan.toUpperCase()} 
                    WHERE org_id = ${orgId}
                    RETURNING email
                `;

                // 5. Fire Upgrade Emails for affected admins/users
                if (process.env.INTERNAL_API_SECRET) {
                    try {
                        const baseUrl = process.env.URL || 'http://localhost:5173';
                        for (const u of affectedUsers) {
                            if (!u.email) continue;
                            await fetch(`${baseUrl}/api/email_receipt`, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${process.env.INTERNAL_API_SECRET}`
                                },
                                body: JSON.stringify({
                                    type: 'UPGRADE',
                                    email: u.email,
                                    plan: plan.toUpperCase()
                                })
                            });
                        }
                    } catch (emailErr) {
                        console.error('Non-blocking Upgrade Email Error:', emailErr);
                    }
                }
            } catch (dbErr) {
                console.error('Failed to update Postgres upon Stripe success', dbErr);
                // Return 500 so Stripe automatically retries this webhook delivery
                return { statusCode: 500, body: 'Database Update Failure' };
            }
        }
    }

    // Acknowledge receipt of the event
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
