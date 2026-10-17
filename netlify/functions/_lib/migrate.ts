/**
 * Migration runner (PL-02) used by both the functions (auto-apply on first use) and `npm run db:migrate`.
 *
 * Auto-apply design (production constraint: no maintenance window, nobody runs migrations by hand, and every
 * Netlify function invocation is killed after 10 s):
 * 1. The first request a function instance serves calls `ensureSchema()`. If `schema_migrations` already holds
 *    every version this build needs, nothing else happens (one cheap query per cold start).
 * 2. Otherwise it opens one dedicated connection and takes the Postgres advisory lock `MIGRATION_LOCK_KEY`
 *    (polling `pg_try_advisory_lock` for at most `AUTO_LOCK_WAIT_MS`). It re-reads the applied versions (another
 *    invocation may have finished meanwhile) and applies pending `migrations/NNNN_*.sql` files one at a time, each
 *    in its own transaction together with its `schema_migrations` row, so progress is persisted file by file.
 * 3. Time budget (QA-011): it always applies the first pending file, then starts another only while less than
 *    `AUTO_BUDGET_MS` has passed. Each file runs with `statement_timeout` set to what is left before
 *    `AUTO_HARD_LIMIT_MS`, so a slow file fails cleanly (rolled back, nothing recorded) instead of being cut off by
 *    the platform. Whatever is left is applied by the next invocations; the client retries on its own.
 * 4. The lock is released in a `finally` on every path. It is a session lock, so even a killed invocation cannot
 *    leave it held: Postgres drops it when the connection closes.
 * 5. Until the schema is current, requests answer 503 `migration_pending` (the app shows its maintenance state and
 *    retries with backoff). Every migration is additive and idempotent, so a retry after a failure is safe.
 */
import { createHash } from 'node:crypto';
import type { Db, Queryable, Session } from './db';
import { migrationPending } from './errors';
import { log, errorFields } from './log';
import { MIGRATION_FILES } from './migrations.generated';

export interface Migration {
  version: number;
  name: string;
  sql: string;
  checksum: string;
}

export const MIGRATION_LOCK_KEY = 7283110020;

export function checksumOf(sql: string): string {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');
}

export function parseMigrations(files: ReadonlyArray<{ file: string; sql: string }>): Migration[] {
  const out = files.map(({ file, sql }) => {
    const m = /^(\d{4})_([a-z0-9_]+)\.sql$/.exec(file);
    if (!m) throw new Error(`Bad migration file name: ${file}`);
    return { version: Number(m[1]), name: m[2], sql, checksum: checksumOf(sql) };
  });
  out.sort((a, b) => a.version - b.version);
  out.forEach((m, i) => {
    if (i > 0 && out[i - 1].version === m.version) throw new Error(`Duplicate migration version ${m.version}`);
  });
  return out;
}

export const MIGRATIONS: Migration[] = parseMigrations(MIGRATION_FILES);
export const REQUIRED_SCHEMA_VERSION = MIGRATIONS.length ? MIGRATIONS[MIGRATIONS.length - 1].version : 0;

const SCHEMA_TABLE_SQL = `CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`;

function isMissingRelation(e: unknown): boolean {
  const err = e as { code?: string; message?: string };
  return err?.code === '42P01' || /relation "?schema_migrations"? does not exist/i.test(err?.message ?? '');
}

export async function appliedMigrations(q: Queryable): Promise<Map<number, string>> {
  try {
    const rows = await q.query<{ version: number; checksum: string }>(
      'SELECT version, checksum FROM schema_migrations ORDER BY version',
    );
    return new Map(rows.map((r) => [Number(r.version), String(r.checksum)]));
  } catch (e) {
    if (isMissingRelation(e)) return new Map();
    throw e;
  }
}

export async function currentSchemaVersion(q: Queryable): Promise<number> {
  const applied = await appliedMigrations(q);
  let v = 0;
  for (const k of applied.keys()) v = Math.max(v, k);
  return v;
}

export function pendingMigrations(applied: Map<number, string>, all: Migration[] = MIGRATIONS): Migration[] {
  return all.filter((m) => !applied.has(m.version));
}

/** Applied migrations whose file content changed afterwards (PL-02#AC3). */
export function modifiedMigrations(applied: Map<number, string>, all: Migration[] = MIGRATIONS): Migration[] {
  return all.filter((m) => applied.has(m.version) && applied.get(m.version) !== m.checksum);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function acquireLock(s: Session, waitMs: number): Promise<boolean> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const rows = await s.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [MIGRATION_LOCK_KEY]);
    if (rows[0]?.ok === true) return true;
    if (Date.now() >= deadline) return false;
    await sleep(200);
  }
}

export async function releaseLock(s: Session): Promise<void> {
  await s.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => undefined);
}

async function applyOne(s: Session, m: Migration, statementTimeoutMs?: number): Promise<void> {
  await s.exec('BEGIN');
  try {
    // SET LOCAL lasts until COMMIT/ROLLBACK, so the dedicated connection is left as it was.
    if (statementTimeoutMs)
      await s.exec(`SET LOCAL statement_timeout = ${Math.max(1, Math.floor(statementTimeoutMs))}`);
    await s.exec(m.sql);
    await s.query('INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)', [
      m.version,
      m.name,
      m.checksum,
    ]);
    await s.exec('COMMIT');
  } catch (e) {
    await s.exec('ROLLBACK').catch(() => undefined);
    throw e;
  }
}

export interface ApplyResult {
  applied: number[];
  modified: number[];
  lockAcquired: boolean;
  /** Pending files left for a later invocation because the time budget ran out (0 when the schema is current). */
  remaining: number;
}

export interface ApplyOptions {
  lockWaitMs?: number;
  migrations?: Migration[];
  /** Start another file only while less than this has passed since the call (the first file always runs). */
  budgetMs?: number;
  /** Each file's statement_timeout is what is left of this (measured from the call); unset = no timeout. */
  hardLimitMs?: number;
  /** Tests: the clock. */
  now?: () => number;
}

/** Applies pending migrations under the advisory lock. Throws when a migration fails; the lock is always released. */
export async function applyPending(s: Session, opts: ApplyOptions = {}): Promise<ApplyResult> {
  const all = opts.migrations ?? MIGRATIONS;
  const now = opts.now ?? Date.now;
  const started = now();
  // Lock first: concurrent `CREATE TABLE IF NOT EXISTS` on a fresh database races in the catalog
  // (unique violation on pg_type_typname_nsp_index), which made concurrent cold starts answer 503.
  const locked = await acquireLock(s, opts.lockWaitMs ?? 7000);
  if (!locked) return { applied: [], modified: [], lockAcquired: false, remaining: -1 };
  try {
    await s.exec(SCHEMA_TABLE_SQL);
    const applied = await appliedMigrations(s);
    const pending = pendingMigrations(applied, all);
    const result: ApplyResult = {
      applied: [],
      modified: modifiedMigrations(applied, all).map((m) => m.version),
      lockAcquired: true,
      remaining: pending.length,
    };
    for (const m of pending) {
      const elapsed = now() - started;
      if (result.applied.length > 0 && opts.budgetMs !== undefined && elapsed >= opts.budgetMs) break;
      const t0 = now();
      const timeout = opts.hardLimitMs !== undefined ? Math.max(1000, opts.hardLimitMs - elapsed) : undefined;
      try {
        await applyOne(s, m, timeout);
      } catch (e) {
        const err = e as { code?: string };
        // 57014 = query_canceled (statement_timeout): this one file is too slow for a function invocation.
        if (err?.code === '57014') {
          log('error', {
            event: 'migration.too_slow',
            version: m.version,
            name: m.name,
            timeoutMs: timeout,
            hint: 'Run npm run db:migrate against the database to apply it without the function time limit.',
          });
        }
        throw e;
      }
      result.applied.push(m.version);
      result.remaining -= 1;
      log('info', { event: 'migration.applied', version: m.version, name: m.name, durationMs: now() - t0 });
    }
    if (result.remaining > 0) {
      log('info', { event: 'migration.deferred', remaining: result.remaining, elapsedMs: now() - started });
    }
    return result;
  } finally {
    await releaseLock(s);
  }
}

// ── Cold-start guard used by withApi ─────────────────────────────────────────

/** Auto-apply limits for one function invocation (Netlify kills it at 10 s). Overridable for tests and ops. */
export const AUTO_LOCK_WAIT_MS = 2000;
export const AUTO_BUDGET_MS = 4000;
export const AUTO_HARD_LIMIT_MS = 8000;

export interface EnsureOptions {
  lockWaitMs?: number;
  budgetMs?: number;
  hardLimitMs?: number;
  migrations?: Migration[];
  now?: () => number;
}

let autoOptions: EnsureOptions = {};

/** Tests only: the options `ensureSchema` uses when a function calls it without any (e.g. a slow-deploy clock). */
export function configureAutoMigration(opts: EnsureOptions | null): void {
  autoOptions = opts ?? {};
}

/** Expected while a deploy is migrating (lock held elsewhere, or budget used up): not an error. */
class PendingError extends Error {}

let ready: Promise<void> | null = null;

/**
 * Resolves when the schema is at REQUIRED_SCHEMA_VERSION. Otherwise applies as many pending migrations as fit in
 * this invocation's budget and rejects with 503 `migration_pending` while any are left (the next request carries
 * on). Memoised per instance once the schema is current.
 */
export function ensureSchema(db: Db, options: EnsureOptions = {}): Promise<void> {
  if (!ready) {
    const opts = { ...autoOptions, ...options };
    const all = opts.migrations ?? MIGRATIONS;
    ready = (async () => {
      const applied = await appliedMigrations(db);
      const modified = modifiedMigrations(applied, all);
      if (modified.length) {
        log('error', { event: 'migration.modified', versions: modified.map((m) => m.version) });
      }
      if (pendingMigrations(applied, all).length === 0) return;
      const result = await db.session((s) =>
        applyPending(s, {
          migrations: all,
          lockWaitMs: opts.lockWaitMs ?? AUTO_LOCK_WAIT_MS,
          budgetMs: opts.budgetMs ?? AUTO_BUDGET_MS,
          hardLimitMs: opts.hardLimitMs ?? AUTO_HARD_LIMIT_MS,
          now: opts.now,
        }),
      );
      if (!result.lockAcquired) throw new PendingError('Migration lock is held by another invocation');
      if (result.remaining > 0) throw new PendingError(`${result.remaining} migration(s) left for the next request`);
      const after = await appliedMigrations(db);
      if (pendingMigrations(after, all).length) throw new Error('Migrations still pending after apply');
    })().catch((e: unknown) => {
      ready = null;
      if (e instanceof PendingError) log('info', { event: 'migration.pending', reason: e.message });
      else log('error', { event: 'migration.failed', err: errorFields(e) });
      throw migrationPending();
    });
  }
  return ready;
}

/** Tests only: forget the memoised result so the next call checks again. */
export function resetSchemaCheck(): void {
  ready = null;
}

// ── Dry run (PL-02#AC1, AC-01#AC1) ───────────────────────────────────────────

/** Queries run before and after each pending migration inside the rolled-back transaction. */
export const DRY_RUN_PROBES: Record<string, string> = {
  users: 'SELECT count(*)::int AS n FROM users',
  'users.is_platform_admin': 'SELECT count(*)::int AS n FROM users WHERE is_platform_admin',
  'users.email_verified_at': 'SELECT count(*)::int AS n FROM users WHERE email_verified_at IS NOT NULL',
  org_memberships: 'SELECT count(*)::int AS n FROM org_memberships',
  'org_memberships.ORG_ADMIN': "SELECT count(*)::int AS n FROM org_memberships WHERE role = 'ORG_ADMIN'",
  workspace_members: 'SELECT count(*)::int AS n FROM workspace_members',
  'workspace_members.access_role': 'SELECT count(*)::int AS n FROM workspace_members WHERE access_role IS NOT NULL',
  organizations: 'SELECT count(*)::int AS n FROM organizations',
  'organizations.plan': 'SELECT count(*)::int AS n FROM organizations WHERE plan IS NOT NULL',
  workspaces: 'SELECT count(*)::int AS n FROM workspaces',
  resources: 'SELECT count(*)::int AS n FROM resources',
  'resources.linked_user_id': 'SELECT count(*)::int AS n FROM resources WHERE linked_user_id IS NOT NULL',
  'resources.tribe_affinity_ids': 'SELECT count(*)::int AS n FROM resources WHERE tribe_affinity_ids IS NOT NULL',
  projects: 'SELECT count(*)::int AS n FROM projects',
  'projects.tribe_id': 'SELECT count(*)::int AS n FROM projects WHERE tribe_id IS NOT NULL',
  'projects.without_tribe': 'SELECT count(*)::int AS n FROM projects WHERE tribe_id IS NULL',
  allocations: 'SELECT count(*)::int AS n FROM allocations',
  crafts: 'SELECT count(*)::int AS n FROM crafts',
  tribes: 'SELECT count(*)::int AS n FROM tribes',
  org_teams: 'SELECT count(*)::int AS n FROM org_teams',
  demand_lines: 'SELECT count(*)::int AS n FROM demand_lines',
  audit_events: 'SELECT count(*)::int AS n FROM audit_events',
  integration_mappings: 'SELECT count(*)::int AS n FROM integration_mappings',
  tribe_calibrations: 'SELECT count(*)::int AS n FROM tribe_calibrations',
};

const PER_ORG_PROBE = `SELECT o.id::text AS org_id, o.name,
  (SELECT count(*)::int FROM users u WHERE u.org_id = o.id) AS users,
  (SELECT count(*)::int FROM org_memberships m WHERE m.org_id = o.id AND m.role = 'ORG_ADMIN') AS org_admins,
  (SELECT count(*)::int FROM org_memberships m WHERE m.org_id = o.id AND m.role = 'MEMBER') AS members,
  (SELECT count(*)::int FROM workspace_members wm WHERE wm.org_id = o.id AND wm.access_role = 'WORKSPACE_ADMIN') AS ws_admins,
  (SELECT count(*)::int FROM workspace_members wm WHERE wm.org_id = o.id AND wm.access_role = 'PLANNER') AS planners,
  (SELECT count(*)::int FROM workspace_members wm WHERE wm.org_id = o.id AND wm.access_role = 'VIEWER') AS viewers,
  (SELECT count(*)::int FROM tribes t WHERE t.org_id = o.id) AS tribes,
  (SELECT count(*)::int FROM org_teams t WHERE t.org_id = o.id) AS teams,
  (SELECT count(*)::int FROM resources r JOIN workspaces w ON w.id = r.workspace_id
     WHERE w.org_id = o.id AND r.linked_user_id IS NOT NULL) AS people_linked,
  (SELECT count(*)::int FROM projects p JOIN workspaces w ON w.id = p.workspace_id
     WHERE w.org_id = o.id AND p.tribe_id IS NULL) AS projects_without_tribe,
  o.plan
FROM organizations o ORDER BY o.name`;

async function probe(s: Session, text: string): Promise<number | null> {
  await s.exec('SAVEPOINT probe');
  try {
    const rows = await s.query<{ n: number }>(text);
    await s.exec('RELEASE SAVEPOINT probe');
    return Number(rows[0]?.n ?? 0);
  } catch {
    await s.exec('ROLLBACK TO SAVEPOINT probe');
    return null;
  }
}

export interface DryRunReport {
  pending: Array<{ version: number; name: string }>;
  modified: number[];
  counts: Record<string, { before: number | null; after: number | null }>;
  perOrg: Array<Record<string, unknown>>;
}

/** Applies every pending migration inside ONE transaction that is always rolled back; reports the effect. */
export async function dryRun(s: Session, all: Migration[] = MIGRATIONS): Promise<DryRunReport> {
  const applied = await appliedMigrations(s);
  const pending = pendingMigrations(applied, all);
  const report: DryRunReport = {
    pending: pending.map((m) => ({ version: m.version, name: m.name })),
    modified: modifiedMigrations(applied, all).map((m) => m.version),
    counts: {},
    perOrg: [],
  };
  await s.exec('BEGIN');
  try {
    for (const [k, text] of Object.entries(DRY_RUN_PROBES))
      report.counts[k] = { before: await probe(s, text), after: null };
    for (const m of pending) await s.exec(m.sql);
    for (const [k, text] of Object.entries(DRY_RUN_PROBES)) report.counts[k].after = await probe(s, text);
    await s.exec('SAVEPOINT per_org');
    try {
      report.perOrg = await s.query(PER_ORG_PROBE);
    } catch {
      await s.exec('ROLLBACK TO SAVEPOINT per_org');
    }
  } finally {
    await s.exec('ROLLBACK');
  }
  return report;
}
