-- =============================================================================
-- PMO Capacity Planner preproduction bootstrap schema
--
-- Creates an empty, production-compatible schema for the isolated `develop`
-- environment. It deliberately contains no production data, credentials, or
-- tenant records. The schema includes the current lifecycle, RBAC, and QBR
-- structures required by the application.
-- =============================================================================

BEGIN;

-- ── Core tenancy and identity ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    slug TEXT UNIQUE,
    logo_url TEXT,
    primary_color VARCHAR(50)
);

CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT,
    role TEXT NOT NULL DEFAULT 'USER'
        CHECK (role IN ('SUPERUSER', 'ORG_ADMIN', 'PMO_ADMIN', 'WORKSPACE_OWNER', 'USER')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    plan TEXT NOT NULL DEFAULT 'BASIC'
        CHECK (plan IN ('BASIC', 'PRO', 'MAX')),
    org_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    ai_queries_month INTEGER DEFAULT 0,
    last_reset_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    two_factor_enabled BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS workspaces (
    id UUID PRIMARY KEY,
    org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS workspace_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'USER'
        CHECK (role IN ('PMO_ADMIN', 'WORKSPACE_OWNER', 'USER')),
    invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, workspace_id)
);

-- ── Capacity-planning data ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS resources (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    team_id TEXT REFERENCES teams(id),
    total_capacity INTEGER NOT NULL DEFAULT 100,
    location TEXT,
    email TEXT,
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    role TEXT,
    department TEXT,
    avatar_initials TEXT,
    daily_rate_eur NUMERIC,
    skills TEXT[] DEFAULT ARRAY[]::TEXT[]
);

CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT NOT NULL,
    priority TEXT,
    start_date TEXT,
    end_date TEXT,
    budget NUMERIC,
    color TEXT,
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    description TEXT,
    client_name TEXT,
    required_skills TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]
);

CREATE TABLE IF NOT EXISTS allocations (
    id TEXT PRIMARY KEY,
    resource_id TEXT REFERENCES resources(id) ON DELETE CASCADE,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    percentage INTEGER NOT NULL,
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    start_date TEXT,
    end_date TEXT,
    org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS scenarios (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS scenario_allocations (
    scenario_id INTEGER REFERENCES scenarios(id) ON DELETE CASCADE,
    allocation_id TEXT REFERENCES allocations(id) ON DELETE CASCADE,
    PRIMARY KEY (scenario_id, allocation_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    details JSONB,
    ip_address TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS otps (
    email TEXT PRIMARY KEY,
    otp TEXT NOT NULL,
    expires_at BIGINT NOT NULL,
    attempts INTEGER DEFAULT 0
);

-- ── QBR planning ────────────────────────────────────────────────────────────
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
    is_active BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS qbr_sprints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quarter_id UUID REFERENCES qbr_quarters(id) ON DELETE CASCADE,
    sprint_number INTEGER NOT NULL CHECK (sprint_number BETWEEN 1 AND 6),
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
    member_type TEXT NOT NULL DEFAULT 'INTERNAL'
        CHECK (member_type IN ('INTERNAL', 'VENDOR', 'CONTRACTOR')),
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
    progress INTEGER DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
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
    status TEXT NOT NULL DEFAULT 'PLANNING'
        CHECK (status IN ('PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED')),
    priority TEXT DEFAULT 'MEDIUM'
        CHECK (priority IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
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
    squad_role TEXT DEFAULT 'MEMBER'
        CHECK (squad_role IN ('LEAD', 'MEMBER', 'ADVISOR')),
    UNIQUE (squad_id, member_id)
);

CREATE TABLE IF NOT EXISTS qbr_scenarios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    quarter_id UUID REFERENCES qbr_quarters(id) ON DELETE CASCADE,
    is_committed BOOLEAN DEFAULT FALSE,
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
    percentage INTEGER NOT NULL CHECK (percentage BETWEEN 0 AND 100),
    scenario_id UUID REFERENCES qbr_scenarios(id) ON DELETE CASCADE,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (member_id, project_id, sprint_id, scenario_id)
);

-- ── Supporting indexes ──────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_res_org ON resources(org_id);
CREATE INDEX IF NOT EXISTS idx_proj_org ON projects(org_id);
CREATE INDEX IF NOT EXISTS idx_alloc_org ON allocations(org_id);
CREATE INDEX IF NOT EXISTS idx_projects_workspace_status ON projects(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_projects_required_skills ON projects USING GIN(required_skills);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_wm_user ON workspace_members(user_id);
CREATE INDEX IF NOT EXISTS idx_wm_workspace ON workspace_members(workspace_id);
CREATE INDEX IF NOT EXISTS idx_wm_org ON workspace_members(org_id);
CREATE INDEX IF NOT EXISTS idx_qbr_bookings_member ON qbr_bookings(member_id);
CREATE INDEX IF NOT EXISTS idx_qbr_bookings_sprint ON qbr_bookings(sprint_id);
CREATE INDEX IF NOT EXISTS idx_qbr_bookings_project ON qbr_bookings(project_id);
CREATE INDEX IF NOT EXISTS idx_qbr_bookings_scenario ON qbr_bookings(scenario_id);
CREATE INDEX IF NOT EXISTS idx_qbr_members_tribe ON qbr_members(tribe_id);
CREATE INDEX IF NOT EXISTS idx_qbr_members_chapter ON qbr_members(chapter_id);
CREATE INDEX IF NOT EXISTS idx_qbr_sprints_quarter ON qbr_sprints(quarter_id);

-- Keep user update timestamps consistent with the production identity contract.
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_user_timestamp ON users;
CREATE TRIGGER trg_update_user_timestamp
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

COMMIT;
