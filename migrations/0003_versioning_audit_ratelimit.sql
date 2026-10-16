-- 0003 optimistic concurrency, booking state, audit events, rate limits, hashed OTPs
-- (PL-04, AC-10, HS-05, DM-03 columns on allocations).

-- Versioned entities. Existing rows start at version 1.
ALTER TABLE resources ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE resources ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE resources ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE resources ADD COLUMN IF NOT EXISTS updated_by UUID;

ALTER TABLE projects ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE projects ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE projects ADD COLUMN IF NOT EXISTS updated_by UUID;

ALTER TABLE allocations ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE allocations ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE allocations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE allocations ADD COLUMN IF NOT EXISTS updated_by UUID;
ALTER TABLE allocations ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'confirmed';
ALTER TABLE allocations ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE allocations ADD COLUMN IF NOT EXISTS external_ref TEXT;
ALTER TABLE allocations ADD COLUMN IF NOT EXISTS demand_line_id TEXT;
ALTER TABLE allocations ADD COLUMN IF NOT EXISTS proposed_at TIMESTAMPTZ;
ALTER TABLE allocations ADD COLUMN IF NOT EXISTS proposed_by UUID;
ALTER TABLE allocations ADD COLUMN IF NOT EXISTS responded_at TIMESTAMPTZ;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'allocations_state_check') THEN
    ALTER TABLE allocations ADD CONSTRAINT allocations_state_check
      CHECK (state IN ('tentative', 'confirmed', 'declined'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_allocations_resource ON allocations(resource_id);
CREATE INDEX IF NOT EXISTS idx_allocations_project ON allocations(project_id);
CREATE INDEX IF NOT EXISTS idx_allocations_external_ref ON allocations(workspace_id, external_ref);

ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS data_version INTEGER NOT NULL DEFAULT 1;

-- Audit events (review §3.4). Append-only. ip is TEXT so a malformed forwarded header never fails a write.
CREATE TABLE IF NOT EXISTS audit_events (
  id BIGSERIAL PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  org_id UUID NULL,
  workspace_id UUID NULL,
  actor_user_id UUID NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'platform_admin', 'system', 'integration', 'webhook')),
  actor_ext_id TEXT NULL,
  action TEXT NOT NULL,
  target_type TEXT NULL,
  target_id TEXT NULL,
  before JSONB NULL,
  after JSONB NULL,
  ip TEXT NULL,
  user_agent TEXT NULL,
  request_id TEXT NULL,
  legacy_audit_log_id INTEGER NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_audit_events_org ON audit_events(org_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_ws ON audit_events(workspace_id, occurred_at DESC);

-- AC-10#AC5: copy legacy LOGIN rows (idempotent via legacy_audit_log_id). audit_logs is kept.
INSERT INTO audit_events (occurred_at, org_id, actor_user_id, actor_type, action, after, ip, legacy_audit_log_id)
SELECT COALESCE(a.created_at, now()), u.org_id, a.user_id, 'user', 'auth.login',
       CASE WHEN a.details IS NULL THEN NULL ELSE jsonb_build_object('legacy', a.details) END,
       NULLIF(a.ip_address, 'Unknown'), a.id
FROM audit_logs a
LEFT JOIN users u ON u.id = a.user_id
WHERE a.action = 'LOGIN'
ON CONFLICT DO NOTHING;

-- Fixed-window rate limits (HS-05).
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits(window_start);

-- Hashed OTPs (HS-05#AC1). The legacy plaintext column is written as '' from now on.
ALTER TABLE otps ADD COLUMN IF NOT EXISTS otp_hash TEXT;
ALTER TABLE otps ADD COLUMN IF NOT EXISTS context TEXT;
