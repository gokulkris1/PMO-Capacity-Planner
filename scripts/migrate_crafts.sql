-- ============================================================
-- PMO Crafts & Demand planning — schema additions
-- Idempotent: safe to run more than once. The workspace function
-- also applies these lazily on cold start.
-- ============================================================

-- Above-the-table / below-the-table crafts per person
-- { primaryCraft: 'project-mgmt', secondaryCrafts: [{craftId, proficiency, maxPct}], tribeAffinity: [], targetUtil: 100 }
ALTER TABLE resources ADD COLUMN IF NOT EXISTS craft_profile JSONB DEFAULT '{}'::jsonb;

-- Project requirement roadmap
ALTER TABLE projects ADD COLUMN IF NOT EXISTS stage TEXT;              -- Pipeline | Initiated | Mobilising | In Flight | Closing
ALTER TABLE projects ADD COLUMN IF NOT EXISTS initiated_on DATE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS craft_demand JSONB DEFAULT '[]'::jsonb; -- [{quarterKey:'2026-Q4', craftId, fte, note}]
ALTER TABLE projects ADD COLUMN IF NOT EXISTS jira_key TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS planview_id TEXT;

-- Which craft a person performs on an allocation (NULL = their primary craft)
ALTER TABLE allocations ADD COLUMN IF NOT EXISTS craft_id TEXT;
ALTER TABLE allocations ADD COLUMN IF NOT EXISTS source TEXT;          -- manual | marketplace | planview | jira

CREATE INDEX IF NOT EXISTS idx_projects_jira_key ON projects(jira_key);
CREATE INDEX IF NOT EXISTS idx_allocations_craft ON allocations(craft_id);
