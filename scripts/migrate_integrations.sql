-- =============================================================================
-- Migration: Workspace Integrations (Jira / Planview connectors + calibration)
-- Run this ONCE against your Neon DB
-- Safe to re-run (uses IF NOT EXISTS)
--
-- The integrations function (netlify/functions/integrations.ts) also runs this
-- lazily on cold start, so this script is only needed to pre-create the table.
-- Secrets are stored AES-256-GCM encrypted in secret_enc as "iv:tag:ciphertext".
-- =============================================================================

CREATE TABLE IF NOT EXISTS workspace_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('jira','planview','settings')),
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  secret_enc TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_workspace_integrations_workspace_id
  ON workspace_integrations(workspace_id);
