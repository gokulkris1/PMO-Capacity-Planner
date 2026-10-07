-- =============================================================================
-- RBAC migration: safe five-tier hierarchy
-- SUPERUSER → ORG_ADMIN → PMO_ADMIN → WORKSPACE_OWNER → USER
--
-- Preconditions
--   * Take a backup / point-in-time restore marker before execution.
--   * Review the verification queries after the transaction completes.
--
-- This migration is intentionally non-destructive: it does NOT drop
-- workspace_members and retains existing workspace assignments.
-- =============================================================================

BEGIN;

-- ── Platform roles ──────────────────────────────────────────────────────────
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_plan_check;

-- Normalize every known legacy value. Any unrecognized legacy value becomes
-- USER, which is the least-privileged role.
UPDATE users
SET role = CASE role
    WHEN 'ADMIN' THEN 'ORG_ADMIN'
    WHEN 'PMO' THEN 'PMO_ADMIN'
    WHEN 'PM' THEN 'USER'
    WHEN 'VIEWER' THEN 'USER'
    WHEN 'MEMBER' THEN 'USER'
    WHEN 'SUPERUSER' THEN 'SUPERUSER'
    WHEN 'ORG_ADMIN' THEN 'ORG_ADMIN'
    WHEN 'PMO_ADMIN' THEN 'PMO_ADMIN'
    WHEN 'WORKSPACE_OWNER' THEN 'WORKSPACE_OWNER'
    WHEN 'USER' THEN 'USER'
    ELSE 'USER'
END;

UPDATE users SET plan = 'BASIC' WHERE plan IS NULL OR plan = 'FREE' OR plan NOT IN ('BASIC', 'PRO', 'MAX');

ALTER TABLE users
    ADD CONSTRAINT users_role_check
    CHECK (role IN ('SUPERUSER', 'ORG_ADMIN', 'PMO_ADMIN', 'WORKSPACE_OWNER', 'USER'));

ALTER TABLE users
    ADD CONSTRAINT users_plan_check
    CHECK (plan IN ('BASIC', 'PRO', 'MAX'));

-- ── Workspace membership schema ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspace_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'USER',
    invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, workspace_id)
);

-- The v1 migration named this constraint consistently. Dropping it before the
-- role update lets WORKSPACE_ADMIN be safely normalized without deleting rows.
ALTER TABLE workspace_members DROP CONSTRAINT IF EXISTS workspace_members_role_check;

UPDATE workspace_members
SET org_id = workspaces.org_id
FROM workspaces
WHERE workspace_members.workspace_id = workspaces.id
  AND workspace_members.org_id IS DISTINCT FROM workspaces.org_id;

UPDATE workspace_members
SET role = CASE role
    WHEN 'WORKSPACE_ADMIN' THEN 'PMO_ADMIN'
    WHEN 'ADMIN' THEN 'PMO_ADMIN'
    WHEN 'PMO_ADMIN' THEN 'PMO_ADMIN'
    WHEN 'WORKSPACE_OWNER' THEN 'WORKSPACE_OWNER'
    WHEN 'USER' THEN 'USER'
    ELSE 'USER'
END;

ALTER TABLE workspace_members
    ADD CONSTRAINT workspace_members_role_check
    CHECK (role IN ('PMO_ADMIN', 'WORKSPACE_OWNER', 'USER'));

CREATE INDEX IF NOT EXISTS idx_wm_user ON workspace_members(user_id);
CREATE INDEX IF NOT EXISTS idx_wm_workspace ON workspace_members(workspace_id);
CREATE INDEX IF NOT EXISTS idx_wm_org ON workspace_members(org_id);

-- Backfill organization-level administrators to all workspaces in their own
-- organization. Existing member rows are retained but receive PMO authority.
INSERT INTO workspace_members (user_id, workspace_id, org_id, role)
SELECT u.id, w.id, w.org_id, 'PMO_ADMIN'
FROM users u
JOIN workspaces w ON w.org_id = u.org_id
WHERE u.role IN ('ORG_ADMIN', 'PMO_ADMIN')
  AND u.org_id IS NOT NULL
ON CONFLICT (user_id, workspace_id)
DO UPDATE SET role = 'PMO_ADMIN', org_id = EXCLUDED.org_id;

-- Users without any membership in their organization receive access to one
-- deterministic workspace only. This avoids widening access across every
-- workspace while keeping migrated user accounts usable.
WITH first_workspace_per_org AS (
    SELECT DISTINCT ON (org_id) id, org_id
    FROM workspaces
    ORDER BY org_id, id
)
INSERT INTO workspace_members (user_id, workspace_id, org_id, role)
SELECT
    u.id,
    w.id,
    w.org_id,
    CASE WHEN u.role = 'WORKSPACE_OWNER' THEN 'WORKSPACE_OWNER' ELSE 'USER' END
FROM users u
JOIN first_workspace_per_org w ON w.org_id = u.org_id
WHERE u.role IN ('WORKSPACE_OWNER', 'USER')
  AND u.org_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM workspace_members existing_member
      WHERE existing_member.user_id = u.id AND existing_member.org_id = u.org_id
  )
ON CONFLICT (user_id, workspace_id) DO NOTHING;

ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_queries_month INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_reset_date TIMESTAMPTZ DEFAULT NOW();

COMMIT;

-- Run manually after the transaction:
-- SELECT role, COUNT(*) FROM users GROUP BY role ORDER BY role;
-- SELECT role, COUNT(*) FROM workspace_members GROUP BY role ORDER BY role;
-- SELECT wm.user_id, wm.workspace_id
-- FROM workspace_members wm
-- JOIN workspaces w ON w.id = wm.workspace_id
-- WHERE wm.org_id <> w.org_id;
