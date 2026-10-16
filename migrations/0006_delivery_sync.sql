-- 0006 Jira sync v2 and Planview v2 (JI-01..04, PV-01, PV-03).

CREATE TABLE IF NOT EXISTS sync_jobs (
  id TEXT PRIMARY KEY,
  org_id UUID NOT NULL,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('jira', 'planview')),
  trigger TEXT NOT NULL CHECK (trigger IN ('schedule', 'manual')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'partial')),
  cursor JSONB NOT NULL DEFAULT '{}'::jsonb,
  pages_done INTEGER NOT NULL DEFAULT 0,
  issues_seen INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  rate_limited_until TIMESTAMPTZ,
  locked_until TIMESTAMPTZ,
  snapshot_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  requested_by UUID
);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_ws ON sync_jobs(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_status ON sync_jobs(status);

CREATE TABLE IF NOT EXISTS delivery_snapshots (
  id BIGSERIAL PRIMARY KEY,
  org_id UUID NOT NULL,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  jira_project_key TEXT NOT NULL,
  project_id TEXT,
  tribe_id TEXT,
  sprint_id TEXT,
  sprint_name TEXT,
  sprint_state TEXT,
  sprint_start DATE,
  sprint_end DATE,
  quarter_key TEXT,
  assignee_account_id TEXT,
  person_id TEXT,
  points_total NUMERIC(10, 2) NOT NULL DEFAULT 0,
  points_done NUMERIC(10, 2) NOT NULL DEFAULT 0,
  issues_total INTEGER NOT NULL DEFAULT 0,
  issues_done INTEGER NOT NULL DEFAULT 0,
  implied_fte NUMERIC(10, 3)
);
CREATE UNIQUE INDEX IF NOT EXISTS delivery_snapshots_uq ON delivery_snapshots
  (workspace_id, snapshot_date, jira_project_key, coalesce(sprint_id, ''), coalesce(assignee_account_id, ''));
CREATE INDEX IF NOT EXISTS idx_delivery_snapshots_ws_date ON delivery_snapshots(workspace_id, snapshot_date);

CREATE TABLE IF NOT EXISTS integration_mappings (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('jira', 'planview')),
  external_key TEXT NOT NULL,
  external_name TEXT,
  board_ids INTEGER[] NOT NULL DEFAULT '{}'::INTEGER[],
  project_id TEXT,
  tribe_id TEXT,
  match_method TEXT NOT NULL DEFAULT 'none' CHECK (match_method IN ('key', 'name', 'manual', 'none')),
  confirmed BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID,
  PRIMARY KEY (workspace_id, provider, external_key)
);

CREATE TABLE IF NOT EXISTS external_identities (
  id TEXT PRIMARY KEY,
  org_id UUID NOT NULL,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  person_id TEXT,
  provider TEXT NOT NULL CHECK (provider IN ('jira', 'planview')),
  external_id TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  email TEXT,
  match_method TEXT NOT NULL DEFAULT 'none' CHECK (match_method IN ('accountId', 'email', 'name', 'manual', 'none')),
  confirmed BOOLEAN NOT NULL DEFAULT false,
  last_seen_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, provider, external_id)
);

CREATE TABLE IF NOT EXISTS tribe_calibrations (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  tribe_id TEXT NOT NULL,
  points_per_sprint_per_fte NUMERIC(8, 2) NOT NULL CHECK (points_per_sprint_per_fte > 0),
  sprint_length_days INTEGER NOT NULL CHECK (sprint_length_days > 0),
  suggested_value NUMERIC(8, 2),
  suggested_basis JSONB,
  note TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, tribe_id)
);

CREATE TABLE IF NOT EXISTS planview_previews (
  id TEXT PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- JI-02#AC4 / PV-03#AC2: v1.1 settings.mappings JSON becomes confirmed mapping rows (JSON left in place).
INSERT INTO integration_mappings (workspace_id, provider, external_key, project_id, tribe_id, match_method, confirmed)
SELECT wi.workspace_id, m.provider, m.key, m.value, p.tribe_id, 'manual', true
FROM workspace_integrations wi
CROSS JOIN LATERAL (
  SELECT 'jira' AS provider, j.key, j.value
  FROM jsonb_each_text(CASE WHEN jsonb_typeof(wi.config -> 'mappings' -> 'jira') = 'object'
                         THEN wi.config -> 'mappings' -> 'jira' ELSE '{}'::jsonb END) j
  UNION ALL
  SELECT 'planview', pv.key, pv.value
  FROM jsonb_each_text(CASE WHEN jsonb_typeof(wi.config -> 'mappings' -> 'planview') = 'object'
                         THEN wi.config -> 'mappings' -> 'planview' ELSE '{}'::jsonb END) pv
) m
LEFT JOIN projects p ON p.id = m.value AND p.workspace_id = wi.workspace_id
WHERE wi.provider = 'settings' AND coalesce(m.key, '') <> '' AND coalesce(m.value, '') <> ''
ON CONFLICT DO NOTHING;

-- ORG-01#AC7 / JI-04: calibration by tribe name becomes rows keyed by tribe id (JSON left in place).
INSERT INTO tribe_calibrations (workspace_id, tribe_id, points_per_sprint_per_fte, sprint_length_days, note)
SELECT wi.workspace_id, t.id, (c.value ->> 'pointsPerSprintPerFte')::numeric, (c.value ->> 'sprintLengthDays')::numeric::int,
       'Migrated from v1.1 settings'
FROM workspace_integrations wi
JOIN workspaces w ON w.id = wi.workspace_id
CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(wi.config -> 'calibration') = 'object'
                                 THEN wi.config -> 'calibration' ELSE '{}'::jsonb END) c
JOIN tribes t ON t.org_id = w.org_id AND lower(t.name) = lower(btrim(c.key))
WHERE wi.provider = 'settings' AND c.key <> '*'
  AND (c.value ->> 'pointsPerSprintPerFte') ~ '^[0-9]+(\.[0-9]+)?$'
  AND (c.value ->> 'sprintLengthDays') ~ '^[0-9]+(\.[0-9]+)?$'
  AND (c.value ->> 'pointsPerSprintPerFte')::numeric > 0
  AND (c.value ->> 'sprintLengthDays')::numeric >= 1
ON CONFLICT DO NOTHING;
