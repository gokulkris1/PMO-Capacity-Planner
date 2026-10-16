/**
 * POST /api/checkout (HS-06, ST-06): Stripe Checkout for the caller's organisation. Public mode only (404 in
 * internal mode), Org Admins only (org.billing), 503 when Stripe is not configured; no dummy keys.
 */
import { z } from 'zod';
import { auditCtx, parseWith, requireActor, withApi } from './_lib/api';
import { audit } from './_lib/audit';
import { requireOrg } from './_lib/authz';
import { assertPublicBilling, priceFor, stripeClient } from './_lib/billing';
import { one } from './_lib/db';
import { appBaseUrl } from './_lib/env';
import { forbidden, notFound, upstreamError } from './_lib/errors';
import { errorFields, log } from './_lib/log';

export const handler = withApi({ fn: 'checkout' }, async (ctx) => {
  assertPublicBilling();
  if (ctx.method !== 'POST') throw notFound('Not found');
  const body = parseWith(z.object({ plan: z.enum(['PRO', 'MAX']), orgSlug: z.string().optional() }), ctx.body, 'Invalid plan selected');
  const actor = requireActor(ctx);
  const membership = await one<{ org_id: string; slug: string }>(
    ctx.db,
    `SELECT m.org_id, o.slug FROM org_memberships m JOIN organizations o ON o.id = m.org_id WHERE m.user_id = $1`,
    [actor.userId],
  );
  if (!membership) throw forbidden('Unauthorized for this tenant');
  if (body.orgSlug && body.orgSlug !== membership.slug) throw forbidden('Unauthorized for this tenant');
  const access = await requireOrg(ctx, membership.org_id, 'org.billing');
  const price = priceFor(body.plan);
  const stripe = stripeClient();
  const base = appBaseUrl();
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      billing_address_collection: 'auto',
      customer: access.org.stripe_customer_id ? String(access.org.stripe_customer_id) : undefined,
      customer_email: access.org.stripe_customer_id ? undefined : actor.email,
      client_reference_id: membership.org_id,
      line_items: [{ price, quantity: 1 }],
      success_url: `${base}/o/${membership.slug}/settings/billing?upgrade=success`,
      cancel_url: `${base}/o/${membership.slug}/settings/billing?upgrade=cancelled`,
      metadata: { orgId: membership.org_id, plan: body.plan, userId: actor.userId },
      subscription_data: { metadata: { orgId: membership.org_id, plan: body.plan } },
    });
    await audit(ctx.db, auditCtx(ctx), { action: 'billing.checkout_started', orgId: membership.org_id, targetType: 'org', targetId: membership.org_id, after: { plan: body.plan } });
    return { url: session.url };
  } catch (e) {
    log('error', { event: 'stripe.checkout_failed', requestId: ctx.requestId, err: errorFields(e) });
    throw upstreamError('Billing is not available right now. Try again later.');
  }
});
