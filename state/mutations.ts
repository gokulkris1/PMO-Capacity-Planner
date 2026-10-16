/**
 * `useMutations()` implementation (BACKLOG §4.3): every write goes through `DataRuntime.mutate`,
 * which applies the change optimistically, sends it with the confirmed `version` (PatchBody), folds
 * the server response into the snapshot, rolls back on error, opens the conflict dialog on 409 and
 * records an undo action (PL-06#AC2–4). Creates carry client-generated UUIDs (PL-04#AC5) so the
 * optimistic row and the saved row share an id.
 */
import type * as D from '../shared/contracts/dto';
import type {
  AllocationBatchResponse,
  AllocationOp,
  DemandOp,
  InvitationRequest,
  InvitationResponse,
  MemberDTO,
  MemberPatch,
  NewAllocation,
  NewDemandLine,
  NewPerson,
  NewProject,
  PeopleBulkRequest,
  PeopleImportRequest,
  PeopleImportResponse,
  ProposeRequest,
  RespondRequest,
} from '../shared/contracts/api';
import { nowIso, today } from '../utils/clock';
import { rollingQuarterViews } from '../utils/quarters';
import {
  applyAllocationOps,
  applyBatchResponse,
  copyForwardOps,
  inverseOps,
  isUuid,
  MAX_BATCH_OPS,
  quarterCellOps,
} from '../utils/viewModels/allocationOps';
import { ApiRequestError } from '../services/api/errors';
import { newUuid } from '../services/api/demoTransport';
import type { DataRuntime } from './runtime';

type StructureKind = 'tribes' | 'chapters' | 'teams' | 'crafts';
type Entity = { id: D.ID } & Record<string, unknown>;

export interface Mutations {
  people: {
    create(p: NewPerson): Promise<D.PersonDTO>;
    update(id: D.ID, patch: Partial<D.PersonDTO>): Promise<D.PersonDTO>;
    remove(id: D.ID): Promise<void>;
    bulk(req: Omit<PeopleBulkRequest, 'versions'>): Promise<D.PersonDTO[]>;
    importRows(req: PeopleImportRequest): Promise<PeopleImportResponse>;
    requestCraftChange(personId: D.ID, crafts: D.SecondaryCraftDTO[]): Promise<D.CraftChangeRequestDTO>;
    decideCraftChange(id: D.ID, d: 'approve' | 'reject', reason?: string): Promise<D.CraftChangeRequestDTO>;
  };
  projects: {
    create(p: NewProject): Promise<D.ProjectDTO>;
    update(id: D.ID, patch: Partial<D.ProjectDTO>): Promise<D.ProjectDTO>;
    remove(id: D.ID): Promise<void>;
  };
  demand: {
    create(l: NewDemandLine): Promise<D.DemandLineDTO>;
    update(id: D.ID, patch: Partial<D.DemandLineDTO>): Promise<D.DemandLineDTO>;
    remove(id: D.ID): Promise<void>;
    copyForward(id: D.ID, toQuarterKeys: D.QuarterKey[]): Promise<void>;
  };
  allocations: {
    batch(ops: AllocationOp[], label: string): Promise<void>;
    setQuarterCell(a: {
      resourceId: D.ID;
      projectId: D.ID;
      craftId: D.ID | null;
      quarterKey: D.QuarterKey;
      pct: number;
    }): Promise<void>;
    copyForward(a: {
      resourceId: D.ID;
      projectId: D.ID;
      craftId: D.ID | null;
      fromQuarterKey: D.QuarterKey;
    }): Promise<void>;
    respond(id: D.ID, r: RespondRequest): Promise<void>;
  };
  marketplace: {
    propose(r: ProposeRequest): Promise<D.AllocationDTO>;
    setOffer(o: Omit<D.MarketplaceOfferDTO, 'createdBy' | 'createdAt'>): Promise<void>;
    withdrawOffer(personId: D.ID, quarterKey: D.QuarterKey): Promise<void>;
  };
  structure: {
    save(kind: StructureKind, entity: { id?: D.ID; version?: number } & Record<string, unknown>): Promise<void>;
    archive(kind: StructureKind, id: D.ID, archived: boolean): Promise<void>;
  };
  admin: {
    invite(r: InvitationRequest): Promise<InvitationResponse>;
    members(): Promise<MemberDTO[]>;
    updateMember(userId: D.ID, p: MemberPatch): Promise<void>;
    removeMember(userId: D.ID): Promise<void>;
    updateOrg(patch: Partial<D.OrgDTO>): Promise<void>;
  };
}

const SERVER_KEYS = ['id', 'version', 'updatedAt', 'updatedBy', 'createdAt'];
function strip<T extends object>(patch: T): Partial<T> {
  const out = { ...patch } as Record<string, unknown>;
  for (const k of SERVER_KEYS) delete out[k];
  return out as Partial<T>;
}
function pick<T extends object>(entity: T, keys: string[]): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = (entity as Record<string, unknown>)[k];
  return out as Partial<T>;
}
function upsert<T extends { id: D.ID }>(list: T[], item: T): T[] {
  return list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item];
}
function find<T extends { id: D.ID }>(list: T[], id: D.ID, what: string): T {
  const x = list.find((e) => e.id === id);
  if (!x) throw new ApiRequestError(404, 'not_found', `${what} not found.`);
  return x;
}
const reuseId = (id: D.ID) => (isUuid(id) ? id : newUuid());
const noop = () => undefined;

export function buildMutations(rt: DataRuntime): Mutations {
  const actor = (): D.UserRef | null => {
    const u = rt.getState().me?.user;
    return u ? { id: u.id, name: u.name } : null;
  };
  const stamp = () => ({ updatedAt: nowIso(), updatedBy: actor() });
  const quarters = (s: D.WorkspaceSnapshot) => rollingQuarterViews(today(), s.org.planning.fiscalYearStartMonth);
  const can = (p: string) => rt.activeMeWorkspace()?.permissions.includes(p as never) ?? false;
  const visible = () => rt.getState().snapshot;
  const nameOf = <T extends { id: D.ID; name: string }>(list: T[] | undefined, id: D.ID) =>
    list?.find((x) => x.id === id)?.name ?? 'This record';
  const own = <T extends { id: D.ID; version: number }>(x: T): T => {
    rt.noteOwnVersion(x.id, x.version);
    return x;
  };
  const withIds = (ops: AllocationOp[]): AllocationOp[] =>
    ops.map((op) =>
      op.op === 'create' && !op.allocation.id ? { ...op, allocation: { ...op.allocation, id: newUuid() } } : op,
    );
  const localCtx = () => ({ newId: newUuid, now: nowIso(), user: actor() });

  /* ── allocations ────────────────────────────────────────────────────────────── */

  /** Sends a batch; `build` computes ops from the confirmed server snapshot at send time. */
  function allocationBatch(
    label: string,
    build: (server: D.WorkspaceSnapshot) => AllocationOp[],
    preview: (s: D.WorkspaceSnapshot) => AllocationOp[],
    undoable = true,
  ): Promise<void> {
    return rt
      .mutate<AllocationBatchResponse>(
        {
          label,
          entity: { kind: 'booking', name: 'This booking' },
          optimistic: (s) => ({ ...s, allocations: applyAllocationOps(s.allocations, preview(s), localCtx()) }),
          async send({ wsId, server, api }) {
            const ops = build(server).map((op) => {
              if (op.op === 'create') return op;
              const cur = server.allocations.find((a) => a.id === op.id);
              // Rebase ops computed from an optimistic view onto this session's own confirmed writes.
              if (cur && op.version < cur.version && rt.ownedSince(op.id, op.version, cur.version))
                return { ...op, version: cur.version };
              return op;
            });
            if (ops.length > MAX_BATCH_OPS)
              throw new ApiRequestError(
                413,
                'payload_too_large',
                `A batch can hold at most ${MAX_BATCH_OPS} operations.`,
              );
            if (ops.length === 0) return { upserted: [], deleted: [], dataVersion: server.workspace.dataVersion };
            return api.allocations.batch(wsId, ops, label);
          },
          commit: (s, r) => ({
            ...s,
            allocations: applyBatchResponse(s.allocations, r).map((a) => (r.upserted.includes(a) ? own(a) : a)),
          }),
          dataVersion: (r) => r.dataVersion,
          onConflict: (s, cur) => {
            const c = cur as D.AllocationDTO;
            return c && typeof c === 'object' && 'resourceId' in c
              ? { ...s, allocations: upsert(s.allocations, c) }
              : s;
          },
          inverse: (before, _after, r) => {
            const inv = inverseOps(before.allocations, r);
            return inv.length
              ? () =>
                  allocationBatch(
                    `Undo: ${label}`,
                    () => inv,
                    () => inv,
                    false,
                  )
              : null;
          },
        },
        { undoable },
      )
      .then(noop);
  }

  const allocations: Mutations['allocations'] = {
    batch(ops, label) {
      const fixed = withIds(ops);
      return allocationBatch(
        label,
        () => fixed,
        () => fixed,
      );
    },
    setQuarterCell(a) {
      if (!Number.isFinite(a.pct) || a.pct < 0 || a.pct > 200)
        return Promise.reject(
          new ApiRequestError(400, 'bad_request', 'Enter 0–200', { fields: { pct: 'Enter 0–200' } }),
        );
      const ids = new Map<string, D.ID>();
      // Stable ids for creates so the optimistic row and the saved row match.
      const stable = (ops: AllocationOp[]) =>
        ops.map((op, i) => {
          if (op.op !== 'create') return op;
          const k = `${i}`;
          if (!ids.has(k)) ids.set(k, newUuid());
          return { ...op, allocation: { ...op.allocation, id: ids.get(k)! } };
        });
      return allocationBatch(
        'Edit booking',
        (server) => stable(quarterCellOps(server, quarters(server), a)),
        (s) => stable(quarterCellOps(s, quarters(s), a)),
      );
    },
    copyForward(a) {
      return allocationBatch(
        'Copy to later quarters',
        (server) => withIds(copyForwardOps(server, quarters(server), a)),
        (s) => withIds(copyForwardOps(s, quarters(s), a)),
      );
    },
    respond(id, r) {
      return rt
        .mutate<D.AllocationDTO>({
          label: r.decision === 'accept' ? 'Accept booking' : 'Decline booking',
          entity: { kind: 'booking', name: 'This booking' },
          optimistic: (s) => ({
            ...s,
            allocations: s.allocations.map((a) =>
              a.id === id
                ? { ...a, state: r.decision === 'accept' ? 'confirmed' : 'declined', respondedAt: nowIso() }
                : a,
            ),
          }),
          send: ({ wsId, api }) => api.allocations.respond(wsId, id, r),
          commit: (s, res) => ({ ...s, allocations: upsert(s.allocations, own(res)) }),
          inverse: (before, _a, res) => {
            const prev = before.allocations.find((a) => a.id === id);
            if (!prev || !can('allocations.write')) return null;
            const op: AllocationOp = {
              op: 'update',
              id,
              version: res.version,
              patch: { state: prev.state, respondedAt: prev.respondedAt, notes: prev.notes },
            };
            return () =>
              allocationBatch(
                'Undo response',
                () => [op],
                () => [op],
                false,
              );
          },
        })
        .then(noop);
    },
  };

  /* ── people ─────────────────────────────────────────────────────────────────── */

  function updatePerson(id: D.ID, patch: Partial<D.PersonDTO>, undoable = true): Promise<D.PersonDTO> {
    const clean = strip(patch);
    const name = nameOf(visible()?.people, id);
    return rt.mutate<D.PersonDTO>(
      {
        label: `Edit ${name}`,
        entity: { kind: 'person', name },
        optimistic: (s) => ({ ...s, people: s.people.map((p) => (p.id === id ? { ...p, ...clean } : p)) }),
        send: ({ wsId, server, api }) =>
          api.people.update(wsId, id, { version: find(server.people, id, 'Person').version, patch: clean }),
        commit: (s, r) => ({ ...s, people: upsert(s.people, own(r)) }),
        onConflict: (s, cur) => ({ ...s, people: upsert(s.people, cur as D.PersonDTO) }),
        inverse: (before) => {
          const prev = before.people.find((p) => p.id === id);
          return prev ? () => updatePerson(id, pick(prev, Object.keys(clean)), false).then(noop) : null;
        },
      },
      { undoable },
    );
  }

  function createPerson(p: NewPerson, undoable = true): Promise<D.PersonDTO> {
    const id = p.id ?? newUuid();
    const draft: D.PersonDTO = {
      email: null,
      role: '',
      type: 'Permanent',
      department: '',
      location: null,
      totalCapacity: 100,
      dailyRate: null,
      teamId: null,
      chapterId: null,
      homeTribeId: null,
      linkedUserId: null,
      primaryCraft: null,
      secondaryCrafts: [],
      tribeAffinity: [],
      skills: [],
      targetUtil: visible()?.org.planning.defaultTargetUtil ?? 100,
      ...strip(p),
      id,
      name: p.name,
      version: 1,
      ...stamp(),
    };
    return rt.mutate<D.PersonDTO>(
      {
        label: `Add ${p.name}`,
        optimistic: (s) => ({ ...s, people: upsert(s.people, draft) }),
        send: ({ wsId, api }) => api.people.create(wsId, { ...strip(p), name: p.name, id } as NewPerson),
        commit: (s, r) => ({ ...s, people: upsert(s.people, own(r)) }),
        inverse: (_b, _a, r) => () => removePerson(r.id, false),
      },
      { undoable },
    );
  }

  function removePerson(id: D.ID, undoable = true): Promise<void> {
    const name = nameOf(visible()?.people, id);
    return rt
      .mutate<void>(
        {
          label: `Delete ${name}`,
          entity: { kind: 'person', name },
          optimistic: (s) => ({
            ...s,
            people: s.people.filter((p) => p.id !== id),
            allocations: s.allocations.filter((a) => a.resourceId !== id),
            offers: s.offers.filter((o) => o.personId !== id),
          }),
          send: ({ wsId, server, api }) => api.people.remove(wsId, id, find(server.people, id, 'Person').version),
          commit: (s) => ({
            ...s,
            people: s.people.filter((p) => p.id !== id),
            allocations: s.allocations.filter((a) => a.resourceId !== id),
            offers: s.offers.filter((o) => o.personId !== id),
            craftRequests: s.craftRequests.filter((r) => r.personId !== id),
          }),
          onConflict: (s, cur) => ({ ...s, people: upsert(s.people, cur as D.PersonDTO) }),
          inverse: (before) => {
            const prev = before.people.find((p) => p.id === id);
            if (!prev) return null;
            const bookings = before.allocations.filter((a) => a.resourceId === id);
            const offers = before.offers.filter((o) => o.personId === id);
            return async () => {
              const restored = await createPerson(
                { ...strip(prev), name: prev.name, id: reuseId(prev.id) } as NewPerson,
                false,
              );
              const ops: AllocationOp[] = bookings.map((a) => ({
                op: 'create',
                allocation: { ...(strip(a) as NewAllocation), id: reuseId(a.id), resourceId: restored.id },
              }));
              if (ops.length)
                await allocationBatch(
                  `Restore ${prev.name}'s bookings`,
                  () => ops,
                  () => ops,
                  false,
                );
              for (const o of offers) await setOffer({ ...o, personId: restored.id }, false);
            };
          },
        },
        { undoable },
      )
      .then(noop);
  }

  const people: Mutations['people'] = {
    create: (p) => createPerson(p),
    update: (id, patch) => updatePerson(id, patch),
    remove: (id) => removePerson(id),
    bulk(req) {
      const ids = new Set(req.ids);
      const { addSecondaryCraft, ...fields } = req.patch;
      const apply = (p: D.PersonDTO): D.PersonDTO => ({
        ...p,
        ...fields,
        secondaryCrafts:
          addSecondaryCraft && addSecondaryCraft.craftId !== p.primaryCraft
            ? [...p.secondaryCrafts.filter((c) => c.craftId !== addSecondaryCraft.craftId), addSecondaryCraft]
            : p.secondaryCrafts,
      });
      return rt
        .mutate<{ people: D.PersonDTO[] }>({
          label: `Edit ${req.ids.length} ${req.ids.length === 1 ? 'person' : 'people'}`,
          entity: { kind: 'person', name: `${req.ids.length} people` },
          optimistic: (s) => ({ ...s, people: s.people.map((p) => (ids.has(p.id) ? apply(p) : p)) }),
          send: ({ wsId, server, api }) => {
            const versions: Record<D.ID, number> = {};
            for (const id of req.ids) versions[id] = find(server.people, id, 'Person').version;
            return api.people.bulk(wsId, { ...req, versions });
          },
          commit: (s, r) => ({ ...s, people: r.people.reduce((list, p) => upsert(list, own(p)), s.people) }),
          inverse: (before) => {
            const prev = before.people.filter((p) => ids.has(p.id));
            const keys = [...Object.keys(fields), ...(addSecondaryCraft ? ['secondaryCrafts'] : [])];
            return async () => {
              for (const p of prev) await updatePerson(p.id, pick(p, keys), false);
            };
          },
        })
        .then((r) => r.people);
    },
    async importRows(req) {
      const res = await rt.mutate<PeopleImportResponse>(
        {
          label: `Import ${req.rows.length} rows`,
          send: ({ wsId, api }) => api.people.import(wsId, req),
          commit: (s) => s,
          dataVersion: () => 'unchanged',
        },
        { undoable: false },
      );
      await rt.loadSnapshot();
      return res;
    },
    requestCraftChange(personId, crafts) {
      return rt.mutate<D.CraftChangeRequestDTO>(
        {
          label: 'Suggest craft changes',
          send: ({ wsId, api }) => api.people.requestCraftChange(wsId, personId, crafts),
          commit: (s, r) => ({ ...s, craftRequests: upsert(s.craftRequests, r) }),
        },
        { undoable: false },
      );
    },
    decideCraftChange(id, d, reason) {
      return rt.mutate<D.CraftChangeRequestDTO>(
        {
          label: d === 'approve' ? 'Approve craft change' : 'Reject craft change',
          entity: { kind: 'request', name: 'This request' },
          optimistic: (s) => ({
            ...s,
            craftRequests: s.craftRequests.map((r) =>
              r.id === id ? { ...r, status: d === 'approve' ? 'approved' : 'rejected' } : r,
            ),
          }),
          send: ({ wsId, api }) => api.craftRequests.decide(wsId, id, d, reason),
          commit: (s, r) => ({
            ...s,
            craftRequests: upsert(s.craftRequests, r),
            people:
              r.status === 'approved'
                ? s.people.map((p) =>
                    p.id === r.personId ? own({ ...p, secondaryCrafts: r.proposed, version: p.version + 1 }) : p,
                  )
                : s.people,
          }),
        },
        { undoable: false },
      );
    },
  };

  /* ── projects ───────────────────────────────────────────────────────────────── */

  function updateProject(id: D.ID, patch: Partial<D.ProjectDTO>, undoable = true): Promise<D.ProjectDTO> {
    const clean = strip(patch);
    const name = nameOf(visible()?.projects, id);
    return rt.mutate<D.ProjectDTO>(
      {
        label: `Edit ${name}`,
        entity: { kind: 'project', name },
        optimistic: (s) => ({ ...s, projects: s.projects.map((p) => (p.id === id ? { ...p, ...clean } : p)) }),
        send: ({ wsId, server, api }) =>
          api.projects.update(wsId, id, { version: find(server.projects, id, 'Project').version, patch: clean }),
        commit: (s, r) => ({ ...s, projects: upsert(s.projects, own(r)) }),
        onConflict: (s, cur) => ({ ...s, projects: upsert(s.projects, cur as D.ProjectDTO) }),
        inverse: (before) => {
          const prev = before.projects.find((p) => p.id === id);
          return prev ? () => updateProject(id, pick(prev, Object.keys(clean)), false).then(noop) : null;
        },
      },
      { undoable },
    );
  }

  function createProject(p: NewProject, undoable = true): Promise<D.ProjectDTO> {
    const id = p.id ?? newUuid();
    const draft: D.ProjectDTO = {
      status: 'Planning',
      priority: 'Medium',
      description: '',
      startDate: null,
      endDate: null,
      budget: null,
      tribeId: null,
      stage: null,
      initiatedOn: null,
      ownerUserId: null,
      jiraKey: null,
      planviewId: null,
      source: 'manual',
      ...strip(p),
      id,
      name: p.name,
      version: 1,
      ...stamp(),
    };
    return rt.mutate<D.ProjectDTO>(
      {
        label: `Add ${p.name}`,
        optimistic: (s) => ({ ...s, projects: upsert(s.projects, draft) }),
        send: ({ wsId, api }) => api.projects.create(wsId, { ...strip(p), name: p.name, id } as NewProject),
        commit: (s, r) => ({ ...s, projects: upsert(s.projects, own(r)) }),
        inverse: (_b, _a, r) => () => removeProject(r.id, false),
      },
      { undoable },
    );
  }

  function removeProject(id: D.ID, undoable = true): Promise<void> {
    const name = nameOf(visible()?.projects, id);
    return rt
      .mutate<void>(
        {
          label: `Delete ${name}`,
          entity: { kind: 'project', name },
          optimistic: (s) => ({
            ...s,
            projects: s.projects.filter((p) => p.id !== id),
            allocations: s.allocations.filter((a) => a.projectId !== id),
            demand: s.demand.filter((l) => l.projectId !== id),
          }),
          send: ({ wsId, server, api }) => api.projects.remove(wsId, id, find(server.projects, id, 'Project').version),
          commit: (s) => ({
            ...s,
            projects: s.projects.filter((p) => p.id !== id),
            allocations: s.allocations.filter((a) => a.projectId !== id),
            demand: s.demand.filter((l) => l.projectId !== id),
          }),
          onConflict: (s, cur) => ({ ...s, projects: upsert(s.projects, cur as D.ProjectDTO) }),
          inverse: (before) => {
            const prev = before.projects.find((p) => p.id === id);
            if (!prev) return null;
            const lines = before.demand.filter((l) => l.projectId === id);
            const bookings = before.allocations.filter((a) => a.projectId === id);
            return async () => {
              const restored = await createProject(
                { ...strip(prev), name: prev.name, id: reuseId(prev.id) } as NewProject,
                false,
              );
              const dOps: DemandOp[] = lines.map((l) => ({
                op: 'create',
                line: { ...(strip(l) as NewDemandLine), id: reuseId(l.id), projectId: restored.id },
              }));
              if (dOps.length)
                await demandBatch(
                  `Restore ${prev.name} demand`,
                  () => dOps,
                  () => dOps,
                  false,
                );
              const aOps: AllocationOp[] = bookings.map((a) => ({
                op: 'create',
                allocation: { ...(strip(a) as NewAllocation), id: reuseId(a.id), projectId: restored.id },
              }));
              if (aOps.length)
                await allocationBatch(
                  `Restore ${prev.name} bookings`,
                  () => aOps,
                  () => aOps,
                  false,
                );
            };
          },
        },
        { undoable },
      )
      .then(noop);
  }

  const projects: Mutations['projects'] = {
    create: (p) => createProject(p),
    update: (id, patch) => updateProject(id, patch),
    remove: (id) => removeProject(id),
  };

  /* ── demand ─────────────────────────────────────────────────────────────────── */

  function applyDemandOps(list: D.DemandLineDTO[], ops: DemandOp[]): D.DemandLineDTO[] {
    let out = [...list];
    for (const op of ops) {
      if (op.op === 'delete') out = out.filter((l) => l.id !== op.id);
      else if (op.op === 'update') out = out.map((l) => (l.id === op.id ? { ...l, ...op.patch } : l));
      else
        out = upsert(out, {
          ...op.line,
          id: op.line.id ?? newUuid(),
          createdAt: nowIso(),
          version: 1,
          ...stamp(),
        } as D.DemandLineDTO);
    }
    return out;
  }

  function demandBatch(
    label: string,
    build: (server: D.WorkspaceSnapshot) => DemandOp[],
    preview: (s: D.WorkspaceSnapshot) => DemandOp[],
    undoable = true,
  ): Promise<void> {
    return rt
      .mutate<{ upserted: D.DemandLineDTO[]; deleted: D.ID[] }>(
        {
          label,
          entity: { kind: 'demand', name: 'This demand line' },
          optimistic: (s) => ({ ...s, demand: applyDemandOps(s.demand, preview(s)) }),
          send: ({ wsId, server, api }) => {
            const ops = build(server);
            return ops.length ? api.demand.batch(wsId, ops) : Promise.resolve({ upserted: [], deleted: [] });
          },
          commit: (s, r) => ({
            ...s,
            demand: r.upserted.reduce(
              (list, l) => upsert(list, own(l)),
              s.demand.filter((l) => !r.deleted.includes(l.id)),
            ),
          }),
          inverse: (before, _a, r) => {
            const prev = new Map(before.demand.map((l) => [l.id, l]));
            const inv: DemandOp[] = [
              ...r.upserted.map((l): DemandOp => {
                const old = prev.get(l.id);
                return old
                  ? {
                      op: 'update',
                      id: l.id,
                      version: l.version,
                      patch: pick(old, ['fte', 'status', 'ownerUserId', 'note', 'craftId', 'quarterKey']),
                    }
                  : { op: 'delete', id: l.id, version: l.version };
              }),
              ...r.deleted.flatMap((id): DemandOp[] => {
                const old = prev.get(id);
                return old ? [{ op: 'create', line: { ...(strip(old) as NewDemandLine), id: reuseId(old.id) } }] : [];
              }),
            ];
            return inv.length
              ? () =>
                  demandBatch(
                    `Undo: ${label}`,
                    () => inv,
                    () => inv,
                    false,
                  )
              : null;
          },
        },
        { undoable },
      )
      .then(noop);
  }

  function updateDemand(id: D.ID, patch: Partial<D.DemandLineDTO>, undoable = true): Promise<D.DemandLineDTO> {
    const clean = strip(patch);
    return rt.mutate<D.DemandLineDTO>(
      {
        label: 'Edit demand',
        entity: { kind: 'demand', name: 'This demand line' },
        optimistic: (s) => ({ ...s, demand: s.demand.map((l) => (l.id === id ? { ...l, ...clean } : l)) }),
        send: ({ wsId, server, api }) =>
          api.demand.update(wsId, id, { version: find(server.demand, id, 'Demand line').version, patch: clean }),
        commit: (s, r) => ({ ...s, demand: upsert(s.demand, own(r)) }),
        onConflict: (s, cur) => ({ ...s, demand: upsert(s.demand, cur as D.DemandLineDTO) }),
        inverse: (before) => {
          const prev = before.demand.find((l) => l.id === id);
          return prev ? () => updateDemand(id, pick(prev, Object.keys(clean)), false).then(noop) : null;
        },
      },
      { undoable },
    );
  }

  const demand: Mutations['demand'] = {
    create(l) {
      const line = { ...l, id: l.id ?? newUuid() };
      return rt.mutate<D.DemandLineDTO>({
        label: 'Add demand',
        optimistic: (s) => ({ ...s, demand: applyDemandOps(s.demand, [{ op: 'create', line }]) }),
        send: ({ wsId, api }) => api.demand.create(wsId, line),
        commit: (s, r) => ({ ...s, demand: upsert(s.demand, own(r)) }),
        inverse: (_b, _a, r) => () =>
          demandBatch(
            'Undo: Add demand',
            () => [{ op: 'delete', id: r.id, version: r.version }],
            () => [{ op: 'delete', id: r.id, version: r.version }],
            false,
          ),
      });
    },
    update: (id, patch) => updateDemand(id, patch),
    remove(id) {
      return rt
        .mutate<void>({
          label: 'Delete demand',
          entity: { kind: 'demand', name: 'This demand line' },
          optimistic: (s) => ({ ...s, demand: s.demand.filter((l) => l.id !== id) }),
          send: ({ wsId, server, api }) => api.demand.remove(wsId, id, find(server.demand, id, 'Demand line').version),
          commit: (s) => ({ ...s, demand: s.demand.filter((l) => l.id !== id) }),
          inverse: (before) => {
            const prev = before.demand.find((l) => l.id === id);
            if (!prev) return null;
            const op: DemandOp = { op: 'create', line: { ...(strip(prev) as NewDemandLine), id: reuseId(prev.id) } };
            return () =>
              demandBatch(
                'Undo: Delete demand',
                () => [op],
                () => [op],
                false,
              );
          },
        })
        .then(noop);
    },
    copyForward(id, toQuarterKeys) {
      const build = (s: D.WorkspaceSnapshot): DemandOp[] => {
        const src = find(s.demand, id, 'Demand line');
        return toQuarterKeys
          .filter((q) => q !== src.quarterKey)
          .map((q): DemandOp => {
            const existing = s.demand.find(
              (l) => l.projectId === src.projectId && l.craftId === src.craftId && l.quarterKey === q,
            );
            return existing
              ? {
                  op: 'update',
                  id: existing.id,
                  version: existing.version,
                  patch: { fte: src.fte, status: src.status },
                }
              : {
                  op: 'create',
                  line: {
                    id: newUuid(),
                    projectId: src.projectId,
                    quarterKey: q,
                    craftId: src.craftId,
                    fte: src.fte,
                    status: src.status,
                    ownerUserId: src.ownerUserId,
                    note: src.note,
                  },
                };
          });
      };
      let planned: DemandOp[] | null = null;
      const once = (s: D.WorkspaceSnapshot) => (planned ??= build(s));
      return demandBatch(
        'Copy demand to later quarters',
        (server) => {
          // Keep the optimistic ids for creates; refresh versions for updates from the server.
          const ops = once(server);
          return ops.map((op) => {
            if (op.op !== 'update') return op;
            const cur = server.demand.find((l) => l.id === op.id);
            return cur ? { ...op, version: cur.version } : op;
          });
        },
        once,
      );
    },
  };

  /* ── marketplace ────────────────────────────────────────────────────────────── */

  function setOffer(o: Omit<D.MarketplaceOfferDTO, 'createdBy' | 'createdAt'>, undoable = true): Promise<void> {
    const key = (x: { personId: D.ID; quarterKey: string }) => `${x.personId}|${x.quarterKey}`;
    const draft: D.MarketplaceOfferDTO = { ...o, createdBy: actor() ?? { id: '', name: '' }, createdAt: nowIso() };
    const replace = (list: D.MarketplaceOfferDTO[], x: D.MarketplaceOfferDTO) => [
      ...list.filter((y) => key(y) !== key(x)),
      x,
    ];
    return rt
      .mutate<D.MarketplaceOfferDTO>(
        {
          label: 'Offer to marketplace',
          optimistic: (s) => ({ ...s, offers: replace(s.offers, draft) }),
          send: ({ wsId, api }) =>
            api.marketplace.setOffer(wsId, o.personId, o.quarterKey, {
              pct: o.pct,
              craftIds: o.craftIds,
              note: o.note,
            }),
          commit: (s, r) => ({ ...s, offers: replace(s.offers, r) }),
          inverse: (before) => {
            const prev = before.offers.find((x) => key(x) === key(o));
            return prev ? () => setOffer(prev, false) : () => withdrawOffer(o.personId, o.quarterKey, false);
          },
        },
        { undoable },
      )
      .then(noop);
  }

  function withdrawOffer(personId: D.ID, quarterKey: D.QuarterKey, undoable = true): Promise<void> {
    const match = (x: D.MarketplaceOfferDTO) => x.personId === personId && x.quarterKey === quarterKey;
    return rt
      .mutate<void>(
        {
          label: 'Withdraw offer',
          optimistic: (s) => ({ ...s, offers: s.offers.filter((x) => !match(x)) }),
          send: ({ wsId, api }) => api.marketplace.withdrawOffer(wsId, personId, quarterKey),
          commit: (s) => ({ ...s, offers: s.offers.filter((x) => !match(x)) }),
          inverse: (before) => {
            const prev = before.offers.find(match);
            return prev ? () => setOffer(prev, false) : null;
          },
        },
        { undoable },
      )
      .then(noop);
  }

  const marketplace: Mutations['marketplace'] = {
    propose(r) {
      const tempId = `pending-${newUuid()}`;
      return rt.mutate<D.AllocationDTO>({
        label: 'Propose booking',
        optimistic: (s) => ({
          ...s,
          allocations: [
            ...s.allocations,
            {
              id: tempId,
              resourceId: r.resourceId,
              projectId: r.projectId,
              percentage: r.percentage,
              startDate: r.startDate,
              endDate: r.endDate,
              craftId: r.craftId,
              source: 'marketplace',
              state: 'tentative',
              notes: null,
              externalRef: null,
              demandLineId: r.demandLineId,
              proposedAt: nowIso(),
              proposedBy: actor(),
              respondedAt: null,
              version: 1,
              ...stamp(),
            },
          ],
        }),
        send: ({ wsId, api }) => api.marketplace.propose(wsId, r),
        commit: (s, a) => ({ ...s, allocations: upsert(s.allocations, own(a)) }),
        inverse: (_b, _a, a) => {
          if (!can('allocations.write')) return null;
          const op: AllocationOp = { op: 'delete', id: a.id, version: a.version };
          return () =>
            allocationBatch(
              'Undo: Propose booking',
              () => [op],
              () => [op],
              false,
            );
        },
      });
    },
    setOffer: (o) => setOffer(o),
    withdrawOffer: (personId, quarterKey) => withdrawOffer(personId, quarterKey),
  };

  /* ── structure (org-level) ─────────────────────────────────────────────────── */

  function orgId(): D.ID {
    const id = rt.getState().me?.org?.id;
    if (!id) throw new ApiRequestError(403, 'forbidden', 'You are not in an organisation.');
    return id;
  }

  function saveStructure(
    kind: StructureKind,
    entity: { id?: D.ID; version?: number } & Record<string, unknown>,
    label: string,
    undoable = true,
  ): Promise<void> {
    const list = (s: D.WorkspaceSnapshot) => s[kind] as unknown as Array<Entity & D.Versioned>;
    const existing = entity.id ? visible() && list(visible()!).find((e) => e.id === entity.id) : undefined;
    const clean = strip(entity) as Record<string, unknown>;
    const tempId = entity.id ?? `pending-${newUuid()}`;
    return rt
      .mutate<Entity & D.Versioned>(
        {
          label,
          entity: { kind: kind.slice(0, -1), name: String(existing?.name ?? clean.name ?? 'This record') },
          optimistic: (s) => ({
            ...s,
            [kind]: existing
              ? list(s).map((e) => (e.id === entity.id ? { ...e, ...clean } : e))
              : [...list(s), { ...clean, id: tempId, archived: false, version: 1, ...stamp() }],
          }),
          send: ({ server, api }) => {
            const o = orgId();
            const cur = entity.id ? list(server).find((e) => e.id === entity.id) : undefined;
            if (cur)
              return api.structure.update(o, kind, cur.id, {
                version: entity.version ?? cur.version,
                patch: clean as never,
              }) as unknown as Promise<Entity & D.Versioned>;
            return api.structure.create(o, kind, {
              ...clean,
              ...(entity.id ? { id: entity.id } : {}),
            } as never) as unknown as Promise<Entity & D.Versioned>;
          },
          commit: (s, r) => ({ ...s, [kind]: upsert(list(s), r) }),
          onConflict: (s, cur) =>
            cur && typeof cur === 'object' && 'id' in cur
              ? { ...s, [kind]: upsert(list(s), cur as Entity & D.Versioned) }
              : s,
          inverse: (before, _a, r) => {
            const prev = list(before).find((e) => e.id === r.id);
            if (prev) {
              const back = pick(prev, Object.keys(clean));
              return () => saveStructure(kind, { ...back, id: r.id }, `Undo: ${label}`, false);
            }
            return async () => {
              const o = orgId();
              await rt.api.structure.remove(o, kind, r.id, r.version);
              await rt.loadSnapshot();
            };
          },
        },
        { undoable },
      )
      .then(noop);
  }

  const structure: Mutations['structure'] = {
    save: (kind, entity) => saveStructure(kind, entity, `Save ${kind.slice(0, -1)}`),
    archive: (kind, id, archived) =>
      saveStructure(kind, { id, archived }, `${archived ? 'Archive' : 'Restore'} ${kind.slice(0, -1)}`),
  };

  /* ── admin ──────────────────────────────────────────────────────────────────── */

  const admin: Mutations['admin'] = {
    invite: (r) => Promise.resolve().then(() => rt.api.invitations.create(orgId(), r)),
    members: () => Promise.resolve().then(() => rt.api.members.list(orgId())),
    async updateMember(userId, p) {
      await rt.api.members.update(orgId(), userId, p);
      if (userId === rt.getState().me?.user.id) await rt.refreshMe();
    },
    async removeMember(userId) {
      await rt.api.members.remove(orgId(), userId);
    },
    async updateOrg(patch) {
      const clean = strip(patch);
      await rt.mutate<D.OrgDTO>(
        {
          label: 'Update organisation',
          entity: { kind: 'organisation', name: 'The organisation' },
          optimistic: (s) => ({ ...s, org: { ...s.org, ...clean } }),
          send: ({ server, api }) => api.orgs.update(orgId(), { version: server.org.version, patch: clean }),
          commit: (s, r) => ({ ...s, org: r }),
          onConflict: (s, cur) =>
            cur && typeof cur === 'object' && 'slug' in cur ? { ...s, org: cur as D.OrgDTO } : s,
          dataVersion: () => 'unchanged',
        },
        { undoable: false },
      );
      await rt.refreshMe();
    },
  };

  return { people, projects, demand, allocations, marketplace, structure, admin };
}
