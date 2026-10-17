/**
 * PL-02, AC-01, ORG-01, DM-01, JI-02/PV-03, AC-10#AC5: migrations apply to an empty DB and to a v1.1-shaped DB,
 * are idempotent, backfill the new model, and never change a legacy value.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';
import { PgliteDb } from './helpers/pglite';
import { LEGACY, PRE_BASELINE_SQL, seedLegacyData } from './helpers/legacyFixture';
import {
  MIGRATIONS,
  REQUIRED_SCHEMA_VERSION,
  applyPending,
  currentSchemaVersion,
  dryRun,
  ensureSchema,
  resetSchemaCheck,
  parseMigrations,
  appliedMigrations,
  modifiedMigrations,
  MIGRATION_LOCK_KEY,
} from '../../netlify/functions/_lib/migrate';
import { MIGRATION_FILES } from '../../netlify/functions/_lib/migrations.generated';

process.env.LOG_LEVEL = 'silent';

const ROOT = join(__dirname, '..', '..');

describe('migration files', () => {
  it('the embedded copy matches migrations/*.sql exactly', () => {
    const files = readdirSync(join(ROOT, 'migrations'))
      .filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f))
      .sort();
    expect(MIGRATION_FILES.map((m) => m.file)).toEqual(files);
    for (const m of MIGRATION_FILES) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed repo directory
      expect(m.sql).toBe(readFileSync(join(ROOT, 'migrations', m.file), 'utf8'));
    }
  });

  it('are numbered 0001..0009 and additive (no DROP TABLE / DROP COLUMN / legacy CHECK changes)', () => {
    expect(MIGRATIONS.map((m) => m.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(REQUIRED_SCHEMA_VERSION).toBe(9);
    for (const m of MIGRATIONS) {
      const sql = m.sql.replace(/--.*$/gm, '');
      expect(sql).not.toMatch(/DROP\s+TABLE/i);
      expect(sql).not.toMatch(/DROP\s+COLUMN/i);
      expect(sql).not.toMatch(/DROP\s+CONSTRAINT\s+(users_role_check|users_plan_check|workspace_members_role_check)/i);
      expect(sql).not.toMatch(/ALTER\s+COLUMN\s+\w+\s+TYPE/i);
    }
  });

  it('rejects bad names and duplicate versions', () => {
    expect(() => parseMigrations([{ file: 'x.sql', sql: '' }])).toThrow(/Bad migration/);
    expect(() =>
      parseMigrations([
        { file: '0001_a.sql', sql: '' },
        { file: '0001_b.sql', sql: '' },
      ]),
    ).toThrow(/Duplicate/);
  });
});

describe('empty database', () => {
  let db: PgliteDb;
  beforeAll(async () => {
    db = new PgliteDb();
  });
  afterAll(() => db.close());

  it('applies every migration, records them, and a second run applies nothing', async () => {
    const first = await db.session((s) => applyPending(s));
    expect(first.applied).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(await currentSchemaVersion(db)).toBe(9);
    const second = await db.session((s) => applyPending(s));
    expect(second.applied).toEqual([]);
    expect(second.lockAcquired).toBe(true);
  });

  it('re-running every file again changes nothing (idempotent SQL)', async () => {
    const before = await db.query(`SELECT count(*)::int AS n FROM crafts`);
    for (const m of MIGRATIONS) await db.session((s) => s.exec(m.sql));
    const after = await db.query(`SELECT count(*)::int AS n FROM crafts`);
    expect(after).toEqual(before);
  });

  it('releases the advisory lock after applying', async () => {
    const rows = await db.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [MIGRATION_LOCK_KEY]);
    expect(rows[0].ok).toBe(true);
    await db.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
  });

  it('reports modified migrations by checksum', async () => {
    const applied = await appliedMigrations(db);
    const changed = MIGRATIONS.map((m) => (m.version === 3 ? { ...m, checksum: 'different' } : m));
    expect(modifiedMigrations(applied, changed).map((m) => m.version)).toEqual([3]);
  });
});

describe('ensureSchema (auto-apply on first use)', () => {
  it('applies pending migrations once and memoises', async () => {
    const db = new PgliteDb();
    resetSchemaCheck();
    await Promise.all([ensureSchema(db), ensureSchema(db), ensureSchema(db)]);
    expect(await currentSchemaVersion(db)).toBe(REQUIRED_SCHEMA_VERSION);
    const count = db.statements.filter((s) => s.startsWith('INSERT INTO schema_migrations')).length;
    expect(count).toBe(MIGRATIONS.length);
    db.statements.length = 0;
    await ensureSchema(db);
    expect(db.statements).toHaveLength(0);
    resetSchemaCheck();
    await db.close();
  });

  it('answers 503 migration_pending when applying fails, and retries on the next call', async () => {
    const db = new PgliteDb();
    resetSchemaCheck();
    await db.pg.exec('CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT)'); // incompatible legacy shape
    await expect(ensureSchema(db)).rejects.toMatchObject({ status: 503, code: 'migration_pending' });
    await db.pg.exec('DROP TABLE resources');
    await expect(ensureSchema(db)).resolves.toBeUndefined();
    resetSchemaCheck();
    await db.close();
  });

  it('a failed migration leaves no partial state for that version', async () => {
    const db = new PgliteDb();
    const broken = parseMigrations([
      { file: '0001_ok.sql', sql: 'CREATE TABLE IF NOT EXISTS t_ok (id int);' },
      { file: '0002_bad.sql', sql: 'CREATE TABLE t_half (id int); SELECT * FROM missing_table;' },
    ]);
    await expect(db.session((s) => applyPending(s, { migrations: broken }))).rejects.toThrow();
    const applied = await appliedMigrations(db);
    expect([...applied.keys()]).toEqual([1]);
    const half = await db.query(`SELECT to_regclass('t_half') AS t`);
    expect(half[0].t).toBeNull();
    await db.close();
  });

  // No database at all (QA round 2 saw this flake at Jest's 5 s default while PGlite started on a loaded runner): a
  // stub session whose advisory lock is always taken elsewhere, a 50 ms wait and an explicit budget.
  it('gives up waiting for a lock held elsewhere without applying', async () => {
    let calls = 0;
    const statements: string[] = [];
    const stub = {
      query: async (text: string) => {
        statements.push(text);
        if (text.includes('pg_try_advisory_lock')) {
          calls += 1;
          return [{ ok: false }] as never;
        }
        return [] as never;
      },
      exec: async (text: string) => {
        statements.push(text);
      },
    };
    const started = Date.now();
    const result = await applyPending(stub, { lockWaitMs: 50 });
    expect(result.lockAcquired).toBe(false);
    expect(result.applied).toEqual([]);
    expect(calls).toBeGreaterThan(1);
    // Nothing but lock attempts: no schema table, no migration, and no unlock of a lock it never held.
    expect(statements.every((t) => t.includes('pg_try_advisory_lock'))).toBe(true);
    expect(Date.now() - started).toBeLessThan(2000);
  }, 15_000);
});

describe('auto-migration inside the function time limit (QA-011)', () => {
  /** A clock that moves `step` ms every time it is read: every file "takes" longer than the budget. */
  const slowClock = (step: number) => {
    let t = 0;
    return () => (t += step);
  };
  const files = (n: number) =>
    parseMigrations(
      Array.from({ length: n }, (_, i) => ({
        file: `${String(i + 1).padStart(4, '0')}_step_${i + 1}.sql`,
        sql: `CREATE TABLE IF NOT EXISTS qa011_step_${i + 1} (id int);`,
      })),
    );
  const advisoryLocks = async (db: PgliteDb) =>
    Number((await db.query(`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory'`))[0].n);

  it('applies one file per invocation when files are slow, persisting progress in schema_migrations', async () => {
    const db = new PgliteDb();
    const all = files(3);
    const opts = { migrations: all, budgetMs: 4000, hardLimitMs: 8000 };
    const r1 = await db.session((s) => applyPending(s, { ...opts, now: slowClock(5000) }));
    expect(r1).toMatchObject({ applied: [1], remaining: 2, lockAcquired: true });
    expect([...(await appliedMigrations(db)).keys()]).toEqual([1]);
    const r2 = await db.session((s) => applyPending(s, { ...opts, now: slowClock(5000) }));
    expect(r2).toMatchObject({ applied: [2], remaining: 1 });
    const r3 = await db.session((s) => applyPending(s, { ...opts, now: slowClock(5000) }));
    expect(r3).toMatchObject({ applied: [3], remaining: 0 });
    expect(await advisoryLocks(db)).toBe(0);
    await db.close();
  });

  it('applies everything in one invocation when it fits the budget', async () => {
    const db = new PgliteDb();
    const r = await db.session((s) => applyPending(s, { migrations: files(4), budgetMs: 4000, now: slowClock(10) }));
    expect(r).toMatchObject({ applied: [1, 2, 3, 4], remaining: 0 });
    await db.close();
  });

  it('runs each file under a statement_timeout of what is left before the hard limit', async () => {
    const db = new PgliteDb();
    await db.session((s) => applyPending(s, { migrations: files(1), hardLimitMs: 8000, now: slowClock(500) }));
    expect(db.statements.find((t) => t.startsWith('SET LOCAL statement_timeout'))).toBe(
      'SET LOCAL statement_timeout = 7500',
    );
    await db.close();
  });

  it('a file that hits the statement timeout is rolled back and the lock is still released', async () => {
    const db = new PgliteDb();
    const slow = parseMigrations([
      { file: '0001_ok.sql', sql: 'CREATE TABLE IF NOT EXISTS qa011_ok (id int);' },
      {
        file: '0002_slow.sql',
        sql: "CREATE TABLE qa011_slow (id int); DO $$ BEGIN RAISE EXCEPTION 'canceling statement due to statement timeout' USING ERRCODE = 'query_canceled'; END $$;",
      },
    ]);
    await expect(db.session((s) => applyPending(s, { migrations: slow, hardLimitMs: 8000 }))).rejects.toMatchObject({
      code: '57014',
    });
    expect([...(await appliedMigrations(db)).keys()]).toEqual([1]);
    expect((await db.query(`SELECT to_regclass('qa011_slow') AS t`))[0].t).toBeNull();
    expect(db.statements.filter((t) => t.includes('pg_advisory_unlock'))).toHaveLength(1);
    expect(await advisoryLocks(db)).toBe(0);
    await db.close();
  });

  it('ensureSchema answers migration_pending while files are left and resolves once the last one is applied', async () => {
    const db = new PgliteDb();
    resetSchemaCheck();
    const all = files(3);
    const opts = { migrations: all, budgetMs: 4000, hardLimitMs: 8000 };
    const outcomes: string[] = [];
    for (let i = 0; i < 5; i++) {
      outcomes.push(
        await ensureSchema(db, { ...opts, now: slowClock(5000) }).then(
          () => 'ok',
          (e: { code?: string }) => e.code ?? 'error',
        ),
      );
    }
    expect(outcomes).toEqual(['migration_pending', 'migration_pending', 'ok', 'ok', 'ok']);
    expect([...(await appliedMigrations(db)).keys()]).toEqual([1, 2, 3]);
    expect(await advisoryLocks(db)).toBe(0);
    resetSchemaCheck();
    await db.close();
  });
});

describe('v1.1 production-shaped database', () => {
  let db: PgliteDb;
  const hash = bcrypt.hashSync('correct horse battery', 4);
  let legacySnapshot: Record<string, unknown[]>;

  const legacyQueries: Record<string, string> = {
    users: 'SELECT id, email, password_hash, role, plan, org_id, name, two_factor_enabled FROM users ORDER BY id',
    workspace_members:
      'SELECT user_id, workspace_id, org_id, role FROM workspace_members ORDER BY user_id, workspace_id',
    resources:
      'SELECT id, workspace_id, name, role, type, team_id, capacity, total_capacity, email, skills, craft_profile FROM resources ORDER BY id',
    projects:
      'SELECT id, workspace_id, name, status, priority, client_name, stage, craft_demand::text, jira_key, planview_id, start_date::text, end_date::text FROM projects ORDER BY id',
    allocations:
      'SELECT id, workspace_id, resource_id, project_id, percentage, start_date::text, end_date::text, craft_id, source FROM allocations ORDER BY id',
    organizations: 'SELECT id, name, slug, logo_url FROM organizations ORDER BY id',
    workspaces: 'SELECT id, org_id, name FROM workspaces ORDER BY id',
    integrations: 'SELECT workspace_id, provider, config::text FROM workspace_integrations ORDER BY workspace_id',
  };

  beforeAll(async () => {
    db = new PgliteDb();
    await db.pg.exec(PRE_BASELINE_SQL);
    await db.session((s) => applyPending(s, { migrations: MIGRATIONS.slice(0, 1) }));
    await db.session((s) => seedLegacyData(s, hash));
    legacySnapshot = {};
    for (const [k, q] of Object.entries(legacyQueries)) legacySnapshot[k] = await db.query(q);
  });
  afterAll(() => db.close());

  it('dry run reports the planned backfill and changes nothing', async () => {
    const report = await db.session((s) => dryRun(s));
    expect(report.pending.map((p) => p.version)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    expect(report.counts['org_memberships'].after).toBe(6);
    expect(report.counts['users.is_platform_admin'].after).toBe(1);
    expect(report.counts['workspace_members.access_role'].after).toBe(5);
    expect(report.counts['tribes'].after).toBeGreaterThanOrEqual(3);
    const acme = report.perOrg.find((o) => o.org_id === LEGACY.orgA);
    expect(acme).toMatchObject({ org_admins: 2, plan: 'MAX', projects_without_tribe: 1 });
    expect(await currentSchemaVersion(db)).toBe(1);
    expect((await db.query(`SELECT to_regclass('org_memberships') AS t`))[0].t).toBeNull();
  });

  it('applies the remaining migrations', async () => {
    resetSchemaCheck();
    await ensureSchema(db);
    expect(await currentSchemaVersion(db)).toBe(REQUIRED_SCHEMA_VERSION);
    // 0009 (QA-034): the seeded PgM / PdM codes follow the form rule (2-4 capitals or digits).
    const shorts = await db.query<{ short: string }>(
      `SELECT DISTINCT short FROM crafts WHERE id IN ('programme-mgmt', 'product-mgmt')`,
    );
    expect(shorts.map((r) => r.short).sort()).toEqual(['PDM', 'PGM']);
    resetSchemaCheck();
  });

  it('leaves every legacy column byte-identical (AC-01#AC4)', async () => {
    for (const [k, q] of Object.entries(legacyQueries)) expect([k, await db.query(q)]).toEqual([k, legacySnapshot[k]]);
  });

  it('backfills platform admin, org memberships and workspace roles (AC-01#AC2)', async () => {
    const admins = await db.query(`SELECT id FROM users WHERE is_platform_admin`);
    expect(admins.map((r) => r.id)).toEqual([LEGACY.superuser]);
    const om = await db.query<{ user_id: string; role: string }>(
      `SELECT user_id, role FROM org_memberships ORDER BY user_id`,
    );
    const roles = Object.fromEntries(om.map((r) => [r.user_id, r.role]));
    expect(roles).toEqual({
      [LEGACY.superuser]: 'ORG_ADMIN',
      [LEGACY.orgAdminA]: 'ORG_ADMIN',
      [LEGACY.legacyAdminB]: 'ORG_ADMIN',
      [LEGACY.pmoAdminA]: 'MEMBER',
      [LEGACY.ownerA]: 'MEMBER',
      [LEGACY.userA]: 'MEMBER',
    });
    const wm = await db.query<{ user_id: string; access_role: string }>(
      `SELECT user_id, access_role FROM workspace_members WHERE workspace_id = $1`,
      [LEGACY.wsA1],
    );
    const ws = Object.fromEntries(wm.map((r) => [r.user_id, r.access_role]));
    expect(ws[LEGACY.pmoAdminA]).toBe('WORKSPACE_ADMIN');
    expect(ws[LEGACY.ownerA]).toBe('PLANNER');
    expect(ws[LEGACY.userA]).toBe('VIEWER');
    const unverified = await db.query(`SELECT id FROM users WHERE email_verified_at IS NULL`);
    expect(unverified).toHaveLength(0);
  });

  it('backfills organisation plan, features and visibility (PL-07#AC1, SH-05#AC1, AC-09#AC1)', async () => {
    const orgs = await db.query<{ id: string; plan: string; v: string }>(
      `SELECT id, plan, default_workspace_visibility AS v, features FROM organizations ORDER BY id`,
    );
    expect(orgs.map((o) => [o.id, o.plan, o.v])).toEqual([
      [LEGACY.orgA, 'MAX', 'org'],
      [LEGACY.orgB, 'BASIC', 'org'],
    ]);
  });

  it('creates crafts with unchanged ids, tribes from client names, teams and links (ORG-01)', async () => {
    const crafts = await db.query<{ id: string }>(`SELECT id FROM crafts WHERE org_id = $1 ORDER BY sort_order, id`, [
      LEGACY.orgA,
    ]);
    expect(crafts.map((c) => c.id)).toEqual(
      expect.arrayContaining(['programme-mgmt', 'tooling-admin', 'legacy-custom-craft']),
    );
    expect(crafts).toHaveLength(14); // 12 PMO crafts + 2 ids referenced by legacy data
    const tribes = await db.query<{ name: string }>(`SELECT name FROM tribes WHERE org_id = $1 ORDER BY lower(name)`, [
      LEGACY.orgA,
    ]);
    expect(tribes.map((t) => t.name.toLowerCase())).toEqual(['digital experience', 'lending', 'payments']);
    const p1 = await db.query<{ tribe_id: string; name: string }>(
      `SELECT p.tribe_id, t.name FROM projects p JOIN tribes t ON t.id = p.tribe_id WHERE p.id = 'p1'`,
    );
    expect(p1[0].name.toLowerCase()).toBe('payments');
    const r1 = await db.query<{ tribe_affinity_ids: string[]; home_tribe_id: string; linked_user_id: string }>(
      `SELECT tribe_affinity_ids, home_tribe_id, linked_user_id FROM resources WHERE id = 'r1'`,
    );
    expect(r1[0].tribe_affinity_ids).toHaveLength(2);
    expect(r1[0].home_tribe_id).toBe(r1[0].tribe_affinity_ids[0]);
    expect(r1[0].linked_user_id).toBe(LEGACY.userA);
    const teams = await db.query(`SELECT org_id, id, name FROM org_teams ORDER BY org_id, id`);
    expect(teams).toEqual([
      { org_id: LEGACY.orgA, id: 't1', name: 'Programme Management' },
      { org_id: LEGACY.orgA, id: 't4', name: 'Delivery' },
      { org_id: LEGACY.orgA, id: 't9', name: 't9' },
      { org_id: LEGACY.orgB, id: 't1', name: 'Programme Management' },
    ]);
    const pv = await db.query(`SELECT source FROM projects WHERE id = 'p2'`);
    expect(pv[0].source).toBe('planview');
  });

  it('creates demand lines from craft_demand, summing duplicates (DM-01#AC1)', async () => {
    const lines = await db.query(
      `SELECT project_id, quarter_key, craft_id, fte::float AS fte, status, note FROM demand_lines ORDER BY project_id, quarter_key`,
    );
    expect(lines).toEqual([
      { project_id: 'p1', quarter_key: '2026-Q4', craft_id: 'scrum-master', fte: 1.5, status: 'Confirmed', note: null },
      { project_id: 'p1', quarter_key: '2027-Q1', craft_id: 'project-mgmt', fte: 2, status: 'Confirmed', note: 'ramp' },
      {
        project_id: 'p2',
        quarter_key: '2027-Q1',
        craft_id: 'business-analysis',
        fte: 1,
        status: 'Forecast',
        note: null,
      },
    ]);
  });

  it('copies LOGIN audit rows, mappings and calibration (AC-10#AC5, JI-02#AC4, ORG-01#AC7)', async () => {
    const ev = await db.query(`SELECT action, actor_user_id, ip FROM audit_events`);
    expect(ev).toEqual([{ action: 'auth.login', actor_user_id: LEGACY.orgAdminA, ip: '10.0.0.1' }]);
    const maps = await db.query(
      `SELECT provider, external_key, project_id, confirmed FROM integration_mappings ORDER BY provider`,
    );
    expect(maps).toEqual([
      { provider: 'jira', external_key: 'PHX', project_id: 'p1', confirmed: true },
      { provider: 'planview', external_key: 'PV-9', project_id: 'p2', confirmed: true },
    ]);
    const cal = await db.query(
      `SELECT c.points_per_sprint_per_fte::float AS pps, c.sprint_length_days AS sld, lower(t.name) AS tribe
       FROM tribe_calibrations c JOIN tribes t ON t.id = c.tribe_id`,
    );
    expect(cal).toEqual([{ pps: 12, sld: 10, tribe: 'payments' }]);
  });

  it('allows org-scoped team ids now that the legacy teams FK is relaxed', async () => {
    await expect(db.query(`UPDATE resources SET team_id = 'brand-new-team' WHERE id = 'r2'`)).resolves.toBeDefined();
    await db.query(`UPDATE resources SET team_id = 't4' WHERE id = 'r2'`);
  });

  it('re-running all migration files changes no rows (AC-01#AC3)', async () => {
    const counts = async () =>
      db.query(`SELECT (SELECT count(*) FROM org_memberships) a, (SELECT count(*) FROM tribes) b,
                (SELECT count(*) FROM demand_lines) c, (SELECT count(*) FROM audit_events) d, (SELECT count(*) FROM crafts) e,
                (SELECT count(*) FROM org_teams) f, (SELECT count(*) FROM integration_mappings) g`);
    const before = await counts();
    for (const m of MIGRATIONS) await db.session((s) => s.exec(m.sql));
    expect(await counts()).toEqual(before);
    for (const [k, q] of Object.entries(legacyQueries)) expect([k, await db.query(q)]).toEqual([k, legacySnapshot[k]]);
  });
});
