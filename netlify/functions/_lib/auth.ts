/**
 * Authentication (AC-02, AC-03, SEC-13). The session is an HS256 JWT signed with the unchanged JWT_SECRET,
 * carried in the `pcp_session` cookie or (legacy clients, tests) an `Authorization: Bearer` header.
 * Authorisation always comes from the database row, never from claims. A token whose `tv` differs from
 * `users.token_version` is rejected; a v1.1 token has no `tv` and counts as 0, so existing sessions stay valid.
 *
 * `requireUser` sits behind an `AuthAdapter` so Release 3.0 can add a Forge-context adapter.
 */
import jwt from 'jsonwebtoken';
import type { Queryable } from './db';
import { one } from './db';
import { requireEnv } from './env';
import { unauthorized } from './errors';
import type { Headers } from './http';
import { SESSION_COOKIE, SESSION_MAX_AGE_SEC } from './http';
import type { SessionUser } from '../../../shared/contracts/dto';

export interface UserRow {
  id: string;
  email: string;
  name: string | null;
  role: string | null;
  plan: string | null;
  org_id: string | null;
  is_platform_admin: boolean;
  token_version: number;
  email_verified_at: unknown;
  two_factor_enabled: boolean | null;
  password_hash?: string;
}

export interface Actor {
  userId: string;
  email: string;
  name: string;
  isPlatformAdmin: boolean;
  tokenVersion: number;
  authMethod: 'cookie' | 'bearer';
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  /** v1.1 users.role, only for dual-read fallbacks. */
  legacyRole: string | null;
  legacyOrgId: string | null;
}

export const USER_COLUMNS =
  'id, email, name, role, plan, org_id, is_platform_admin, token_version, email_verified_at, two_factor_enabled';

export async function loadUser(q: Queryable, id: string): Promise<UserRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return one<UserRow & Record<string, unknown>>(q, `SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]);
}

export async function loadUserByEmail(
  q: Queryable,
  email: string,
): Promise<(UserRow & { password_hash: string }) | null> {
  return one<UserRow & { password_hash: string } & Record<string, unknown>>(
    q,
    `SELECT ${USER_COLUMNS}, password_hash FROM users WHERE email = $1`,
    [normaliseEmail(email)],
  );
}

export function normaliseEmail(email: string): string {
  return String(email ?? '')
    .trim()
    .toLowerCase();
}

export function toSessionUser(u: UserRow): SessionUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name || u.email.split('@')[0],
    isPlatformAdmin: !!u.is_platform_admin,
    emailVerified: !!u.email_verified_at,
    twoFactorEnabled: !!u.two_factor_enabled,
  };
}

// ── Tokens ──────────────────────────────────────────────────────────────────

export interface SessionClaims {
  sub?: string;
  id?: string;
  tv?: number;
  iat?: number;
  exp?: number;
}

function secrets(): string[] {
  const list = [requireEnv('JWT_SECRET')];
  const next = process.env.JWT_SECRET_NEXT;
  if (next && next.trim()) list.push(next);
  return list;
}

/**
 * Signs the 7-day session. Besides `{ sub, tv }` it carries the v1.1 claims (`id`, `email`, `role`, `org_id`)
 * so a rollback to v1.1 code keeps working with sessions issued by 2.0. They are never trusted by 2.0.
 */
export function signSession(u: UserRow): string {
  return jwt.sign(
    { sub: u.id, id: u.id, tv: Number(u.token_version ?? 0), email: u.email, role: u.role, org_id: u.org_id },
    requireEnv('JWT_SECRET'),
    { algorithm: 'HS256', expiresIn: SESSION_MAX_AGE_SEC },
  );
}

/** HS256 only (rejects `alg: none` and RS/ES tokens); accepts JWT_SECRET_NEXT for graceful rotation. */
export function verifyToken(token: string): SessionClaims | null {
  for (const secret of secrets()) {
    try {
      const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
      if (typeof payload === 'object' && payload) return payload as SessionClaims;
    } catch {
      // try the next secret
    }
  }
  return null;
}

// ── Adapter ─────────────────────────────────────────────────────────────────

export interface AuthInput {
  headers: Headers;
  cookies: Record<string, string>;
}

export interface AuthAdapter {
  authenticate(input: AuthInput, q: Queryable): Promise<Actor | null>;
}

export function tokenFrom(input: AuthInput): { token: string; method: 'cookie' | 'bearer' } | null {
  const h = input.headers['authorization'];
  if (h && /^Bearer\s+/i.test(h)) return { token: h.replace(/^Bearer\s+/i, '').trim(), method: 'bearer' };
  const c = input.cookies[SESSION_COOKIE];
  if (c) return { token: c, method: 'cookie' };
  return null;
}

export const SESSION_ENDED = 'Your session has ended. Sign in again.';

export class SessionJwtAuth implements AuthAdapter {
  async authenticate(input: AuthInput, q: Queryable): Promise<Actor | null> {
    const found = tokenFrom(input);
    if (!found) return null;
    const claims = verifyToken(found.token);
    if (!claims) throw unauthorized(SESSION_ENDED);
    const userId = claims.sub || claims.id;
    if (!userId) throw unauthorized(SESSION_ENDED);
    const user = await loadUser(q, String(userId));
    if (!user) throw unauthorized(SESSION_ENDED);
    const tv = typeof claims.tv === 'number' ? claims.tv : 0;
    if (tv !== Number(user.token_version ?? 0)) throw unauthorized(SESSION_ENDED);
    return actorFromUser(user, found.method);
  }
}

export function actorFromUser(user: UserRow, method: 'cookie' | 'bearer'): Actor {
  return {
    userId: user.id,
    email: user.email,
    name: user.name || user.email.split('@')[0],
    isPlatformAdmin: !!user.is_platform_admin,
    tokenVersion: Number(user.token_version ?? 0),
    authMethod: method,
    emailVerified: !!user.email_verified_at,
    twoFactorEnabled: !!user.two_factor_enabled,
    legacyRole: user.role,
    legacyOrgId: user.org_id,
  };
}

let adapter: AuthAdapter = new SessionJwtAuth();
export function setAuthAdapter(a: AuthAdapter): void {
  adapter = a;
}
export function authenticate(input: AuthInput, q: Queryable): Promise<Actor | null> {
  return adapter.authenticate(input, q);
}
