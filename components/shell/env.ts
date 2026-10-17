/**
 * Build-time UI configuration (Vite env). Only VITE_* variables reach the browser; none are secrets.
 *   VITE_APP_MODE          'public' | 'internal'   (default 'public'; corporate deployments set 'internal', CA-3)
 *   VITE_ALLOW_PUBLIC_SIGNUP 'true' to show "Create account" in internal mode (A-6)
 *   VITE_ENABLE_DEMO       'true' to allow /demo in internal mode (ST-10#AC3)
 *   VITE_EMBEDDED          'true' to start in embedded shell mode (SH-02#AC6)
 *   VITE_ROUTER            'hash' for static previews without SPA fallback (SH-01#AC7)
 *   VITE_APP_VERSION       injected by vite.config.ts from package.json (SH-10)
 */
const env: Record<string, string | undefined> =
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

export const APP_MODE: 'public' | 'internal' = env.VITE_APP_MODE === 'internal' ? 'internal' : 'public';
export const SIGNUP_ENABLED = APP_MODE === 'public' || env.VITE_ALLOW_PUBLIC_SIGNUP === 'true';
export const DEMO_ENABLED = APP_MODE === 'public' || env.VITE_ENABLE_DEMO === 'true';
export const EMBEDDED_BY_ENV = env.VITE_EMBEDDED === 'true';
export const HASH_ROUTER = env.VITE_ROUTER === 'hash';
export const APP_VERSION = env.VITE_APP_VERSION || '2.0.0';
/** Vite dev server / development build (the component kit route is registered only then). */
export const IS_DEV = (env as Record<string, unknown>).DEV === true;
