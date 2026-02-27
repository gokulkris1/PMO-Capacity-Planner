-- ═══════════════════════════════════════════════════════════════════════
-- V2 RBAC Migration — 5-Tier Role Hierarchy
-- SUPERUSER → ORG_ADMIN → PMO_ADMIN → WORKSPACE_OWNER → USER
-- ═══════════════════════════════════════════════════════════════════════

-- 1. Drop existing role constraints so we can widen the enum
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_plan_check;

-- 2. Normalise any legacy roles before applying new constraint
UPDATE users SET role = 'ORG_ADMIN' WHERE role = 'ADMIN';
UPDATE users SET role = 'USER' WHERE role = 'MEMBER';

-- 3. Apply new role constraint (5-tier)
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('SUPERUSER','ORG_ADMIN','PMO_ADMIN','WORKSPACE_OWNER','USER'));

-- 4. Re-apply plan constraint
ALTER TABLE users ADD CONSTRAINT users_plan_check
  CHECK (plan IN ('BASIC','PRO','MAX'));

-- 5. Drop old workspace_members table (it was created by v1 migration)
DROP TABLE IF EXISTS workspace_members;

-- 6. Create new workspace_members with 3-tier workspace-scoped role
CREATE TABLE workspace_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'USER'
    CHECK (role IN ('PMO_ADMIN','WORKSPACE_OWNER','USER')),
  invited_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, workspace_id)
);

-- 7. Indexes
CREATE INDEX IF NOT EXISTS idx_wm_user ON workspace_members(user_id);
CREATE INDEX IF NOT EXISTS idx_wm_workspace ON workspace_members(workspace_id);
CREATE INDEX IF NOT EXISTS idx_wm_org ON workspace_members(org_id);

-- 8. Back-fill: ORG_ADMINs become PMO_ADMIN in their org's default workspace
INSERT INTO workspace_members (user_id, workspace_id, org_id, role)
SELECT u.id, w.id, u.org_id, 'PMO_ADMIN'
FROM users u
JOIN workspaces w ON w.org_id = u.org_id
WHERE u.role = 'ORG_ADMIN' AND u.org_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- 9. Back-fill: remaining users (USER role) get USER in their org's workspace
INSERT INTO workspace_members (user_id, workspace_id, org_id, role)
SELECT u.id, w.id, u.org_id, 'USER'
FROM users u
JOIN workspaces w ON w.org_id = u.org_id
WHERE u.role = 'USER' AND u.org_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- 10. Ensure helper columns exist
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_queries_month INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_reset_date TIMESTAMPTZ DEFAULT NOW();
