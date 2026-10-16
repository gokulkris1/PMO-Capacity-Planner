-- 0005 demand lines, marketplace offers, craft change requests (DM-01, DM-03, DM-05, PPL-06).
-- demand_lines has no FK to projects on purpose: a rollback to v1.1 (delete-and-reinsert save) must not cascade
-- them away. The 2.0 code deletes a project's lines explicitly.

CREATE TABLE IF NOT EXISTS demand_lines (
  id TEXT PRIMARY KEY,
  org_id UUID NOT NULL,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  quarter_key TEXT NOT NULL CHECK (quarter_key ~ '^[0-9]{4}-Q[1-4]$'),
  craft_id TEXT NOT NULL,
  fte NUMERIC(6, 2) NOT NULL CHECK (fte >= 0 AND fte <= 50),
  status TEXT NOT NULL DEFAULT 'Forecast' CHECK (status IN ('Forecast', 'Confirmed')),
  owner_user_id UUID,
  note TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID,
  UNIQUE (project_id, quarter_key, craft_id)
);
CREATE INDEX IF NOT EXISTS idx_demand_lines_ws ON demand_lines(workspace_id);

-- DM-01#AC1: every craft_demand element becomes a row (duplicates in one project/quarter/craft are summed).
INSERT INTO demand_lines (id, org_id, workspace_id, project_id, quarter_key, craft_id, fte, status, note)
SELECT gen_random_uuid()::text, x.org_id, x.workspace_id, x.project_id, x.quarter_key, x.craft_id,
       LEAST(sum(x.fte), 50), min(x.status), max(x.note)
FROM (
  SELECT w.org_id, p.workspace_id, p.id AS project_id, d ->> 'quarterKey' AS quarter_key, d ->> 'craftId' AS craft_id,
         (d ->> 'fte')::numeric AS fte,
         CASE WHEN p.stage IN ('In Flight', 'Mobilising') THEN 'Confirmed' ELSE 'Forecast' END AS status,
         NULLIF(d ->> 'note', '') AS note
  FROM projects p
  JOIN workspaces w ON w.id = p.workspace_id
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(p.craft_demand) = 'array'
                                            THEN p.craft_demand ELSE '[]'::jsonb END) d
  WHERE (d ->> 'quarterKey') ~ '^[0-9]{4}-Q[1-4]$'
    AND coalesce(d ->> 'craftId', '') <> ''
    AND (d ->> 'fte') ~ '^[0-9]+(\.[0-9]+)?$'
    AND w.org_id IS NOT NULL
) x
GROUP BY x.org_id, x.workspace_id, x.project_id, x.quarter_key, x.craft_id
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS marketplace_offers (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL,
  quarter_key TEXT NOT NULL CHECK (quarter_key ~ '^[0-9]{4}-Q[1-4]$'),
  pct INTEGER NOT NULL CHECK (pct > 0 AND pct <= 200),
  craft_ids TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  note TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, person_id, quarter_key)
);

CREATE TABLE IF NOT EXISTS craft_change_requests (
  id TEXT PRIMARY KEY,
  org_id UUID NOT NULL,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL,
  current JSONB NOT NULL DEFAULT '[]'::jsonb,
  proposed JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  submitted_by UUID,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by UUID,
  decided_at TIMESTAMPTZ,
  reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_craft_requests_ws ON craft_change_requests(workspace_id, status);

-- DM-03#AC4: time to staff, stored when a proposal is accepted or confirmed.
ALTER TABLE allocations ADD COLUMN IF NOT EXISTS time_to_staff_days NUMERIC(8, 2);
