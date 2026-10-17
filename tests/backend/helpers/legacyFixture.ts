/**
 * A v1.1-shaped database: legacy tables (as production has them, including the old global `teams` table with a
 * FK from resources and a NOT NULL `capacity` column) filled with representative data. Used to prove that the
 * 2.0 migrations backfill the new model and leave every legacy value byte-identical.
 */
import type { Session } from '../../../netlify/functions/_lib/db';

export const LEGACY = {
  orgA: '0a000000-0000-4000-8000-00000000000a',
  orgB: '0b000000-0000-4000-8000-00000000000b',
  wsA1: 'a1000000-0000-4000-8000-0000000000a1',
  wsA2: 'a2000000-0000-4000-8000-0000000000a2',
  wsB1: 'b1000000-0000-4000-8000-0000000000b1',
  superuser: '50000000-0000-4000-8000-000000000001',
  orgAdminA: '50000000-0000-4000-8000-000000000002',
  legacyAdminB: '50000000-0000-4000-8000-000000000003',
  pmoAdminA: '50000000-0000-4000-8000-000000000004',
  ownerA: '50000000-0000-4000-8000-000000000005',
  userA: '50000000-0000-4000-8000-000000000006',
  noOrg: '50000000-0000-4000-8000-000000000007',
};

/** Legacy-only bits that production may have but a fresh 0001 does not create. Run before 0001. */
export const PRE_BASELINE_SQL = `
CREATE TABLE teams (id TEXT PRIMARY KEY, name TEXT NOT NULL);
INSERT INTO teams VALUES ('t1','Programme Management'),('t2','Digital Planning'),('t4','Delivery'),('t9','Odd team');
CREATE TABLE organizations (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL, slug TEXT UNIQUE,
  logo_url TEXT, primary_color VARCHAR(50), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE workspaces (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE resources (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE, team_id TEXT REFERENCES teams(id),
  capacity INTEGER NOT NULL, location TEXT, email TEXT);
`;

/** `hash` is the bcrypt hash every legacy user gets (tests sign in with its password). */
export async function seedLegacyData(s: Session, hash: string): Promise<void> {
  const L = { ...LEGACY, hash };
  await s.exec(`
INSERT INTO organizations (id, name, slug) VALUES ('${L.orgA}', 'Acme', 'acme-1'), ('${L.orgB}', 'Beta', 'beta-2');
INSERT INTO workspaces (id, org_id, name, created_at) VALUES
  ('${L.wsA1}', '${L.orgA}', 'Default Workspace', '2025-01-01'),
  ('${L.wsA2}', '${L.orgA}', 'Second', '2025-02-01'),
  ('${L.wsB1}', '${L.orgB}', 'Default Workspace', '2025-01-01');
INSERT INTO users (id, email, password_hash, name, role, plan, org_id, two_factor_enabled) VALUES
  ('${L.superuser}', 'boss@platform.test', '${L.hash}', 'Boss', 'SUPERUSER', 'MAX', '${L.orgA}', false),
  ('${L.orgAdminA}', 'admin@acme.test', '${L.hash}', 'Ada Admin', 'ORG_ADMIN', 'PRO', '${L.orgA}', true),
  ('${L.legacyAdminB}', 'admin@beta.test', '${L.hash}', 'Bea', 'ORG_ADMIN', 'BASIC', '${L.orgB}', false),
  ('${L.pmoAdminA}', 'pmo@acme.test', '${L.hash}', 'Pat PMO', 'PMO_ADMIN', 'BASIC', '${L.orgA}', false),
  ('${L.ownerA}', 'owner@acme.test', '${L.hash}', 'Owen Owner', 'WORKSPACE_OWNER', 'BASIC', '${L.orgA}', false),
  ('${L.userA}', 'Noma.Odigie@acme.test', '${L.hash}', 'Noma', 'USER', 'BASIC', '${L.orgA}', false),
  ('${L.noOrg}', 'loner@nowhere.test', '${L.hash}', 'Lone', 'USER', 'BASIC', NULL, false);
INSERT INTO workspace_members (user_id, workspace_id, org_id, role) VALUES
  ('${L.orgAdminA}', '${L.wsA1}', '${L.orgA}', 'PMO_ADMIN'),
  ('${L.pmoAdminA}', '${L.wsA1}', '${L.orgA}', 'PMO_ADMIN'),
  ('${L.ownerA}', '${L.wsA1}', '${L.orgA}', 'WORKSPACE_OWNER'),
  ('${L.userA}', '${L.wsA1}', '${L.orgA}', 'USER'),
  ('${L.legacyAdminB}', '${L.wsB1}', '${L.orgB}', 'PMO_ADMIN');
INSERT INTO resources (id, workspace_id, name, role, type, department, team_id, capacity, total_capacity, email, skills, craft_profile) VALUES
  ('r1', '${L.wsA1}', 'Noma Odigie', 'Scrum Master', 'Permanent', 'PMO', 't1', 100, 100, 'noma.odigie@acme.test', '{Agile,Jira}',
   '{"primaryCraft":"scrum-master","secondaryCrafts":[{"craftId":"business-analysis","proficiency":2,"maxPct":30}],"tribeAffinity":["Payments","Lending "],"targetUtil":90}'),
  ('r2', '${L.wsA1}', 'Tom Hayes', 'Chapter Lead', 'Permanent', 'PMO', 't4', 100, 100, NULL, '{}',
   '{"primaryCraft":"project-mgmt","secondaryCrafts":[],"tribeAffinity":[]}'),
  ('r3', '${L.wsA1}', 'Custom Crafter', 'Analyst', 'Contractor', 'PMO', 't9', 100, 100, NULL, '{}',
   '{"primaryCraft":"legacy-custom-craft"}'),
  ('rb1', '${L.wsB1}', 'Beta Person', 'PM', 'Permanent', 'PMO', 't1', 100, 100, NULL, '{}', '{}');
INSERT INTO projects (id, workspace_id, name, status, priority, client_name, stage, craft_demand, jira_key, planview_id, start_date, end_date) VALUES
  ('p1', '${L.wsA1}', 'Phoenix', 'Active', 'High', 'payments', 'In Flight',
   '[{"quarterKey":"2026-Q4","craftId":"scrum-master","fte":1},{"quarterKey":"2026-Q4","craftId":"scrum-master","fte":0.5},{"quarterKey":"2027-Q1","craftId":"project-mgmt","fte":2,"note":"ramp"}]',
   'PHX', NULL, '2026-10-01', '2027-06-30'),
  ('p2', '${L.wsA1}', 'Ledger', 'Planning', 'Medium', 'Lending', 'Pipeline',
   '[{"quarterKey":"2027-Q1","craftId":"business-analysis","fte":1},{"quarterKey":"bad","craftId":"x","fte":1}]', NULL, 'PV-9', NULL, NULL),
  ('p3', '${L.wsA1}', 'No Tribe', 'Active', 'Low', NULL, NULL, '[]', NULL, NULL, NULL, NULL),
  ('pb1', '${L.wsB1}', 'Beta Project', 'Active', 'Low', 'Payments', 'Initiated', '[]', NULL, NULL, NULL, NULL);
INSERT INTO allocations (id, workspace_id, resource_id, project_id, percentage, start_date, end_date, craft_id, source) VALUES
  ('a1', '${L.wsA1}', 'r1', 'p1', 35, '2026-10-01', '2026-12-31', 'scrum-master', NULL),
  ('a2', '${L.wsA1}', 'r2', 'p2', 50, NULL, NULL, NULL, 'planview'),
  ('ab1', '${L.wsB1}', 'rb1', 'pb1', 100, NULL, NULL, NULL, NULL);
INSERT INTO audit_logs (user_id, action, ip_address, details) VALUES
  ('${L.orgAdminA}', 'LOGIN', '10.0.0.1', '{"plan":"PRO"}'),
  ('${L.userA}', 'SOMETHING_ELSE', NULL, NULL);
INSERT INTO workspace_integrations (workspace_id, provider, config) VALUES
  ('${L.wsA1}', 'settings', '{"calibration":{"*":{"pointsPerSprintPerFte":10,"sprintLengthDays":14},"Payments":{"pointsPerSprintPerFte":12,"sprintLengthDays":10}},"mappings":{"jira":{"PHX":"p1"},"planview":{"PV-9":"p2"}}}');
INSERT INTO qbr_tribes (org_id, workspace_id, name) VALUES ('${L.orgA}', '${L.wsA1}', 'Digital Experience');
INSERT INTO otps (email, otp, expires_at, attempts) VALUES ('admin@acme.test', '123456', ${Date.now() + 600000}, 0);
`);
}
