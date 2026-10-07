-- Project lifecycle and skill-led staffing migration
-- Safe to rerun. Apply before deploying code that reads/writes `required_skills`.

BEGIN;

ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS required_skills TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Normalize legacy NULL values so API consumers always receive an array.
UPDATE projects
SET required_skills = ARRAY[]::TEXT[]
WHERE required_skills IS NULL;

CREATE INDEX IF NOT EXISTS idx_projects_workspace_status
    ON projects (workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_projects_required_skills
    ON projects USING GIN (required_skills);

COMMIT;
