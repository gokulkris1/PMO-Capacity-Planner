-- 0001 baseline (PL-02#AC5): every table and column the v1.1 code relied on, created only if missing.
-- On the production database this is a no-op apart from columns that were applied lazily at cold start
-- (workspace.ts, integrations.ts) or by hand (scripts/migrate_*.sql), which are now guaranteed.
-- Additive and idempotent: CREATE ... IF NOT EXISTS, ADD COLUMN IF NOT EXISTS, no DROP of tables or columns.

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  logo_url TEXT,
  primary_color VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS slug TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS primary_color VARCHAR(50);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- Fresh databases get the same CHECK constraints production has (v2 RBAC), so tests catch bad dual-writes.
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'USER'
    CONSTRAINT users_role_check CHECK (role IN ('SUPERUSER', 'ORG_ADMIN', 'PMO_ADMIN', 'WORKSPACE_OWNER', 'USER')),
  plan TEXT DEFAULT 'BASIC' CONSTRAINT users_plan_check CHECK (plan IN ('BASIC', 'PRO', 'MAX')),
  org_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  two_factor_enabled BOOLEAN DEFAULT false,
  ai_queries_month INTEGER DEFAULT 0,
  last_reset_date TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'BASIC';
ALTER TABLE users ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_queries_month INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_reset_date TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_workspaces_org ON workspaces(org_id);

CREATE TABLE IF NOT EXISTS workspace_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'USER' CHECK (role IN ('PMO_ADMIN', 'WORKSPACE_OWNER', 'USER')),
  invited_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, workspace_id)
);
CREATE INDEX IF NOT EXISTS idx_wm_user ON workspace_members(user_id);
CREATE INDEX IF NOT EXISTS idx_wm_workspace ON workspace_members(workspace_id);
CREATE INDEX IF NOT EXISTS idx_wm_org ON workspace_members(org_id);

CREATE TABLE IF NOT EXISTS resources (
  id TEXT PRIMARY KEY,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT,
  type TEXT NOT NULL DEFAULT 'Permanent',
  department TEXT,
  team_id TEXT,
  total_capacity INTEGER DEFAULT 100,
  avatar_initials TEXT,
  email TEXT,
  location TEXT,
  daily_rate_eur NUMERIC,
  skills TEXT[] DEFAULT '{}'::TEXT[],
  craft_profile JSONB DEFAULT '{}'::jsonb
);
ALTER TABLE resources ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE resources ADD COLUMN IF NOT EXISTS role TEXT;
ALTER TABLE resources ADD COLUMN IF NOT EXISTS department TEXT;
ALTER TABLE resources ADD COLUMN IF NOT EXISTS team_id TEXT;
ALTER TABLE resources ADD COLUMN IF NOT EXISTS total_capacity INTEGER DEFAULT 100;
ALTER TABLE resources ADD COLUMN IF NOT EXISTS avatar_initials TEXT;
ALTER TABLE resources ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE resources ADD COLUMN IF NOT EXISTS location TEXT;
ALTER TABLE resources ADD COLUMN IF NOT EXISTS daily_rate_eur NUMERIC;
ALTER TABLE resources ADD COLUMN IF NOT EXISTS skills TEXT[] DEFAULT '{}'::TEXT[];
ALTER TABLE resources ADD COLUMN IF NOT EXISTS craft_profile JSONB DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_resources_workspace ON resources(workspace_id);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Active',
  priority TEXT DEFAULT 'Medium',
  description TEXT,
  start_date DATE,
  end_date DATE,
  client_name TEXT,
  budget NUMERIC,
  color TEXT,
  stage TEXT,
  initiated_on DATE,
  craft_demand JSONB DEFAULT '[]'::jsonb,
  jira_key TEXT,
  planview_id TEXT
);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'Medium';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS start_date DATE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS end_date DATE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS client_name TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS budget NUMERIC;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS color TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS stage TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS initiated_on DATE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS craft_demand JSONB DEFAULT '[]'::jsonb;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS jira_key TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS planview_id TEXT;
CREATE INDEX IF NOT EXISTS idx_projects_workspace ON projects(workspace_id);
CREATE INDEX IF NOT EXISTS idx_projects_jira_key ON projects(jira_key);

CREATE TABLE IF NOT EXISTS allocations (
  id TEXT PRIMARY KEY,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  resource_id TEXT REFERENCES resources(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  percentage INTEGER,
  start_date DATE,
  end_date DATE,
  craft_id TEXT,
  source TEXT
);
ALTER TABLE allocations ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE allocations ADD COLUMN IF NOT EXISTS percentage INTEGER;
ALTER TABLE allocations ADD COLUMN IF NOT EXISTS start_date DATE;
ALTER TABLE allocations ADD COLUMN IF NOT EXISTS end_date DATE;
ALTER TABLE allocations ADD COLUMN IF NOT EXISTS craft_id TEXT;
ALTER TABLE allocations ADD COLUMN IF NOT EXISTS source TEXT;
CREATE INDEX IF NOT EXISTS idx_allocations_workspace ON allocations(workspace_id);
CREATE INDEX IF NOT EXISTS idx_allocations_craft ON allocations(craft_id);

-- Legacy columns that some databases created NOT NULL without a default (server/migrations.sql). Give them a
-- default so 2.0 inserts, which do not know them, succeed. Additive: no data changes.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = current_schema() AND table_name = 'resources' AND column_name = 'capacity'
               AND column_default IS NULL) THEN
    EXECUTE 'ALTER TABLE resources ALTER COLUMN capacity SET DEFAULT 100';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS otps (
  email TEXT PRIMARY KEY,
  otp TEXT,
  expires_at BIGINT,
  attempts INTEGER DEFAULT 0
);
ALTER TABLE otps ADD COLUMN IF NOT EXISTS attempts INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  details JSONB,
  ip_address TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);

CREATE TABLE IF NOT EXISTS workspace_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('jira', 'planview', 'settings')),
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  secret_enc TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, provider)
);
CREATE INDEX IF NOT EXISTS idx_workspace_integrations_workspace_id ON workspace_integrations(workspace_id);

-- QBR sprint-planning module (scripts/migrate_qbr.sql)
CREATE TABLE IF NOT EXISTS qbr_tribes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  lead_name TEXT,
  color TEXT DEFAULT '#6366f1',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS qbr_chapters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  lead_name TEXT,
  color TEXT DEFAULT '#ec4899',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS qbr_coe_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  lead_name TEXT,
  color TEXT DEFAULT '#f59e0b',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS qbr_quarters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  is_active BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS qbr_sprints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quarter_id UUID REFERENCES qbr_quarters(id) ON DELETE CASCADE,
  sprint_number INTEGER NOT NULL CHECK (sprint_number >= 1 AND sprint_number <= 6),
  label TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  UNIQUE (quarter_id, sprint_number)
);
CREATE TABLE IF NOT EXISTS qbr_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  role_title TEXT,
  tribe_id UUID REFERENCES qbr_tribes(id) ON DELETE SET NULL,
  chapter_id UUID REFERENCES qbr_chapters(id) ON DELETE SET NULL,
  coe_id UUID REFERENCES qbr_coe_groups(id) ON DELETE SET NULL,
  member_type TEXT NOT NULL DEFAULT 'INTERNAL' CHECK (member_type IN ('INTERNAL', 'VENDOR', 'CONTRACTOR')),
  daily_rate NUMERIC,
  skills TEXT[],
  avatar_color TEXT DEFAULT '#6366f1',
  total_capacity INTEGER DEFAULT 100,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS qbr_okrs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  level TEXT NOT NULL CHECK (level IN ('LEADERSHIP', 'TRIBE', 'COE')),
  parent_okr_id UUID REFERENCES qbr_okrs(id) ON DELETE SET NULL,
  tribe_id UUID REFERENCES qbr_tribes(id) ON DELETE SET NULL,
  quarter_id UUID REFERENCES qbr_quarters(id) ON DELETE SET NULL,
  progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS qbr_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  tribe_id UUID REFERENCES qbr_tribes(id) ON DELETE SET NULL,
  okr_id UUID REFERENCES qbr_okrs(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'PLANNING' CHECK (status IN ('PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED')),
  priority TEXT DEFAULT 'MEDIUM' CHECK (priority IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
  start_quarter_id UUID REFERENCES qbr_quarters(id) ON DELETE SET NULL,
  end_quarter_id UUID REFERENCES qbr_quarters(id) ON DELETE SET NULL,
  color TEXT DEFAULT '#3b82f6',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS qbr_squads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  tribe_id UUID REFERENCES qbr_tribes(id) ON DELETE SET NULL,
  project_id UUID REFERENCES qbr_projects(id) ON DELETE SET NULL,
  okr_id UUID REFERENCES qbr_okrs(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS qbr_squad_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  squad_id UUID REFERENCES qbr_squads(id) ON DELETE CASCADE,
  member_id UUID REFERENCES qbr_members(id) ON DELETE CASCADE,
  squad_role TEXT DEFAULT 'MEMBER' CHECK (squad_role IN ('LEAD', 'MEMBER', 'ADVISOR')),
  UNIQUE (squad_id, member_id)
);
CREATE TABLE IF NOT EXISTS qbr_scenarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  quarter_id UUID REFERENCES qbr_quarters(id) ON DELETE CASCADE,
  is_committed BOOLEAN DEFAULT false,
  created_by TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS qbr_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  member_id UUID REFERENCES qbr_members(id) ON DELETE CASCADE,
  project_id UUID REFERENCES qbr_projects(id) ON DELETE CASCADE,
  sprint_id UUID REFERENCES qbr_sprints(id) ON DELETE CASCADE,
  percentage INTEGER NOT NULL CHECK (percentage >= 0 AND percentage <= 100),
  scenario_id UUID REFERENCES qbr_scenarios(id) ON DELETE CASCADE,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (member_id, project_id, sprint_id, scenario_id)
);
CREATE INDEX IF NOT EXISTS idx_qbr_bookings_member ON qbr_bookings(member_id);
CREATE INDEX IF NOT EXISTS idx_qbr_bookings_sprint ON qbr_bookings(sprint_id);
CREATE INDEX IF NOT EXISTS idx_qbr_bookings_project ON qbr_bookings(project_id);
CREATE INDEX IF NOT EXISTS idx_qbr_bookings_scenario ON qbr_bookings(scenario_id);
CREATE INDEX IF NOT EXISTS idx_qbr_members_tribe ON qbr_members(tribe_id);
CREATE INDEX IF NOT EXISTS idx_qbr_members_chapter ON qbr_members(chapter_id);
CREATE INDEX IF NOT EXISTS idx_qbr_sprints_quarter ON qbr_sprints(quarter_id);

-- Marker table for "rows that existed when migration N first ran" backfills (keeps re-runs idempotent).
CREATE TABLE IF NOT EXISTS migration_markers (
  name TEXT PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
