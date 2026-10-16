/**
 * HTTP helpers: header access, client IP, CORS allow-list (SEC-25, AC-03#AC4) and cookies.
 * CORS never answers `*`; it reflects only origins in ALLOWED_ORIGINS, the site's own Netlify URLs, or the
 * request's own host (same-origin), always with `Vary: Origin`.
 */
import { optionalEnv } from './env';

export type Headers = Record<string, string | undefined>;

export function lowerHeaders(h: Record<string, string | undefined> | null | undefined): Headers {
  const out: Headers = {};
  for (const [k, v] of Object.entries(h ?? {})) out[k.toLowerCase()] = v;
  return out;
}

export function clientIp(headers: Headers): string | null {
  const direct = headers['x-nf-client-connection-ip'];
  if (direct) return direct.trim();
  const fwd = headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return headers['client-ip']?.trim() || null;
}

function normaliseOrigin(o: string): string | null {
  try {
    const u = new URL(o.trim());
    return `${u.protocol}//${u.host}`.toLowerCase();
  } catch {
    return null;
  }
}

export function allowedOrigins(): string[] {
  const list = optionalEnv('ALLOWED_ORIGINS')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const v of ['URL', 'DEPLOY_PRIME_URL', 'DEPLOY_URL']) {
    const val = optionalEnv(v);
    if (val) list.push(val);
  }
  return list.map(normaliseOrigin).filter((o): o is string => !!o);
}

/** True when the Origin header is absent (non-browser or same-origin GET), allowed, or same-origin. */
export function originAllowed(headers: Headers): boolean {
  const origin = headers['origin'];
  if (!origin || origin === 'null') return !origin;
  const o = normaliseOrigin(origin);
  if (!o) return false;
  const host = headers['x-forwarded-host'] || headers['host'];
  if (host) {
    const h = host.split(',')[0].trim().toLowerCase();
    if (o === `https://${h}` || o === `http://${h}`) return true;
  }
  return allowedOrigins().includes(o);
}

export function corsHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = { Vary: 'Origin' };
  const origin = headers['origin'];
  if (origin && originAllowed(headers)) {
    out['Access-Control-Allow-Origin'] = origin;
    out['Access-Control-Allow-Credentials'] = 'true';
    out['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, X-CSRF-Token, X-Request-Id';
    out['Access-Control-Allow-Methods'] = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
    out['Access-Control-Max-Age'] = '600';
  }
  return out;
}

export const SECURITY_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

// ── Cookies (AC-03) ────────────────────────────────────────────────────────

export const SESSION_COOKIE = 'pcp_session';
export const CSRF_COOKIE = 'pcp_csrf';
export const SESSION_MAX_AGE_SEC = 7 * 24 * 3600;

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

interface CookieOpts {
  httpOnly: boolean;
  path: string;
  maxAge: number;
}
function serialize(name: string, value: string, o: CookieOpts): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${o.path}`,
    `Max-Age=${o.maxAge}`,
    'Secure',
    'SameSite=Lax',
  ];
  if (o.httpOnly) parts.push('HttpOnly');
  return parts.join('; ');
}

export function sessionCookies(sessionJwt: string, csrfToken: string): string[] {
  return [
    serialize(SESSION_COOKIE, sessionJwt, { httpOnly: true, path: '/api', maxAge: SESSION_MAX_AGE_SEC }),
    serialize(CSRF_COOKIE, csrfToken, { httpOnly: false, path: '/', maxAge: SESSION_MAX_AGE_SEC }),
  ];
}

export function clearSessionCookies(): string[] {
  return [
    serialize(SESSION_COOKIE, '', { httpOnly: true, path: '/api', maxAge: 0 }),
    serialize(CSRF_COOKIE, '', { httpOnly: false, path: '/', maxAge: 0 }),
  ];
}
