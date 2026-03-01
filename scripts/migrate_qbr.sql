-- ============================================================
-- QBR Planning Module — Database Schema
-- ============================================================

-- Tribes (business areas, e.g. Payments, Lending, Digital)
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

-- Chapters (craft groups, e.g. Engineering, Design, QA)
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

-- Centers of Excellence (shared skill groups)
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

-- Quarters
CREATE TABLE IF NOT EXISTS qbr_quarters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    label TEXT NOT NULL,          -- e.g. 'Q2 2026'
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    is_active BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Sprints (2-week blocks within a quarter, 6 per quarter)
CREATE TABLE IF NOT EXISTS qbr_sprints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quarter_id UUID REFERENCES qbr_quarters(id) ON DELETE CASCADE,
    sprint_number INTEGER NOT NULL CHECK (sprint_number >= 1 AND sprint_number <= 6),
    label TEXT NOT NULL,          -- e.g. 'S1 (Jan 6–17)'
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    UNIQUE (quarter_id, sprint_number)
);

-- Members (people in QBR planning — may be different from workspace resources)
CREATE TABLE IF NOT EXISTS qbr_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT,
    role_title TEXT,              -- e.g. 'Senior Engineer', 'UX Designer'
    tribe_id UUID REFERENCES qbr_tribes(id) ON DELETE SET NULL,
    chapter_id UUID REFERENCES qbr_chapters(id) ON DELETE SET NULL,
    coe_id UUID REFERENCES qbr_coe_groups(id) ON DELETE SET NULL,
    member_type TEXT NOT NULL DEFAULT 'INTERNAL' CHECK (member_type IN ('INTERNAL', 'VENDOR', 'CONTRACTOR')),
    daily_rate NUMERIC,
    skills TEXT[],                -- array of skill tags
    avatar_color TEXT DEFAULT '#6366f1',
    total_capacity INTEGER DEFAULT 100,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- OKRs (Objectives & Key Results, hierarchical)
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

-- QBR Projects / Initiatives
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

-- Squads (cross-functional teams)
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

-- Squad Members
CREATE TABLE IF NOT EXISTS qbr_squad_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    squad_id UUID REFERENCES qbr_squads(id) ON DELETE CASCADE,
    member_id UUID REFERENCES qbr_members(id) ON DELETE CASCADE,
    squad_role TEXT DEFAULT 'MEMBER' CHECK (squad_role IN ('LEAD', 'MEMBER', 'ADVISOR')),
    UNIQUE (squad_id, member_id)
);

-- What-If Scenarios
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

-- Sprint Bookings (the core capacity data)
CREATE TABLE IF NOT EXISTS qbr_bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    member_id UUID REFERENCES qbr_members(id) ON DELETE CASCADE,
    project_id UUID REFERENCES qbr_projects(id) ON DELETE CASCADE,
    sprint_id UUID REFERENCES qbr_sprints(id) ON DELETE CASCADE,
    percentage INTEGER NOT NULL CHECK (percentage >= 0 AND percentage <= 100),
    scenario_id UUID REFERENCES qbr_scenarios(id) ON DELETE CASCADE,  -- NULL = committed/live booking
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (member_id, project_id, sprint_id, scenario_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_qbr_bookings_member ON qbr_bookings(member_id);
CREATE INDEX IF NOT EXISTS idx_qbr_bookings_sprint ON qbr_bookings(sprint_id);
CREATE INDEX IF NOT EXISTS idx_qbr_bookings_project ON qbr_bookings(project_id);
CREATE INDEX IF NOT EXISTS idx_qbr_bookings_scenario ON qbr_bookings(scenario_id);
CREATE INDEX IF NOT EXISTS idx_qbr_members_tribe ON qbr_members(tribe_id);
CREATE INDEX IF NOT EXISTS idx_qbr_members_chapter ON qbr_members(chapter_id);
CREATE INDEX IF NOT EXISTS idx_qbr_sprints_quarter ON qbr_sprints(quarter_id);
