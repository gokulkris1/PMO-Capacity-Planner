/**
 * Configuration access (PL-01#AC5-6, OPS-02). Every environment variable the functions read is listed in
 * `.env.example`; nothing falls back to a hard-coded secret.
 */
import { HttpError } from './errors';

/** Returns the value or throws a 503 (fail closed). Call inside a request, never at module load. */
export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new HttpError(503, 'server_error', 'Service is not configured. Contact your administrator.', {
      logMessage: `${name} missing`,
    });
  }
  return v;
}

export function optionalEnv(name: string, fallback = ''): string {
  const v = process.env[name];
  return v && v.trim() ? v : fallback;
}

export function envFlag(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v.trim() === '') return fallback;
  return /^(1|true|yes|on)$/i.test(v.trim());
}

/** PL-01#AC5: one resolution order for every function. */
export const DATABASE_URL_VARS = [
  'DATABASE_URL',
  'NETLIFY_DATABASE_URL_UNPOOLED',
  'NETLIFY_DATABASE_URL',
  'NEON_DATABASE_URL',
] as const;

export function databaseUrl(): string | null {
  for (const name of DATABASE_URL_VARS) {
    const v = process.env[name];
    if (v && v.trim()) return v.trim();
  }
  return null;
}

export type AppMode = 'public' | 'internal';
export function appMode(): AppMode {
  return optionalEnv('APP_MODE', 'public').toLowerCase() === 'internal' ? 'internal' : 'public';
}

/** Public self-registration (A-6): off by default in internal mode, on by default in public mode. */
export function publicSignupAllowed(): boolean {
  return envFlag('ALLOW_PUBLIC_SIGNUP', appMode() === 'public');
}

/**
 * Netlify sets CONTEXT to production | deploy-preview | branch-deploy | dev. When it is missing we assume
 * production (fail safe: dev-only behaviour must be opted into).
 */
export function deployContext(): string {
  return optionalEnv('CONTEXT', 'production');
}
export function isProduction(): boolean {
  return deployContext() === 'production';
}
/** `netlify dev` on a developer machine. */
export function isLocalDev(): boolean {
  return process.env.NETLIFY_DEV === 'true' || deployContext() === 'dev';
}

/** Base URL used in links inside emails (invitations, proposals). */
export function appBaseUrl(): string {
  return optionalEnv('APP_URL') || optionalEnv('URL') || 'http://localhost:8888';
}

/** Variables reported (as booleans only) by GET /api/health (PL-13#AC1). */
export const HEALTH_ENV_VARS = [
  'JWT_SECRET',
  'INTEGRATIONS_ENC_KEY',
  'ALLOWED_ORIGINS',
  'APP_MODE',
  'RESEND_API_KEY',
  'FROM_EMAIL',
  'OPENAI_API_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_PRICE_PRO',
  'STRIPE_PRICE_MAX',
] as const;

export function envPresence(): Record<string, boolean> {
  const out: Record<string, boolean> = { DATABASE_URL: databaseUrl() !== null };
  for (const name of HEALTH_ENV_VARS) out[name] = !!process.env[name]?.trim();
  return out;
}
