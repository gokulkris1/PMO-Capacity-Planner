/** Session issuing shared by login, invitation accept, session exchange and refresh (AC-03). */
import type { Ctx } from './api';
import type { UserRow } from './auth';
import { signSession, toSessionUser } from './auth';
import { randomToken } from './crypto';
import type { Queryable } from './db';
import { one } from './db';
import { CSRF_COOKIE, sessionCookies } from './http';

/** Sets `pcp_session` + `pcp_csrf` on the response and returns the signed token. Keeps an existing CSRF value. */
export function issueSession(ctx: Ctx, user: UserRow): string {
  const token = signSession(user);
  const csrf =
    ctx.cookies[CSRF_COOKIE] && ctx.cookies[CSRF_COOKIE].length >= 32 ? ctx.cookies[CSRF_COOKIE] : randomToken(32);
  ctx.setCookies.push(...sessionCookies(token, csrf));
  return token;
}

export interface LegacyUserShape {
  id: string;
  email: string;
  name: string;
  role: string;
  plan: string;
  orgId: string | null;
  orgSlug: string | null;
  isPlatformAdmin: boolean;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
}

/**
 * The v1.1 Login component stores `data.user` as-is; keep every v1.1 field (role, plan, orgId, orgSlug) and add
 * the 2.0 `SessionUser` fields.
 */
export async function sessionUserPayload(q: Queryable, u: UserRow): Promise<LegacyUserShape> {
  const org = await one<{ id: string; slug: string | null; plan: string | null }>(
    q,
    `SELECT o.id, o.slug, o.plan FROM organizations o
     WHERE o.id = coalesce((SELECT m.org_id FROM org_memberships m WHERE m.user_id = $1), $2::uuid)`,
    [u.id, u.org_id],
  );
  const base = toSessionUser(u);
  const plan = String(org?.plan ?? u.plan ?? 'BASIC').toUpperCase();
  return {
    ...base,
    role: u.role ?? 'USER',
    plan: plan === 'ENTERPRISE' ? 'MAX' : plan,
    orgId: org?.id ?? u.org_id ?? null,
    orgSlug: org?.slug ?? null,
  };
}
