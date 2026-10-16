-- =============================================================================
-- Migration: Workspace Members & Hierarchical RBAC
-- Branch: workspaces
-- Run this ONCE against your Neon DB
-- Safe to re-run (uses IF NOT EXISTS / ON CONFLICT DO NOTHING)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Drop old role constraint so we can update values
-- -----------------------------------------------------------------------------
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_plan_check;

-- -----------------------------------------------------------------------------
-- 2. Rename platform roles to new names
--    Old: SUPERUSER, ADMIN, USER
--    New: SUPERUSER, ORG_ADMIN, MEMBER
-- -----------------------------------------------------------------------------
UPDATE users SET role = 'ORG_ADMIN' WHERE role = 'ADMIN';
UPDATE users SET role = 'MEMBER'    WHERE role = 'USER';
-- SUPERUSER stays as-is

-- -----------------------------------------------------------------------------
-- 3. Re-add updated constraints
-- -----------------------------------------------------------------------------
ALTER TABLE users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('SUPERUSER', 'ORG_ADMIN', 'MEMBER'));

ALTER TABLE users
  ADD CONSTRAINT users_plan_check
  CHECK (plan IN ('BASIC', 'PRO', 'MAX'));

-- -----------------------------------------------------------------------------
-- 4. Create workspace_members junction table (heart of the new RBAC)
--    A user can hold a different role on each workspace they belong to.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workspace_members (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID        NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
    workspace_id  UUID        NOT NULL REFERENCES workspaces(id)    ON DELETE CASCADE,
    org_id        UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    role          TEXT        NOT NULL DEFAULT 'USER'
                              CHECK (role IN ('WORKSPACE_ADMIN', 'USER')),
    invited_by    UUID        REFERENCES users(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, workspace_id)   -- one role per user per workspace
);

CREATE INDEX IF NOT EXISTS idx_wm_user      ON workspace_members(user_id);
CREATE INDEX IF NOT EXISTS idx_wm_workspace ON workspace_members(workspace_id);
CREATE INDEX IF NOT EXISTS idx_wm_org       ON workspace_members(org_id);

-- -----------------------------------------------------------------------------
-- 5. Backfill workspace_members from existing users
--    ORG_ADMIN  → WORKSPACE_ADMIN on every workspace in their org
--    MEMBER     → USER on every workspace in their org
--    SUPERUSER  → WORKSPACE_ADMIN everywhere (code also grants this automatically)
-- -----------------------------------------------------------------------------
INSERT INTO workspace_members (user_id, workspace_id, org_id, role)
SELECT
    u.id                                                            AS user_id,
    w.id                                                            AS workspace_id,
    o.id                                                            AS org_id,
    CASE
        WHEN u.role IN ('SUPERUSER', 'ORG_ADMIN') THEN 'WORKSPACE_ADMIN'
        ELSE 'USER'
    END                                                             AS role
FROM users u
JOIN organizations o ON o.id = u.org_id
JOIN workspaces    w ON w.org_id = o.id
WHERE u.org_id IS NOT NULL
ON CONFLICT (user_id, workspace_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 6. Guard: add optional columns if missing
-- -----------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN     DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_queries_month   INTEGER     DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_reset_date    TIMESTAMPTZ DEFAULT NOW();

-- -----------------------------------------------------------------------------
-- Verify (run this SELECT to check backfill):
--   SELECT u.email, u.role AS platform_role, wm.role AS ws_role, w.name
--   FROM workspace_members wm
--   JOIN users      u ON u.id = wm.user_id
--   JOIN workspaces w ON w.id = wm.workspace_id
--   LIMIT 20;
-- -----------------------------------------------------------------------------
