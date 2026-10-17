-- server/migrations.sql

-- Teams (static list, could be seeded later)
CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL
);

-- Resources
CREATE TABLE IF NOT EXISTS resources (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    team_id TEXT REFERENCES teams(id),
    capacity INTEGER NOT NULL,
    location TEXT,
    email TEXT
);

-- Projects
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT NOT NULL,
    org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    priority INTEGER,
    start_date DATE,
    end_date DATE,
    budget NUMERIC,
    color TEXT
);

-- Allocations (many‑to‑many between resources and projects)
CREATE TABLE IF NOT EXISTS allocations (
    id SERIAL PRIMARY KEY,
    org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    resource_id TEXT REFERENCES resources(id) ON DELETE CASCADE,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    allocation_percent INTEGER NOT NULL CHECK (allocation_percent >= 0 AND allocation_percent <= 100)
);

-- Scenarios (what‑if sandbox)
CREATE TABLE IF NOT EXISTS scenarios (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Scenario allocations (snapshot of allocations for a scenario)
CREATE TABLE IF NOT EXISTS scenario_allocations (
    scenario_id INTEGER REFERENCES scenarios(id) ON DELETE CASCADE,
    allocation_id INTEGER REFERENCES allocations(id) ON DELETE CASCADE,
    PRIMARY KEY (scenario_id, allocation_id)
);
