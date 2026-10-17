/**
 * POST /api/webhook — Stripe events (HS-06, SEC-09). Fails closed: 503 without STRIPE_WEBHOOK_SECRET /
 * STRIPE_SECRET_KEY, 400 on a bad signature (no DB change), idempotent per event id (stripe_events).
 * Handles checkout.session.completed, customer.subscription.updated/deleted and final invoice.payment_failed.
 */
import type Stripe from 'stripe';
import type { Ctx } from './_lib/api';
import { withApi } from './_lib/api';
import { audit } from './_lib/audit';
import { assertPublicBilling, planForPrice, setOrgPlan, stripeClient } from './_lib/billing';
import type { Queryable } from './_lib/db';
import { one, withTx } from './_lib/db';
import { optionalEnv } from './_lib/env';
import { badRequest, notFound, serviceUnavailable } from './_lib/errors';
import { receiptEmail, sendEmail } from './_lib/email';
import { log } from './_lib/log';
import type { Plan } from '../../shared/contracts/dto';

const WEBHOOK_AUDIT = { requestId: null, ip: null, userAgent: null, actorUserId: null, actorType: 'webhook' as const };

async function orgByStripe(
  q: Queryable,
  customer: unknown,
  subscription: unknown,
  metaOrg: unknown,
): Promise<string | null> {
  if (typeof metaOrg === 'string' && /^[0-9a-f-]{36}$/i.test(metaOrg)) {
    const r = await one<{ id: string }>(q, `SELECT id FROM organizations WHERE id = $1`, [metaOrg]);
    if (r) return r.id;
  }
  const r = await one<{ id: string }>(
    q,
    `SELECT id FROM organizations WHERE ($1::text IS NOT NULL AND stripe_subscription_id = $1) OR ($2::text IS NOT NULL AND stripe_customer_id = $2) LIMIT 1`,
    [typeof subscription === 'string' ? subscription : null, typeof customer === 'string' ? customer : null],
  );
  return r?.id ?? null;
}

async function apply(q: Queryable, event: Stripe.Event): Promise<{ orgId: string; plan: Plan } | null> {
  const obj = event.data.object as unknown as Record<string, unknown>;
  const meta = (obj.metadata ?? {}) as Record<string, unknown>;
  let orgId: string | null = null;
  let plan: Plan | null = null;
  let ids: { customerId?: string | null; subscriptionId?: string | null } = {};
  switch (event.type) {
    case 'checkout.session.completed': {
      orgId = await orgByStripe(q, obj.customer, obj.subscription, meta.orgId);
      plan = meta.plan === 'PRO' || meta.plan === 'MAX' ? meta.plan : null;
      ids = {
        customerId: typeof obj.customer === 'string' ? obj.customer : null,
        subscriptionId: typeof obj.subscription === 'string' ? obj.subscription : null,
      };
      break;
    }
    case 'customer.subscription.updated': {
      orgId = await orgByStripe(q, obj.customer, obj.id, meta.orgId);
      const status = String(obj.status ?? '');
      const items = (obj.items as { data?: Array<{ price?: { id?: string } }> })?.data ?? [];
      plan = ['canceled', 'unpaid', 'incomplete_expired'].includes(status)
        ? 'BASIC'
        : planForPrice(items[0]?.price?.id);
      ids = { subscriptionId: typeof obj.id === 'string' ? obj.id : null };
      break;
    }
    case 'customer.subscription.deleted': {
      orgId = await orgByStripe(q, obj.customer, obj.id, meta.orgId);
      plan = 'BASIC';
      break;
    }
    case 'invoice.payment_failed': {
      if (obj.next_payment_attempt !== null && obj.next_payment_attempt !== undefined) return null; // not final yet
      orgId = await orgByStripe(q, obj.customer, obj.subscription, null);
      plan = 'BASIC';
      break;
    }
    default:
      return null;
  }
  if (!orgId || !plan) {
    log('warn', { event: 'stripe.unmatched', type: event.type, id: event.id });
    return null;
  }
  const res = await setOrgPlan(q, orgId, plan, ids);
  await audit(q, WEBHOOK_AUDIT, {
    action: 'org.plan_change',
    orgId,
    targetType: 'org',
    targetId: orgId,
    before: { plan: res?.before ?? null },
    after: { plan, stripeEvent: event.id, type: event.type },
  });
  return { orgId, plan };
}

async function handle(ctx: Ctx) {
  assertPublicBilling();
  if (ctx.method !== 'POST') throw notFound('Not found');
  const secret = optionalEnv('STRIPE_WEBHOOK_SECRET');
  if (!secret)
    throw serviceUnavailable(
      'Billing is not available right now.',
      'Stripe not configured: STRIPE_WEBHOOK_SECRET missing',
    );
  const stripe = stripeClient();
  const sig = ctx.headers['stripe-signature'];
  if (!sig || !ctx.rawBody) throw badRequest('Missing signature or body');
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(ctx.rawBody, sig, secret);
  } catch {
    throw badRequest('Webhook signature verification failed');
  }
  const result = await withTx(async (q) => {
    const fresh = await q.query(
      `INSERT INTO stripe_events (id, type) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING RETURNING id`,
      [event.id, event.type],
    );
    if (!fresh.length) return { duplicate: true as const };
    return { duplicate: false as const, changed: await apply(q, event) };
  });
  if (!result.duplicate && result.changed && event.type === 'checkout.session.completed') {
    const admins = await ctx.db.query<{ email: string; name: string }>(
      `SELECT u.email, o.name FROM org_memberships m JOIN users u ON u.id = m.user_id JOIN organizations o ON o.id = m.org_id
       WHERE m.org_id = $1 AND m.role = 'ORG_ADMIN'`,
      [result.changed.orgId],
    );
    for (const a of admins) await sendEmail(receiptEmail(a.email, a.name, result.changed.plan));
  }
  return { received: true, duplicate: result.duplicate };
}

export const handler = withApi(
  { fn: 'webhook', auth: 'none', csrf: false, rawBody: true, requireJwtSecret: false },
  handle,
);
