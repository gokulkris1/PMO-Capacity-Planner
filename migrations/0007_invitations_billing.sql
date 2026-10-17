-- 0007 invitations, Stripe lifecycle, per-org AI quota (AC-05, HS-06, HS-11).

CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  org_role TEXT NOT NULL CHECK (org_role IN ('ORG_ADMIN', 'MEMBER')),
  workspaces JSONB NOT NULL DEFAULT '[]'::jsonb,
  token_hash TEXT NOT NULL UNIQUE,
  invited_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_invitations_org ON invitations(org_id, created_at DESC);

CREATE TABLE IF NOT EXISTS stripe_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS ai_queries_month INTEGER NOT NULL DEFAULT 0;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS ai_quota_reset_at TIMESTAMPTZ NOT NULL DEFAULT date_trunc('month', now());
