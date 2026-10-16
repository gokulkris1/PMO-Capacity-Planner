/**
 * WP-0 STUB: every mutation from BACKLOG §4.3 `useMutations()`, applied to the in-memory demo
 * snapshot and resolved immediately. Permission checks mirror the API route table (403
 * `forbidden`), and creating people/projects respects entitlements (403 `entitlement`), so
 * gated UI can be exercised with `?demoRole=VIEWER`. C replaces this with real client calls.
 */
import type * as D from '../../shared/contracts/dto';
import type {
  AllocationOp,
  InvitationRequest,
  InvitationResponse,
  MemberDTO,
  MemberPatch,
  NewDemandLine,
  NewPerson,
  NewProject,
  PeopleBulkRequest,
  PeopleImportRequest,
  PeopleImportResponse,
  ProposeRequest,
  RespondRequest,
} from '../../shared/contracts/api';
import type { Permission } from '../../shared/permissions';
import { withinLimit } from '../../shared/entitlements';
import { applyAllocationOps } from '../../utils/viewModels/allocationOps';
import { copyForward as copyForwardOps, setQuarterCell as setQuarterCellOps } from '../../utils/viewModels';
import { ApiRequestError } from './errors';
import { rollingQuarterViews } from './quarters';
import { commit, getState, newId, setState } from './store';

type StructureKind = 'tribes' | 'chapters' | 'teams' | 'crafts';

const now = () => new Date().toISOString();
const actor = (): D.UserRef | null => {
  const u = getState().me?.user;
  return u ? { id: u.id, name: u.name } : null;
};
const stamp = () => ({ updatedAt: now(), updatedBy: actor() });

function activeWorkspace(): D.MeWorkspace | null {
  const s = getState();
  return s.me?.workspaces.find((w) => w.id === s.activeWorkspaceId) ?? null;
}
function has(p: Permission): boolean {
  return activeWorkspace()?.permissions.includes(p) ?? false;
}
function isOwn(personId: D.ID): boolean {
  return activeWorkspace()?.linkedPersonId === personId;
}
function forbid(): never {
  throw new ApiRequestError(403, 'forbidden', 'You do not have permission to do that.');
}
function need(p: Permission): void {
  if (!has(p)) forbid();
}
function needOwnOr(any: Permission, own: Permission, personId: D.ID): void {
  if (!has(any) && !(has(own) && isOwn(personId))) forbid();
}
function notFound(what: string): never {
  throw new ApiRequestError(404, 'not_found', `${what} not found.`);
}
function snap(): D.WorkspaceSnapshot {
  return getState().snapshot;
}
function quarters() {
  return rollingQuarterViews(new Date(), snap().org.planning.fiscalYearStartMonth);
}
function bumped<T extends D.Versioned>(e: T, patch: Partial<T>): T {
  return { ...e, ...patch, version: e.version + 1, ...stamp() };
}
/** Drops keys the server owns from a client patch. */
function clean<T extends object>(patch: T): T {
  const rest = { ...patch } as Record<string, unknown>;
  delete rest.id;
  delete rest.version;
  delete rest.updatedAt;
  delete rest.updatedBy;
  return rest as T;
}

function makePerson(p: NewPerson): D.PersonDTO {
  return {
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
    targetUtil: snap().org.planning.defaultTargetUtil,
    ...clean(p),
    id: p.id ?? newId(),
    name: p.name,
    version: 1,
    ...stamp(),
  };
}

function makeProject(p: NewProject): D.ProjectDTO {
  return {
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
    ...clean(p),
    id: p.id ?? newId(),
    name: p.name,
    version: 1,
    ...stamp(),
  };
}

function applyBatch(ops: AllocationOp[], label: string): void {
  commit(label, (s) => ({
    ...s,
    allocations: applyAllocationOps(s.allocations, ops, { newId, now: now(), user: actor() }),
  }));
}

const people = {
  async create(p: NewPerson): Promise<D.PersonDTO> {
    need('people.write');
    const me = getState().me;
    if (me && !withinLimit(me.entitlements, 'maxPeople', snap().people.length + 1)) {
      throw new ApiRequestError(403, 'entitlement', 'Your plan does not allow more people.');
    }
    const person = makePerson(p);
    commit(`Add ${person.name}`, (s) => ({ ...s, people: [...s.people, person] }));
    return person;
  },
  async update(id: D.ID, patch: Partial<D.PersonDTO>): Promise<D.PersonDTO> {
    needOwnOr('people.write', 'people.write.own', id);
    const cur = snap().people.find((p) => p.id === id) ?? notFound('Person');
    const next = bumped(cur, clean(patch));
    commit(`Edit ${cur.name}`, (s) => ({ ...s, people: s.people.map((p) => (p.id === id ? next : p)) }));
    return next;
  },
  async remove(id: D.ID): Promise<void> {
    need('people.write');
    const cur = snap().people.find((p) => p.id === id) ?? notFound('Person');
    commit(`Delete ${cur.name}`, (s) => ({
      ...s,
      people: s.people.filter((p) => p.id !== id),
      allocations: s.allocations.filter((a) => a.resourceId !== id),
      offers: s.offers.filter((o) => o.personId !== id),
    }));
  },
  async bulk(req: Omit<PeopleBulkRequest, 'versions'>): Promise<D.PersonDTO[]> {
    need('people.write');
    const ids = new Set(req.ids);
    const { addSecondaryCraft, ...fields } = req.patch;
    const updated: D.PersonDTO[] = [];
    commit(`Edit ${req.ids.length} people`, (s) => ({
      ...s,
      people: s.people.map((p) => {
        if (!ids.has(p.id)) return p;
        const secondaryCrafts = addSecondaryCraft
          ? [...p.secondaryCrafts.filter((c) => c.craftId !== addSecondaryCraft.craftId), addSecondaryCraft]
          : p.secondaryCrafts;
        const next = bumped(p, { ...fields, secondaryCrafts });
        updated.push(next);
        return next;
      }),
    }));
    return updated;
  },
  async importRows(req: PeopleImportRequest): Promise<PeopleImportResponse> {
    need('import.csv');
    const res: PeopleImportResponse = { created: 0, updated: 0, skipped: 0, errors: [] };
    commit(`Import ${req.rows.length} rows`, (s) => {
      let list = [...s.people];
      req.rows.forEach((row, i) => {
        if (!row.name?.trim()) {
          res.errors.push({ row: i + 1, message: 'Name is required.' });
          res.skipped++;
          return;
        }
        const match = list.find(
          (p) =>
            (row.email && p.email?.toLowerCase() === row.email.toLowerCase()) ||
            p.name.toLowerCase() === row.name.toLowerCase(),
        );
        const craft = row.aboveCraft
          ? s.crafts.find((c) => c.id === row.aboveCraft || c.name.toLowerCase() === row.aboveCraft!.toLowerCase())?.id
          : undefined;
        const fields: Partial<D.PersonDTO> = {
          name: row.name.trim(),
          ...(row.email !== undefined && { email: row.email }),
          ...(row.jobTitle !== undefined && { role: row.jobTitle }),
          ...(row.type !== undefined && { type: row.type }),
          ...(row.location !== undefined && { location: row.location }),
          ...(row.targetPct !== undefined && { targetUtil: row.targetPct }),
          ...(craft !== undefined && { primaryCraft: craft }),
          ...(row.belowCrafts !== undefined && { secondaryCrafts: row.belowCrafts }),
          ...(row.skills !== undefined && { skills: row.skills }),
        };
        if (match) {
          list = list.map((p) => (p === match ? bumped(p, fields) : p));
          res.updated++;
        } else {
          list.push(makePerson({ ...fields, name: row.name.trim() }));
          res.created++;
        }
      });
      return { ...s, people: list };
    });
    return res;
  },
  async requestCraftChange(personId: D.ID, crafts: D.SecondaryCraftDTO[]): Promise<D.CraftChangeRequestDTO> {
    needOwnOr('people.write', 'people.write.own', personId);
    const person = snap().people.find((p) => p.id === personId) ?? notFound('Person');
    const user = actor() ?? { id: 'demo-user', name: 'Demo User' };
    const req: D.CraftChangeRequestDTO = {
      id: newId(),
      personId,
      current: person.secondaryCrafts,
      proposed: crafts,
      status: 'pending',
      submittedBy: user,
      submittedAt: now(),
      decidedBy: null,
      decidedAt: null,
      reason: null,
    };
    commit(`Request craft change for ${person.name}`, (s) => ({ ...s, craftRequests: [...s.craftRequests, req] }));
    return req;
  },
  async decideCraftChange(id: D.ID, d: 'approve' | 'reject', reason?: string): Promise<D.CraftChangeRequestDTO> {
    need('craftProfile.approve');
    const cur = snap().craftRequests.find((r) => r.id === id) ?? notFound('Request');
    if (cur.status !== 'pending') throw new ApiRequestError(409, 'conflict', 'This request was already decided.');
    const next: D.CraftChangeRequestDTO = {
      ...cur,
      status: d === 'approve' ? 'approved' : 'rejected',
      decidedBy: actor(),
      decidedAt: now(),
      reason: reason ?? null,
    };
    commit(d === 'approve' ? 'Approve craft change' : 'Reject craft change', (s) => ({
      ...s,
      craftRequests: s.craftRequests.map((r) => (r.id === id ? next : r)),
      people:
        d === 'approve'
          ? s.people.map((p) => (p.id === cur.personId ? bumped(p, { secondaryCrafts: cur.proposed }) : p))
          : s.people,
    }));
    return next;
  },
};

const projects = {
  async create(p: NewProject): Promise<D.ProjectDTO> {
    need('projects.write');
    const me = getState().me;
    if (me && !withinLimit(me.entitlements, 'maxProjects', snap().projects.length + 1)) {
      throw new ApiRequestError(403, 'entitlement', 'Your plan does not allow more projects.');
    }
    const project = makeProject(p);
    commit(`Add ${project.name}`, (s) => ({ ...s, projects: [...s.projects, project] }));
    return project;
  },
  async update(id: D.ID, patch: Partial<D.ProjectDTO>): Promise<D.ProjectDTO> {
    need('projects.write');
    const cur = snap().projects.find((p) => p.id === id) ?? notFound('Project');
    const next = bumped(cur, clean(patch));
    commit(`Edit ${cur.name}`, (s) => ({ ...s, projects: s.projects.map((p) => (p.id === id ? next : p)) }));
    return next;
  },
  async remove(id: D.ID): Promise<void> {
    need('projects.write');
    const cur = snap().projects.find((p) => p.id === id) ?? notFound('Project');
    commit(`Delete ${cur.name}`, (s) => ({
      ...s,
      projects: s.projects.filter((p) => p.id !== id),
      allocations: s.allocations.filter((a) => a.projectId !== id),
      demand: s.demand.filter((l) => l.projectId !== id),
    }));
  },
};

const demand = {
  async create(l: NewDemandLine): Promise<D.DemandLineDTO> {
    need('demand.write');
    const line: D.DemandLineDTO = { ...clean(l), id: l.id ?? newId(), createdAt: now(), version: 1, ...stamp() };
    commit('Add demand', (s) => ({ ...s, demand: [...s.demand, line] }));
    return line;
  },
  async update(id: D.ID, patch: Partial<D.DemandLineDTO>): Promise<D.DemandLineDTO> {
    need('demand.write');
    const cur = snap().demand.find((l) => l.id === id) ?? notFound('Demand line');
    const next = bumped(cur, clean(patch));
    commit('Edit demand', (s) => ({ ...s, demand: s.demand.map((l) => (l.id === id ? next : l)) }));
    return next;
  },
  async remove(id: D.ID): Promise<void> {
    need('demand.write');
    if (!snap().demand.some((l) => l.id === id)) notFound('Demand line');
    commit('Delete demand', (s) => ({ ...s, demand: s.demand.filter((l) => l.id !== id) }));
  },
  async copyForward(id: D.ID, toQuarterKeys: D.QuarterKey[]): Promise<void> {
    need('demand.write');
    const src = snap().demand.find((l) => l.id === id) ?? notFound('Demand line');
    commit('Copy demand forward', (s) => {
      let list = [...s.demand];
      for (const q of toQuarterKeys) {
        const existing = list.find(
          (l) => l.projectId === src.projectId && l.craftId === src.craftId && l.quarterKey === q,
        );
        if (existing) list = list.map((l) => (l === existing ? bumped(l, { fte: src.fte, status: src.status }) : l));
        else list.push({ ...src, id: newId(), quarterKey: q, createdAt: now(), version: 1, ...stamp() });
      }
      return { ...s, demand: list };
    });
  },
};

const allocations = {
  async batch(ops: AllocationOp[], label: string): Promise<void> {
    need('allocations.write');
    if (ops.length > 500)
      throw new ApiRequestError(413, 'payload_too_large', 'A batch can hold at most 500 operations.');
    applyBatch(ops, label);
  },
  async setQuarterCell(a: {
    resourceId: D.ID;
    projectId: D.ID;
    craftId: D.ID | null;
    quarterKey: D.QuarterKey;
    pct: number;
  }): Promise<void> {
    need('allocations.write');
    if (a.pct < 0 || a.pct > 200)
      throw new ApiRequestError(400, 'bad_request', 'Enter 0–200', { fields: { pct: 'Enter 0–200' } });
    applyBatch(setQuarterCellOps(snap(), quarters(), a), 'Edit booking');
  },
  async copyForward(a: {
    resourceId: D.ID;
    projectId: D.ID;
    craftId: D.ID | null;
    fromQuarterKey: D.QuarterKey;
  }): Promise<void> {
    need('allocations.write');
    applyBatch(copyForwardOps(snap(), quarters(), a), 'Copy to later quarters');
  },
  async respond(id: D.ID, r: RespondRequest): Promise<void> {
    const cur = snap().allocations.find((a) => a.id === id) ?? notFound('Booking');
    needOwnOr('allocations.write', 'allocations.respond.own', cur.resourceId);
    if (cur.state !== 'tentative') throw new ApiRequestError(409, 'conflict', 'This booking is no longer pending.');
    const next = bumped(cur, {
      state: r.decision === 'accept' ? 'confirmed' : 'declined',
      respondedAt: now(),
      notes: r.reason ?? cur.notes,
    });
    commit(r.decision === 'accept' ? 'Accept booking' : 'Decline booking', (s) => ({
      ...s,
      allocations: s.allocations.map((a) => (a.id === id ? next : a)),
    }));
  },
};

const marketplace = {
  async propose(r: ProposeRequest): Promise<D.AllocationDTO> {
    need('allocations.propose');
    const a: D.AllocationDTO = {
      id: newId(),
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
      proposedAt: now(),
      proposedBy: actor(),
      respondedAt: null,
      version: 1,
      ...stamp(),
    };
    commit('Propose booking', (s) => ({ ...s, allocations: [...s.allocations, a] }));
    return a;
  },
  async setOffer(o: Omit<D.MarketplaceOfferDTO, 'createdBy' | 'createdAt'>): Promise<void> {
    needOwnOr('offers.write', 'offers.write.own', o.personId);
    const offer: D.MarketplaceOfferDTO = {
      ...o,
      createdBy: actor() ?? { id: 'demo-user', name: 'Demo User' },
      createdAt: now(),
    };
    commit('Offer to marketplace', (s) => ({
      ...s,
      offers: [...s.offers.filter((x) => !(x.personId === o.personId && x.quarterKey === o.quarterKey)), offer],
    }));
  },
  async withdrawOffer(personId: D.ID, quarterKey: D.QuarterKey): Promise<void> {
    needOwnOr('offers.write', 'offers.write.own', personId);
    commit('Withdraw offer', (s) => ({
      ...s,
      offers: s.offers.filter((x) => !(x.personId === personId && x.quarterKey === quarterKey)),
    }));
  },
};

const STRUCTURE_DEFAULTS: Record<StructureKind, Record<string, unknown>> = {
  tribes: { name: '', leadName: null, archived: false },
  chapters: { name: '', craftId: null, leadPersonId: null, archived: false },
  teams: { name: '', archived: false },
  crafts: { name: '', short: '', description: null, family: null, archived: false, sortOrder: 0 },
};

const structure = {
  async save(kind: StructureKind, entity: { id?: D.ID; version?: number } & Record<string, unknown>): Promise<void> {
    need('structure.write');
    commit(`Save ${kind.slice(0, -1)}`, (s) => {
      const list = s[kind] as unknown as Array<D.Versioned & { id: D.ID }>;
      const existing = entity.id ? list.find((e) => e.id === entity.id) : undefined;
      if (existing && entity.version !== undefined && entity.version !== existing.version) {
        throw new ApiRequestError(409, 'conflict', 'Someone else changed this. Reload to see their change.');
      }
      const next = existing
        ? list.map((e) => (e === existing ? bumped(e, clean(entity) as Partial<typeof e>) : e))
        : [
            ...list,
            {
              ...STRUCTURE_DEFAULTS[kind],
              sortOrder: list.length,
              ...clean(entity),
              id: entity.id ?? newId(),
              version: 1,
              ...stamp(),
            },
          ];
      return { ...s, [kind]: next };
    });
  },
  async archive(kind: StructureKind, id: D.ID, archived: boolean): Promise<void> {
    need('structure.write');
    commit(archived ? `Archive ${kind.slice(0, -1)}` : `Restore ${kind.slice(0, -1)}`, (s) => {
      const list = s[kind] as unknown as Array<D.Versioned & { id: D.ID; archived: boolean }>;
      return { ...s, [kind]: list.map((e) => (e.id === id ? bumped(e, { archived }) : e)) };
    });
  },
};

const admin = {
  async invite(r: InvitationRequest): Promise<InvitationResponse> {
    if (!has('org.members.manage') && !has('workspace.members.manage')) forbid();
    const id = newId();
    const origin = typeof window !== 'undefined' && window.location ? window.location.origin : '';
    return {
      invitation: { id, email: r.email, expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString() },
      inviteUrl: `${origin}/invite/demo-${id}`,
    };
  },
  async members(): Promise<MemberDTO[]> {
    if (!has('org.members.manage') && !has('workspace.members.manage')) forbid();
    const me = getState().me;
    if (!me) return [];
    return [
      {
        userId: me.user.id,
        name: me.user.name,
        email: me.user.email,
        orgRole: me.org?.role ?? 'MEMBER',
        workspaces: me.workspaces.map((w) => ({ workspaceId: w.id, role: w.role })),
        linkedPersonIds: me.workspaces.map((w) => w.linkedPersonId).filter((x): x is string => !!x),
        lastSignInAt: now(),
      },
    ];
  },
  async updateMember(_userId: D.ID, _p: MemberPatch): Promise<void> {
    if (!has('org.members.manage') && !has('workspace.members.manage')) forbid();
  },
  async removeMember(_userId: D.ID): Promise<void> {
    if (!has('org.members.manage') && !has('workspace.members.manage')) forbid();
  },
  async updateOrg(patch: Partial<D.OrgDTO>): Promise<void> {
    need('org.manage');
    commit('Update organisation', (s) => ({ ...s, org: bumped(s.org, clean(patch)) }));
    setState((st) => {
      const o = st.snapshot.org;
      return st.me?.org
        ? {
            ...st,
            me: {
              ...st.me,
              org: {
                ...st.me.org,
                name: o.name,
                slug: o.slug,
                logoUrl: o.logoUrl,
                plan: o.plan,
                features: o.features,
                planning: o.planning,
              },
            },
          }
        : st;
    });
  },
};

/** One stable object for the whole app (safe in effect dependency lists). */
export const stubMutations = { people, projects, demand, allocations, marketplace, structure, admin };
