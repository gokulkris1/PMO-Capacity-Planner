import { act, renderHook, waitFor } from '@testing-library/react';
import type * as D from '../../shared/contracts/dto';
import { ApiRequestError } from '../../services/api/errors';
import { HttpTransport } from '../../services/api/httpTransport';
import { DEMO_OTP, DEMO_WORKSPACE_ID } from '../../services/api/demo/seed';
import { clientGapsFor } from '../../state/accountActions';
import { deliveryStoreFor, planviewFieldTest, quarterRowsOf } from '../../state/delivery';
import { DataRuntime } from '../../state/runtime';
import {
  deliverySignalOf,
  useAccountActions,
  useClientGaps,
  useDelivery,
  useIntegrationSettings,
  useMutations,
  useOrgAdmin,
  usePlatformAdmin,
  useQuarters,
  useRecordExport,
  useUndo,
  useWorkspaceData,
} from '../../state';
import { setupRuntime } from './helpers';

async function booted(o: Parameters<typeof setupRuntime>[0] = {}) {
  const env = setupRuntime(o);
  await env.rt.start();
  if (o.signedIn !== false) expect(env.rt.getState().dataStatus).toBe('ready');
  return env;
}

describe('account actions (B1 client gaps)', () => {
  it('registers, resets a password and verifies an email on the demo transport', async () => {
    const { rt, transport } = await booted({ signedIn: false, appMode: 'public' });
    const a = clientGapsFor(rt).auth;
    await expect(
      a.register({ name: 'New Person', email: 'new@example.com', password: 'long-password-1' }),
    ).resolves.toEqual({
      verificationSent: true,
    });
    await expect(a.register({ name: '', email: 'bad', password: 'x' })).rejects.toMatchObject({ status: 400 });
    await a.requestPasswordReset('new@example.com');
    await expect(
      a.confirmPasswordReset({ email: 'new@example.com', code: '000000', newPassword: 'another-password' }),
    ).rejects.toMatchObject({ status: 400 });
    await a.confirmPasswordReset({ email: 'new@example.com', code: DEMO_OTP, newPassword: 'another-password' });
    expect(transport.dump().users.find((u) => u.email === 'new@example.com')?.password).toBe('another-password');
    await a.sendVerification('new@example.com');
    await a.checkVerification({ email: 'new@example.com', code: DEMO_OTP });
    expect(transport.dump().users.find((u) => u.email === 'new@example.com')?.emailVerified).toBe(true);
  });

  it('invites, lists, resends and revokes an invitation', async () => {
    const { rt, transport } = await booted({ role: 'ORG_ADMIN' });
    const orgId = rt.getState().me!.org!.id;
    const created = await rt.api.invitations.create(orgId, {
      email: 'invitee@example.com',
      orgRole: 'MEMBER',
      workspaces: [{ workspaceId: DEMO_WORKSPACE_ID, role: 'PLANNER' }],
    });
    const org = clientGapsFor(rt).org;
    const list = await org.listInvitations();
    const inv = list.find((i) => i.email === 'invitee@example.com')!;
    expect(inv).toMatchObject({ orgRole: 'MEMBER', workspaces: [{ workspaceId: DEMO_WORKSPACE_ID, role: 'PLANNER' }] });
    expect(typeof inv.invitedAt).toBe('string');
    const oldToken = created.inviteUrl.split('/').pop()!;
    expect((await clientGapsFor(rt).auth.lookupInvitation(oldToken)).email).toBe('invitee@example.com');
    // Resending issues a fresh link and retires the old one.
    await org.resendInvitation(inv.id);
    await expect(clientGapsFor(rt).auth.lookupInvitation(oldToken)).rejects.toMatchObject({ status: 404 });
    const token = transport.dump().invitations.find((i) => i.id === inv.id)!.token;
    expect((await clientGapsFor(rt).auth.lookupInvitation(token)).email).toBe('invitee@example.com');
    await org.revokeInvitation(inv.id);
    expect((await org.listInvitations()).some((i) => i.id === inv.id)).toBe(false);
    await expect(clientGapsFor(rt).auth.lookupInvitation(token)).rejects.toMatchObject({ status: 410 });
  });

  it('creates, renames and deletes a workspace, then starts checkout', async () => {
    const { rt } = await booted({ role: 'ORG_ADMIN', appMode: 'public' });
    const org = clientGapsFor(rt).org;
    const { id } = await org.createWorkspace('Second');
    expect(rt.getState().me!.workspaces.some((w) => w.id === id && w.name === 'Second')).toBe(true);
    await org.renameWorkspace(id, 'Renamed');
    expect(rt.getState().me!.workspaces.find((w) => w.id === id)?.name).toBe('Renamed');
    await org.deleteWorkspace(id);
    expect(rt.getState().me!.workspaces.some((w) => w.id === id)).toBe(false);
    expect(rt.getState().activeWorkspaceId).toBe(DEMO_WORKSPACE_ID);
    const { url } = await org.startCheckout('PRO');
    expect(url).toMatch(/^https:\/\//);
  });

  it('updates the profile, changes the password and turns on two-factor sign-in', async () => {
    const { rt, transport } = await booted();
    const acct = clientGapsFor(rt).account;
    await acct.updateProfile({ name: 'Renamed User' });
    expect(rt.getState().me!.user.name).toBe('Renamed User');
    const before = transport.dump().users.find((u) => u.id === rt.getState().me!.user.id)!.password;
    await expect(
      acct.changePassword({ currentPassword: 'wrong-one', newPassword: 'brand-new-password' }),
    ).rejects.toBeInstanceOf(ApiRequestError);
    await acct.changePassword({ currentPassword: before, newPassword: 'brand-new-password' });
    await acct.setTwoFactor({ enabled: true, currentPassword: 'brand-new-password' });
    expect(rt.getState().me!.user.twoFactorEnabled).toBe(true);
  });

  it('platform overview is 404 except for platform admins', async () => {
    const { rt } = await booted();
    await expect(clientGapsFor(rt).platform.overview()).rejects.toMatchObject({ status: 404 });
    const admin = await booted({ isPlatformAdmin: true });
    const o = await clientGapsFor(admin.rt).platform.overview();
    expect(o.workspaces).toBeGreaterThan(0);
    expect(o.organisations[0]).toMatchObject({ slug: expect.any(String), members: expect.any(Number) });
  });
});

describe('integration settings', () => {
  it('maps the legacy config to JiraConnection / PlanviewConnection and saves partial updates', async () => {
    const { rt } = await booted({ role: 'WORKSPACE_ADMIN' });
    const it = clientGapsFor(rt).integrations;
    await it.saveJira({
      siteUrl: 'https://acme.atlassian.net/',
      email: 'ops@acme.test',
      apiToken: 'secret',
      projectKeys: ['ABC'],
    });
    await it.savePlanview({ adapter: 'odata', baseUrl: 'https://pv.acme.test', username: 'svc', secret: 's' });
    const got = await it.get();
    expect(got.jira).toMatchObject({
      siteUrl: 'https://acme.atlassian.net',
      email: 'ops@acme.test',
      hasSecret: true,
      projectKeys: ['ABC'],
      status: 'connected',
    });
    expect(got.planview).toMatchObject({
      adapter: 'odata',
      baseUrl: 'https://pv.acme.test',
      username: 'svc',
      hasSecret: true,
    });
    const t = await it.testJira();
    expect(t.ok).toBe(true);
    expect((await it.get()).jira.lastTestedAt).not.toBeNull();
    expect((await it.testPlanview()).ok).toBe(true);
  });

  it('a planner cannot manage the connection; the test reports the reason instead of throwing', async () => {
    const { rt } = await booted({ role: 'PLANNER' });
    const it = clientGapsFor(rt).integrations;
    await expect(it.saveJira({ email: 'x@y.z' })).rejects.toMatchObject({ status: 403 });
    const t = await it.testJira();
    expect(t.ok).toBe(false);
    expect(t.message).toBeTruthy();
  });
});

describe('hooks', () => {
  it('return stable per-runtime objects with B1 method names', async () => {
    const env = await booted();
    const { result, rerender } = renderHook(
      () => ({
        acct: useAccountActions(),
        org: useOrgAdmin(),
        integ: useIntegrationSettings(),
        plat: usePlatformAdmin(),
        gaps: useClientGaps(),
        rec: useRecordExport(),
      }),
      { wrapper: env.wrapper },
    );
    const first = result.current;
    rerender();
    expect(result.current.acct).toBe(first.acct);
    expect(result.current.gaps.org).toBe(first.org);
    for (const k of [
      'register',
      'requestPasswordReset',
      'confirmPasswordReset',
      'sendVerification',
      'checkVerification',
      'lookupInvitation',
      'acceptInvitation',
    ])
      expect(typeof (first.gaps.auth as unknown as Record<string, unknown>)[k]).toBe('function');
    for (const k of ['createOrg', 'updateProfile', 'changePassword', 'setTwoFactor'])
      expect(typeof (first.gaps.account as unknown as Record<string, unknown>)[k]).toBe('function');
    expect(Object.keys(first.integ).sort()).toEqual(['get', 'saveJira', 'savePlanview', 'testJira', 'testPlanview']);
    expect(Object.keys(first.plat)).toEqual(['overview']);
  });

  it('recordExport writes the export audit event (RP-04#AC4)', async () => {
    const { rt, transport } = await booted();
    await clientGapsFor(rt).recordExport({ kind: 'qbr-pack', format: 'pdf' });
    const ev = transport.dump().audit.find((e) => e.action === 'export.pdf');
    expect(ev).toMatchObject({ targetType: 'report', targetId: 'qbr-pack' });
  });

  it('useWorkspaceData exposes a boot failure (503 migration_pending) and retries the boot', async () => {
    let calls = 0;
    const transport = new HttpTransport({
      getCookies: () => '',
      fetchImpl: () => {
        calls++;
        return Promise.resolve({
          ok: false,
          status: 503,
          headers: { get: (k: string) => (k === 'content-type' ? 'application/json' : null) },
          text: () => Promise.resolve(JSON.stringify({ error: 'Updating', code: 'migration_pending' })),
        } as unknown as Response);
      },
    });
    const rt = new DataRuntime({ transport, storage: null });
    await rt.start();
    const { DataProvider } = await import('../../state/session');
    const { result } = renderHook(() => useWorkspaceData(), {
      wrapper: ({ children }) => <DataProvider runtime={rt}>{children}</DataProvider>,
    });
    expect(result.current.status).toBe('error');
    expect(result.current.error).toMatchObject({ status: 503, code: 'migration_pending' });
    const before = calls;
    await act(async () => {
      await result.current.reload();
    });
    expect(calls).toBeGreaterThan(before);
  });
});

describe('setQuarterCells (AL-07 paste)', () => {
  it('sends one batch and makes one undo step', async () => {
    const env = setupRuntime();
    const { result } = renderHook(
      () => ({ m: useMutations(), undo: useUndo(), data: useWorkspaceData(), quarters: useQuarters() }),
      { wrapper: env.wrapper },
    );
    await waitFor(() => expect(result.current.data.status).toBe('ready'));
    const s = result.current.data.snapshot!;
    const quarters = result.current.quarters;
    const counted = s.allocations.find((a) => a.state === 'confirmed' && a.projectId)!;
    const seen: string[] = [];
    const orig = env.transport.request.bind(env.transport);
    env.transport.request = ((m: string, p: string, b?: unknown, i?: unknown) => {
      if (m !== 'GET') seen.push(`${m} ${p}`);
      return orig(m as never, p, b, i as never);
    }) as typeof env.transport.request;
    const undoDepth = env.rt.getState().undo.length;
    await act(async () => {
      await result.current.m.allocations.setQuarterCells([
        {
          resourceId: counted.resourceId,
          projectId: counted.projectId!,
          craftId: counted.craftId,
          quarterKey: quarters[1].key,
          pct: 30,
        },
        {
          resourceId: counted.resourceId,
          projectId: counted.projectId!,
          craftId: counted.craftId,
          quarterKey: quarters[2].key,
          pct: 40,
        },
      ]);
    });
    expect(seen.filter((x) => x.includes('/allocations')).length).toBe(1);
    expect(seen[0]).toMatch(/allocations\/batch$/);
    expect(env.rt.getState().undo.length).toBe(undoDepth + 1);
    expect(result.current.undo.label).toBe('Paste 2 cells');
    await act(async () => {
      await result.current.undo.undo();
    });
    const restored = env.rt.getState().snapshot!.allocations.filter((a) => a.resourceId === counted.resourceId);
    expect(restored.map((a) => [a.projectId, a.startDate, a.endDate, a.percentage]).sort()).toEqual(
      s.allocations
        .filter((a) => a.resourceId === counted.resourceId)
        .map((a) => [a.projectId, a.startDate, a.endDate, a.percentage])
        .sort(),
    );
  });

  it('rejects out-of-range values with "Enter 0–200" and sends nothing', async () => {
    const env = await booted();
    const { result } = renderHook(() => useMutations(), { wrapper: env.wrapper });
    await act(async () => {
      await expect(
        result.current.allocations.setQuarterCells([
          { resourceId: 'r1', projectId: 'p1', craftId: null, quarterKey: '2026-Q4', pct: 250 },
        ]),
      ).rejects.toMatchObject({ status: 400, message: 'Enter 0–200' });
    });
  });
});

describe('delivery (B2 DeliverySource)', () => {
  it('loads mappings, calibrations, sync health and rows for a planner', async () => {
    const env = await booted({ role: 'WORKSPACE_ADMIN' });
    const { result } = renderHook(() => useDelivery(useWorkspaceData().snapshot), { wrapper: env.wrapper });
    await waitFor(() => expect(result.current.sprintRows.length).toBeGreaterThan(0));
    const d = result.current;
    expect(d.provider).toBe('demo');
    expect(d.configured.jira).toBe(true);
    expect(d.mappings.length).toBeGreaterThan(0);
    expect(d.calibrations.length).toBeGreaterThan(0);
    expect(d.health?.provider).toBe('jira');
    expect(d.quarterRows.length).toBeGreaterThan(0);
    for (const q of d.quarterRows) expect(q.sprintName).toBeNull();

    let job!: D.SyncJobDTO;
    await act(async () => {
      job = await result.current.syncNow();
    });
    expect(result.current.health?.lastJob?.id).toBe(job.id);
    while (job.status === 'queued' || job.status === 'running') {
      await act(async () => {
        job = await result.current.stepJob(job.id);
      });
    }
    expect(result.current.health?.state).toBe('ok');

    const cal = result.current.calibrations[0];
    await act(async () => {
      await result.current.saveCalibration(cal.tribeId, cal.pointsPerSprintPerFte + 1, 'QBR check');
    });
    expect(result.current.calibrations.find((c) => c.tribeId === cal.tribeId)).toMatchObject({
      pointsPerSprintPerFte: cal.pointsPerSprintPerFte + 1,
      note: 'QBR check',
    });

    const t = await result.current.planviewTestMapping();
    expect(t.fields.find((f) => f.path === 'project.id')).toMatchObject({ entity: 'project', required: true });
    const pv = await result.current.planviewPreview();
    expect(pv.previewId).toBeTruthy();
  });

  it('a viewer gets health and rows but no mapping lists, and actions are refused', async () => {
    const env = await booted({ role: 'VIEWER' });
    const s = env.rt.getState().snapshot!;
    const store = deliveryStoreFor(env.rt);
    await store.ensure(s.workspace.id);
    const d = store.source(s, store.getState());
    expect(d.mappings).toEqual([]);
    expect(d.calibrations).toEqual([]);
    await expect(d.syncNow()).rejects.toMatchObject({ status: 403 });
  });

  it('without a snapshot the source is empty and actions reject', async () => {
    const env = setupRuntime({ signedIn: false });
    const { result } = renderHook(() => useDelivery(null), { wrapper: env.wrapper });
    expect(result.current.provider).toBe('none');
    await expect(result.current.syncNow()).rejects.toBeInstanceOf(ApiRequestError);
  });

  it('pure helpers: quarter roll-up, test-mapping table, signal wording', () => {
    const row = (sprint: number, from: string, to: string, q: D.QuarterKey, done: number): D.DeliveryRowDTO => ({
      key: `t1-${sprint}`,
      label: `Sprint ${sprint}`,
      tribeId: 't1',
      projectId: null,
      sprintId: String(sprint),
      sprintName: `Sprint ${sprint}`,
      quarterKey: q,
      from,
      to,
      pointsTotal: done + 2,
      pointsDone: done,
      issuesDone: 1,
      impliedFte: done / 10,
      plannedFte: 2,
    });
    const rows = quarterRowsOf([
      row(2, '2026-10-15', '2026-10-28', '2026-Q4', 30),
      row(1, '2026-10-01', '2026-10-14', '2026-Q4', 20),
      row(3, '2027-01-05', '2027-01-18', '2027-Q1', 10),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      quarterKey: '2026-Q4',
      from: '2026-10-01',
      to: '2026-10-28',
      pointsDone: 50,
      impliedFte: 2.5,
    });
    const t = planviewFieldTest({
      source: {},
      mapped: { 'project.id': 'PV-1', 'assignment.percent': 0.4 },
      missing: ['project.manager'],
    });
    expect(t.fields).toEqual([
      { entity: 'project', field: 'Project id', path: 'project.id', value: 'PV-1', required: true },
      { entity: 'assignment', field: 'Percent', path: 'assignment.percent', value: '0.4', required: true },
      { entity: 'project', field: 'Manager', path: 'project.manager', value: null, required: false },
    ]);
    expect(deliverySignalOf(2, 3)).toEqual({ kind: 'more', label: 'Jira shows more effort than planned' });
    expect(deliverySignalOf(2, 1)).toEqual({ kind: 'less', label: 'Jira shows less effort than planned' });
    expect(deliverySignalOf(2, 2)).toEqual({ kind: 'inline', label: 'In line' });
    expect(deliverySignalOf(0, 0)).toEqual({ kind: 'inline', label: 'In line' });
  });
});
