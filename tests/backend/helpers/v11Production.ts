/**
 * The v1.1 production database, rebuilt from the scripts that actually shaped it (package I, upgrade proof).
 *
 * Production was never created from one schema file. It grew through hand-run scripts, lazy cold-start DDL and the
 * v1.1 code itself, so this helper replays that history in order, with the data that existed at each stage:
 *
 *  1. server/migrations_user.sql            users (role PMO | PM | VIEWER) + updated_at trigger          (bf70a40)
 *  2. tenancy                                organizations / workspaces / users.plan, users.org_id. No script in
 *                                            main creates them; the shapes (no id default, FK ON DELETE SET NULL)
 *                                            are taken from the production-compatible scripts/
 *                                            bootstrap_preprod_schema.sql on `develop` (e418d85)
 *  3. server/migrations.sql                  teams, resources (capacity NOT NULL), projects (priority INTEGER),
 *                                            allocations (SERIAL id, allocation_percent CHECK 0..100), scenarios
 *  4. server/migrate_orgs.js, migrate_org_slug.js, scripts/migrate_v1_2_theming.ts
 *  5. scripts/emergency_fix_schema.ts        role/department/total_capacity/skills…, priority → TEXT,
 *                                            allocation_percent → percentage, allocation id → TEXT (the script's
 *                                            ALTER fails on the scenario_allocations FK; the manual fix that
 *                                            production evidently got is applied, matching the preprod bootstrap)
 *  6. scripts/add_skills_column.ts, scripts/migrate_audit_logs.ts
 *  7. scripts/migrate_rbac.ts                PMO → ADMIN, PM/VIEWER → USER, FREE → BASIC, tom.hayes → SUPERUSER
 *  8. scripts/migrate_workspace_members.sql  run statement by statement by scripts/run_migration.mjs (errors skipped):
 *                                            ADMIN → ORG_ADMIN, USER → MEMBER, workspace_members (WORKSPACE_ADMIN|USER)
 *  9. scripts/migrate_v2_rbac.sql            run by scripts/migrate_v2_rbac.mjs (errors skipped): MEMBER → USER,
 *                                            workspace_members recreated (PMO_ADMIN|WORKSPACE_OWNER|USER)
 * 10. scripts/migrate_qbr.sql, scripts/migrate_crafts.sql (also lazy in v1.1 workspace.ts),
 *     scripts/migrate_integrations.sql (also lazy in v1.1 integrations.ts), otps (bootstrap shape)
 *
 * Users are created in the era they would have been created in, so the role conversions above happen to them
 * exactly as they did in production. Passwords are bcrypt cost 10, as v1.1 hashed them.
 *
 * Variant `drifted` adds the plausible damage of hand-run scripts on top: project/allocation dates stored as TEXT
 * (as the preprod bootstrap shows), migrate_workspace_members.sql re-run after v2 RBAC (it drops users_role_check,
 * turns USER into MEMBER and then fails to re-add its constraint), and a user whose role was set to the old 'ADMIN'
 * value afterwards. 2.0 must still sign every one of them in.
 */
import bcrypt from 'bcryptjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Session } from '../../../netlify/functions/_lib/db';

export type V11Variant = 'replayed' | 'drifted';

/* eslint-disable security/detect-non-literal-fs-filename -- fixed fixture paths inside the repository */
const ROOT = join(__dirname, '..', '..', '..');
const fixture = (f: string) => readFileSync(join(ROOT, 'tests', 'backend', 'fixtures', 'v1.1', f), 'utf8');
const legacy = (f: string) => readFileSync(join(ROOT, 'migrations', 'legacy', f), 'utf8');
/* eslint-enable security/detect-non-literal-fs-filename */

/** How scripts/run_migration.mjs and scripts/migrate_v2_rbac.mjs ran a .sql file: comment lines dropped, split
 *  on ';', each statement on its own, errors ignored. */
async function runLikeMjs(s: Session, sql: string): Promise<void> {
  const stmts = sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((x) => x.trim())
    .filter(Boolean);
  for (const st of stmts) await s.exec(st).catch(() => undefined);
}

/** How the TypeScript scripts ran: one statement at a time, failures logged and skipped. */
async function runEach(s: Session, stmts: string[]): Promise<void> {
  for (const st of stmts) await s.exec(st).catch(() => undefined);
}

// ── Fixed ids ────────────────────────────────────────────────────────────────

export const V11 = {
  orgAcme: '0a000000-0000-4000-8000-0000000000a1',
  orgBeta: '0b000000-0000-4000-8000-0000000000b1',
  wsAcme: 'a1000000-0000-4000-8000-0000000000a1',
  wsAcme2: 'a2000000-0000-4000-8000-0000000000a2',
  wsBeta: 'b1000000-0000-4000-8000-0000000000b1',
};

export interface V11User {
  key: string;
  id: string;
  email: string;
  /** What the person types at the login form (case as they remember it). */
  loginEmail: string;
  password: string;
  name: string;
  orgId: string | null;
  twoFactor?: boolean;
  /** Stored hash uses the older `$2a$` prefix. */
  prefix2a?: boolean;
  /** Expected 2.0 identity after migration. */
  expect: {
    platformAdmin: boolean;
    orgRole: 'ORG_ADMIN' | 'MEMBER' | null;
    workspaces: Record<string, 'WORKSPACE_ADMIN' | 'PLANNER' | 'CONTRIBUTOR' | 'VIEWER'>;
  };
}

const uid = (n: number) => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Every account, with the era it was created in. Expected roles depend on the variant (see `usersFor`). */
export function usersFor(variant: V11Variant): V11User[] {
  const A = V11.orgAcme;
  const B = V11.orgBeta;
  const wsA = V11.wsAcme;
  const wsA2 = V11.wsAcme2;
  const wsB = V11.wsBeta;
  // Legacy USER / MEMBER rows map to VIEWER in their workspaces (AC-01#AC2).
  const list: V11User[] = [
    // Era 0 (v1.0 roles)
    {
      key: 'tom',
      id: uid(1),
      email: 'tom.hayes@acme.example',
      loginEmail: 'Tom.Hayes@acme.example',
      password: 'Pmo-Planner-2024',
      name: 'Tom Hayes',
      orgId: A,
      expect: { platformAdmin: true, orgRole: 'ORG_ADMIN', workspaces: { [wsA]: 'WORKSPACE_ADMIN' } },
    },
    {
      key: 'pm',
      id: uid(2),
      email: 'priya.menon@acme.example',
      loginEmail: 'priya.menon@acme.example',
      password: 'pmo123',
      name: 'Priya Menon',
      orgId: A,
      prefix2a: true,
      expect: { platformAdmin: false, orgRole: 'MEMBER', workspaces: { [wsA]: 'VIEWER' } },
    },
    {
      key: 'viewer',
      id: uid(3),
      email: 'victor.lee@acme.example',
      loginEmail: 'victor.lee@acme.example',
      password: 'Viewer!Pass9',
      name: 'Victor Lee',
      orgId: A,
      expect: { platformAdmin: false, orgRole: 'MEMBER', workspaces: { [wsA]: 'VIEWER', [wsA2]: 'VIEWER' } },
    },
    // Era 1 (SUPERUSER / ADMIN / USER)
    {
      key: 'ada',
      id: uid(4),
      email: 'ada.admin@acme.example',
      loginEmail: 'ada.admin@acme.example',
      password: 'Ada-Lovelace-1815',
      name: 'Ada Admin',
      orgId: A,
      twoFactor: true,
      expect: {
        platformAdmin: false,
        orgRole: 'ORG_ADMIN',
        workspaces: { [wsA]: 'WORKSPACE_ADMIN', [wsA2]: 'WORKSPACE_ADMIN' },
      },
    },
    {
      key: 'noma',
      id: uid(5),
      email: 'Noma.Odigie@acme.example',
      loginEmail: 'noma.odigie@ACME.example',
      password: 'noma-secret-77',
      name: 'Noma Odigie',
      orgId: A,
      expect: { platformAdmin: false, orgRole: 'MEMBER', workspaces: { [wsA]: 'VIEWER' } },
    },
    // Era 2 (ORG_ADMIN / MEMBER)
    {
      key: 'bea',
      id: uid(6),
      email: 'bea@beta.example',
      loginEmail: 'bea@beta.example',
      password: 'Beta-Org-Admin!',
      name: 'Bea Brown',
      orgId: B,
      expect: { platformAdmin: false, orgRole: 'ORG_ADMIN', workspaces: { [wsB]: 'WORKSPACE_ADMIN' } },
    },
    {
      key: 'mem',
      id: uid(7),
      email: 'mel.member@acme.example',
      loginEmail: 'mel.member@acme.example',
      password: 'Member-Mel-42',
      name: 'Mel Member',
      orgId: A,
      expect: { platformAdmin: false, orgRole: 'MEMBER', workspaces: { [wsA]: 'VIEWER' } },
    },
    // Era 3 (five-tier v2 RBAC)
    {
      key: 'pat',
      id: uid(8),
      email: 'pat.pmo@acme.example',
      loginEmail: 'pat.pmo@acme.example',
      password: 'Pat-PMO-Admin-1',
      name: 'Pat PMO',
      orgId: A,
      expect: { platformAdmin: false, orgRole: 'MEMBER', workspaces: { [wsA]: 'WORKSPACE_ADMIN' } },
    },
    {
      key: 'owen',
      id: uid(9),
      email: 'owen.owner@acme.example',
      loginEmail: 'owen.owner@acme.example',
      password: 'Owen-Owner-2025',
      name: 'Owen Owner',
      orgId: A,
      expect: { platformAdmin: false, orgRole: 'MEMBER', workspaces: { [wsA]: 'PLANNER', [wsA2]: 'PLANNER' } },
    },
    {
      key: 'loner',
      id: uid(10),
      email: 'loner@nowhere.example',
      loginEmail: 'loner@nowhere.example',
      password: 'Lonely-Planner-1',
      name: 'Lone Ranger',
      orgId: null,
      expect: { platformAdmin: false, orgRole: null, workspaces: {} },
    },
  ];
  if (variant === 'drifted') {
    list.push({
      key: 'oldadmin',
      id: uid(11),
      email: 'old.admin@acme.example',
      loginEmail: 'old.admin@acme.example',
      password: 'Old-Admin-Role-1',
      name: 'Old Admin',
      orgId: A,
      // users.role = 'ADMIN' (pre-RBAC value set by hand): org admin in 2.0 (shared/permissions fromLegacyUserRole).
      expect: { platformAdmin: false, orgRole: 'ORG_ADMIN', workspaces: { [wsA]: 'WORKSPACE_ADMIN' } },
    });
  }
  return list;
}

function hashFor(u: V11User): string {
  const h = bcrypt.hashSync(u.password, 10);
  return u.prefix2a ? h.replace(/^\$2[aby]\$/, '$2a$') : h;
}

const q = (v: string | null) => (v === null ? 'NULL' : `'${v.replace(/'/g, "''")}'`);

function insertUser(u: V11User, role: string, plan = 'BASIC', extra = ''): string {
  return `INSERT INTO users (id, email, password_hash, name, role, plan, org_id${extra ? ', two_factor_enabled' : ''})
    VALUES ('${u.id}', ${q(u.email)}, ${q(hashFor(u))}, ${q(u.name)}, '${role}', '${plan}', ${q(u.orgId)}${extra ? `, ${extra}` : ''})`;
}

// ── Expected data (what the 2.0 API must show after migration) ───────────────

/** Workspace "Default Workspace" of Acme: the planning data the 2.0 snapshot must return unchanged. */
export const ACME_DATA = {
  resources: ['r-tom', 'r-noma', 'r-maria', 'r-kerrie', 'r-gokul', 'r-1700000000001'],
  projects: ['p-phoenix', 'p-ledger', 'p-nebula', 'p-1700000000002', 'p-legacy'],
  /** id → percentage (v1.1 `percentage`; one over 100 % after the emergency fix dropped the CHECK). */
  allocations: {
    '1': 50,
    'a-1712000000001': 60,
    'a-1712000000002': 40,
    'a-1712000000003': 120,
    'a-1712000000004': 30,
    'a-1712000000005': 100,
    'a-1712000000006': 25,
    'alloc-mobile-7': 70,
  } as Record<string, number>,
  /** craft_demand summed per (project, quarter, craft) — 2.0 demand lines. */
  demand: {
    'p-phoenix|2026-Q4|scrum-master': 1.5,
    'p-phoenix|2027-Q1|project-mgmt': 2,
    'p-ledger|2027-Q1|business-analysis': 1,
    'p-nebula|2027-Q2|business-analysis': 0.5,
    'p-nebula|2027-Q2|delivery-lead': 1,
  } as Record<string, number>,
  primaryCraft: { 'r-noma': 'scrum-master', 'r-tom': 'project-mgmt', 'r-maria': 'product-mgmt' } as Record<
    string,
    string
  >,
  qbr: { tribes: 2, members: 3, quarters: 1, sprints: 6, projects: 2, bookings: 4 },
};

// ── Replay ───────────────────────────────────────────────────────────────────

export async function buildV11Production(s: Session, variant: V11Variant): Promise<V11User[]> {
  const users = usersFor(variant);
  const U = Object.fromEntries(users.map((u) => [u.key, u]));
  const { orgAcme: A, orgBeta: B, wsAcme: wsA, wsAcme2: wsA2, wsBeta: wsB } = V11;

  // 1. users (v1.0)
  await s.exec(fixture('server_migrations_user.sql'));

  // 2. tenancy (shapes from the preprod bootstrap: ids without defaults, users.org_id ON DELETE SET NULL)
  await s.exec(`
    CREATE TABLE organizations (id UUID PRIMARY KEY, name TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE workspaces (id UUID PRIMARY KEY, org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
    ALTER TABLE users ADD COLUMN plan TEXT NOT NULL DEFAULT 'FREE';
    ALTER TABLE users ADD COLUMN org_id UUID REFERENCES organizations(id) ON DELETE SET NULL;
  `);

  // 3. planning tables
  await s.exec(fixture('server_migrations.sql'));

  // 4. org columns, slug, theming
  await runEach(s, [
    'ALTER TABLE resources ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE',
    'ALTER TABLE resources ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE',
    'ALTER TABLE resources ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id)',
    'ALTER TABLE projects ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE',
    'ALTER TABLE projects ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE',
    'ALTER TABLE projects ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id)',
    'ALTER TABLE allocations ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE',
    'ALTER TABLE allocations ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE',
    'ALTER TABLE allocations ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id)',
    'CREATE INDEX IF NOT EXISTS idx_res_org ON resources(org_id)',
    'CREATE INDEX IF NOT EXISTS idx_proj_org ON projects(org_id)',
    'CREATE INDEX IF NOT EXISTS idx_alloc_org ON allocations(org_id)',
    'ALTER TABLE organizations ADD COLUMN IF NOT EXISTS slug TEXT UNIQUE',
    'UPDATE organizations SET slug = gen_random_uuid()::text WHERE slug IS NULL',
    'ALTER TABLE organizations ADD COLUMN IF NOT EXISTS logo_url TEXT',
    'ALTER TABLE organizations ADD COLUMN IF NOT EXISTS primary_color VARCHAR(50)',
  ]);

  // ── Era 0 data: v1.0 roles, plan FREE, integer priorities, SERIAL allocation ──
  await s.exec(`
    INSERT INTO organizations (id, name, slug) VALUES ('${A}', 'Acme Bank', 'acme-bank'), ('${B}', 'Beta Insurance', 'beta-insurance');
    INSERT INTO workspaces (id, org_id, name, created_at) VALUES
      ('${wsA}', '${A}', 'Default Workspace', '2025-01-10'),
      ('${wsA2}', '${A}', 'Transformation', '2025-03-01'),
      ('${wsB}', '${B}', 'Default Workspace', '2025-02-01');
    ${insertUser(U.tom, 'PMO', 'FREE')};
    ${insertUser(U.pm, 'PM', 'FREE')};
    ${insertUser(U.viewer, 'VIEWER', 'FREE')};
    INSERT INTO teams (id, name) VALUES ('t1', 'Programme Management'), ('t2', 'Digital Planning'), ('t4', 'Delivery');
    INSERT INTO resources (id, name, type, org_id, workspace_id, team_id, capacity, location, email) VALUES
      ('r-tom', 'Tom Hayes', 'Permanent', '${A}', '${wsA}', 't1', 100, 'Dublin', 'tom.hayes@acme.example');
    INSERT INTO projects (id, name, status, org_id, workspace_id, priority, start_date, end_date, budget, color) VALUES
      ('p-legacy', 'Legacy Migration', 'Active', '${A}', '${wsA}', 2, '2025-01-01', '2027-12-31', 250000, '#3b82f6');
    INSERT INTO allocations (org_id, workspace_id, resource_id, project_id, allocation_percent) VALUES
      ('${A}', '${wsA}', 'r-tom', 'p-legacy', 50);
  `);

  // 5. emergency schema fix
  await runEach(s, [
    'ALTER TABLE resources ADD COLUMN IF NOT EXISTS role TEXT',
    'ALTER TABLE resources ADD COLUMN IF NOT EXISTS department TEXT',
    'ALTER TABLE resources ADD COLUMN IF NOT EXISTS total_capacity INTEGER DEFAULT 100',
    'ALTER TABLE resources ADD COLUMN IF NOT EXISTS avatar_initials TEXT',
    'ALTER TABLE resources ADD COLUMN IF NOT EXISTS daily_rate_eur NUMERIC',
    "ALTER TABLE resources ADD COLUMN IF NOT EXISTS skills TEXT[] DEFAULT '{}'::TEXT[]",
    'UPDATE resources SET total_capacity = capacity WHERE total_capacity = 100 AND capacity IS NOT NULL',
    'ALTER TABLE projects ADD COLUMN IF NOT EXISTS description TEXT',
    'ALTER TABLE projects ADD COLUMN IF NOT EXISTS client_name TEXT',
    'ALTER TABLE projects ALTER COLUMN priority TYPE TEXT USING priority::TEXT',
    'ALTER TABLE allocations RENAME COLUMN allocation_percent TO percentage',
    'ALTER TABLE allocations ADD COLUMN IF NOT EXISTS start_date DATE',
    'ALTER TABLE allocations ADD COLUMN IF NOT EXISTS end_date DATE',
    // The script's own statement fails on the scenario_allocations FK (integer) and is skipped…
    'ALTER TABLE allocations ALTER COLUMN id TYPE TEXT USING id::TEXT',
  ]);
  // …production got the TEXT ids (v1.1 clients send "a-<timestamp>") with the FK moved to TEXT as well.
  await s.exec(`
    ALTER TABLE scenario_allocations DROP CONSTRAINT IF EXISTS scenario_allocations_allocation_id_fkey;
    ALTER TABLE allocations ALTER COLUMN id TYPE TEXT USING id::TEXT;
    ALTER TABLE allocations ALTER COLUMN id DROP DEFAULT;
    ALTER TABLE scenario_allocations ALTER COLUMN allocation_id TYPE TEXT USING allocation_id::TEXT;
    ALTER TABLE scenario_allocations ADD CONSTRAINT scenario_allocations_allocation_id_fkey
      FOREIGN KEY (allocation_id) REFERENCES allocations(id) ON DELETE CASCADE;
  `);
  await runEach(s, [
    'ALTER TABLE allocations DROP CONSTRAINT IF EXISTS allocations_allocation_percent_check',
    'ALTER TABLE allocations DROP CONSTRAINT IF EXISTS allocations_percentage_check',
  ]);
  if (variant === 'drifted') {
    // Dates as TEXT, as the production-compatible preprod bootstrap has them.
    await s.exec(`
      ALTER TABLE projects ALTER COLUMN start_date TYPE TEXT USING start_date::TEXT;
      ALTER TABLE projects ALTER COLUMN end_date TYPE TEXT USING end_date::TEXT;
      ALTER TABLE allocations ALTER COLUMN start_date TYPE TEXT USING start_date::TEXT;
      ALTER TABLE allocations ALTER COLUMN end_date TYPE TEXT USING end_date::TEXT;
    `);
  }

  // 6. skills (no-op by now) and audit_logs
  await runEach(s, [
    "ALTER TABLE resources ADD COLUMN IF NOT EXISTS skills TEXT[] DEFAULT '{}'::TEXT[]",
    `CREATE TABLE IF NOT EXISTS audit_logs (id SERIAL PRIMARY KEY, user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL, details JSONB, ip_address TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
    'CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action)',
  ]);

  // 7. migrate_rbac.ts
  await runEach(s, [
    'ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check',
    'ALTER TABLE users DROP CONSTRAINT IF EXISTS users_plan_check',
    'ALTER TABLE workspaces DROP CONSTRAINT IF EXISTS workspaces_plan_check',
    "UPDATE users SET role = 'ADMIN' WHERE role IN ('PMO')",
    "UPDATE users SET role = 'USER' WHERE role IN ('PM', 'VIEWER')",
    "UPDATE users SET plan = 'BASIC' WHERE plan = 'FREE'",
    "UPDATE workspaces SET plan = 'BASIC' WHERE plan = 'FREE'",
    "UPDATE users SET role = 'SUPERUSER', plan = 'MAX' WHERE email ILIKE 'tom.hayes%' OR email ILIKE '%tomhayes%'",
    "ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('SUPERUSER', 'ADMIN', 'USER'))",
    "ALTER TABLE users ADD CONSTRAINT users_plan_check CHECK (plan IN ('BASIC', 'PRO', 'MAX'))",
    "ALTER TABLE workspaces ADD CONSTRAINT workspaces_plan_check CHECK (plan IN ('BASIC', 'PRO', 'MAX'))",
  ]);

  // ── Era 1 data: ADMIN / USER, TEXT allocation ids, over-100 % booking ──
  await s.exec(`
    ${insertUser(U.ada, 'ADMIN', 'PRO')};
    ${insertUser(U.noma, 'USER')};
    INSERT INTO resources (id, name, type, org_id, workspace_id, team_id, capacity, total_capacity, role, department, skills, email) VALUES
      ('r-noma', 'Noma Odigie', 'Permanent', '${A}', '${wsA}', 't1', 100, 100, 'Scrum Master', 'PMO', '{Agile,Jira}', 'noma.odigie@acme.example'),
      ('r-maria', 'Maria Kelly', 'Permanent', '${A}', '${wsA}', 't2', 100, 100, 'Product Manager', 'Digital', '{}', NULL),
      ('r-kerrie', 'Kerrie Dalton', 'Contractor', '${A}', '${wsA}', 't4', 80, 80, 'Programme Manager', 'PMO', '{Budgeting}', NULL),
      ('r-gokul', 'Gokul Gurijala', 'Permanent', '${A}', '${wsA}', 't1', 100, 100, 'Project Manager', 'PMO', '{}', NULL),
      ('r-beta', 'Ben Beta', 'Permanent', '${B}', '${wsB}', NULL, 100, 100, 'Analyst', 'Ops', '{}', NULL);
    INSERT INTO projects (id, name, status, org_id, workspace_id, priority, start_date, end_date, description, client_name) VALUES
      ('p-phoenix', 'Phoenix', 'Active', '${A}', '${wsA}', 'High', '2026-10-01', '2027-06-30', 'Payments rebuild', 'Payments'),
      ('p-ledger', 'Ledger', 'Planning', '${A}', '${wsA}', 'Medium', NULL, NULL, NULL, 'Lending '),
      ('p-beta', 'Beta Claims', 'Active', '${B}', '${wsB}', 'Low', '2026-01-01', '2027-12-31', NULL, 'Claims');
    INSERT INTO allocations (id, org_id, workspace_id, resource_id, project_id, percentage, start_date, end_date) VALUES
      ('a-1712000000001', '${A}', '${wsA}', 'r-noma', 'p-phoenix', 60, '2026-10-01', '2026-12-31'),
      ('a-1712000000002', '${A}', '${wsA}', 'r-noma', 'p-ledger', 40, NULL, NULL),
      ('a-1712000000003', '${A}', '${wsA}', 'r-maria', 'p-phoenix', 120, '2026-10-01', '2027-03-31'),
      ('a-1712000000004', '${A}', '${wsA}', 'r-kerrie', 'p-ledger', 30, '2027-01-01', '2027-06-30'),
      ('a-beta-1', '${B}', '${wsB}', 'r-beta', 'p-beta', 100, NULL, NULL);
  `);

  // 8. migrate_workspace_members.sql (run_migration.mjs)
  await runLikeMjs(s, legacy('migrate_workspace_members.sql'));

  // ── Era 2 data ──
  await s.exec(`
    ${insertUser(U.bea, 'ORG_ADMIN')};
    ${insertUser(U.mem, 'MEMBER')};
    INSERT INTO workspace_members (user_id, workspace_id, org_id, role, invited_by) VALUES
      ('${U.bea.id}', '${wsB}', '${B}', 'WORKSPACE_ADMIN', NULL),
      ('${U.mem.id}', '${wsA}', '${A}', 'USER', '${U.ada.id}');
  `);

  // 9. migrate_v2_rbac.sql (migrate_v2_rbac.mjs): drops and rebuilds workspace_members from users.role
  await runLikeMjs(s, legacy('migrate_v2_rbac.sql'));

  // ── Era 3 data: explicit workspace roles as v1.1 wrote them ──
  await s.exec(`
    ${insertUser(U.pat, 'PMO_ADMIN')};
    ${insertUser(U.owen, 'WORKSPACE_OWNER')};
    ${insertUser(U.loner, 'USER')};
    DELETE FROM workspace_members WHERE workspace_id <> '${wsA}' AND org_id = '${A}';
    INSERT INTO workspace_members (user_id, workspace_id, org_id, role, invited_by) VALUES
      ('${U.ada.id}', '${wsA2}', '${A}', 'PMO_ADMIN', '${U.ada.id}'),
      ('${U.viewer.id}', '${wsA2}', '${A}', 'USER', '${U.ada.id}'),
      ('${U.pat.id}', '${wsA}', '${A}', 'PMO_ADMIN', '${U.ada.id}'),
      ('${U.owen.id}', '${wsA}', '${A}', 'WORKSPACE_OWNER', '${U.ada.id}'),
      ('${U.owen.id}', '${wsA2}', '${A}', 'WORKSPACE_OWNER', '${U.ada.id}'),
      ('${U.tom.id}', '${wsA}', '${A}', 'PMO_ADMIN', NULL)
    ON CONFLICT (user_id, workspace_id) DO UPDATE SET role = EXCLUDED.role;
    UPDATE users SET two_factor_enabled = true WHERE id = '${U.ada.id}';
  `);

  // 10. QBR, crafts, integrations, otps
  await s.exec(legacy('migrate_qbr.sql'));
  await s.exec(legacy('migrate_crafts.sql'));
  await s.exec(legacy('migrate_integrations.sql'));
  await s.exec(`CREATE TABLE IF NOT EXISTS otps (email TEXT PRIMARY KEY, otp TEXT NOT NULL, expires_at BIGINT NOT NULL,
    attempts INTEGER DEFAULT 0)`);

  // ── Era 4 data: crafts, demand roadmap, marketplace bookings, integrations, QBR, audit ──
  await s.exec(`
    UPDATE resources SET craft_profile = '{"primaryCraft":"scrum-master","secondaryCrafts":[{"craftId":"business-analysis","proficiency":2,"maxPct":30}],"tribeAffinity":["Payments","Lending "],"targetUtil":90}' WHERE id = 'r-noma';
    UPDATE resources SET craft_profile = '{"primaryCraft":"project-mgmt","secondaryCrafts":[{"craftId":"delivery-lead","proficiency":3}],"tribeAffinity":["Payments"]}' WHERE id = 'r-tom';
    UPDATE resources SET craft_profile = '{"primaryCraft":"product-mgmt"}' WHERE id = 'r-maria';
    INSERT INTO resources (id, name, type, workspace_id, team_id, capacity, total_capacity, role, skills, craft_profile) VALUES
      ('r-1700000000001', 'Mary Vithalani', 'Permanent', '${wsA}', NULL, 100, 100, 'Automation Product Manager', '{}',
       '{"primaryCraft":"business-analysis","secondaryCrafts":[],"tribeAffinity":[]}');
    UPDATE projects SET stage = 'In Flight', initiated_on = '2026-06-01', jira_key = 'PHX',
      craft_demand = '[{"quarterKey":"2026-Q4","craftId":"scrum-master","fte":1},{"quarterKey":"2026-Q4","craftId":"scrum-master","fte":0.5},{"quarterKey":"2027-Q1","craftId":"project-mgmt","fte":2,"note":"ramp up"}]'
      WHERE id = 'p-phoenix';
    UPDATE projects SET stage = 'Pipeline', planview_id = 'PV-9',
      craft_demand = '[{"quarterKey":"2027-Q1","craftId":"business-analysis","fte":1},{"quarterKey":"bad","craftId":"x","fte":1}]'
      WHERE id = 'p-ledger';
    INSERT INTO projects (id, name, status, workspace_id, priority, client_name, stage, craft_demand, start_date, end_date) VALUES
      ('p-nebula', 'Nebula', 'Planning', '${wsA}', 'Medium', 'Digital', 'Initiated',
       '[{"quarterKey":"2027-Q2","craftId":"business-analysis","fte":0.5},{"quarterKey":"2027-Q2","craftId":"delivery-lead","fte":1}]',
       '2027-01-01', '2027-12-31'),
      ('p-1700000000002', 'Operations Uplift', 'Active', '${wsA}', 'Low', NULL, NULL, '[]', NULL, NULL);
    INSERT INTO allocations (id, workspace_id, resource_id, project_id, percentage, start_date, end_date, craft_id, source) VALUES
      ('a-1712000000005', '${wsA}', 'r-gokul', 'p-nebula', 100, '2027-01-01', '2027-06-30', 'project-mgmt', 'manual'),
      ('a-1712000000006', '${wsA}', 'r-noma', 'p-nebula', 25, '2027-04-01', '2027-06-30', 'business-analysis', 'marketplace'),
      ('alloc-mobile-7', '${wsA}', 'r-1700000000001', 'p-1700000000002', 70, NULL, NULL, NULL, 'planview');
    INSERT INTO workspace_integrations (workspace_id, provider, config) VALUES
      ('${wsA}', 'settings', '{"calibration":{"*":{"pointsPerSprintPerFte":10,"sprintLengthDays":14},"Payments":{"pointsPerSprintPerFte":12,"sprintLengthDays":10}},"mappings":{"jira":{"PHX":"p-phoenix"},"planview":{"PV-9":"p-ledger"}}}'),
      ('${wsA}', 'jira', '{"domain":"acme.atlassian.net","email":"jira-bot@acme.example","projectKeys":["PHX"],"boardIds":[12]}');
    INSERT INTO audit_logs (user_id, action, ip_address, details) VALUES
      ('${U.ada.id}', 'LOGIN', '10.0.0.1', '{"plan":"PRO","role":"ORG_ADMIN"}'),
      ('${U.tom.id}', 'LOGIN', '10.0.0.2', '{"plan":"MAX","role":"SUPERUSER"}'),
      ('${U.noma.id}', 'WORKSPACE_SAVE', NULL, NULL);
    INSERT INTO otps (email, otp, expires_at, attempts) VALUES ('ada.admin@acme.example', '123456', ${Date.now() - 60_000}, 0);
    INSERT INTO qbr_tribes (id, org_id, workspace_id, name, lead_name) VALUES
      ('c1000000-0000-4000-8000-000000000001', '${A}', '${wsA}', 'Digital Experience', 'Tom Hayes'),
      ('c1000000-0000-4000-8000-000000000002', '${A}', '${wsA}', 'Payments', NULL);
    INSERT INTO qbr_quarters (id, org_id, workspace_id, label, start_date, end_date, is_active) VALUES
      ('c2000000-0000-4000-8000-000000000001', '${A}', '${wsA}', 'QBR1 FY27', '2026-10-01', '2026-12-31', true);
    INSERT INTO qbr_sprints (quarter_id, sprint_number, label, start_date, end_date)
      SELECT 'c2000000-0000-4000-8000-000000000001', n, 'Sprint ' || n, DATE '2026-10-01' + (n - 1) * 14, DATE '2026-10-01' + n * 14 - 1
      FROM generate_series(1, 6) AS n;
    INSERT INTO qbr_members (id, org_id, workspace_id, name, email, role_title, tribe_id, member_type) VALUES
      ('c3000000-0000-4000-8000-000000000001', '${A}', '${wsA}', 'Noma Odigie', 'noma.odigie@acme.example', 'Scrum Master', 'c1000000-0000-4000-8000-000000000001', 'INTERNAL'),
      ('c3000000-0000-4000-8000-000000000002', '${A}', '${wsA}', 'Maria Kelly', NULL, 'Product Manager', 'c1000000-0000-4000-8000-000000000001', 'INTERNAL'),
      ('c3000000-0000-4000-8000-000000000003', '${A}', '${wsA}', 'Vendor Dev', NULL, 'Developer', 'c1000000-0000-4000-8000-000000000002', 'VENDOR');
    INSERT INTO qbr_projects (id, org_id, workspace_id, name, tribe_id, status, priority) VALUES
      ('c4000000-0000-4000-8000-000000000001', '${A}', '${wsA}', 'Checkout', 'c1000000-0000-4000-8000-000000000001', 'ACTIVE', 'HIGH'),
      ('c4000000-0000-4000-8000-000000000002', '${A}', '${wsA}', 'Fraud Engine', 'c1000000-0000-4000-8000-000000000002', 'PLANNING', 'MEDIUM');
    INSERT INTO qbr_bookings (org_id, workspace_id, member_id, project_id, sprint_id, percentage)
      SELECT '${A}', '${wsA}', m.id, p.id, sp.id, 50
      FROM (VALUES ('c3000000-0000-4000-8000-000000000001'::uuid, 'c4000000-0000-4000-8000-000000000001'::uuid),
                   ('c3000000-0000-4000-8000-000000000002'::uuid, 'c4000000-0000-4000-8000-000000000001'::uuid),
                   ('c3000000-0000-4000-8000-000000000003'::uuid, 'c4000000-0000-4000-8000-000000000002'::uuid),
                   ('c3000000-0000-4000-8000-000000000001'::uuid, 'c4000000-0000-4000-8000-000000000002'::uuid)) AS mp(mid, pid)
      JOIN qbr_members m ON m.id = mp.mid JOIN qbr_projects p ON p.id = mp.pid
      JOIN qbr_sprints sp ON sp.quarter_id = 'c2000000-0000-4000-8000-000000000001' AND sp.sprint_number = 1;
  `);

  if (variant === 'drifted') {
    // Someone re-ran run_migration.mjs after v2 RBAC: it drops users_role_check, turns USER into MEMBER, then fails to
    // add its narrower constraint (PMO_ADMIN rows exist) and fails its WORKSPACE_ADMIN backfill (CHECK). Later a
    // role was set to the pre-RBAC value 'ADMIN' through the v1.1 admin panel, which no constraint stopped.
    await runLikeMjs(s, legacy('migrate_workspace_members.sql'));
    await s.exec(`
      ${insertUser(U.oldadmin, 'ADMIN')};
      INSERT INTO workspace_members (user_id, workspace_id, org_id, role) VALUES ('${U.oldadmin.id}', '${wsA}', '${A}', 'PMO_ADMIN');
    `);
  }
  return users;
}
