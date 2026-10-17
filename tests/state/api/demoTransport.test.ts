/** @jest-environment node */
import { createApiClient, type ApiClient } from '../../../services/api/client';
import { DemoTransport, demoOptionsFromSearch } from '../../../services/api/demoTransport';
import { ApiRequestError } from '../../../services/api/errors';
import { DEMO_OTP, DEMO_PASSWORD, type DemoRole } from '../../../services/api/demo/seed';
import { setClock } from '../../../utils/clock';
import type * as D from '../../../shared/contracts/dto';

const WS = 'demo';

function client(
  role: DemoRole = 'ORG_ADMIN',
  o: ConstructorParameters<typeof DemoTransport>[0] = {},
): { api: ApiClient; t: DemoTransport } {
  const t = new DemoTransport({ role, ...o });
  return { api: createApiClient(t), t };
}

async function err(p: Promise<unknown>): Promise<ApiRequestError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiRequestError) return e;
    throw e;
  }
  throw new Error('expected an ApiRequestError');
}

beforeAll(() => setClock('2026-10-16'));
afterAll(() => setClock());

describe('DemoTransport: session and identity', () => {
  it('starts signed in as the demo user with the role from ?demoRole', async () => {
    expect(demoOptionsFromSearch('?demoRole=VIEWER&demoPlatformAdmin=1')).toEqual({
      role: 'VIEWER',
      isPlatformAdmin: true,
      signedIn: undefined,
    });
    expect(demoOptionsFromSearch('?demoRole=NOPE&demoSignedOut=1')).toEqual({
      role: undefined,
      isPlatformAdmin: false,
      signedIn: false,
    });
    const { api } = client('CONTRIBUTOR');
    const me = await api.auth.me();
    expect(me.user.name).toBe('Demo User');
    expect(me.workspaces[0]).toMatchObject({ id: WS, role: 'CONTRIBUTOR', linkedPersonId: 'r9', implicit: false });
    expect(me.workspaces[0].permissions).toContain('people.write.own');
    expect(me.workspaces[0].permissions).not.toContain('people.write');
    expect(me.entitlements.plan).toBe('ENTERPRISE');
    expect(me.org?.features.aiAssistant).toBe(false);
  });

  it('ORG_ADMIN implies PMO Admin in every workspace', async () => {
    const me = await client('ORG_ADMIN').api.auth.me();
    expect(me.org?.role).toBe('ORG_ADMIN');
    expect(me.workspaces[0].role).toBe('WORKSPACE_ADMIN');
    expect(me.workspaces[0].permissions).toEqual(
      expect.arrayContaining(['org.manage', 'structure.write', 'integrations.manage']),
    );
  });

  it('checks passwords and 2FA codes when acceptAnyPassword is off', async () => {
    const { api } = client('PLANNER', { acceptAnyPassword: false, signedIn: false });
    expect((await err(api.auth.me())).status).toBe(401);
    expect((await err(api.auth.login({ email: 'tom.hayes@company.ie', password: 'nope' }))).status).toBe(401);
    await expect(api.auth.login({ email: 'twofa@example.com', password: DEMO_PASSWORD })).resolves.toEqual({
      require2FA: true,
      email: 'twofa@example.com',
    });
    expect(
      (await err(api.auth.login({ email: 'twofa@example.com', password: DEMO_PASSWORD, otp: '000000' }))).status,
    ).toBe(401);
    const ok = await api.auth.login({ email: 'twofa@example.com', password: DEMO_PASSWORD, otp: DEMO_OTP });
    expect('user' in ok && ok.user.twoFactorEnabled).toBe(true);
    await api.auth.logout();
    expect((await err(api.auth.refresh())).status).toBe(401);
  });

  it('internal mode refuses self-registration; legacy routes are 410', async () => {
    const { api, t } = client();
    expect(await err(api.auth.register({ email: 'a@b.co', password: 'longenough1', name: 'A' }))).toMatchObject({
      status: 403,
    });
    expect(await err(t.request('POST', '/api/workspace', {}))).toMatchObject({ status: 410, code: 'gone' });
    expect(await err(t.request('POST', '/api/auth/users/invite', {}))).toMatchObject({ status: 410 });
    expect(await err(t.request('GET', '/api/v2/nope'))).toMatchObject({ status: 404 });
  });
});

describe('DemoTransport: snapshot and permissions', () => {
  it('serves the demo workspace built from constants.ts', async () => {
    const s = await client().api.workspace.snapshot(WS);
    expect(s.people).toHaveLength(10);
    expect(s.projects).toHaveLength(7);
    expect(s.crafts).toHaveLength(12);
    expect(s.tribes.map((t) => t.name).sort()).toEqual(['Digital', 'Lending', 'Operations', 'Payments']);
    expect(s.projects.find((p) => p.id === 'p3')?.tribeId).toBe('tribe-lending');
    expect(s.demand.find((l) => l.projectId === 'p7')?.status).toBe('Forecast'); // Pipeline
    expect(s.demand.find((l) => l.projectId === 'p6')?.status).toBe('Confirmed'); // Mobilising
    expect(s.allocations.find((a) => a.id === 'a9')).toMatchObject({ source: 'planview', externalRef: 'PVA-9' });
    expect(s.delivery?.byProjectQbr1.length).toBe(3);
  });

  it('filters craft-change requests by role (all, own, none)', async () => {
    expect((await client('PLANNER').api.workspace.snapshot(WS)).craftRequests).toHaveLength(1);
    expect((await client('CONTRIBUTOR').api.workspace.snapshot(WS)).craftRequests).toHaveLength(0); // r9's own: none
    expect((await client('VIEWER').api.workspace.snapshot(WS)).craftRequests).toHaveLength(0);
  });

  it.each([
    ['VIEWER', 'people.update', 403],
    ['CONTRIBUTOR', 'people.update', 403],
    ['PLANNER', 'people.update', 200],
    ['PLANNER', 'structure', 403],
    ['WORKSPACE_ADMIN', 'structure', 200],
    ['VIEWER', 'export', 200],
  ] as Array<[DemoRole, string, number]>)('%s → %s is %i', async (role, action, status) => {
    const { api } = client(role);
    const run = () => {
      if (action === 'people.update') return api.people.update(WS, 'r1', { version: 1, patch: { location: 'Cork' } });
      if (action === 'structure') return api.structure.create('demo-org', 'teams', { name: 'New team' });
      return api.workspace.exportAudit(WS, { kind: 'csv', report: 'bookings' });
    };
    if (status === 200) await expect(run()).resolves.not.toThrow();
    else expect((await err(run())).status).toBe(status);
  });

  it('lets a squad member edit only their own profile fields', async () => {
    const { api } = client('CONTRIBUTOR');
    await expect(api.people.update(WS, 'r9', { version: 1, patch: { location: 'Galway' } })).resolves.toMatchObject({
      location: 'Galway',
      version: 2,
    });
    expect((await err(api.people.update(WS, 'r9', { version: 2, patch: { targetUtil: 50 } }))).status).toBe(403);
    expect((await err(api.people.update(WS, 'r8', { version: 1, patch: { location: 'x' } }))).status).toBe(403);
  });
});

describe('DemoTransport: versioned writes', () => {
  it('bumps versions, rejects stale versions with the latest row, and validates input', async () => {
    const { api } = client('PLANNER');
    const p = await api.people.update(WS, 'r2', { version: 1, patch: { targetUtil: 80 } });
    expect(p).toMatchObject({ version: 2, targetUtil: 80 });
    const e = await err(api.people.update(WS, 'r2', { version: 1, patch: { targetUtil: 70 } }));
    expect(e).toMatchObject({ status: 409, code: 'conflict' });
    expect(e.body).toMatchObject({ current: { version: 2, targetUtil: 80 }, changedBy: { name: 'Demo User' } });
    expect((await err(api.people.update(WS, 'r2', { version: 2, patch: { targetUtil: 200 } }))).fields).toEqual({
      targetUtil: 'Target must be 0–150',
    });
    expect((await err(api.people.update(WS, 'r2', { patch: {} } as never))).fields).toEqual({ version: 'Required' });
    expect((await err(api.people.create(WS, { name: 'Bad id', id: 'not-a-uuid' }))).fields).toEqual({
      id: 'Must be a UUID',
    });
  });

  it('requires a tribe on new projects (PPL-07#AC4)', async () => {
    const { api } = client('PLANNER');
    expect((await err(api.projects.create(WS, { name: 'X' }))).fields).toEqual({ tribeId: 'Choose a tribe' });
    await expect(api.projects.create(WS, { name: 'X', tribeId: 'tribe-digital' })).resolves.toMatchObject({
      source: 'manual',
      version: 1,
    });
  });

  it('enforces plan limits on create only (public BASIC plan, PL-07#AC4)', async () => {
    const { api } = client('ORG_ADMIN', { appMode: 'public', plan: 'BASIC' });
    const me = await api.auth.me();
    expect(me.entitlements.maxPeople).toBe(5);
    const e = await err(api.people.create(WS, { name: 'Eleventh' }));
    expect(e).toMatchObject({ status: 403, code: 'entitlement' });
    await expect(api.people.update(WS, 'r1', { version: 1, patch: { location: 'Cork' } })).resolves.toBeTruthy();
    expect((await err(api.people.import(WS, { rows: [], createMissingStructure: false }))).code).toBe('entitlement');
  });

  it('CSV import validates crafts against the catalogue exactly like the API (QA-005)', async () => {
    const { api } = client('PLANNER');
    const res = await api.people.import(WS, {
      rows: [
        {
          name: 'Long Craft Id',
          aboveCraft: 'business-analysis',
          belowCrafts: [{ craftId: 'SM', proficiency: 2, maxPct: 30 }],
        },
        { name: 'Lower Short', aboveCraft: 'pm' },
        { name: 'Unknown Above', aboveCraft: 'not-a-craft-in-this-org' },
        { name: 'Unknown Below', belowCrafts: [{ craftId: 'nope', proficiency: 1, maxPct: 10 }] },
      ],
      createMissingStructure: false,
    });
    expect(res).toEqual({
      created: 2,
      updated: 0,
      skipped: 2,
      errors: [
        { row: 3, message: "Unknown craft 'not-a-craft-in-this-org'" },
        { row: 4, message: "Unknown craft 'nope'" },
      ],
    });
    const snap = await api.workspace.snapshot(WS);
    expect(snap.people.find((p) => p.name === 'Long Craft Id')).toMatchObject({
      primaryCraft: 'business-analysis',
      secondaryCrafts: [{ craftId: 'scrum-master', proficiency: 2, maxPct: 30 }],
    });
    expect(snap.people.find((p) => p.name === 'Lower Short')?.primaryCraft).toBe('project-mgmt');
  });

  it('demand: validates, rejects duplicates, batches atomically', async () => {
    const { api } = client('PLANNER');
    const line = {
      projectId: 'p3',
      quarterKey: '2027-Q2',
      craftId: 'change-mgmt',
      fte: 0.5,
      status: 'Confirmed' as const,
      ownerUserId: null,
      note: null,
    };
    const created = await api.demand.create(WS, line);
    expect(created).toMatchObject({ fte: 0.5, version: 1 });
    expect((await err(api.demand.create(WS, line))).status).toBe(409);
    const before = (await api.workspace.snapshot(WS)).demand.length;
    const e = await err(
      api.demand.batch(WS, [
        { op: 'update', id: created.id, version: 1, patch: { fte: 1 } },
        { op: 'update', id: created.id, version: 99, patch: { fte: 2 } },
      ]),
    );
    expect(e.status).toBe(409);
    expect(e.fields?.['ops.1']).toBeDefined();
    const after = await api.workspace.snapshot(WS);
    expect(after.demand).toHaveLength(before);
    expect(after.demand.find((l) => l.id === created.id)?.fte).toBe(0.5); // nothing applied
  });
});

describe('DemoTransport: allocations', () => {
  it('applies batches atomically and returns upserted, deleted and dataVersion', async () => {
    const { api } = client('PLANNER');
    const dv = (await api.workspace.snapshot(WS)).workspace.dataVersion;
    const id = '3b2e8f0c-1d2a-4c3b-9e8f-0a1b2c3d4e5f';
    const r = await api.allocations.batch(
      WS,
      [
        { op: 'create', allocation: { id, resourceId: 'r4', projectId: 'p1', percentage: 20 } },
        { op: 'update', id: 'a1', version: 1, patch: { percentage: 10 } },
        { op: 'delete', id: 'a2', version: 1 },
      ],
      'rebalance',
    );
    expect(r.upserted.map((a) => a.id).sort()).toEqual(['a1', id].sort());
    expect(r.deleted).toEqual(['a2']);
    expect(r.dataVersion).toBe(dv + 1);
    const e = await err(
      api.allocations.batch(WS, [{ op: 'update', id: 'a3', version: 1, patch: { percentage: 999 } }]),
    );
    expect(e).toMatchObject({ status: 400 });
    expect(e.fields?.['ops.0']).toBeDefined();
  });

  it('locks Planview bookings unless the org allows overrides (AL-05#AC2)', async () => {
    const { api } = client('ORG_ADMIN');
    const locked = await err(
      api.allocations.batch(WS, [{ op: 'update', id: 'a9', version: 1, patch: { percentage: 10 } }]),
    );
    expect(locked).toMatchObject({ status: 409, message: 'Locked: sourced from Planview' });
    const org = await api.orgs.get('demo-org');
    await api.orgs.update('demo-org', {
      version: org.version,
      patch: { planning: { ...org.planning, planviewOwnership: 'overridable' } },
    });
    const r = await api.allocations.batch(WS, [{ op: 'update', id: 'a9', version: 1, patch: { percentage: 10 } }]);
    expect(r.upserted[0]).toMatchObject({ percentage: 10, source: 'manual', externalRef: 'PVA-9' });
  });

  it('rejects batches over 500 operations with 413', async () => {
    const ops = Array.from({ length: 501 }, () => ({ op: 'delete' as const, id: 'a1', version: 1 }));
    expect(await err(client('PLANNER').api.allocations.batch(WS, ops))).toMatchObject({
      status: 413,
      code: 'payload_too_large',
    });
  });

  it('propose → tentative → accept by the linked person (DM-03, PPL-05)', async () => {
    const planner = client('PLANNER');
    const proposal = await planner.api.marketplace.propose(WS, {
      demandLineId: 'd-p3-2027-Q1-business-analysis',
      projectId: 'p3',
      resourceId: 'r9',
      craftId: 'business-analysis',
      quarterKey: '2027-Q1',
      percentage: 30,
      startDate: '2027-01-11',
      endDate: '2027-03-31',
    });
    expect(proposal).toMatchObject({ state: 'tentative', source: 'marketplace', proposedBy: { name: 'Demo User' } });
    // A second identical proposal is not double-proposed.
    expect(
      (
        await err(
          planner.api.marketplace.propose(WS, {
            ...proposal,
            demandLineId: proposal.demandLineId,
            quarterKey: '2027-Q1',
          } as never),
        )
      ).status,
    ).toBe(409);
    // Squad member r9 is the demo user's linked person: they can respond, others cannot.
    const squad = new DemoTransport({ role: 'CONTRIBUTOR', db: planner.t.dump() });
    const squadApi = createApiClient(squad);
    const accepted = await squadApi.allocations.respond(WS, proposal.id, { decision: 'accept' });
    expect(accepted).toMatchObject({ state: 'confirmed', version: 2 });
    expect(accepted.respondedAt).toBeTruthy();
    expect((await err(squadApi.allocations.respond(WS, proposal.id, { decision: 'decline' }))).status).toBe(409);
    const viewer = createApiClient(new DemoTransport({ role: 'VIEWER', db: planner.t.dump() }));
    expect((await err(viewer.marketplace.propose(WS, { ...proposal } as never))).status).toBe(403);
  });

  it('offers: own for squad members, any for planners (DM-05#AC3)', async () => {
    const squad = client('CONTRIBUTOR').api;
    await expect(
      squad.marketplace.setOffer(WS, 'r9', '2026-Q4', { pct: 30, craftIds: ['scrum-master'], note: 'Free' }),
    ).resolves.toMatchObject({ pct: 30 });
    expect(
      (await err(squad.marketplace.setOffer(WS, 'r8', '2026-Q4', { pct: 30, craftIds: [], note: null }))).status,
    ).toBe(403);
    await expect(squad.marketplace.withdrawOffer(WS, 'r9', '2026-Q4')).resolves.toBeUndefined();
  });
});

describe('DemoTransport: craft changes and structure', () => {
  it('craft change: own request only, approval updates the person (PPL-06)', async () => {
    const squad = client('CONTRIBUTOR').api;
    const crafts: D.SecondaryCraftDTO[] = [{ craftId: 'change-mgmt', proficiency: 2, maxPct: 30 }];
    const req = await squad.people.requestCraftChange(WS, 'r9', crafts);
    expect(req.status).toBe('pending');
    expect((await err(squad.people.requestCraftChange(WS, 'r8', crafts))).status).toBe(403);
    expect((await err(squad.craftRequests.decide(WS, req.id, 'approve'))).status).toBe(403);
    expect(
      (await err(squad.people.requestCraftChange(WS, 'r9', [{ craftId: 'project-mgmt', proficiency: 3, maxPct: 10 }])))
        .fields,
    ).toEqual({
      'secondaryCrafts.0': 'Already their above-the-table craft',
    });
  });

  it('planner approval and rejection rules', async () => {
    const { api } = client('PLANNER');
    expect((await err(api.craftRequests.decide(WS, 'cr-1', 'reject'))).fields).toEqual({ reason: 'Give a reason' });
    const approved = await api.craftRequests.decide(WS, 'cr-1', 'approve');
    expect(approved).toMatchObject({ status: 'approved', decidedBy: { name: 'Demo User' } });
    const s = await api.workspace.snapshot(WS);
    expect(s.people.find((p) => p.id === 'r8')?.secondaryCrafts.map((c) => c.craftId)).toContain('change-mgmt');
    expect((await err(api.craftRequests.decide(WS, 'cr-1', 'approve'))).status).toBe(409);
  });

  it('structure: unique names, craft short codes, in-use delete, archive (ORG-02)', async () => {
    const { api } = client('WORKSPACE_ADMIN');
    expect(await err(api.structure.create('demo-org', 'tribes', { name: 'digital' }))).toMatchObject({
      status: 409,
      fields: { name: 'Already exists' },
    });
    expect(
      (await err(api.structure.create('demo-org', 'crafts', { name: 'Service Design', short: 'sd' }))).fields,
    ).toEqual({
      short: 'Use 2–4 capital letters or digits',
    });
    const sd = await api.structure.create('demo-org', 'crafts', { name: 'Service Design', short: 'SD' });
    expect(sd).toMatchObject({ id: 'service-design', short: 'SD', archived: false, version: 1 });
    const renamed = await api.structure.update('demo-org', 'crafts', 'service-design', {
      version: 1,
      patch: { name: 'Service & Experience Design' },
    });
    expect(renamed).toMatchObject({ id: 'service-design', version: 2 });
    const inUse = await err(api.structure.remove('demo-org', 'crafts', 'project-mgmt'));
    expect(inUse.message).toMatch(/^In use by \d+ records\. Archive it instead\.$/);
    await expect(
      api.structure.update('demo-org', 'crafts', 'project-mgmt', { version: 1, patch: { archived: true } }),
    ).resolves.toMatchObject({ archived: true });
    await expect(api.structure.remove('demo-org', 'crafts', 'service-design')).resolves.toBeUndefined();
  });

  it('rejects invalid planning thresholds with the shared message (ST-03#AC2)', async () => {
    const { api } = client('ORG_ADMIN');
    const org = await api.orgs.get('demo-org');
    const e = await err(
      api.orgs.update('demo-org', {
        version: org.version,
        patch: { planning: { ...org.planning, thresholds: { benchBelow: 50, onTargetFrom: 110, onTargetTo: 100 } } },
      }),
    );
    expect(e.message).toBe('On-target range must start below where it ends, and above the Available threshold.');
  });
});

describe('DemoTransport: members, invitations, AI', () => {
  it('invites, looks up, accepts and signs the new user in (AC-05)', async () => {
    const { api } = client('ORG_ADMIN');
    expect(
      (
        await err(
          api.invitations.create('demo-org', {
            email: 'x@y.co',
            orgRole: 'MEMBER',
            workspaces: [],
            role: 'SUPERUSER',
          } as never),
        )
      ).status,
    ).toBe(400);
    const inv = await api.invitations.create('demo-org', {
      email: 'new.person@example.com',
      orgRole: 'MEMBER',
      workspaces: [{ workspaceId: WS, role: 'PLANNER' }],
    });
    const token = inv.inviteUrl.split('/').pop()!;
    await expect(api.invitations.lookup(token)).resolves.toMatchObject({
      email: 'new.person@example.com',
      existingUser: false,
    });
    expect((await err(api.invitations.accept(token, { name: 'New', password: 'short' }))).fields).toEqual({
      password: 'Use at least 10 characters',
    });
    const accepted = await api.invitations.accept(token, { name: 'New Person', password: 'long-enough-1' });
    expect(accepted.user.emailVerified).toBe(true);
    const me = await api.auth.me();
    expect(me.user.email).toBe('new.person@example.com');
    expect(me.workspaces[0].role).toBe('PLANNER');
    expect((await err(api.invitations.lookup(token))).status).toBe(410);
  });

  it('protects the last Org Admin and rejects plan changes (AC-06)', async () => {
    const { api } = client('ORG_ADMIN');
    expect((await err(api.members.update('demo-org', 'demo-user', { orgRole: 'MEMBER' }))).status).toBe(409);
    expect((await err(api.members.update('demo-org', 'u-tom', { plan: 'MAX' } as never))).fields).toEqual({
      plan: 'Plan is managed by billing.',
    });
    expect((await err(api.members.list('other-org'))).status).toBe(404);
    const planner = client('PLANNER').api;
    expect((await err(planner.members.list('demo-org'))).status).toBe(403);
  });

  it('AI is 403 feature_disabled until enabled, then answers and counts the quota', async () => {
    const { api } = client('ORG_ADMIN');
    expect(await err(api.ai.ask(WS, 'How are we doing?'))).toMatchObject({ status: 403, code: 'feature_disabled' });
    const org = await api.orgs.get('demo-org');
    await api.orgs.update('demo-org', {
      version: org.version,
      patch: { features: { ...org.features, aiAssistant: true } },
    });
    const { answer } = await api.ai.ask(WS, 'How are we doing?');
    expect(answer).toMatch(/QBR1/);
    expect((await err(api.ai.ask(WS, 'x'.repeat(2001)))).status).toBe(400);
  });
});

describe('DemoTransport: integrations', () => {
  it('Jira: auto-match by key then name, save mappings, sync steps to success (JI-01/02)', async () => {
    const { api } = client('PLANNER');
    await api.projects.update(WS, 'p6', { version: 1, patch: { jiraKey: 'ORION' } });
    const m = await api.jira.autoMatch(WS);
    expect(m.projects.find((x) => x.jiraKey === 'ORION')).toMatchObject({
      projectId: 'p6',
      matchMethod: 'key',
      confirmed: false,
    });
    expect(m.projects.find((x) => x.jiraKey === 'DATA')?.matchMethod).toBe('none');
    const saved = await api.jira.saveProjectMappings(WS, [
      { ...m.projects.find((x) => x.jiraKey === 'ORION')!, confirmed: true },
    ]);
    expect(saved.projects.find((x) => x.jiraKey === 'ORION')?.confirmed).toBe(true);
    let { job } = await api.sync.startJira(WS);
    expect((await api.sync.startJira(WS)).job.id).toBe(job.id); // no duplicate while running
    while (job.status !== 'succeeded') ({ job } = await api.sync.step(WS, job.id));
    expect(job.pagesDone).toBe(3);
    expect((await api.sync.health(WS)).state).toBe('ok');
  });

  it('calibration: defaults per tribe, note required, versioned (JI-04)', async () => {
    const { api } = client('PLANNER');
    const list = await api.calibration.list(WS);
    expect(list.find((c) => c.tribeId === 'tribe-lending')).toMatchObject({
      isDefault: true,
      pointsPerSprintPerFte: 10,
      version: 0,
    });
    expect(
      (
        await err(
          api.calibration.save(WS, 'tribe-lending', {
            pointsPerSprintPerFte: 8,
            sprintLengthDays: 14,
            note: '',
            version: 0,
          }),
        )
      ).fields?.note,
    ).toBe('Why are you changing this?');
    const saved = await api.calibration.save(WS, 'tribe-lending', {
      pointsPerSprintPerFte: 8,
      sprintLengthDays: 14,
      note: 'Smaller stories',
      version: 0,
    });
    expect(saved).toMatchObject({ isDefault: false, version: 1, note: 'Smaller stories' });
    expect((await err(client('VIEWER').api.calibration.list(WS))).status).toBe(403);
  });

  it('delivery rows filter by tribe and aggregate per sprint', async () => {
    const { api } = client('VIEWER');
    const rows = await api.delivery.rows(WS, { groupBy: 'tribe', tribeId: 'tribe-digital' });
    expect(rows).toHaveLength(6);
    expect(rows.every((r) => r.tribeId === 'tribe-digital' && r.projectId === null)).toBe(true);
    expect(
      (await api.delivery.rows(WS, { groupBy: 'sprint', projectId: 'p2' })).every((r) => r.projectId === 'p2'),
    ).toBe(true);
  });

  it('Planview: preview, apply, second preview shows no changes, expired preview is 409 (PV-01)', async () => {
    const { api } = client('PLANNER');
    const pv = await api.planview.preview(WS);
    expect(pv.projects.new.map((p) => p.externalId)).toEqual(['PV-1001']);
    expect(pv.projects.changed[0].changes).toEqual([{ field: 'endDate', from: '2027-06-30', to: '2027-08-31' }]);
    expect(pv.assignments.changed.map((a) => a.externalId)).toEqual(['PVA-23']);
    expect(pv.assignments.unmatchedPeople.map((p) => p.name)).toEqual(['Jordan Blake']);
    const res = await api.planview.apply(WS, {
      previewId: pv.previewId,
      accept: { projects: ['PV-0004', 'PV-1001'], assignments: ['PVA-23', 'PVA-31', 'PVA-40'] },
      personMatches: { 'pv-jb': 'r2' },
    });
    expect(res).toEqual({ created: 3, updated: 2, skipped: 0 });
    const again = await api.planview.preview(WS);
    expect(
      [again.projects.new, again.projects.changed, again.assignments.new, again.assignments.changed].map(
        (x) => x.length,
      ),
    ).toEqual([0, 0, 0, 0]);
    expect(
      await err(
        api.planview.apply(WS, {
          previewId: pv.previewId,
          accept: { projects: [], assignments: [] },
          personMatches: {},
        }),
      ),
    ).toMatchObject({
      status: 409,
      message: 'This preview expired. Run it again.',
    });
    const s = await api.workspace.snapshot(WS);
    expect(s.allocations.filter((a) => a.source === 'manual' && a.resourceId === 'r10')).toHaveLength(1); // manual a24 untouched
  });
});

describe('DemoTransport: persistence, isolation and sample data', () => {
  it('persists to the given storage and restores on a new transport', async () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    };
    const a = createApiClient(new DemoTransport({ storage }));
    await a.people.update(WS, 'r1', { version: 1, patch: { location: 'Cork' } });
    const b = createApiClient(new DemoTransport({ storage }));
    expect((await b.workspace.snapshot(WS)).people.find((p) => p.id === 'r1')?.location).toBe('Cork');
  });

  it('returns copies: mutating a response never changes the database', async () => {
    const { api } = client();
    const s = await api.workspace.snapshot(WS);
    s.people[0].name = 'Hacked';
    expect((await api.workspace.snapshot(WS)).people[0].name).not.toBe('Hacked');
  });

  it('sample data installs only into an empty workspace, with fresh UUIDs', async () => {
    const { api } = client('ORG_ADMIN');
    expect((await err(api.workspace.installSampleData(WS))).status).toBe(409);
    const ws = await api.orgs.createWorkspace('demo-org', 'Second');
    const s = await api.workspace.installSampleData(ws.id);
    expect(s.people).toHaveLength(10);
    expect(s.people.every((p) => /^[0-9a-f-]{36}$/.test(p.id))).toBe(true);
    expect(s.allocations.every((a) => s.people.some((p) => p.id === a.resourceId))).toBe(true);
  });
});
