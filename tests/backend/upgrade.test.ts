/**
 * Upgrade proof (package I, PL-14, AC-01#AC3–4, AC-03#AC1–2, §6.3 checklist 1–3): a database shaped exactly like
 * v1.1 production (rebuilt from the scripts that created it, see helpers/v11Production.ts) is opened by the 2.0
 * functions the way production will open it after deploy — the first request runs the auto-migration — and then:
 *
 *  - every existing user signs in through the real 2.0 login handler with the same email and password and gets a
 *    session (cookie + token); the 2FA user signs in with the emailed code;
 *  - a v1.1 bearer token (same JWT_SECRET, no `tv` claim) is accepted and can be exchanged for a cookie session;
 *  - `/api/v2/me` and the workspace snapshot return the migrated people, projects, allocations and demand;
 *  - the v1.1 columns are byte-identical (parity report "0 rows lost, 0 credential changes");
 *  - writes work on migrated rows and on the legacy table shapes (no id defaults, TEXT dates);
 *  - running the migrations again is a no-op; concurrent cold starts are safe (real PostgreSQL, when available).
 *
 * Runs on PGlite always and, when a PostgreSQL server is available (local initdb or UPGRADE_TEST_PG_URL), on real
 * PostgreSQL too (the engine Neon runs).
 */
import jwt from 'jsonwebtoken';
import { handler as auth } from '../../netlify/functions/auth';
import { handler as v2 } from '../../netlify/functions/v2';
import { handler as qbr } from '../../netlify/functions/qbr';
import { handler as workspaceFn } from '../../netlify/functions/workspace';
import { handler as health } from '../../netlify/functions/health';
import { setDb, type Db } from '../../netlify/functions/_lib/db';
import { setEmailTransport } from '../../netlify/functions/_lib/email';
import {
  MIGRATIONS,
  REQUIRED_SCHEMA_VERSION,
  applyPending,
  currentSchemaVersion,
  resetSchemaCheck,
} from '../../netlify/functions/_lib/migrate';
import { compareSnapshots, summarise, takeSnapshot, type ParitySnapshot } from '../../scripts/db/parity';
import type { MeResponse, WorkspaceSnapshot } from '../../shared/contracts/dto';
import { call, cookieValue, type CallResult } from './helpers/harness';
import { PgliteDb } from './helpers/pglite';
import { PgDb, startPostgres, type PgServer } from './helpers/pgServer';
import { ACME_DATA, V11, buildV11Production, type V11User, type V11Variant } from './helpers/v11Production';

jest.setTimeout(120_000);

const PROD_JWT_SECRET = 'the-unchanged-v1.1-production-secret-value';
const HOST = 'pmocapacityplanner.netlify.app';

/** The production environment as it is today: no INTEGRATIONS_ENC_KEY, ALLOWED_ORIGINS or APP_MODE. */
function productionEnv(): void {
  for (const k of [
    'INTEGRATIONS_ENC_KEY',
    'ALLOWED_ORIGINS',
    'APP_MODE',
    'VITE_APP_MODE',
    'ALLOW_PUBLIC_SIGNUP',
    'FROM_EMAIL',
    'OPENAI_API_KEY',
    'JWT_SECRET_NEXT',
  ])
    delete process.env[k];
  process.env.JWT_SECRET = PROD_JWT_SECRET;
  process.env.RESEND_API_KEY = 're_production_key_present';
  process.env.CONTEXT = 'production';
  process.env.URL = `https://${HOST}`;
  process.env.LOG_LEVEL = 'silent';
}

const mail: Array<{ to: string; text: string }> = [];
let ipSeq = 0;

/** A browser request from the production origin (unique client IP so per-IP rate limits never interfere). */
function browser(extra: { token?: string; cookies?: Record<string, string>; body?: unknown; csrf?: string } = {}) {
  ipSeq += 1;
  const headers: Record<string, string> = {
    host: HOST,
    origin: `https://${HOST}`,
    'x-nf-client-connection-ip': `203.0.113.${ipSeq % 250}`,
  };
  if (extra.csrf) headers['x-csrf-token'] = extra.csrf;
  return { headers, token: extra.token, cookies: extra.cookies, body: extra.body };
}

interface Session {
  cookies: Record<string, string>;
  csrf: string;
  token: string;
}

async function signIn(u: V11User): Promise<{ res: CallResult; session: Session }> {
  let res = await call(
    auth,
    'POST',
    '/api/auth/login',
    browser({ body: { email: u.loginEmail, password: u.password } }),
  );
  if (u.twoFactor) {
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ require2FA: true, email: u.email.toLowerCase() });
    const sent = mail.filter((m) => m.to.toLowerCase() === u.email.toLowerCase()).pop();
    const code = /\b(\d{6})\b/.exec(sent?.text ?? '')?.[1];
    expect(code).toBeDefined();
    res = await call(
      auth,
      'POST',
      '/api/auth/login',
      browser({ body: { email: u.loginEmail, password: u.password, otp: code } }),
    );
  }
  const session = cookieValue(res.cookies, 'pcp_session') ?? '';
  const csrf = cookieValue(res.cookies, 'pcp_csrf') ?? '';
  return {
    res,
    session: { cookies: { pcp_session: session, pcp_csrf: csrf }, csrf, token: session },
  };
}

type Backend = 'pglite' | 'postgres';
const VARIANTS: V11Variant[] = ['replayed', 'drifted'];

let server: PgServer | null = null;
let serverTried = false;
async function pgServer(): Promise<PgServer | null> {
  if (!serverTried) {
    serverTried = true;
    server = await startPostgres();
  }
  return server;
}

async function freshDb(backend: Backend, name: string): Promise<(Db & { close(): Promise<void> }) | null> {
  if (backend === 'pglite') return new PgliteDb();
  const s = await pgServer();
  if (!s) return null;
  return new PgDb(await s.createDatabase(name));
}

beforeAll(() => {
  productionEnv();
  setEmailTransport({
    send: async (m) => {
      mail.push({ to: m.to, text: m.text });
      return {};
    },
  });
});

afterAll(async () => {
  setEmailTransport(null);
  setDb(null);
  resetSchemaCheck();
  await server?.stop();
});

describe.each((['pglite', 'postgres'] as Backend[]).flatMap((b) => VARIANTS.map((v) => [b, v] as const)))(
  'upgrade v1.1 → 2.0 on %s (%s v1.1 schema)',
  (backend, variant) => {
    let db: (Db & { close(): Promise<void> }) | null = null;
    let users: V11User[] = [];
    let before: ParitySnapshot;
    let legacyCounts: Record<string, number>;
    const sessions = new Map<string, Session>();
    const byKey = (k: string) => users.find((u) => u.key === k) as V11User;
    const skip = () => !db;

    beforeAll(async () => {
      productionEnv();
      db = await freshDb(backend, `upgrade_${variant}`);
      if (!db) return;
      const d = db;
      users = await d.session((s) => buildV11Production(s, variant));
      before = await takeSnapshot(d);
      legacyCounts = {};
      for (const t of [
        'users',
        'organizations',
        'workspaces',
        'workspace_members',
        'resources',
        'projects',
        'allocations',
        'audit_logs',
        'workspace_integrations',
        'qbr_tribes',
        'qbr_members',
        'qbr_bookings',
      ])
        legacyCounts[t] = Number((await d.query(`SELECT count(*)::int AS n FROM ${t}`))[0].n);
      expect(await currentSchemaVersion(d)).toBe(0);
      setDb(d);
      resetSchemaCheck(); // a freshly deployed function instance
    });

    afterAll(async () => {
      setDb(null);
      resetSchemaCheck();
      await db?.close();
    });

    it('the first request after deploy migrates the database and signs the user in', async () => {
      if (skip()) return console.warn(`upgrade.test: no PostgreSQL server available, ${backend} run skipped`);
      const tom = byKey('tom');
      const { res, session } = await signIn(tom);
      expect(res.status).toBe(200);
      expect(await currentSchemaVersion(db!)).toBe(REQUIRED_SCHEMA_VERSION);
      // v1.1 response contract kept: { token, user } with the v1.1 user fields, plus cookies.
      expect(res.json.user).toMatchObject({ id: tom.id, email: tom.email.toLowerCase() });
      expect(session.cookies.pcp_session).toBeTruthy();
      expect(session.csrf).toBeTruthy();
      sessions.set(tom.key, session);
    });

    it('leaves every v1.1 value byte-identical: 0 rows lost, 0 credential changes (PL-14#AC1)', async () => {
      if (skip()) return;
      const report = compareSnapshots(before, await takeSnapshot(db!));
      const { ok, text } = summarise(report);
      expect(text).toMatch(/^0 rows lost, 0 credential changes/);
      expect(ok).toBe(true);
      for (const [t, n] of Object.entries(legacyCounts)) {
        const now = Number((await db!.query(`SELECT count(*)::int AS n FROM ${t}`))[0].n);
        // audit_logs only grows (2.0 writes audit_events, not audit_logs); everything else is unchanged.
        expect({ t, n: now }).toEqual({ t, n });
      }
    });

    it('every existing user signs in with the same email and password', async () => {
      if (skip()) return;
      for (const u of users) {
        if (sessions.has(u.key)) continue;
        const { res, session } = await signIn(u);
        expect({ user: u.key, status: res.status, error: res.json.error }).toEqual({
          user: u.key,
          status: 200,
          error: undefined,
        });
        expect(res.json.user).toMatchObject({ id: u.id });
        expect(res.json).not.toHaveProperty('token'); // QA-001: cookie only
        expect(session.cookies.pcp_session).toBeTruthy();
        sessions.set(u.key, session);
      }
      expect(sessions.size).toBe(users.length);
    });

    it('a wrong password is still refused, without telling which part was wrong', async () => {
      if (skip()) return;
      const res = await call(
        auth,
        'POST',
        '/api/auth/login',
        browser({ body: { email: byKey('noma').loginEmail, password: 'not-the-password' } }),
      );
      expect(res.status).toBe(401);
      expect(res.json.error).toBe('Invalid email or password');
    });

    it('accepts a v1.1 bearer token (same JWT_SECRET, no tv claim) and exchanges it for a cookie session', async () => {
      if (skip()) return;
      const ada = byKey('ada');
      // Exactly what v1.1 /api/auth/login signed (and what browsers hold in localStorage.pcp_token).
      const legacyToken = jwt.sign(
        { id: ada.id, email: ada.email, role: 'ORG_ADMIN', org_id: ada.orgId },
        PROD_JWT_SECRET,
        {
          expiresIn: '7d',
        },
      );
      const me = await call(v2, 'GET', '/api/v2/me', browser({ token: legacyToken }));
      expect(me.status).toBe(200);
      expect((me.json as unknown as MeResponse).user.id).toBe(ada.id);

      const exchanged = await call(auth, 'POST', '/api/auth/session', browser({ token: legacyToken }));
      expect(exchanged.status).toBe(200);
      const cookie = cookieValue(exchanged.cookies, 'pcp_session');
      expect(cookie).toBeTruthy();
      const viaCookie = await call(v2, 'GET', '/api/v2/me', browser({ cookies: { pcp_session: cookie as string } }));
      expect(viaCookie.status).toBe(200);

      // The register-era payload (no org_id claim) works too; a token signed with another secret does not.
      const noma = byKey('noma');
      const old = jwt.sign({ id: noma.id, email: noma.email, role: 'USER' }, PROD_JWT_SECRET, { expiresIn: '7d' });
      expect((await call(v2, 'GET', '/api/v2/me', browser({ token: old }))).status).toBe(200);
      const forged = jwt.sign({ id: noma.id, email: noma.email, role: 'SUPERUSER' }, 'another-secret');
      expect((await call(v2, 'GET', '/api/v2/me', browser({ token: forged }))).status).toBe(401);
    });

    it('/api/v2/me shows each user the organisation and workspace roles they had (AC-01#AC2)', async () => {
      if (skip()) return;
      for (const u of users) {
        const s = sessions.get(u.key) as Session;
        const res = await call(v2, 'GET', '/api/v2/me', browser({ cookies: s.cookies }));
        expect({ user: u.key, status: res.status }).toEqual({ user: u.key, status: 200 });
        const me = res.json as unknown as MeResponse;
        expect({ user: u.key, platformAdmin: me.user.isPlatformAdmin }).toEqual({
          user: u.key,
          platformAdmin: u.expect.platformAdmin,
        });
        expect({ user: u.key, orgRole: me.org?.role ?? null, orgId: me.org?.id ?? null }).toEqual({
          user: u.key,
          orgRole: u.expect.orgRole,
          orgId: u.orgId,
        });
        for (const [wsId, role] of Object.entries(u.expect.workspaces)) {
          const ws = me.workspaces.find((w) => w.id === wsId);
          expect({ user: u.key, wsId, role: ws?.role, implicit: ws?.implicit }).toEqual({
            user: u.key,
            wsId,
            role,
            implicit: false,
          });
        }
        // Any other workspace is visible only through the org-wide default visibility (AC-09), read-only.
        for (const ws of me.workspaces.filter((w) => !(w.id in u.expect.workspaces))) {
          if (u.expect.orgRole === 'ORG_ADMIN') continue;
          expect({ user: u.key, ws: ws.id, implicit: ws.implicit, role: ws.role }).toEqual({
            user: u.key,
            ws: ws.id,
            implicit: true,
            role: 'VIEWER',
          });
        }
        // Users never see another organisation's workspace.
        expect(me.workspaces.every((w) => w.id !== V11.wsBeta || u.orgId === V11.orgBeta)).toBe(true);
      }
    });

    it('the workspace snapshot returns the migrated people, projects, allocations and demand', async () => {
      if (skip()) return;
      const s = sessions.get('pat') as Session; // PMO Admin of the Acme default workspace
      const res = await call(v2, 'GET', `/api/v2/workspaces/${V11.wsAcme}/snapshot`, browser({ cookies: s.cookies }));
      expect(res.status).toBe(200);
      const snap = res.json as unknown as WorkspaceSnapshot;
      expect(snap.people.map((p) => p.id).sort()).toEqual([...ACME_DATA.resources].sort());
      expect(snap.projects.map((p) => p.id).sort()).toEqual([...ACME_DATA.projects].sort());
      expect(Object.fromEntries(snap.allocations.map((a) => [a.id, a.percentage]))).toEqual(ACME_DATA.allocations);
      for (const [id, craft] of Object.entries(ACME_DATA.primaryCraft))
        expect({ id, craft: snap.people.find((p) => p.id === id)?.primaryCraft }).toEqual({ id, craft });
      const noma = snap.people.find((p) => p.id === 'r-noma');
      expect(noma).toMatchObject({ targetUtil: 90, totalCapacity: 100, skills: ['Agile', 'Jira'] });
      expect(noma?.secondaryCrafts).toEqual([
        expect.objectContaining({ craftId: 'business-analysis', proficiency: 2 }),
      ]);
      const demand: Record<string, number> = {};
      for (const d of snap.demand) {
        const k = `${d.projectId}|${d.quarterKey}|${d.craftId}`;
        demand[k] = Math.round(((demand[k] ?? 0) + d.fte) * 100) / 100;
      }
      expect(demand).toEqual(ACME_DATA.demand);
      // Crafts referenced by people and demand exist in the org catalogue (renaming a craft never breaks a link).
      const craftIds = new Set(snap.crafts.map((c) => c.id));
      for (const id of ['scrum-master', 'project-mgmt', 'business-analysis', 'product-mgmt', 'delivery-lead'])
        expect({ id, known: craftIds.has(id) }).toEqual({ id, known: true });
      // Projects carry their v1.1 dates; Planview-sourced allocations keep their source.
      expect(snap.projects.find((p) => p.id === 'p-phoenix')).toMatchObject({
        startDate: '2026-10-01',
        endDate: '2027-06-30',
        jiraKey: 'PHX',
      });
      expect(snap.allocations.find((a) => a.id === 'alloc-mobile-7')).toMatchObject({ source: 'planview' });
      expect(snap.allocations.find((a) => a.id === 'a-1712000000001')).toMatchObject({
        startDate: '2026-10-01',
        endDate: '2026-12-31',
        state: 'confirmed',
      });
      // Another org's data never leaks in.
      expect(snap.people.some((p) => p.id === 'r-beta')).toBe(false);
    });

    it('keeps the v1.1 workspace read endpoint working for browsers still on the old bundle', async () => {
      if (skip()) return;
      const s = sessions.get('noma') as Session;
      const res = await call(workspaceFn, 'GET', `/api/workspace?wsId=${V11.wsAcme}`, browser({ token: s.token }));
      expect(res.status).toBe(200);
      const body = res.json as unknown as { resources: unknown[]; projects: unknown[]; allocations: unknown[] };
      expect(body.resources).toHaveLength(ACME_DATA.resources.length);
      expect(body.projects).toHaveLength(ACME_DATA.projects.length);
      expect(body.allocations).toHaveLength(Object.keys(ACME_DATA.allocations).length);
      // and the v1.1 bulk save is refused with the reload message instead of overwriting 2.0 data
      const save = await call(
        workspaceFn,
        'POST',
        `/api/workspace?wsId=${V11.wsAcme}`,
        browser({ token: s.token, body: {} }),
      );
      expect(save.status).toBe(410);
    });

    it('keeps the QBR sprint data; the module answers once an Org Admin switches it on (SH-05)', async () => {
      if (skip()) return;
      const ada = sessions.get('ada') as Session;
      const q = `/api/qbr/overview?wsId=${V11.wsAcme}&orgId=${V11.orgAcme}`;
      const off = await call(qbr, 'GET', q, browser({ cookies: ada.cookies }));
      expect(off.status).toBe(403);
      expect(off.json.code).toBe('feature_disabled');

      const org = await call(v2, 'GET', `/api/v2/orgs/${V11.orgAcme}`, browser({ cookies: ada.cookies }));
      expect(org.status).toBe(200);
      const patch = await call(
        v2,
        'PATCH',
        `/api/v2/orgs/${V11.orgAcme}`,
        browser({
          cookies: ada.cookies,
          csrf: ada.csrf,
          body: {
            version: org.json.version,
            patch: { features: { ...(org.json.features as object), qbrSprintModule: true } },
          },
        }),
      );
      expect(patch.status).toBe(200);
      const on = await call(qbr, 'GET', q, browser({ cookies: ada.cookies }));
      expect(on.status).toBe(200);
      const o = on.json as unknown as { tribes: unknown[]; quarters: unknown[]; stats: { members: number } };
      expect(o.tribes).toHaveLength(ACME_DATA.qbr.tribes);
      expect(o.quarters).toHaveLength(ACME_DATA.qbr.quarters);
      expect(Number((await db!.query('SELECT count(*)::int AS n FROM qbr_bookings'))[0].n)).toBe(
        ACME_DATA.qbr.bookings,
      );
    });

    it('writes work on migrated rows and dual-write the v1.1 columns (rollback stays possible)', async () => {
      if (skip()) return;
      const pat = sessions.get('pat') as Session;
      const snapRes = await call(
        v2,
        'GET',
        `/api/v2/workspaces/${V11.wsAcme}/snapshot`,
        browser({ cookies: pat.cookies }),
      );
      const snap = snapRes.json as unknown as WorkspaceSnapshot;
      const alloc = snap.allocations.find((a) => a.id === 'a-1712000000003');
      expect(alloc).toBeDefined();
      const batch = await call(
        v2,
        'POST',
        `/api/v2/workspaces/${V11.wsAcme}/allocations/batch`,
        browser({
          cookies: pat.cookies,
          csrf: pat.csrf,
          body: {
            label: 'upgrade test',
            ops: [
              { op: 'update', id: alloc!.id, version: alloc!.version, patch: { percentage: 90 } },
              {
                op: 'create',
                allocation: {
                  id: 'b6f3f4a2-6f43-4bb5-9c0e-2d7c1d1f0a01',
                  resourceId: 'r-kerrie',
                  projectId: 'p-phoenix',
                  percentage: 20,
                  startDate: '2027-01-01',
                  endDate: '2027-03-31',
                },
              },
            ],
          },
        }),
      );
      expect({ status: batch.status, error: batch.json.error }).toEqual({ status: 200, error: undefined });
      const rows = await db!.query(
        `SELECT id, percentage, start_date::text AS s FROM allocations WHERE id IN ('a-1712000000003', 'b6f3f4a2-6f43-4bb5-9c0e-2d7c1d1f0a01') ORDER BY id`,
      );
      expect(rows).toEqual([
        { id: 'a-1712000000003', percentage: 90, s: '2026-10-01' },
        { id: 'b6f3f4a2-6f43-4bb5-9c0e-2d7c1d1f0a01', percentage: 20, s: '2027-01-01' },
      ]);

      // Add a person and a project through the 2.0 API.
      const person = await call(
        v2,
        'POST',
        `/api/v2/workspaces/${V11.wsAcme}/people`,
        browser({
          cookies: pat.cookies,
          csrf: pat.csrf,
          body: { name: 'New Starter', primaryCraft: 'business-analysis' },
        }),
      );
      expect({ status: person.status, error: person.json.error }).toEqual({ status: 201, error: undefined });
      const project = await call(
        v2,
        'POST',
        `/api/v2/workspaces/${V11.wsAcme}/projects`,
        browser({
          cookies: pat.cookies,
          csrf: pat.csrf,
          body: { name: 'New Initiative', startDate: '2027-01-01', endDate: '2027-12-31', stage: 'Initiated' },
        }),
      );
      expect([201, 400]).toContain(project.status); // 400 only if the 2.0 rules require a tribe (PPL-07#AC3)

      // The org admin creates a workspace (organizations/workspaces have no id default in production).
      const ada = sessions.get('ada') as Session;
      const ws = await call(
        v2,
        'POST',
        `/api/v2/orgs/${V11.orgAcme}/workspaces`,
        browser({ cookies: ada.cookies, csrf: ada.csrf, body: { name: 'Created after upgrade' } }),
      );
      expect({ status: ws.status, error: ws.json.error }).toEqual({ status: 201, error: undefined });
    });

    it('the user without an organisation signs in and is offered "create an organisation"', async () => {
      if (skip()) return;
      const s = sessions.get('loner') as Session;
      const me = (await call(v2, 'GET', '/api/v2/me', browser({ cookies: s.cookies }))).json as unknown as MeResponse;
      expect(me.org).toBeNull();
      expect(me.workspaces).toEqual([]);
    });

    it('running the migrations again is a no-op (AC-01#AC3, PL-02#AC2)', async () => {
      if (skip()) return;
      const d = db!;
      const mid = await takeSnapshot(d);
      const counts = async () =>
        Object.fromEntries(
          await Promise.all(
            [
              'org_memberships',
              'workspace_members',
              'crafts',
              'tribes',
              'org_teams',
              'demand_lines',
              'audit_events',
              'integration_mappings',
              'tribe_calibrations',
              'schema_migrations',
            ].map(async (t) => [t, Number((await d.query(`SELECT count(*)::int AS n FROM ${t}`))[0].n)] as const),
          ),
        );
      const c1 = await counts();
      // 1) a new cold start: nothing pending
      resetSchemaCheck();
      expect((await call(health, 'GET', '/api/health', browser())).status).toBe(200);
      const r = await d.session((s) => applyPending(s));
      expect(r.applied).toEqual([]);
      // 2) every migration file executed again verbatim (an operator re-running SQL by hand)
      await d.session(async (s) => {
        for (const m of MIGRATIONS) await s.exec(m.sql);
      });
      const c2 = await counts();
      // audit_events can only grow by the health/session audit entries of this test; nothing else changes.
      expect({ ...c2, audit_events: 0 }).toEqual({ ...c1, audit_events: 0 });
      expect(summarise(compareSnapshots(mid, await takeSnapshot(d))).ok).toBe(true);
      // and everyone still signs in
      const { res } = await signIn(byKey('owen'));
      expect(res.status).toBe(200);
    });
  },
);

describe('concurrent cold starts on a v1.1 database (real PostgreSQL)', () => {
  it('several new function instances migrate once and all sign their users in', async () => {
    productionEnv();
    const s = await pgServer();
    if (!s) return console.warn('upgrade.test: no PostgreSQL server available, concurrency test skipped');
    if (process.env.UPGRADE_DEBUG) process.env.LOG_LEVEL = 'error';
    const url = await s.createDatabase('upgrade_concurrent');
    const setup = new PgDb(url);
    const users = await setup.session((x) => buildV11Production(x, 'replayed'));
    const before = await takeSnapshot(setup);

    // Each "instance" is an isolated copy of the function modules (own schema memo, own DB pool), as on Netlify.
    const INSTANCES = 6;
    const instances = Array.from({ length: INSTANCES }, () => {
      let mod!: {
        auth: typeof import('../../netlify/functions/auth');
        db: typeof import('../../netlify/functions/_lib/db');
        email: typeof import('../../netlify/functions/_lib/email');
      };
      jest.isolateModules(() => {
        mod = {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          auth: require('../../netlify/functions/auth'),
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          db: require('../../netlify/functions/_lib/db'),
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          email: require('../../netlify/functions/_lib/email'),
        };
      });
      const pool = new PgDb(url);
      mod.db.setDb(pool);
      mod.email.setEmailTransport({ send: async () => ({}) });
      return { ...mod, pool };
    });
    const signers = users.filter((u) => !u.twoFactor);
    const results = await Promise.all(
      instances.map((inst, i) => {
        const u = signers[i % signers.length];
        return call(
          inst.auth.handler,
          'POST',
          '/api/auth/login',
          browser({ body: { email: u.loginEmail, password: u.password } }),
        );
      }),
    );
    expect(results.map((r) => r.status)).toEqual(Array(INSTANCES).fill(200));
    const versions = await setup.query<{ version: number; n: number }>(
      'SELECT version, count(*)::int AS n FROM schema_migrations GROUP BY version ORDER BY version',
    );
    expect(versions).toEqual(MIGRATIONS.map((m) => ({ version: m.version, n: 1 })));
    const dupes = await setup.query(
      `SELECT org_id, user_id, count(*) FROM org_memberships GROUP BY org_id, user_id HAVING count(*) > 1`,
    );
    expect(dupes).toEqual([]);
    const demandDupes = await setup.query(
      `SELECT project_id, quarter_key, craft_id, count(*) FROM demand_lines GROUP BY 1, 2, 3 HAVING count(*) > 1`,
    );
    expect(demandDupes).toEqual([]);
    expect(summarise(compareSnapshots(before, await takeSnapshot(setup))).ok).toBe(true);
    await Promise.all(instances.map((i) => i.pool.close()));
    await setup.close();
  });
});
