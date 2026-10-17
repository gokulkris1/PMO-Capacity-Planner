/**
 * Handler test harness: a migrated PGlite database injected into `_lib/db`, seed helpers, and `call()` which
 * builds a Netlify HandlerEvent and returns status, JSON body, headers and Set-Cookie values.
 */
import type { Handler, HandlerEvent, HandlerResponse } from '@netlify/functions';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { PgliteDb } from './pglite';
import { setDb } from '../../../netlify/functions/_lib/db';
import { ensureSchema, resetSchemaCheck } from '../../../netlify/functions/_lib/migrate';
import { signSession, type UserRow } from '../../../netlify/functions/_lib/auth';
import { toLegacyWorkspaceRole } from '../../../shared/permissions';
import type { OrgRole, WorkspaceRole, Plan } from '../../../shared/contracts/dto';

export const JWT_SECRET = 'test-secret-value-for-jest-only';
export function testEnv(extra: Record<string, string> = {}): void {
  process.env.JWT_SECRET = JWT_SECRET;
  process.env.LOG_LEVEL = 'silent';
  process.env.CONTEXT = 'dev';
  process.env.INTEGRATIONS_ENC_KEY = Buffer.alloc(32, 7).toString('base64');
  delete process.env.RESEND_API_KEY;
  delete process.env.APP_MODE;
  delete process.env.ALLOW_PUBLIC_SIGNUP;
  delete process.env.ALLOWED_ORIGINS;
  Object.assign(process.env, extra);
}

export async function setupDb(): Promise<PgliteDb> {
  testEnv();
  const db = new PgliteDb();
  setDb(db);
  resetSchemaCheck();
  await ensureSchema(db);
  return db;
}

export async function teardownDb(db: PgliteDb): Promise<void> {
  setDb(null);
  resetSchemaCheck();
  await db.close();
}

// ── Seeding ─────────────────────────────────────────────────────────────────

export const PASSWORD = 'correct horse battery';
let cachedHash: string | null = null;
export function passwordHash(): string {
  if (!cachedHash) cachedHash = bcrypt.hashSync(PASSWORD, 4);
  return cachedHash;
}

export interface TestUser extends UserRow {
  token: string;
}

export async function createOrg(
  db: PgliteDb,
  name = 'Org',
  plan: Plan = 'ENTERPRISE',
  extra: Record<string, unknown> = {},
) {
  const id = randomUUID();
  await db.query(
    `INSERT INTO organizations (id, name, slug, plan, features, planning, default_workspace_visibility)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)`,
    [
      id,
      name,
      `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${id.slice(0, 6)}`,
      plan,
      JSON.stringify(extra.features ?? {}),
      JSON.stringify(extra.planning ?? {}),
      extra.visibility ?? 'org',
    ],
  );
  await db.query(
    `INSERT INTO crafts (org_id, id, name, short, sort_order) VALUES
     ($1, 'project-mgmt', 'Project Management', 'PM', 1), ($1, 'scrum-master', 'Scrum Master', 'SM', 2),
     ($1, 'business-analysis', 'Business Analysis', 'BA', 3)`,
    [id],
  );
  return id;
}

export async function createWorkspace(db: PgliteDb, orgId: string, name = 'Workspace') {
  const id = randomUUID();
  await db.query(`INSERT INTO workspaces (id, org_id, name) VALUES ($1, $2, $3)`, [id, orgId, name]);
  return id;
}

export async function createUser(
  db: PgliteDb,
  opts: {
    email?: string;
    name?: string;
    orgId?: string | null;
    orgRole?: OrgRole | null;
    platformAdmin?: boolean;
    verified?: boolean;
    twoFactor?: boolean;
    legacyRole?: string;
  } = {},
): Promise<TestUser> {
  const id = randomUUID();
  const email = (opts.email ?? `${id.slice(0, 8)}@test.example`).toLowerCase();
  const legacyRole =
    opts.legacyRole ?? (opts.platformAdmin ? 'SUPERUSER' : opts.orgRole === 'ORG_ADMIN' ? 'ORG_ADMIN' : 'USER');
  await db.query(
    `INSERT INTO users (id, email, password_hash, name, role, plan, org_id, is_platform_admin, email_verified_at, two_factor_enabled)
     VALUES ($1, $2, $3, $4, $5, 'BASIC', $6, $7, $8, $9)`,
    [
      id,
      email,
      passwordHash(),
      opts.name ?? email.split('@')[0],
      legacyRole,
      opts.orgId ?? null,
      !!opts.platformAdmin,
      opts.verified === false ? null : new Date().toISOString(),
      !!opts.twoFactor,
    ],
  );
  if (opts.orgId && opts.orgRole) {
    await db.query(`INSERT INTO org_memberships (org_id, user_id, role) VALUES ($1, $2, $3)`, [
      opts.orgId,
      id,
      opts.orgRole,
    ]);
  }
  const row = (
    await db.query<UserRow & Record<string, unknown>>(
      `SELECT id, email, name, role, plan, org_id, is_platform_admin, token_version, email_verified_at, two_factor_enabled FROM users WHERE id = $1`,
      [id],
    )
  )[0];
  return { ...row, token: signSession(row) };
}

export async function addMember(db: PgliteDb, userId: string, wsId: string, role: WorkspaceRole) {
  const ws = await db.query<{ org_id: string }>(`SELECT org_id FROM workspaces WHERE id = $1`, [wsId]);
  await db.query(
    `INSERT INTO workspace_members (user_id, workspace_id, org_id, role, access_role) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, workspace_id) DO UPDATE SET role = EXCLUDED.role, access_role = EXCLUDED.access_role`,
    [userId, wsId, ws[0].org_id, toLegacyWorkspaceRole(role), role],
  );
}

export async function createPerson(db: PgliteDb, wsId: string, extra: Record<string, unknown> = {}) {
  const id = (extra.id as string) ?? randomUUID();
  await db.query(
    `INSERT INTO resources (id, workspace_id, name, role, type, total_capacity, email, linked_user_id, craft_profile, skills)
     VALUES ($1, $2, $3, $4, 'Permanent', 100, $5, $6, $7::jsonb, '{}')`,
    [
      id,
      wsId,
      extra.name ?? 'Person',
      extra.role ?? 'Analyst',
      extra.email ?? null,
      extra.linkedUserId ?? null,
      JSON.stringify(extra.craftProfile ?? { primaryCraft: 'project-mgmt', secondaryCrafts: [] }),
    ],
  );
  return id;
}

export async function createProject(db: PgliteDb, wsId: string, extra: Record<string, unknown> = {}) {
  const id = (extra.id as string) ?? randomUUID();
  await db.query(
    `INSERT INTO projects (id, workspace_id, name, status, priority, start_date, end_date, tribe_id, source, planview_id)
     VALUES ($1, $2, $3, 'Active', 'Medium', $4, $5, $6, $7, $8)`,
    [
      id,
      wsId,
      extra.name ?? 'Project',
      extra.startDate ?? '2026-10-01',
      extra.endDate ?? '2027-09-30',
      extra.tribeId ?? null,
      extra.source ?? 'manual',
      extra.planviewId ?? null,
    ],
  );
  return id;
}

export async function createTribe(db: PgliteDb, orgId: string, name = 'Tribe') {
  const id = randomUUID();
  await db.query(`INSERT INTO tribes (id, org_id, name) VALUES ($1, $2, $3)`, [id, orgId, name]);
  return id;
}

// ── Calling handlers ────────────────────────────────────────────────────────

export interface CallOpts {
  body?: unknown;
  rawBody?: string;
  token?: string | null;
  cookies?: Record<string, string>;
  headers?: Record<string, string>;
  query?: Record<string, string>;
}

export interface CallResult {
  status: number;
  json: Record<string, unknown> & { code?: string; error?: string };
  body: string;
  headers: Record<string, string>;
  cookies: string[];
}

export async function call(handler: Handler, method: string, path: string, opts: CallOpts = {}): Promise<CallResult> {
  const [p, qs] = path.split('?');
  const query: Record<string, string> = { ...(opts.query ?? {}) };
  if (qs) for (const [k, v] of new URLSearchParams(qs)) query[k] = v;
  const headers: Record<string, string> = { host: 'app.test.example', ...(opts.headers ?? {}) };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.cookies)
    headers.cookie = Object.entries(opts.cookies)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('; ');
  if (opts.body !== undefined || opts.rawBody !== undefined) headers['content-type'] = 'application/json';
  const event = {
    httpMethod: method,
    path: p,
    headers,
    queryStringParameters: query,
    body: opts.rawBody ?? (opts.body === undefined ? null : JSON.stringify(opts.body)),
    isBase64Encoded: false,
  } as unknown as HandlerEvent;
  const res = (await handler(event, {} as never)) as HandlerResponse;
  let json: CallResult['json'] = {};
  try {
    json = res.body ? JSON.parse(res.body) : {};
  } catch {
    json = {};
  }
  const cookies = ((res.multiValueHeaders?.['Set-Cookie'] as string[] | undefined) ?? []).map(String);
  return {
    status: res.statusCode,
    json,
    body: res.body ?? '',
    headers: (res.headers ?? {}) as Record<string, string>,
    cookies,
  };
}

/** Cookie jar value from Set-Cookie lines. */
export function cookieValue(setCookies: string[], name: string): string | null {
  for (const c of setCookies) {
    const [pair] = c.split(';');
    const idx = pair.indexOf('=');
    if (pair.slice(0, idx) === name) return decodeURIComponent(pair.slice(idx + 1));
  }
  return null;
}
