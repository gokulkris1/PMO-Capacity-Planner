-- 0008 revoked sessions (AC-03#AC6 hardening, QA-019): plain sign-out revokes that one session on the server.
-- Each session JWT carries a `jti`; signing out records it here until the token would have expired anyway, and
-- authentication refuses a recorded jti. "Sign out of all devices" still bumps users.token_version.
-- Additive and idempotent.
CREATE TABLE IF NOT EXISTS revoked_sessions (
  jti TEXT PRIMARY KEY,
  user_id TEXT,
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_revoked_sessions_expires ON revoked_sessions(expires_at);
