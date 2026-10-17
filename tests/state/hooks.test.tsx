import { act, renderHook, waitFor } from '@testing-library/react';
import type * as D from '../../shared/contracts/dto';
import { DEFAULT_THRESHOLDS } from '../../shared/utilisation';
import { ApiRequestError } from '../../services/api/errors';
import { DEMO_PASSWORD } from '../../services/api/demo/seed';
import { setClock } from '../../utils/clock';
import { buildPeopleRows } from '../../utils/viewModels';
import {
  useConflict,
  useEntitlements,
  useFeature,
  useMutations,
  useQuarters,
  useSession,
  useSessionNotice,
  useUndo,
  useWorkspace,
  useWorkspaceData,
} from '../../state';
import { setupRuntime, memoryStorage } from './helpers';

function useAll() {
  return {
    session: useSession(),
    ws: useWorkspace(),
    data: useWorkspaceData(),
    m: useMutations(),
    undo: useUndo(),
    conflict: useConflict(),
    quarters: useQuarters(),
    ai: useFeature('aiAssistant'),
    jira: useFeature('jiraScheduledSync'),
    ent: useEntitlements(),
    notice: useSessionNotice(),
  };
}

async function ready(o: Parameters<typeof setupRuntime>[0] = {}) {
  const env = setupRuntime(o);
  const hook = renderHook(useAll, { wrapper: env.wrapper });
  await waitFor(() => expect(hook.result.current.data.status).toBe('ready'));
  return { ...env, ...hook };
}

const snap = (r: { current: ReturnType<typeof useAll> }) => r.current.data.snapshot!;
const loadOf = (s: D.WorkspaceSnapshot, name: string, qi = 0) =>
  buildPeopleRows(s, [...renderedQuarters], DEFAULT_THRESHOLDS).find((r) => r.person.name === name)!.quarters[qi];
let renderedQuarters: ReturnType<typeof useQuarters> = [];

beforeAll(() => setClock('2026-10-16'));
afterAll(() => setClock());

describe('session, workspace, features and entitlements (AC-04, SH-05, PL-07)', () => {
  it('boots the demo session and selects the workspace', async () => {
    const { result, storage } = await ready({ role: 'PLANNER' });
    renderedQuarters = result.current.quarters;
    expect(result.current.session).toMatchObject({ status: 'authenticated', mode: 'demo' });
    expect(result.current.session.me?.user.name).toBe('Demo User');
    expect(result.current.ws.workspace?.id).toBe('demo');
    expect(result.current.ws.can('people.write')).toBe(true);
    expect(result.current.ws.can('structure.write')).toBe(false);
    expect(result.current.ws.isOwnPerson('r9')).toBe(true);
    expect(result.current.ws.isOwnPerson('r1')).toBe(false);
    expect(result.current.ws.thresholds).toEqual(DEFAULT_THRESHOLDS);
    expect(result.current.ai).toBe(false);
    expect(result.current.jira).toBe(true);
    expect(result.current.ent.has('csvImport')).toBe(true);
    expect(result.current.ent.maxPeople).toBeNull();
    expect(result.current.quarters.map((q) => `${q.label} ${q.calendarLabel} ${q.fiscalLabel}`)).toEqual([
      'QBR1 Q4 2026 FY26 Q4',
      'QBR2 Q1 2027 FY27 Q1',
      'QBR3 Q2 2027 FY27 Q2',
      'QBR4 Q3 2027 FY27 Q3',
    ]);
    expect(storage.data.get('pcp.ui.lastWorkspace')).toBe('demo');
  });

  it('signs in and out (useSession.login / logout)', async () => {
    const env = setupRuntime({ signedIn: false });
    const { result } = renderHook(useAll, { wrapper: env.wrapper });
    await waitFor(() => expect(result.current.session.status).toBe('anonymous'));
    expect(result.current.ent.has('csvExport')).toBe(false);
    await act(async () => {
      await expect(result.current.session.login('tom.hayes@company.ie', 'wrong')).rejects.toBeInstanceOf(
        ApiRequestError,
      );
    });
    await act(async () => {
      await expect(result.current.session.login('twofa@example.com', DEMO_PASSWORD)).resolves.toEqual({
        require2FA: true,
      });
    });
    expect(result.current.session.status).toBe('anonymous');
    await act(async () => {
      await expect(result.current.session.login('tom.hayes@company.ie', DEMO_PASSWORD)).resolves.toEqual({
        require2FA: false,
      });
    });
    await waitFor(() => expect(result.current.data.status).toBe('ready'));
    expect(result.current.session.me?.user.name).toBe('Tom Hayes');
    expect(result.current.ws.workspace?.linkedPersonId).toBe('r1');
    await act(() => result.current.session.logout());
    expect(result.current.session.status).toBe('anonymous');
    expect(result.current.data.snapshot).toBeNull();
  });

  it('purges v1.1 browser storage on first load and keeps UI preferences (PL-06#AC5)', async () => {
    const storage = memoryStorage({
      pcp_resources: '[]',
      pcp_projects: '[]',
      pcp_allocations: '[]',
      pcp_scenario_mode: '1',
      pcp_scenario_allocations: '[]',
      orbitTheme: 'dark',
      pcp_tour_done: '1',
      pcp_active_workspace: '{}',
      pcp_user: '{}',
      'pcp.ui.sidebarCollapsed': '1',
    });
    await ready({ storage });
    expect([...storage.data.keys()].sort()).toEqual(['pcp.ui.lastWorkspace', 'pcp.ui.sidebarCollapsed']);
  });

  it('switching to a workspace the user cannot open is a 403 (SH-01#AC3); switching back loads it', async () => {
    const { result } = await ready();
    act(() => result.current.ws.switchWorkspace('someone-elses'));
    await waitFor(() => expect(result.current.data.status).toBe('error'));
    expect(result.current.data.error?.status).toBe(403);
    act(() => result.current.ws.switchWorkspace('demo'));
    await waitFor(() => expect(result.current.data.status).toBe('ready'));
  });

  it('a session expiring mid-session signs out with a notice', async () => {
    const { result, transport } = await ready();
    act(() => transport.expireSession());
    expect(result.current.session.status).toBe('anonymous');
    expect(result.current.notice.notice).toEqual({
      kind: 'session-expired',
      message: 'Your session has expired. Please sign in again.',
    });
    act(() => result.current.notice.dismiss());
    expect(result.current.notice.notice).toBeNull();
  });

  it('returns stable objects across renders', async () => {
    const { result, rerender } = await ready();
    const first = result.current;
    rerender();
    expect(result.current.m).toBe(first.m);
    expect(result.current.ws).toBe(first.ws);
    expect(result.current.session).toBe(first.session);
  });
});

describe('mutations: optimistic, versioned, rollback, conflicts (PL-06#AC2–3)', () => {
  it('shows an edit immediately and confirms it with the server version', async () => {
    const { result } = await ready({ role: 'PLANNER', latencyMs: 30 });
    let saved: Promise<D.PersonDTO> | undefined;
    act(() => {
      saved = result.current.m.people.update('r1', { location: 'Cork' });
    });
    expect(snap(result).people.find((p) => p.id === 'r1')).toMatchObject({ location: 'Cork', version: 1 });
    await act(async () => {
      await expect(saved).resolves.toMatchObject({ location: 'Cork', version: 2 });
    });
    expect(snap(result).people.find((p) => p.id === 'r1')).toMatchObject({ location: 'Cork', version: 2 });
    expect(snap(result).workspace.dataVersion).toBe(2);
    expect(result.current.undo).toMatchObject({ canUndo: true, label: 'Edit Tom Hayes' });
  });

  it('rolls back on error and raises "permissions changed" on 403 (AC-04#AC3)', async () => {
    const { result } = await ready({ role: 'VIEWER', latencyMs: 10 });
    let p: Promise<unknown> | undefined;
    act(() => {
      p = result.current.m.people.update('r1', { location: 'Cork' });
    });
    expect(snap(result).people.find((x) => x.id === 'r1')?.location).toBe('Cork');
    await act(async () => {
      await expect(p).rejects.toMatchObject({ status: 403, code: 'forbidden' });
    });
    expect(snap(result).people.find((x) => x.id === 'r1')?.location).toBe('Dublin');
    expect(result.current.notice.notice?.message).toBe('Your permissions changed. The page has been refreshed.');
    expect(result.current.undo.canUndo).toBe(false);
  });

  it('opens the conflict dialog on a stale version and lets the user keep editing', async () => {
    const { result, rt } = await ready({ role: 'PLANNER' });
    await rt.api.people.update('demo', 'r2', { version: 1, patch: { location: 'Galway' } }); // "another user"
    await act(async () => {
      await expect(result.current.m.people.update('r2', { targetUtil: 90 })).rejects.toMatchObject({ status: 409 });
    });
    expect(result.current.conflict.conflict).toEqual({
      entity: 'person',
      name: 'Claire Ryan',
      changedBy: 'Demo User',
      changedAt: expect.any(String),
    });
    expect(snap(result).people.find((p) => p.id === 'r2')).toMatchObject({
      location: 'Galway',
      version: 2,
      targetUtil: 100,
    });
    act(() => result.current.conflict.resolve('dismiss'));
    expect(result.current.conflict.conflict).toBeNull();
    await act(async () => {
      await expect(result.current.m.people.update('r2', { targetUtil: 90 })).resolves.toMatchObject({ version: 3 });
    });
  });

  it('"Reload" in the conflict dialog reloads the snapshot', async () => {
    const { result, rt } = await ready({ role: 'PLANNER' });
    await rt.api.projects.update('demo', 'p1', { version: 1, patch: { description: 'Changed elsewhere' } });
    await act(async () => {
      await expect(result.current.m.projects.update('p1', { priority: 'Low' })).rejects.toBeInstanceOf(ApiRequestError);
    });
    act(() => result.current.conflict.resolve('reload'));
    await waitFor(() =>
      expect(snap(result).projects.find((p) => p.id === 'p1')?.description).toBe('Changed elsewhere'),
    );
  });
});

describe('allocation grid edits and undo (AL-02, AL-03, PL-06#AC4)', () => {
  it('acceptance check 25: rebalance Noma to On target, copy forward, then undo', async () => {
    const { result } = await ready({ role: 'PLANNER' });
    renderedQuarters = result.current.quarters;
    expect(loadOf(snap(result), 'Noma Odigie')).toMatchObject({ loadPct: 115, band: 'over' });
    await act(() =>
      result.current.m.allocations.setQuarterCell({
        resourceId: 'r8',
        projectId: 'p5',
        craftId: 'scrum-master',
        quarterKey: '2026-Q4',
        pct: 15,
      }),
    );
    expect(loadOf(snap(result), 'Noma Odigie')).toMatchObject({ loadPct: 95, band: 'on-target' });
    expect(loadOf(snap(result), 'Noma Odigie', 1).loadPct).toBe(87.9); // QBR2 untouched
    await act(() =>
      result.current.m.allocations.copyForward({
        resourceId: 'r8',
        projectId: 'p5',
        craftId: 'scrum-master',
        fromQuarterKey: '2026-Q4',
      }),
    );
    expect(loadOf(snap(result), 'Noma Odigie', 1).loadPct).toBe(67.9);
    expect(result.current.undo.label).toBe('Copy to later quarters');
    await act(() => result.current.undo.undo());
    expect(loadOf(snap(result), 'Noma Odigie', 1).loadPct).toBe(87.9);
    await act(() => result.current.undo.undo());
    expect(loadOf(snap(result), 'Noma Odigie')).toMatchObject({ loadPct: 115, band: 'over' });
    expect(result.current.undo.canUndo).toBe(false);
  });

  it('serialises quick successive edits of the same booking (rebasing on its own versions)', async () => {
    const { result } = await ready({ role: 'PLANNER', latencyMs: 15 });
    let a: Promise<void> | undefined, b: Promise<void> | undefined;
    act(() => {
      a = result.current.m.allocations.setQuarterCell({
        resourceId: 'r2',
        projectId: 'p1',
        craftId: 'project-mgmt',
        quarterKey: '2026-Q4',
        pct: 40,
      });
      b = result.current.m.allocations.batch(
        [{ op: 'update', id: 'a4', version: 1, patch: { notes: 'Second edit' } }],
        'Annotate',
      );
    });
    await act(async () => {
      await a;
      await b;
    });
    const a4 = snap(result).allocations.find((x) => x.id === 'a4')!;
    expect(a4.notes).toBe('Second edit');
    expect(a4.version).toBe(3);
  });

  it('rejects values outside 0–200 without sending anything', async () => {
    const { result } = await ready({ role: 'PLANNER' });
    await expect(
      result.current.m.allocations.setQuarterCell({
        resourceId: 'r8',
        projectId: 'p5',
        craftId: 'scrum-master',
        quarterKey: '2026-Q4',
        pct: 250,
      }),
    ).rejects.toMatchObject({ status: 400, message: 'Enter 0–200' });
    expect(snap(result).workspace.dataVersion).toBe(1);
  });

  it('a squad member accepts a proposal; planners can undo a confirm (DM-03#AC4, AL-05#AC3)', async () => {
    const squad = await ready({ role: 'CONTRIBUTOR' });
    await act(() => squad.result.current.m.allocations.respond('a-proposal-1', { decision: 'accept' }));
    expect(snap(squad.result).allocations.find((a) => a.id === 'a-proposal-1')).toMatchObject({ state: 'confirmed' });
    expect(squad.result.current.undo.canUndo).toBe(false); // no allocations.write
    const planner = await ready({ role: 'PLANNER' });
    await act(() =>
      planner.result.current.m.allocations.respond('a-proposal-1', { decision: 'decline', reason: 'Not now' }),
    );
    expect(snap(planner.result).allocations.find((a) => a.id === 'a-proposal-1')).toMatchObject({
      state: 'declined',
      notes: 'Not now',
    });
    await act(() => planner.result.current.undo.undo());
    expect(snap(planner.result).allocations.find((a) => a.id === 'a-proposal-1')).toMatchObject({ state: 'tentative' });
  });
});

describe('people, projects, demand, marketplace, structure, admin', () => {
  it('creates, deletes with cascade, and undoes the delete (DS-03#AC4)', async () => {
    const { result } = await ready({ role: 'PLANNER' });
    let created: D.PersonDTO | undefined;
    await act(async () => {
      created = await result.current.m.people.create({ name: 'Ada Lovelace', primaryCraft: 'pmo-analytics' });
    });
    expect(created!.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(snap(result).people.some((p) => p.name === 'Ada Lovelace')).toBe(true);
    await act(() => result.current.undo.undo());
    expect(snap(result).people.some((p) => p.name === 'Ada Lovelace')).toBe(false);

    const bookings = snap(result).allocations.filter((a) => a.resourceId === 'r10').length;
    await act(() => result.current.m.people.remove('r10'));
    expect(snap(result).people.some((p) => p.id === 'r10')).toBe(false);
    expect(snap(result).allocations.some((a) => a.resourceId === 'r10')).toBe(false);
    expect(result.current.undo.label).toBe("Delete Linda O'Dwyer");
    await act(() => result.current.undo.undo());
    const linda = snap(result).people.find((p) => p.name === "Linda O'Dwyer")!;
    expect(snap(result).allocations.filter((a) => a.resourceId === linda.id)).toHaveLength(bookings);
  });

  it('bulk edit sends versions and undo restores each person (PPL-03)', async () => {
    const { result } = await ready({ role: 'PLANNER' });
    await act(async () => {
      await expect(
        result.current.m.people.bulk({ ids: ['r1', 'r2'], patch: { teamId: 't4', targetUtil: 90 } }),
      ).resolves.toHaveLength(2);
    });
    expect(
      snap(result)
        .people.filter((p) => p.teamId === 't4')
        .map((p) => p.id)
        .sort(),
    ).toEqual(['r1', 'r2', 'r8']);
    expect(result.current.undo.label).toBe('Edit 2 people');
    await act(() => result.current.undo.undo());
    expect(snap(result).people.find((p) => p.id === 'r1')).toMatchObject({ teamId: 't1', targetUtil: 100 });
  });

  it('imports rows and reloads the snapshot (PPL-04#AC3)', async () => {
    const { result } = await ready({ role: 'PLANNER' });
    let res: unknown;
    await act(async () => {
      res = await result.current.m.people.importRows({
        rows: [
          { name: 'Imported Person', email: 'imp@example.com', chapter: 'New Chapter' },
          { name: 'Tom Hayes', location: 'Limerick' },
        ],
        createMissingStructure: true,
      });
    });
    expect(res).toEqual({ created: 1, updated: 1, skipped: 0, errors: [] });
    expect(snap(result).people.some((p) => p.name === 'Imported Person')).toBe(true);
    expect(snap(result).chapters.some((c) => c.name === 'New Chapter')).toBe(true);
  });

  it('demand: create, edit, copy to later quarters, undo (DM-01/02)', async () => {
    const { result } = await ready({ role: 'PLANNER' });
    let line: D.DemandLineDTO | undefined;
    await act(async () => {
      line = await result.current.m.demand.create({
        projectId: 'p3',
        quarterKey: '2027-Q2',
        craftId: 'change-mgmt',
        fte: 0.5,
        status: 'Forecast',
        ownerUserId: null,
        note: null,
      });
    });
    await act(() => result.current.m.demand.update(line!.id, { fte: 1, status: 'Confirmed' }));
    await act(() => result.current.m.demand.copyForward(line!.id, ['2027-Q3']));
    const q3 = snap(result).demand.filter(
      (l) => l.projectId === 'p3' && l.craftId === 'change-mgmt' && l.quarterKey === '2027-Q3',
    );
    expect(q3).toHaveLength(1);
    expect(q3[0]).toMatchObject({ fte: 1, status: 'Confirmed' });
    await act(() => result.current.undo.undo());
    expect(snap(result).demand.find((l) => l.id === q3[0].id)).toMatchObject({ fte: 0.5, status: 'Forecast' }); // the existing Q3 line is restored
    await act(() => result.current.m.demand.remove(line!.id));
    expect(snap(result).demand.some((l) => l.id === line!.id)).toBe(false);
  });

  it('marketplace: propose, offer and withdraw (DM-03, DM-05)', async () => {
    const { result } = await ready({ role: 'PLANNER' });
    let proposal: D.AllocationDTO | undefined;
    await act(async () => {
      proposal = await result.current.m.marketplace.propose({
        demandLineId: null,
        projectId: 'p3',
        resourceId: 'r7',
        craftId: 'business-analysis',
        quarterKey: '2027-Q2',
        percentage: 50,
        startDate: '2027-04-01',
        endDate: '2027-06-30',
      });
    });
    expect(
      snap(result)
        .allocations.filter((a) => a.state === 'tentative')
        .map((a) => a.id),
    ).toContain(proposal!.id);
    expect(snap(result).allocations.some((a) => a.id.startsWith('pending-'))).toBe(false);
    await act(() =>
      result.current.m.marketplace.setOffer({
        personId: 'r3',
        quarterKey: '2027-Q2',
        pct: 40,
        craftIds: ['vendor-mgmt'],
        note: 'Ask me',
      }),
    );
    expect(snap(result).offers.find((o) => o.personId === 'r3')).toMatchObject({ pct: 40, note: 'Ask me' });
    await act(() => result.current.m.marketplace.withdrawOffer('r3', '2027-Q2'));
    expect(snap(result).offers.some((o) => o.personId === 'r3')).toBe(false);
    await act(() => result.current.undo.undo());
    expect(snap(result).offers.some((o) => o.personId === 'r3')).toBe(true);
  });

  it('craft change: request as squad member, decide as planner (PPL-06)', async () => {
    const squad = await ready({ role: 'CONTRIBUTOR' });
    await act(async () => {
      await squad.result.current.m.people.requestCraftChange('r9', [
        { craftId: 'release-coord', proficiency: 2, maxPct: 20 },
      ]);
    });
    expect(snap(squad.result).craftRequests.map((r) => r.personId)).toEqual(['r9']);
    const planner = await ready({ role: 'PLANNER' });
    await act(async () => {
      await planner.result.current.m.people.decideCraftChange('cr-1', 'approve');
    });
    expect(snap(planner.result).people.find((p) => p.id === 'r8')).toMatchObject({ version: 2 });
    await act(async () => {
      await expect(planner.result.current.m.people.update('r8', { location: 'Sligo' })).resolves.toMatchObject({
        version: 3,
      });
    });
  });

  it('structure.create resolves with the server id, so people can be assigned to a new chapter (QA-013)', async () => {
    const { result } = await ready({ role: 'ORG_ADMIN' });
    let chapter: { id: string } = { id: '' };
    await act(async () => {
      chapter = await result.current.m.structure.create('chapters', {
        name: 'Service Design',
        craftId: 'pmo-analytics',
        leadPersonId: null,
      });
    });
    expect(chapter.id).not.toMatch(/^pending-/);
    expect(snap(result).chapters.find((c) => c.id === chapter.id)).toMatchObject({ name: 'Service Design' });
    const ids = snap(result)
      .people.slice(0, 2)
      .map((p) => p.id);
    await act(async () => {
      await result.current.m.people.bulk({ ids, patch: { chapterId: chapter.id } });
    });
    for (const id of ids) expect(snap(result).people.find((p) => p.id === id)?.chapterId).toBe(chapter.id);
  });

  it('structure: new craft is selectable at once; archive; org planning changes labels (ORG-04#AC2, ST-03#AC3)', async () => {
    const { result } = await ready({ role: 'ORG_ADMIN' });
    await act(() => result.current.m.structure.save('crafts', { name: 'Service Design', short: 'SD' }));
    expect(snap(result).crafts.find((c) => c.short === 'SD')).toMatchObject({ id: 'service-design', archived: false });
    await act(() => result.current.m.structure.archive('crafts', 'service-design', true));
    expect(snap(result).crafts.find((c) => c.id === 'service-design')?.archived).toBe(true);
    await act(() => result.current.undo.undo());
    expect(snap(result).crafts.find((c) => c.id === 'service-design')?.archived).toBe(false);
    await act(() => result.current.m.structure.save('tribes', { id: 'tribe-digital', name: 'Digital Channels' }));
    expect(snap(result).tribes.find((t) => t.id === 'tribe-digital')).toMatchObject({
      name: 'Digital Channels',
      version: 2,
    });

    const org = snap(result).org;
    await act(() =>
      result.current.m.admin.updateOrg({
        planning: {
          ...org.planning,
          fiscalYearStartMonth: 10,
          thresholds: { benchBelow: 40, onTargetFrom: 85, onTargetTo: 110 },
        },
      }),
    );
    await waitFor(() => expect(result.current.quarters[0].fiscalLabel).toBe('FY27 Q1'));
    expect(result.current.ws.thresholds).toEqual({ benchBelow: 40, onTargetFrom: 85, onTargetTo: 110 });
  });

  it('admin: members and invitations', async () => {
    const { result } = await ready({ role: 'ORG_ADMIN' });
    const members = await result.current.m.admin.members();
    expect(members.map((m) => m.name)).toEqual(expect.arrayContaining(['Demo User', 'Tom Hayes']));
    const inv = await result.current.m.admin.invite({
      email: 'x@example.com',
      orgRole: 'MEMBER',
      workspaces: [{ workspaceId: 'demo', role: 'VIEWER' }],
    });
    expect(inv.inviteUrl).toMatch(/^\/invite\//);
    await result.current.m.admin.updateMember('u-tom', {
      workspaces: [{ workspaceId: 'demo', role: 'WORKSPACE_ADMIN' }],
    });
    expect((await result.current.m.admin.members()).find((m) => m.userId === 'u-tom')?.workspaces[0].role).toBe(
      'WORKSPACE_ADMIN',
    );
    await result.current.m.admin.removeMember('u-aoife');
    expect((await result.current.m.admin.members()).some((m) => m.userId === 'u-aoife')).toBe(false);
  });
});

describe('refetch on focus (AC-04#AC3, PL-06#AC3)', () => {
  it('reloads after 60 s and says "Updated with the latest changes." when others changed data', async () => {
    const { result, rt, advance } = await ready({ role: 'PLANNER' });
    await act(() => rt.onFocus()); // too soon: nothing happens
    expect(result.current.notice.notice).toBeNull();
    advance(61_000);
    await act(() => rt.onFocus()); // nothing changed elsewhere
    expect(result.current.notice.notice).toBeNull();
    await rt.api.people.update('demo', 'r5', { version: 1, patch: { location: 'Cork' } }); // another user
    advance(61_000);
    await act(() => rt.onFocus());
    expect(result.current.notice.notice).toEqual({ kind: 'data-updated', message: 'Updated with the latest changes.' });
    expect(snap(result).people.find((p) => p.id === 'r5')?.location).toBe('Cork');
  });

  it("own edits do not count as someone else's change", async () => {
    const { result, rt, advance } = await ready({ role: 'PLANNER' });
    await act(async () => {
      await result.current.m.people.update('r5', { location: 'Cork' });
      await result.current.m.allocations.setQuarterCell({
        resourceId: 'r5',
        projectId: 'p1',
        craftId: 'digital-planning',
        quarterKey: '2026-Q4',
        pct: 20,
      });
    });
    advance(61_000);
    await act(() => rt.onFocus());
    expect(result.current.notice.notice).toBeNull();
  });
});
