/**
 * Independent QA (Release 2.0): the v1.1 → 2.0 upgrade on dirtier data than tests/backend/upgrade.test.ts uses.
 *
 * Starts from the "drifted" v1.1 production replay (TEXT dates, hand-set roles) and adds rows real production data
 * is likely to contain: craft profiles that are NULL, a JSON string or an array; allocations without dates, with
 * inverted dates, 0 %, timestamp strings or garbage in the date columns; projects with blank client names and
 * non-array craft_demand; a pair of accounts whose emails differ only by case; allocations pointing at another
 * tenant's person or with no workspace; a workspace without members and a workspace without an org; QBR bookings
 * whose member was deleted. Then the first 2.0 request runs the migration and QA checks that it neither fails nor
 * loses rows, that every login still works, and that no endpoint answers 5xx on that data.
 */
import bcrypt from 'bcryptjs';
import { handler as auth } from '../../netlify/functions/auth';
import { handler as v2 } from '../../netlify/functions/v2';
import { handler as qbr } from '../../netlify/functions/qbr';
import { handler as health } from '../../netlify/functions/health';
import { setDb } from '../../netlify/functions/_lib/db';
import { setEmailTransport } from '../../netlify/functions/_lib/email';
import { REQUIRED_SCHEMA_VERSION, currentSchemaVersion, resetSchemaCheck } from '../../netlify/functions/_lib/migrate';
import { compareSnapshots, summarise, takeSnapshot, type ParitySnapshot } from '../../scripts/db/parity';
import { call, cookieValue } from '../backend/helpers/harness';
import { PgliteDb } from '../backend/helpers/pglite';
import { PgDb, startPostgres, type PgServer } from '../backend/helpers/pgServer';
import type { Db } from '../../netlify/functions/_lib/db';
import { V11, buildV11Production, type V11User } from '../backend/helpers/v11Production';

jest.setTimeout(180_000);

const SECRET = 'qa-upgrade-edge-secret';
const HOST = 'pmocapacityplanner.netlify.app';
const WS_EMPTY = 'a3000000-0000-4000-8000-0000000000a3';
const WS_NO_ORG = 'a4000000-0000-4000-8000-0000000000a4';
const DUP_UPPER = {
  id: '60000000-0000-4000-8000-000000000001',
  email: 'Dup.User@acme.example',
  password: 'Dup-Upper-1',
};
const DUP_LOWER = {
  id: '60000000-0000-4000-8000-000000000002',
  email: 'dup.user@acme.example',
  password: 'Dup-Lower-2',
};
const NO_NAME = {
  id: '60000000-0000-4000-8000-000000000003',
  email: 'no.name@acme.example',
  password: 'No-Name-User-3',
};

let users: V11User[] = [];
let before: ParitySnapshot;
const counts: Record<string, number> = {};
let ipSeq = 0;
const mail: Array<{ to: string; text: string }> = [];

function req(extra: { token?: string; body?: unknown } = {}) {
  ipSeq += 1;
  return {
    headers: { host: HOST, origin: `https://${HOST}`, 'x-nf-client-connection-ip': `198.18.0.${ipSeq % 250}` },
    token: extra.token,
    body: extra.body,
  };
}

async function signIn(email: string, password: string) {
  let res = await call(auth, 'POST', '/api/auth/login', req({ body: { email, password } }));
  if (res.json.require2FA) {
    const code = /\b(\d{6})\b/.exec(
      mail.filter((m) => m.to.toLowerCase() === email.toLowerCase()).pop()?.text ?? '',
    )?.[1];
    res = await call(auth, 'POST', '/api/auth/login', req({ body: { email, password, otp: code } }));
  }
  return res;
}

const hash = (p: string) => bcrypt.hashSync(p, 4);
const TABLES = ['users', 'workspaces', 'workspace_members', 'resources', 'projects', 'allocations', 'qbr_bookings'];

let server: PgServer | null = null;

describe.each(['pglite', 'postgres'] as const)('upgrade edge cases on %s', (backend) => {
  let db: (Db & { close(): Promise<void> }) | null = null;
  const skip = () => !db;
  beforeAll(async () => {
    if (backend === 'postgres') {
      server = await startPostgres();
      if (!server) return;
      db = new PgDb(await server.createDatabase('qa_upgrade_edge'));
    } else db = new PgliteDb();
    for (const k of ['INTEGRATIONS_ENC_KEY', 'ALLOWED_ORIGINS', 'APP_MODE', 'ALLOW_PUBLIC_SIGNUP', 'FROM_EMAIL'])
      delete process.env[k];
    Object.assign(process.env, {
      JWT_SECRET: SECRET,
      RESEND_API_KEY: 're_qa',
      CONTEXT: 'production',
      URL: `https://${HOST}`,
      LOG_LEVEL: 'silent',
    });
    setEmailTransport({
      send: async (m) => {
        mail.push({ to: m.to, text: m.text });
        return {};
      },
    });
    users = await db!.session((s) => buildV11Production(s, 'drifted'));
    const { orgAcme: A, wsAcme: wsA, wsBeta: wsB } = V11;
    await db!.session((s) =>
      s.exec(`
      INSERT INTO workspaces (id, org_id, name) VALUES ('${WS_EMPTY}', '${A}', 'Empty workspace'), ('${WS_NO_ORG}', NULL, 'Orphan workspace');
      INSERT INTO users (id, email, password_hash, name, role, plan, org_id) VALUES
        ('${DUP_UPPER.id}', '${DUP_UPPER.email}', '${hash(DUP_UPPER.password)}', 'Dup Upper', 'USER', 'BASIC', '${A}'),
        ('${DUP_LOWER.id}', '${DUP_LOWER.email}', '${hash(DUP_LOWER.password)}', 'Dup Lower', 'USER', 'BASIC', '${A}'),
        ('${NO_NAME.id}', '${NO_NAME.email}', '${hash(NO_NAME.password)}', NULL, 'USER', 'BASIC', '${A}');
      INSERT INTO workspace_members (user_id, workspace_id, org_id, role) VALUES
        ('${DUP_UPPER.id}', '${wsA}', '${A}', 'USER'), ('${DUP_LOWER.id}', '${wsA}', '${A}', 'USER');
      INSERT INTO resources (id, name, type, workspace_id, capacity, total_capacity, role, skills, craft_profile, email) VALUES
        ('r-qa-str', 'String Profile', 'Permanent', '${wsA}', 100, 100, 'PM', '{}', '"PM"', NULL),
        ('r-qa-arr', 'Array Profile', 'Permanent', '${wsA}', 100, 100, 'PM', '{}', '[]', 'DUP.USER@ACME.EXAMPLE'),
        ('r-qa-bad', 'Bad Profile', 'Contractor', '${wsA}', 50, 50, NULL, '{}',
          '{"primaryCraft":"unknown-craft","secondaryCrafts":[{"craftId":null},{"proficiency":7}],"tribeAffinity":"Payments","targetUtil":"high"}', NULL),
        ('r-qa-nows', 'No Workspace', 'Permanent', NULL, 100, 100, 'PM', '{}', NULL, NULL),
        ('r-qa-long', '${'Ł'.repeat(300)}', 'Permanent', '${wsA}', 100, 100, 'PM', '{}', NULL, NULL);
      INSERT INTO projects (id, name, status, workspace_id, priority, client_name, craft_demand, start_date, end_date) VALUES
        ('p-qa-blank', 'Blank Client', 'Active', '${wsA}', 'Low', '', '{"not":"an array"}', NULL, NULL),
        ('p-qa-space', 'Space Client', 'Active', '${wsA}', 'Low', '   ', 'null', '2027-03-31', '2026-01-01'),
        ('p-qa-case', 'Case Client', 'Active', '${wsA}', 'Low', 'PAYMENTS', '[{"quarterKey":"2027-Q1","craftId":"project-mgmt","fte":"2"}]', NULL, NULL);
      INSERT INTO allocations (id, workspace_id, resource_id, project_id, percentage, start_date, end_date) VALUES
        ('a-qa-inverted', '${wsA}', 'r-noma', 'p-ledger', 20, '2027-06-30', '2027-01-01'),
        ('a-qa-zero', '${wsA}', 'r-maria', 'p-ledger', 0, NULL, NULL),
        ('a-qa-cross', '${wsA}', 'r-beta', 'p-phoenix', 10, NULL, NULL),
        ('a-qa-nows', NULL, 'r-noma', 'p-ledger', 15, NULL, NULL),
        ('a-qa-ts', '${wsA}', 'r-tom', 'p-phoenix', 10, '2026-09-30T23:00:00.000Z', '2026-12-31T00:00:00.000Z'),
        ('a-qa-garbage', '${wsA}', 'r-kerrie', 'p-ledger', 10, 'TBC', '');
      ALTER TABLE qbr_bookings DROP CONSTRAINT IF EXISTS qbr_bookings_member_id_fkey;
      DELETE FROM qbr_members WHERE id = 'c3000000-0000-4000-8000-000000000003';
    `),
    );
    void wsB;
    before = await takeSnapshot(db!);
    for (const t of TABLES) counts[t] = Number((await db!.query(`SELECT count(*)::int AS n FROM ${t}`))[0].n);
    setDb(db!);
    resetSchemaCheck();
  });

  afterAll(async () => {
    setEmailTransport(null);
    setDb(null);
    resetSchemaCheck();
    await db?.close();
    await server?.stop();
  });

  describe('QA: v1.1 → 2.0 upgrade on edge-case data', () => {
    it('the first request migrates the dirty database to the required schema version', async () => {
      if (skip()) return console.warn('upgrade.edge: no PostgreSQL available, run skipped');
      const res = await call(health, 'GET', '/api/health', req());
      expect(res.status).toBe(200);
      expect(await currentSchemaVersion(db!)).toBe(REQUIRED_SCHEMA_VERSION);
    });

    it('loses no v1.1 row and changes no credential (parity)', async () => {
      if (skip()) return;
      const { ok, text } = summarise(compareSnapshots(before, await takeSnapshot(db!)));
      expect(text).toMatch(/^0 rows lost, 0 credential changes/);
      expect(ok).toBe(true);
      for (const t of TABLES) {
        const n = Number((await db!.query(`SELECT count(*)::int AS n FROM ${t}`))[0].n);
        expect({ t, n }).toEqual({ t, n: counts[t] });
      }
    });

    it('every seeded v1.1 user and the user without a name still sign in', async () => {
      if (skip()) return;
      for (const u of [...users.map((x) => ({ email: x.loginEmail, password: x.password })), NO_NAME]) {
        const res = await signIn(u.email, u.password);
        expect({ email: u.email, status: res.status }).toEqual({ email: u.email, status: 200 });
      }
    });

    it('of two accounts whose emails differ only by case, the lower-case one signs in (as in v1.1)', async () => {
      if (skip()) return;
      expect((await signIn(DUP_LOWER.email, DUP_LOWER.password)).status).toBe(200);
    });

    it('the workspace snapshot, legacy QBR and delivery reads answer without a server error on the dirty data', async () => {
      if (skip()) return;
      const tom = users.find((u) => u.key === 'tom')!;
      const login = await signIn(tom.loginEmail, tom.password);
      const token = String(login.json.token ?? cookieValue(login.cookies, 'pcp_session'));
      const snap = await call(v2, 'GET', `/api/v2/workspaces/${V11.wsAcme}/snapshot`, req({ token }));
      expect(snap.status).toBe(200);
      const people = (snap.json.people as Array<{ id: string; name: string }>).map((p) => p.id);
      expect(people).toEqual(expect.arrayContaining(['r-qa-str', 'r-qa-arr', 'r-qa-bad', 'r-qa-long']));
      // Beta's person must not leak into Acme's snapshot through the cross-tenant allocation.
      expect(JSON.stringify(snap.json)).not.toContain('Ben Beta');
      const empty = await call(v2, 'GET', `/api/v2/workspaces/${WS_EMPTY}/snapshot`, req({ token }));
      expect(empty.status).toBe(200);
      for (const path of ['sync/health', 'delivery?groupBy=tribe', 'calibration', 'craft-requests']) {
        const r = await call(v2, 'GET', `/api/v2/workspaces/${V11.wsAcme}/${path}`, req({ token }));
        expect({ path, status: r.status }).toEqual({ path, status: 200 });
      }
      await db!.query(
        `UPDATE organizations SET features = features || '{"qbrSprintModule": true}'::jsonb WHERE id = $1`,
        [V11.orgAcme],
      );
      const q = await call(
        qbr,
        'GET',
        `/api/qbr/quarter/c2000000-0000-4000-8000-000000000001?wsId=${V11.wsAcme}`,
        req({ token }),
      );
      expect(q.status).toBe(200);
    });

    it('the orphan workspace (no org) is unreachable rather than a server error', async () => {
      if (skip()) return;
      const tom = users.find((u) => u.key === 'tom')!;
      const login = await signIn(tom.loginEmail, tom.password);
      const r = await call(
        v2,
        'GET',
        `/api/v2/workspaces/${WS_NO_ORG}/snapshot`,
        req({ token: String(login.json.token) }),
      );
      expect([403, 404]).toContain(r.status);
    });

    it('a migration re-run is a no-op', async () => {
      if (skip()) return;
      resetSchemaCheck();
      const snapBefore = await takeSnapshot(db!);
      const res = await call(health, 'GET', '/api/health', req());
      expect(res.status).toBe(200);
      expect(summarise(compareSnapshots(snapBefore, await takeSnapshot(db!))).ok).toBe(true);
    });
  });
});
