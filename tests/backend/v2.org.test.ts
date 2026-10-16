/**
 * /api/v2 org routes: me, orgs, workspaces, structure, members, invitations, audit
 * (AC-04, AC-05, AC-06, AC-08, AC-09, AC-10, ORG-02, SH-05, ST-01, ST-03).
 */
import { handler as v2 } from '../../netlify/functions/v2';
import { handler as auth } from '../../netlify/functions/auth';
import { setEmailTransport } from '../../netlify/functions/_lib/email';
import type { PgliteDb } from './helpers/pglite';
import {
  PASSWORD,
  addMember,
  call,
  cookieValue,
  createOrg,
  createPerson,
  createProject,
  createUser,
  createWorkspace,
  setupDb,
  teardownDb,
  testEnv,
} from './helpers/harness';

let db: PgliteDb;
const mails: Array<{ to: string; subject: string; text: string }> = [];

beforeAll(async () => {
  db = await setupDb();
  setEmailTransport({
    send: async (m) => {
      mails.push({ to: m.to, subject: m.subject, text: m.text });
      return {};
    },
  });
});
afterAll(async () => {
  setEmailTransport(null);
  await teardownDb(db);
});
beforeEach(() => {
  testEnv({ RESEND_API_KEY: 're_test' });
  mails.length = 0;
});

describe('GET /api/v2/me (AC-04, AC-09, SH-05)', () => {
  it('returns roles and permissions per workspace, implicit viewer access and default features', async () => {
    const org = await createOrg(db, 'Me Org', 'PRO');
    const a = await createWorkspace(db, org, 'A');
    const b = await createWorkspace(db, org, 'B');
    const u = await createUser(db, { orgId: org, orgRole: 'MEMBER' });
    await addMember(db, u.id, a, 'PLANNER');
    const person = await createPerson(db, a, { name: 'Me', linkedUserId: u.id });
    const r = await call(v2, 'GET', '/api/v2/me', { token: u.token });
    expect(r.status).toBe(200);
    expect(r.json.appMode).toBe('public');
    expect((r.json.entitlements as { plan: string }).plan).toBe('PRO');
    expect((r.json.org as { role: string; features: unknown }).features).toEqual({
      qbrSprintModule: false,
      aiAssistant: false,
      scenarios: false,
      planviewScheduledImport: false,
      jiraScheduledSync: true,
    });
    const wss = r.json.workspaces as Array<{
      id: string;
      role: string;
      implicit: boolean;
      permissions: string[];
      linkedPersonId: string | null;
    }>;
    const wa = wss.find((w) => w.id === a)!;
    const wb = wss.find((w) => w.id === b)!;
    expect(wa).toMatchObject({ role: 'PLANNER', implicit: false, linkedPersonId: person });
    expect(wa.permissions).toContain('allocations.write');
    expect(wb).toMatchObject({ role: 'VIEWER', implicit: true });
    await db.query(`UPDATE organizations SET default_workspace_visibility = 'members' WHERE id = $1`, [org]);
    const again = await call(v2, 'GET', '/api/v2/me', { token: u.token });
    expect((again.json.workspaces as Array<{ id: string }>).map((w) => w.id)).toEqual([a]);
    const denied = await call(v2, 'GET', `/api/v2/workspaces/${b}/snapshot`, { token: u.token });
    expect(denied.status).toBe(403);
  });

  it('internal mode resolves every org to ENTERPRISE', async () => {
    process.env.APP_MODE = 'internal';
    const org = await createOrg(db, 'Internal', 'BASIC');
    const u = await createUser(db, { orgId: org, orgRole: 'MEMBER' });
    const r = await call(v2, 'GET', '/api/v2/me', { token: u.token });
    expect(r.json.appMode).toBe('internal');
    expect(r.json.entitlements as { plan: string; billingVisible: boolean }).toMatchObject({
      plan: 'ENTERPRISE',
      billingVisible: false,
    });
  });

  it('reads roles from the DB even for a v1.1 user without org_memberships (dual-read)', async () => {
    const org = await createOrg(db, 'Legacy Only');
    const ws = await createWorkspace(db, org);
    const u = await createUser(db, { orgId: org, orgRole: null, legacyRole: 'ORG_ADMIN' });
    const r = await call(v2, 'GET', '/api/v2/me', { token: u.token });
    expect((r.json.org as { role: string }).role).toBe('ORG_ADMIN');
    expect((r.json.workspaces as Array<{ id: string; role: string }>)[0]).toMatchObject({
      id: ws,
      role: 'WORKSPACE_ADMIN',
    });
  });
});

describe('orgs and workspaces (AC-08, ST-01, ST-03, ST-05)', () => {
  it('creates an org in one transaction; a second org is 409 (AC-08#AC3)', async () => {
    const u = await createUser(db);
    const r = await call(v2, 'POST', '/api/v2/orgs', {
      token: u.token,
      body: { name: 'New Co', workspaceName: 'PMO' },
    });
    expect(r.status).toBe(201);
    const orgId = (r.json.org as { id: string }).id;
    expect((r.json.workspace as { name: string }).name).toBe('PMO');
    const rows = await db.query(`SELECT role FROM org_memberships WHERE user_id = $1`, [u.id]);
    expect(rows).toEqual([{ role: 'ORG_ADMIN' }]);
    const legacy = await db.query(`SELECT role, org_id FROM users WHERE id = $1`, [u.id]);
    expect(legacy[0]).toEqual({ role: 'ORG_ADMIN', org_id: orgId });
    const crafts = await db.query(`SELECT count(*)::int AS n FROM crafts WHERE org_id = $1`, [orgId]);
    expect(crafts[0].n).toBe(12);
    const second = await call(v2, 'POST', '/api/v2/orgs', { token: u.token, body: { name: 'Again' } });
    expect(second.status).toBe(409);
    expect(second.json.error).toBe('You already belong to an organisation.');
  });

  it('only ORG_ADMIN creates workspaces; maxWorkspaces applies (AC-08#AC1-2)', async () => {
    const org = await createOrg(db, 'WS Org', 'BASIC');
    await createWorkspace(db, org);
    const admin = await createUser(db, { orgId: org, orgRole: 'ORG_ADMIN' });
    const member = await createUser(db, { orgId: org, orgRole: 'MEMBER' });
    const otherAdmin = await createUser(db, { orgId: await createOrg(db, 'Other'), orgRole: 'ORG_ADMIN' });
    expect(
      (await call(v2, 'POST', `/api/v2/orgs/${org}/workspaces`, { token: member.token, body: { name: 'X' } })).status,
    ).toBe(403);
    expect(
      (await call(v2, 'POST', `/api/v2/orgs/${org}/workspaces`, { token: otherAdmin.token, body: { name: 'X' } }))
        .status,
    ).toBe(403);
    const limited = await call(v2, 'POST', `/api/v2/orgs/${org}/workspaces`, {
      token: admin.token,
      body: { name: 'Delivery PMO' },
    });
    expect(limited.status).toBe(403);
    expect(limited.json.code).toBe('entitlement');
    await db.query(`UPDATE organizations SET plan = 'PRO' WHERE id = $1`, [org]);
    const ok = await call(v2, 'POST', `/api/v2/orgs/${org}/workspaces`, {
      token: admin.token,
      body: { name: 'Delivery PMO' },
    });
    expect(ok.status).toBe(201);
    const mem = await db.query(`SELECT access_role, role FROM workspace_members WHERE workspace_id = $1`, [ok.json.id]);
    expect(mem).toEqual([{ access_role: 'WORKSPACE_ADMIN', role: 'PMO_ADMIN' }]);
  });

  it('patches org settings with version checks; plan is rejected; features audited (ST-01, ST-03, ST-05)', async () => {
    const org = await createOrg(db, 'Settings Org');
    const admin = await createUser(db, { orgId: org, orgRole: 'ORG_ADMIN' });
    const member = await createUser(db, { orgId: org, orgRole: 'MEMBER' });
    const get = await call(v2, 'GET', `/api/v2/orgs/${org}`, { token: member.token });
    expect(get.status).toBe(200);
    expect((get.json.planning as { thresholds: unknown }).thresholds).toEqual({
      benchBelow: 50,
      onTargetFrom: 90,
      onTargetTo: 105,
    });
    const plan = await call(v2, 'PATCH', `/api/v2/orgs/${org}`, {
      token: admin.token,
      body: { version: 1, patch: { plan: 'MAX' } },
    });
    expect(plan.status).toBe(400);
    expect(plan.json.fields).toEqual({ plan: 'Plan is managed by billing.' });
    const byMember = await call(v2, 'PATCH', `/api/v2/orgs/${org}`, {
      token: member.token,
      body: { version: 1, patch: { name: 'X' } },
    });
    expect(byMember.status).toBe(403);
    const http = await call(v2, 'PATCH', `/api/v2/orgs/${org}`, {
      token: admin.token,
      body: { version: 1, patch: { logoUrl: 'http://x.test/a.png' } },
    });
    expect(http.status).toBe(400);
    const badThresholds = await call(v2, 'PATCH', `/api/v2/orgs/${org}`, {
      token: admin.token,
      body: { version: 1, patch: { planning: { thresholds: { benchBelow: 50, onTargetFrom: 110, onTargetTo: 100 } } } },
    });
    expect(badThresholds.status).toBe(400);
    expect(badThresholds.json.error).toBe(
      'On-target range must start below where it ends, and above the Available threshold.',
    );
    const ok = await call(v2, 'PATCH', `/api/v2/orgs/${org}`, {
      token: admin.token,
      body: { version: 1, patch: { features: { aiAssistant: true }, defaultWorkspaceVisibility: 'members' } },
    });
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ version: 2, defaultWorkspaceVisibility: 'members' });
    expect((ok.json.features as { aiAssistant: boolean }).aiAssistant).toBe(true);
    const stale = await call(v2, 'PATCH', `/api/v2/orgs/${org}`, {
      token: admin.token,
      body: { version: 1, patch: { name: 'Y' } },
    });
    expect(stale.status).toBe(409);
    const ev = await db.query(`SELECT action FROM audit_events WHERE org_id = $1`, [org]);
    expect(ev.map((e) => e.action)).toContain('org.feature_change');
  });

  it('deletes a workspace only with the typed name, cascading in a transaction (ST-01#AC3)', async () => {
    const org = await createOrg(db, 'Del Org');
    const ws = await createWorkspace(db, org, 'Doomed');
    const admin = await createUser(db, { orgId: org, orgRole: 'ORG_ADMIN' });
    const p = await createPerson(db, ws);
    await createProject(db, ws);
    const wrong = await call(v2, 'DELETE', `/api/v2/workspaces/${ws}?confirmName=Nope`, { token: admin.token });
    expect(wrong.status).toBe(400);
    const ok = await call(v2, 'DELETE', `/api/v2/workspaces/${ws}?confirmName=Doomed`, { token: admin.token });
    expect(ok.status).toBe(204);
    expect(await db.query(`SELECT 1 FROM resources WHERE id = $1`, [p])).toHaveLength(0);
    expect(await db.query(`SELECT 1 FROM workspaces WHERE id = $1`, [ws])).toHaveLength(0);
  });
});

describe('structure (ORG-02)', () => {
  it('creates, renames with version, rejects duplicates and in-use deletes, allows archive', async () => {
    const org = await createOrg(db, 'Structure Org');
    const ws = await createWorkspace(db, org);
    const wsAdmin = await createUser(db, { orgId: org, orgRole: 'MEMBER' });
    const planner = await createUser(db, { orgId: org, orgRole: 'MEMBER' });
    await addMember(db, wsAdmin.id, ws, 'WORKSPACE_ADMIN');
    await addMember(db, planner.id, ws, 'PLANNER');
    const t = await call(v2, 'POST', `/api/v2/orgs/${org}/tribes`, {
      token: wsAdmin.token,
      body: { name: 'Payments', leadName: 'Sarah' },
    });
    expect(t.status).toBe(201);
    expect(
      (await call(v2, 'POST', `/api/v2/orgs/${org}/tribes`, { token: planner.token, body: { name: 'X' } })).status,
    ).toBe(403);
    const dup = await call(v2, 'POST', `/api/v2/orgs/${org}/tribes`, {
      token: wsAdmin.token,
      body: { name: 'payments' },
    });
    expect(dup.status).toBe(409);
    expect(dup.json.fields).toEqual({ name: 'Already exists' });
    const ren = await call(v2, 'PATCH', `/api/v2/orgs/${org}/tribes/${t.json.id}`, {
      token: wsAdmin.token,
      body: { version: 1, patch: { name: 'Payments & Cards' } },
    });
    expect(ren.json).toMatchObject({ name: 'Payments & Cards', version: 2 });
    const stale = await call(v2, 'PATCH', `/api/v2/orgs/${org}/tribes/${t.json.id}`, {
      token: wsAdmin.token,
      body: { version: 1, patch: { name: 'Z' } },
    });
    expect(stale.status).toBe(409);
    await createProject(db, ws, { tribeId: t.json.id });
    const inUse = await call(v2, 'DELETE', `/api/v2/orgs/${org}/tribes/${t.json.id}`, { token: wsAdmin.token });
    expect(inUse.status).toBe(409);
    expect(inUse.json.error).toBe('In use by 1 records. Archive it instead.');
    const arch = await call(v2, 'PATCH', `/api/v2/orgs/${org}/tribes/${t.json.id}`, {
      token: wsAdmin.token,
      body: { version: 2, patch: { archived: true } },
    });
    expect(arch.json.archived).toBe(true);
    const list = await call(v2, 'GET', `/api/v2/orgs/${org}/tribes`, { token: planner.token });
    expect((list.json as unknown as unknown[]).length).toBe(1);
  });

  it('crafts: rename keeps id, short code rules (ORG-02#AC3-4)', async () => {
    const org = await createOrg(db, 'Craft Org');
    const admin = await createUser(db, { orgId: org, orgRole: 'ORG_ADMIN' });
    const bad = await call(v2, 'POST', `/api/v2/orgs/${org}/crafts`, {
      token: admin.token,
      body: { name: 'Service Design', short: 'sd' },
    });
    expect(bad.status).toBe(400);
    expect(bad.json.fields).toEqual({ short: 'Use 2–4 uppercase letters or digits.' });
    const c = await call(v2, 'POST', `/api/v2/orgs/${org}/crafts`, {
      token: admin.token,
      body: { name: 'Service Design', short: 'SD' },
    });
    expect(c.status).toBe(201);
    expect(c.json.id).toBe('service-design');
    const dupShort = await call(v2, 'POST', `/api/v2/orgs/${org}/crafts`, {
      token: admin.token,
      body: { name: 'Other', short: 'SD' },
    });
    expect(dupShort.status).toBe(400);
    const ren = await call(v2, 'PATCH', `/api/v2/orgs/${org}/crafts/project-mgmt`, {
      token: admin.token,
      body: { version: 1, patch: { name: 'Project Delivery' } },
    });
    expect(ren.json).toMatchObject({ id: 'project-mgmt', name: 'Project Delivery', short: 'PM' });
  });
});

describe('members (AC-06)', () => {
  it('is tenant scoped: other-org PATCH is 404, plan is 400, last admin is 409, removal revokes sessions', async () => {
    const orgX = await createOrg(db, 'Org X');
    const orgY = await createOrg(db, 'Org Y');
    const wsX = await createWorkspace(db, orgX);
    const adminX = await createUser(db, { orgId: orgX, orgRole: 'ORG_ADMIN' });
    const userY = await createUser(db, { orgId: orgY, orgRole: 'MEMBER' });
    const memberX = await createUser(db, { orgId: orgX, orgRole: 'MEMBER' });
    const cross = await call(v2, 'PATCH', `/api/v2/orgs/${orgX}/members/${userY.id}`, {
      token: adminX.token,
      body: { orgRole: 'ORG_ADMIN' },
    });
    expect(cross.status).toBe(404);
    const plan = await call(v2, 'PATCH', `/api/v2/orgs/${orgX}/members/${memberX.id}`, {
      token: adminX.token,
      body: { plan: 'MAX' },
    });
    expect(plan.status).toBe(400);
    const su = await call(v2, 'PATCH', `/api/v2/orgs/${orgX}/members/${memberX.id}`, {
      token: adminX.token,
      body: { role: 'SUPERUSER' },
    });
    expect(su.status).toBe(400);
    const last = await call(v2, 'PATCH', `/api/v2/orgs/${orgX}/members/${adminX.id}`, {
      token: adminX.token,
      body: { orgRole: 'MEMBER' },
    });
    expect(last.status).toBe(409);
    expect(last.json.error).toBe('An organisation needs at least one Org Admin.');
    const ok = await call(v2, 'PATCH', `/api/v2/orgs/${orgX}/members/${memberX.id}`, {
      token: adminX.token,
      body: { workspaces: [{ workspaceId: wsX, role: 'PLANNER' }] },
    });
    expect(ok.status).toBe(200);
    expect(ok.json.workspaces).toEqual([{ workspaceId: wsX, role: 'PLANNER' }]);
    const legacy = await db.query(`SELECT role FROM workspace_members WHERE user_id = $1`, [memberX.id]);
    expect(legacy[0].role).toBe('WORKSPACE_OWNER');
    const ev = await db.query(`SELECT action FROM audit_events WHERE target_id = $1`, [memberX.id]);
    expect(ev.map((e) => e.action)).toContain('role.change');
    const del = await call(v2, 'DELETE', `/api/v2/orgs/${orgX}/members/${memberX.id}`, { token: adminX.token });
    expect(del.status).toBe(204);
    expect((await call(v2, 'GET', '/api/v2/me', { token: memberX.token })).status).toBe(401);
    const lastDel = await call(v2, 'DELETE', `/api/v2/orgs/${orgX}/members/${adminX.id}`, { token: adminX.token });
    expect(lastDel.status).toBe(409);
  });

  it('a WORKSPACE_ADMIN manages only their workspace members (AC-06#AC5)', async () => {
    const org = await createOrg(db, 'WSA Org');
    const ws1 = await createWorkspace(db, org, 'One');
    const ws2 = await createWorkspace(db, org, 'Two');
    const wsAdmin = await createUser(db, { orgId: org, orgRole: 'MEMBER' });
    const target = await createUser(db, { orgId: org, orgRole: 'MEMBER' });
    await addMember(db, wsAdmin.id, ws1, 'WORKSPACE_ADMIN');
    const ok = await call(v2, 'PATCH', `/api/v2/workspaces/${ws1}/members/${target.id}`, {
      token: wsAdmin.token,
      body: { role: 'PLANNER' },
    });
    expect(ok.status).toBe(200);
    const other = await call(v2, 'PATCH', `/api/v2/workspaces/${ws2}/members/${target.id}`, {
      token: wsAdmin.token,
      body: { role: 'PLANNER' },
    });
    expect(other.status).toBe(403);
    const orgRole = await call(v2, 'PATCH', `/api/v2/orgs/${org}/members/${target.id}`, {
      token: wsAdmin.token,
      body: { orgRole: 'ORG_ADMIN' },
    });
    expect(orgRole.status).toBe(403);
    const list = await call(v2, 'GET', `/api/v2/orgs/${org}/members`, { token: wsAdmin.token });
    const ids = list.json as unknown as Array<{ userId: string; workspaces: Array<{ workspaceId: string }> }>;
    expect(ids.every((m) => m.workspaces.every((w) => w.workspaceId === ws1))).toBe(true);
    const rm = await call(v2, 'DELETE', `/api/v2/workspaces/${ws1}/members/${target.id}`, { token: wsAdmin.token });
    expect(rm.status).toBe(204);
  });
});

describe('invitations (AC-05)', () => {
  it('invites a new user by link; accepting creates a verified account and signs in (AC-05#AC1, #AC6)', async () => {
    const org = await createOrg(db, 'Invite Org');
    const ws = await createWorkspace(db, org, 'Home');
    const admin = await createUser(db, { orgId: org, orgRole: 'ORG_ADMIN', name: 'Ada' });
    const r = await call(v2, 'POST', `/api/v2/orgs/${org}/invitations`, {
      token: admin.token,
      body: { email: 'Joiner@new.test', orgRole: 'MEMBER', workspaces: [{ workspaceId: ws, role: 'PLANNER' }] },
    });
    expect(r.status).toBe(201);
    const inviteUrl = r.json.inviteUrl as string;
    const token = inviteUrl.split('/invite/')[1];
    expect((r.json.invitation as { email: string }).email).toBe('joiner@new.test');
    expect(mails[0]).toMatchObject({ to: 'joiner@new.test', subject: 'Join Invite Org on PMO Capacity Planner' });
    const stored = await db.query(`SELECT token_hash FROM invitations WHERE id = $1`, [
      (r.json.invitation as { id: string }).id,
    ]);
    expect(stored[0].token_hash).not.toBe(token);
    const look = await call(v2, 'GET', `/api/v2/invitations/${token}`);
    expect(look.json).toMatchObject({
      email: 'joiner@new.test',
      orgName: 'Invite Org',
      existingUser: false,
      workspaces: [{ id: ws, name: 'Home', role: 'PLANNER' }],
    });
    const short = await call(v2, 'POST', `/api/v2/invitations/${token}/accept`, {
      body: { name: 'Jo', password: 'short' },
    });
    expect(short.status).toBe(400);
    const acc = await call(v2, 'POST', `/api/v2/invitations/${token}/accept`, {
      body: { name: 'Jo', password: 'a long enough pw' },
    });
    expect(acc.status).toBe(200);
    expect(cookieValue(acc.cookies, 'pcp_session')).toBeTruthy();
    const u = await db.query(`SELECT id, email_verified_at, org_id, role FROM users WHERE email = 'joiner@new.test'`);
    expect(u[0].email_verified_at).not.toBeNull();
    const wm = await db.query(`SELECT access_role FROM workspace_members WHERE user_id = $1`, [u[0].id]);
    expect(wm[0].access_role).toBe('PLANNER');
    const reuse = await call(v2, 'GET', `/api/v2/invitations/${token}`);
    expect(reuse.status).toBe(410);
    expect(reuse.json.error).toBe(
      'This invitation link has expired or was already used. Ask your admin for a new one.',
    );
    expect((await call(v2, 'GET', '/api/v2/invitations/unknown-token-value-1234567890')).status).toBe(404);
    const login = await call(auth, 'POST', '/api/auth/login', {
      body: { email: 'joiner@new.test', password: 'a long enough pw' },
    });
    expect(login.status).toBe(200);
  });

  it('never grants platform admin, 409s users of another org, leaves same-org users untouched (AC-05#AC3-5)', async () => {
    const org = await createOrg(db, 'Inv2');
    const ws = await createWorkspace(db, org);
    const admin = await createUser(db, { orgId: org, orgRole: 'ORG_ADMIN' });
    const outsider = await createUser(db, {
      email: 'outsider@else.test',
      orgId: await createOrg(db, 'Else'),
      orgRole: 'MEMBER',
    });
    const sameOrg = await createUser(db, { email: 'colleague@inv2.test', orgId: org, orgRole: 'MEMBER' });
    const su = await call(v2, 'POST', `/api/v2/orgs/${org}/invitations`, {
      token: admin.token,
      body: { email: 'x@y.test', orgRole: 'MEMBER', workspaces: [], role: 'SUPERUSER' },
    });
    expect(su.status).toBe(400);
    const otherOrgId = await call(v2, 'POST', `/api/v2/orgs/${org}/invitations`, {
      token: admin.token,
      body: { email: 'x@y.test', orgRole: 'MEMBER', workspaces: [], orgId: '00000000-0000-4000-8000-000000000000' },
    });
    expect(otherOrgId.status).toBe(403);
    const cross = await call(v2, 'POST', `/api/v2/orgs/${org}/invitations`, {
      token: admin.token,
      body: { email: 'outsider@else.test', orgRole: 'ORG_ADMIN', workspaces: [{ workspaceId: ws, role: 'VIEWER' }] },
    });
    expect(cross.status).toBe(409);
    expect(cross.json.error).toBe('This person belongs to another organisation.');
    const o = await db.query(`SELECT org_id, role FROM users WHERE id = $1`, [outsider.id]);
    expect(o[0].org_id).toBe(outsider.org_id);
    const same = await call(v2, 'POST', `/api/v2/orgs/${org}/invitations`, {
      token: admin.token,
      body: { email: 'colleague@inv2.test', orgRole: 'ORG_ADMIN', workspaces: [{ workspaceId: ws, role: 'PLANNER' }] },
    });
    expect(same.status).toBe(201);
    const after = await db.query(`SELECT role, password_hash = $2 AS same_pw FROM users WHERE id = $1`, [
      sameOrg.id,
      (await db.query(`SELECT password_hash FROM users WHERE id = $1`, [sameOrg.id]))[0].password_hash,
    ]);
    expect(after[0]).toEqual({ role: 'USER', same_pw: true });
    const om = await db.query(`SELECT role FROM org_memberships WHERE user_id = $1`, [sameOrg.id]);
    expect(om[0].role).toBe('MEMBER');
  });

  it('a WORKSPACE_ADMIN may only invite to workspaces they administer, as MEMBER (AC-05#AC2)', async () => {
    const org = await createOrg(db, 'Inv3');
    const ws1 = await createWorkspace(db, org, 'Mine');
    const ws2 = await createWorkspace(db, org, 'Not mine');
    const wsAdmin = await createUser(db, { orgId: org, orgRole: 'MEMBER' });
    await addMember(db, wsAdmin.id, ws1, 'WORKSPACE_ADMIN');
    const ok = await call(v2, 'POST', `/api/v2/orgs/${org}/invitations`, {
      token: wsAdmin.token,
      body: { email: 'a@inv3.test', orgRole: 'MEMBER', workspaces: [{ workspaceId: ws1, role: 'WORKSPACE_ADMIN' }] },
    });
    expect(ok.status).toBe(201);
    const notMine = await call(v2, 'POST', `/api/v2/orgs/${org}/invitations`, {
      token: wsAdmin.token,
      body: { email: 'b@inv3.test', orgRole: 'MEMBER', workspaces: [{ workspaceId: ws2, role: 'VIEWER' }] },
    });
    expect(notMine.status).toBe(403);
    const asAdmin = await call(v2, 'POST', `/api/v2/orgs/${org}/invitations`, {
      token: wsAdmin.token,
      body: { email: 'c@inv3.test', orgRole: 'ORG_ADMIN', workspaces: [{ workspaceId: ws1, role: 'VIEWER' }] },
    });
    expect(asAdmin.status).toBe(403);
    const list = await call(v2, 'GET', `/api/v2/orgs/${org}/invitations`, { token: wsAdmin.token });
    expect((list.json as unknown as unknown[]).length).toBe(1);
    const revoke = await call(
      v2,
      'DELETE',
      `/api/v2/orgs/${org}/invitations/${(ok.json.invitation as { id: string }).id}`,
      { token: wsAdmin.token },
    );
    expect(revoke.status).toBe(204);
    expect(
      (await call(v2, 'GET', `/api/v2/invitations/${(ok.json.inviteUrl as string).split('/invite/')[1]}`)).status,
    ).toBe(410);
  });

  it('an existing user without an org accepts with their password', async () => {
    const org = await createOrg(db, 'Inv4');
    const admin = await createUser(db, { orgId: org, orgRole: 'ORG_ADMIN' });
    await createUser(db, { email: 'solo@inv4.test' });
    const inv = await call(v2, 'POST', `/api/v2/orgs/${org}/invitations`, {
      token: admin.token,
      body: { email: 'solo@inv4.test', orgRole: 'MEMBER', workspaces: [] },
    });
    const token = (inv.json.inviteUrl as string).split('/invite/')[1];
    const wrong = await call(v2, 'POST', `/api/v2/invitations/${token}/accept`, {
      body: { password: 'wrong password!' },
    });
    expect(wrong.status).toBe(401);
    const ok = await call(v2, 'POST', `/api/v2/invitations/${token}/accept`, { body: { password: PASSWORD } });
    expect(ok.status).toBe(200);
  });
});

describe('audit (AC-10)', () => {
  it('ORG_ADMIN reads org events (JSON and CSV), WORKSPACE_ADMIN only their workspace, others 403', async () => {
    const org = await createOrg(db, 'Audit Org');
    const ws = await createWorkspace(db, org);
    const admin = await createUser(db, { orgId: org, orgRole: 'ORG_ADMIN' });
    const wsAdmin = await createUser(db, { orgId: org, orgRole: 'MEMBER' });
    const planner = await createUser(db, { orgId: org, orgRole: 'MEMBER' });
    await addMember(db, wsAdmin.id, ws, 'WORKSPACE_ADMIN');
    await addMember(db, planner.id, ws, 'PLANNER');
    await call(v2, 'POST', `/api/v2/workspaces/${ws}/people`, { token: admin.token, body: { name: 'Audited' } });
    const all = await call(v2, 'GET', `/api/v2/orgs/${org}/audit`, { token: admin.token });
    expect(all.status).toBe(200);
    const events = all.json.events as Array<{ action: string; after: unknown; workspaceId: string }>;
    expect(events[0]).toMatchObject({ action: 'person.create', workspaceId: ws });
    const csv = await call(v2, 'GET', `/api/v2/orgs/${org}/audit?format=csv`, { token: admin.token });
    expect(csv.headers['Content-Type']).toMatch(/text\/csv/);
    expect(csv.body.split('\n')[0]).toBe(
      'occurredAt,actor,actorType,action,workspaceId,targetType,targetId,before,after,requestId',
    );
    expect((await call(v2, 'GET', `/api/v2/orgs/${org}/audit`, { token: wsAdmin.token })).status).toBe(403);
    expect(
      (await call(v2, 'GET', `/api/v2/orgs/${org}/audit?workspaceId=${ws}`, { token: wsAdmin.token })).status,
    ).toBe(200);
    expect(
      (await call(v2, 'GET', `/api/v2/orgs/${org}/audit?workspaceId=${ws}`, { token: planner.token })).status,
    ).toBe(403);
    const exp = await call(v2, 'POST', `/api/v2/workspaces/${ws}/audit/export`, {
      token: planner.token,
      body: { kind: 'pdf', report: 'qbr-pack' },
    });
    expect(exp.status).toBe(204);
  });

  it('a rolled-back write leaves no audit row (AC-10#AC2)', async () => {
    const org = await createOrg(db, 'Rollback Org');
    const ws = await createWorkspace(db, org);
    const admin = await createUser(db, { orgId: org, orgRole: 'ORG_ADMIN' });
    const before = await db.query(`SELECT count(*)::int AS n FROM audit_events WHERE workspace_id = $1`, [ws]);
    const r = await call(v2, 'POST', `/api/v2/workspaces/${ws}/allocations/batch`, {
      token: admin.token,
      body: { ops: [{ op: 'create', allocation: { resourceId: 'missing', projectId: 'missing', percentage: 10 } }] },
    });
    expect(r.status).toBe(400);
    const after = await db.query(`SELECT count(*)::int AS n FROM audit_events WHERE workspace_id = $1`, [ws]);
    expect(after[0].n).toBe(before[0].n);
  });

  it('redacts secrets in before/after (AC-10#AC3)', async () => {
    const { redact } = await import('../../netlify/functions/_lib/audit');
    expect(redact({ name: 'x', password_hash: 'h', nested: { apiToken: 't', otp: '1', secret_enc: 's' } })).toEqual({
      name: 'x',
      password_hash: '[redacted]',
      nested: { apiToken: '[redacted]', otp: '[redacted]', secret_enc: '[redacted]' },
    });
  });
});
