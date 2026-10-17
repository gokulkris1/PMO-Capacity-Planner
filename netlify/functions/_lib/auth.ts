/**
 * Authentication (AC-02, AC-03, SEC-13). The session is an HS256 JWT signed with the unchanged JWT_SECRET,
 * carried in the `pcp_session` cookie or (legacy clients, tests) an `Authorization: Bearer` header.
 * Authorisation always comes from the database row, never from claims. A token whose `tv` differs from
 * `users.token_version` is rejected; a v1.1 token has no `tv` and counts as 0, so existing sessions stay valid.
 *
 * `requireUser` sits behind an `AuthAdapter` so Release 3.0 can add a Forge-context adapter.
 */
import { createHash, randomUUID } from 'node:crypto';
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
    // Case-insensitive: v1.0 (Express) stored emails as typed, v1.1 lower-cased them. An exact lower-case match wins.
    `SELECT ${USER_COLUMNS}, password_hash FROM users WHERE lower(email) = $1 ORDER BY (email = $1) DESC LIMIT 1`,
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
  /** Session id (2.0 sessions issued after QA-019); revoked on plain sign-out. */
  jti?: string;
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
    { algorithm: 'HS256', expiresIn: SESSION_MAX_AGE_SEC, jwtid: randomUUID() },
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
    if (claims.jti && (await isSessionRevoked(q, claims.jti))) throw unauthorized(SESSION_ENDED);
    // A v1.1 token has no jti: it is refused once it has been exchanged for a cookie session (QA-039), after a
    // grace period so other tabs booting with the same token in that moment still get through.
    if (!claims.jti && (await isSessionRevoked(q, legacyTokenJti(found.token)))) throw unauthorized(SESSION_ENDED);
    return actorFromUser(user, found.method);
  }
}

/** QA-019: a session signed out with plain "Sign out" is refused even if someone kept a copy of its cookie. */
export async function isSessionRevoked(q: Queryable, jti: string): Promise<boolean> {
  const rows = await q.query(`SELECT 1 AS x FROM revoked_sessions WHERE jti = $1 AND revoked_at <= now()`, [jti]);
  return rows.length > 0;
}

/** The revocation key of a v1.1 token (it carries no jti): a hash, so the token itself is never stored. */
export function legacyTokenJti(token: string): string {
  return `v11:${createHash('sha256').update(token).digest('hex')}`;
}

/** How long a v1.1 token keeps working after it was exchanged (other tabs, old bundles still loading). */
export const LEGACY_EXCHANGE_GRACE_SEC = 10 * 60;

/**
 * QA-039 (optional hardening): once a v1.1 bearer token has been exchanged for a cookie session it stops working
 * after LEGACY_EXCHANGE_GRACE_SEC, so a copy left in another browser profile or a log cannot be replayed for the
 * rest of its 7 days. Recorded until the token would have expired anyway; "Sign out of all devices" still bumps
 * users.token_version as before.
 */
export async function revokeLegacyToken(q: Queryable, token: string, claims: SessionClaims, userId: string) {
  if (claims.jti) return;
  const exp = claims.exp ?? Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
  await q.query(
    `INSERT INTO revoked_sessions (jti, user_id, revoked_at, expires_at)
     VALUES ($1, $2, now() + make_interval(secs => $3), $4) ON CONFLICT (jti) DO NOTHING`,
    [legacyTokenJti(token), userId, LEGACY_EXCHANGE_GRACE_SEC, new Date(exp * 1000).toISOString()],
  );
}

/** Records the session's jti until the token would have expired (and prunes rows that have). */
export async function revokeSession(q: Queryable, claims: SessionClaims, userId: string | null): Promise<void> {
  if (!claims.jti) return;
  const expires = new Date(((claims.exp ?? Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SEC) as number) * 1000);
  await q.query(`DELETE FROM revoked_sessions WHERE expires_at < now()`);
  await q.query(
    `INSERT INTO revoked_sessions (jti, user_id, expires_at) VALUES ($1, $2, $3) ON CONFLICT (jti) DO NOTHING`,
    [claims.jti, userId, expires.toISOString()],
  );
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
