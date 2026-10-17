/** Stripe helpers (HS-06): fail closed, no dummy keys; plan lives on organizations.plan. */
import Stripe from 'stripe';
import type { Plan } from '../../../shared/contracts/dto';
import type { Queryable } from './db';
import { appMode, optionalEnv } from './env';
import { notFound, serviceUnavailable } from './errors';
import { bestEffort } from './entity';

export function assertPublicBilling(): void {
  if (appMode() === 'internal') throw notFound('Not found');
}

export function stripeClient(): Stripe {
  const key = optionalEnv('STRIPE_SECRET_KEY');
  if (!key)
    throw serviceUnavailable('Billing is not available right now.', 'Stripe not configured: STRIPE_SECRET_KEY missing');
  return new Stripe(key, { timeout: 7000, maxNetworkRetries: 0 });
}

export function priceFor(plan: 'PRO' | 'MAX'): string {
  const price = optionalEnv(plan === 'PRO' ? 'STRIPE_PRICE_PRO' : 'STRIPE_PRICE_MAX');
  if (!price)
    throw serviceUnavailable(
      'Billing is not available right now.',
      `Stripe not configured: STRIPE_PRICE_${plan} missing`,
    );
  return price;
}

export function planForPrice(priceId: string | null | undefined): Plan | null {
  if (!priceId) return null;
  if (priceId === optionalEnv('STRIPE_PRICE_PRO')) return 'PRO';
  if (priceId === optionalEnv('STRIPE_PRICE_MAX')) return 'MAX';
  return null;
}

/** Sets the org plan, keeping v1.1's users.plan in sync for the org's admins only (rollback safety, HS-06#AC4). */
export async function setOrgPlan(
  q: Queryable,
  orgId: string,
  plan: Plan,
  ids: { customerId?: string | null; subscriptionId?: string | null } = {},
): Promise<{ before: string | null } | null> {
  const rows = await q.query<{ before: string | null }>(
    `UPDATE organizations o SET plan = $2, stripe_customer_id = coalesce($3, o.stripe_customer_id),
       stripe_subscription_id = coalesce($4, o.stripe_subscription_id), version = o.version + 1, updated_at = now()
     FROM (SELECT plan AS before FROM organizations WHERE id = $1) b WHERE o.id = $1 RETURNING b.before`,
    [orgId, plan, ids.customerId ?? null, ids.subscriptionId ?? null],
  );
  if (!rows.length) return null;
  await bestEffort(
    q,
    `UPDATE users SET plan = $2 WHERE id IN (SELECT user_id FROM org_memberships WHERE org_id = $1 AND role = 'ORG_ADMIN')`,
    [orgId, plan === 'ENTERPRISE' ? 'MAX' : plan],
  );
  return rows[0];
}
