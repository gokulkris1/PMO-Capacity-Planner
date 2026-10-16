-- 0002 access model (AC-01, AC-07, AC-09, PL-07, SH-05).
-- Adds platform / org / workspace role columns and backfills them from the v1.1 values.
-- users.password_hash, users.email, users.role and workspace_members.role are never modified (AC-01#AC4).

INSERT INTO migration_markers (name) VALUES ('0002_access_model') ON CONFLICT (name) DO NOTHING;

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_sign_in_at TIMESTAMPTZ;

-- Platform admin = former SUPERUSER (AC-01#AC2). Only ever granted otherwise by scripts/grant_platform_admin.mjs.
UPDATE users SET is_platform_admin = true WHERE role = 'SUPERUSER' AND is_platform_admin = false;

-- Every user that existed before 2.0 counts as verified so current logins keep working (AC-07#AC2).
UPDATE users SET email_verified_at = now()
WHERE email_verified_at IS NULL
  AND (created_at IS NULL OR created_at <= (SELECT at FROM migration_markers WHERE name = '0002_access_model'));

CREATE TABLE IF NOT EXISTS org_memberships (
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('ORG_ADMIN', 'MEMBER')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);
-- A user belongs to at most one organisation (AC-08#AC3).
CREATE UNIQUE INDEX IF NOT EXISTS org_memberships_user_uq ON org_memberships(user_id);

-- ORG_ADMIN / legacy ADMIN -> ORG_ADMIN. A former SUPERUSER who belongs to an org keeps admin rights there
-- (they had them in v1.1; deviation from AC-01#AC2 recorded in handoff-A.md). Everyone else -> MEMBER.
INSERT INTO org_memberships (org_id, user_id, role)
SELECT u.org_id, u.id,
       CASE WHEN u.role IN ('ORG_ADMIN', 'ADMIN', 'SUPERUSER') THEN 'ORG_ADMIN' ELSE 'MEMBER' END
FROM users u
JOIN organizations o ON o.id = u.org_id
WHERE u.org_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Workspace roles: new column, legacy column untouched (AC-01#AC2, #AC5).
ALTER TABLE workspace_members ADD COLUMN IF NOT EXISTS access_role TEXT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_members_access_role_check') THEN
    ALTER TABLE workspace_members ADD CONSTRAINT workspace_members_access_role_check
      CHECK (access_role IS NULL OR access_role IN ('WORKSPACE_ADMIN', 'PLANNER', 'CONTRIBUTOR', 'VIEWER'));
  END IF;
END $$;
UPDATE workspace_members SET access_role = CASE role
    WHEN 'PMO_ADMIN' THEN 'WORKSPACE_ADMIN'
    WHEN 'WORKSPACE_ADMIN' THEN 'WORKSPACE_ADMIN'
    WHEN 'WORKSPACE_OWNER' THEN 'PLANNER'
    ELSE 'VIEWER' END
WHERE access_role IS NULL;

-- Organisation settings (plan, feature flags, planning settings, visibility) and optimistic concurrency.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS plan TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS features JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS planning JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS default_workspace_visibility TEXT NOT NULL DEFAULT 'org';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS updated_by UUID;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organizations_visibility_check') THEN
    ALTER TABLE organizations ADD CONSTRAINT organizations_visibility_check
      CHECK (default_workspace_visibility IN ('org', 'members'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organizations_plan_check') THEN
    ALTER TABLE organizations ADD CONSTRAINT organizations_plan_check
      CHECK (plan IS NULL OR plan IN ('BASIC', 'PRO', 'MAX', 'ENTERPRISE'));
  END IF;
END $$;

-- PL-07#AC1: plan of the org's ORG_ADMIN/SUPERUSER users, highest wins, else BASIC.
UPDATE organizations o SET plan = COALESCE((
    SELECT CASE max(CASE upper(coalesce(u.plan, 'BASIC')) WHEN 'MAX' THEN 3 WHEN 'PRO' THEN 2 ELSE 1 END)
             WHEN 3 THEN 'MAX' WHEN 2 THEN 'PRO' ELSE 'BASIC' END
    FROM users u
    WHERE u.org_id = o.id AND u.role IN ('ORG_ADMIN', 'ADMIN', 'SUPERUSER')), 'BASIC')
WHERE o.plan IS NULL;
