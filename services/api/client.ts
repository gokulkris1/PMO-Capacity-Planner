/**
 * Typed API client (PL-05): one method per route in the BACKLOG §4.3 route table, built on the
 * `API` route builder from `shared/contracts/api.ts` and any `Transport`.
 *
 * Versioned writes send `PatchBody<T>` (`{ version, patch }`); DELETEs of versioned rows pass
 * `?version=`. Nothing here holds state.
 */
import type * as D from '../../shared/contracts/dto';
import {
  API,
  type AllocationBatchRequest,
  type AllocationBatchResponse,
  type AllocationOp,
  type AuditEventDTO,
  type DemandOp,
  type InvitationLookup,
  type InvitationRequest,
  type InvitationResponse,
  type LoginRequest,
  type LoginResponse,
  type MemberDTO,
  type MemberPatch,
  type MePatchRequest,
  type NewAllocation,
  type NewDemandLine,
  type NewPerson,
  type NewProject,
  type PatchBody,
  type PeopleBulkRequest,
  type PeopleImportRequest,
  type PeopleImportResponse,
  type PlatformOverview,
  type ProposeRequest,
  type RespondRequest,
} from '../../shared/contracts/api';
import type { Transport } from './transport';

export type StructureKind = 'tribes' | 'chapters' | 'teams' | 'crafts';
export type StructureDTO = D.TribeDTO | D.ChapterDTO | D.TeamDTO | D.CraftDTO;
export interface StructureMap {
  tribes: D.TribeDTO;
  chapters: D.ChapterDTO;
  teams: D.TeamDTO;
  crafts: D.CraftDTO;
}

export interface JiraMappings {
  projects: D.JiraProjectMappingDTO[];
  people: D.IdentityMappingDTO[];
}
export interface CalibrationPut {
  pointsPerSprintPerFte: number;
  sprintLengthDays: number;
  note: string;
  version: number;
}
export interface DeliveryQuery {
  groupBy?: 'tribe' | 'project' | 'sprint' | 'person';
  tribeId?: D.ID;
  projectId?: D.ID;
  from?: D.ISODate;
  to?: D.ISODate;
}
export interface PlanviewApplyRequest {
  previewId: D.ID;
  accept: { projects: string[]; assignments: string[] };
  personMatches: Record<string, D.ID>;
}
export interface AuditQuery {
  from?: D.ISODateTime;
  to?: D.ISODateTime;
  workspaceId?: D.ID;
  action?: string;
  cursor?: string;
}
export interface OfferBody {
  pct: number;
  craftIds: D.ID[];
  note: string | null;
}
export type HealthResponse = Record<string, unknown>;

export type ApiClient = ReturnType<typeof createApiClient>;

export function createApiClient(t: Transport) {
  const get = <T>(path: string, query?: Record<string, string | number | boolean | null | undefined>) =>
    t.request<T>('GET', path, undefined, { query });
  const post = <T>(path: string, body?: unknown) => t.request<T>('POST', path, body);
  const put = <T>(path: string, body?: unknown) => t.request<T>('PUT', path, body);
  const patch = <T>(path: string, body: unknown) => t.request<T>('PATCH', path, body);
  const del = <T = void>(path: string, query?: Record<string, string | number | undefined>) =>
    t.request<T>('DELETE', path, undefined, { query });

  return {
    transport: t,

    auth: {
      login: (r: LoginRequest) => post<LoginResponse>(API.login, r),
      register: (r: { email: string; password: string; name: string }) =>
        post<{ emailVerificationRequired: true }>(API.register, r),
      logout: () => post<void>(API.logout),
      /** Signs out of every device (AC-03#AC6): increments the user's token version. */
      logoutEverywhere: () => post<void>(API.logoutAll),
      refresh: () => post<{ ok: true }>(API.refresh),
      resetSend: (email: string) => post<{ sent: true }>(API.resetSend, { email }),
      resetConfirm: (r: { email: string; otp: string; newPassword: string }) =>
        post<{ success: true }>(API.resetConfirm, r),
      setTwoFactor: (r: { enabled: boolean; password: string }) => post<{ ok: true }>(API.twoFactor, r),
      changePassword: (r: { currentPassword: string; newPassword: string }) =>
        post<{ ok: true }>(API.changePassword, r),
      verifySend: (email?: string) => post<{ sent: true }>(API.verifySend, email ? { email } : {}),
      verifyCheck: (code: string, email?: string) =>
        post<{ verified: true }>(API.verifyCheck, email ? { email, code } : { code }),
      me: () => get<D.MeResponse>(API.me),
      /** ST-01#AC4 profile name. Not in the §4.3 table yet: requested from A (handoff-C.md §7). */
      updateProfile: (r: MePatchRequest) => patch<D.MeResponse>(API.me, r),
    },

    health: () => get<HealthResponse>(API.health),
    ai: { ask: (wsId: D.ID, question: string) => post<{ answer: string }>(API.ai, { wsId, question }) },

    orgs: {
      create: (r: { name: string; workspaceName: string }) =>
        post<{ org: D.OrgDTO; workspace: D.WorkspaceDTO }>(API.createOrg, r),
      get: (orgId: D.ID) => get<D.OrgDTO>(API.org(orgId)),
      update: (orgId: D.ID, body: PatchBody<D.OrgDTO>) => patch<D.OrgDTO>(API.org(orgId), body),
      createWorkspace: (orgId: D.ID, name: string) => post<D.WorkspaceDTO>(API.orgWorkspaces(orgId), { name }),
      renameWorkspace: (wsId: D.ID, name: string) => patch<D.WorkspaceDTO>(API.workspace(wsId), { name }),
      deleteWorkspace: (wsId: D.ID, confirmName: string) => del(API.workspace(wsId), { confirmName }),
      audit: (orgId: D.ID, q: AuditQuery = {}) =>
        get<{ events: AuditEventDTO[]; next: string | null }>(API.orgAudit(orgId), { ...q }),
      auditCsv: (orgId: D.ID, q: AuditQuery = {}) => get<string>(API.orgAudit(orgId), { ...q, format: 'csv' }),
    },

    structure: {
      list: <K extends StructureKind>(orgId: D.ID, kind: K) => get<Array<StructureMap[K]>>(API.orgEntity(orgId, kind)),
      create: <K extends StructureKind>(orgId: D.ID, kind: K, entity: Partial<StructureMap[K]>) =>
        post<StructureMap[K]>(API.orgEntity(orgId, kind), entity),
      update: <K extends StructureKind>(orgId: D.ID, kind: K, id: D.ID, body: PatchBody<StructureMap[K]>) =>
        patch<StructureMap[K]>(API.orgEntity(orgId, kind, id), body),
      remove: (orgId: D.ID, kind: StructureKind, id: D.ID, version?: number) =>
        del(API.orgEntity(orgId, kind, id), { version }),
    },

    members: {
      list: (orgId: D.ID) => get<MemberDTO[]>(API.members(orgId)),
      update: (orgId: D.ID, userId: D.ID, p: MemberPatch) => patch<MemberDTO>(API.members(orgId, userId), p),
      remove: (orgId: D.ID, userId: D.ID) => del(API.members(orgId, userId)),
      setWorkspaceRole: (wsId: D.ID, userId: D.ID, role: D.WorkspaceRole) =>
        patch<MemberDTO>(API.workspaceMembers(wsId, userId), { role }),
      removeFromWorkspace: (wsId: D.ID, userId: D.ID) => del(API.workspaceMembers(wsId, userId)),
    },

    invitations: {
      create: (orgId: D.ID, r: InvitationRequest) => post<InvitationResponse>(API.invitations(orgId), r),
      list: (orgId: D.ID) =>
        get<
          Array<InvitationResponse['invitation'] & { orgRole: D.OrgRole; workspaces: InvitationRequest['workspaces'] }>
        >(API.invitations(orgId)),
      revoke: (orgId: D.ID, id: D.ID) => del(API.invitations(orgId, id)),
      /** ST-02#AC1 "Resend". Not in the §4.3 table yet: requested from A (handoff-C.md §7). */
      resend: (orgId: D.ID, id: D.ID) => post<InvitationResponse>(API.invitationResend(orgId, id)),
      lookup: (token: string) => get<InvitationLookup>(API.invitationByToken(token)),
      accept: (token: string, r: { name?: string; password?: string }) =>
        post<{ user: D.SessionUser }>(API.invitationAccept(token), r),
    },

    workspace: {
      snapshot: (wsId: D.ID) => get<D.WorkspaceSnapshot>(API.snapshot(wsId)),
      installSampleData: (wsId: D.ID) => post<D.WorkspaceSnapshot>(API.sampleData(wsId)),
      exportAudit: (wsId: D.ID, r: { kind: 'pdf' | 'csv'; report: string }) => post<void>(API.exportAudit(wsId), r),
    },

    people: {
      create: (wsId: D.ID, p: NewPerson) => post<D.PersonDTO>(API.people(wsId), p),
      update: (wsId: D.ID, id: D.ID, body: PatchBody<D.PersonDTO>) => patch<D.PersonDTO>(API.people(wsId, id), body),
      remove: (wsId: D.ID, id: D.ID, version?: number) => del(API.people(wsId, id), { version }),
      bulk: (wsId: D.ID, r: PeopleBulkRequest) => post<{ people: D.PersonDTO[] }>(API.peopleBulk(wsId), r),
      import: (wsId: D.ID, r: PeopleImportRequest) => post<PeopleImportResponse>(API.peopleImport(wsId), r),
      requestCraftChange: (wsId: D.ID, personId: D.ID, secondaryCrafts: D.SecondaryCraftDTO[]) =>
        post<D.CraftChangeRequestDTO>(API.craftRequestsFor(wsId, personId), { secondaryCrafts }),
    },

    craftRequests: {
      list: (wsId: D.ID) => get<D.CraftChangeRequestDTO[]>(API.craftRequests(wsId)),
      decide: (wsId: D.ID, id: D.ID, d: 'approve' | 'reject', reason?: string) =>
        post<D.CraftChangeRequestDTO>(API.craftRequestDecision(wsId, id, d), reason === undefined ? {} : { reason }),
    },

    projects: {
      create: (wsId: D.ID, p: NewProject) => post<D.ProjectDTO>(API.projects(wsId), p),
      update: (wsId: D.ID, id: D.ID, body: PatchBody<D.ProjectDTO>) =>
        patch<D.ProjectDTO>(API.projects(wsId, id), body),
      remove: (wsId: D.ID, id: D.ID, version?: number) => del(API.projects(wsId, id), { version }),
    },

    demand: {
      create: (wsId: D.ID, l: NewDemandLine) => post<D.DemandLineDTO>(API.demand(wsId), l),
      update: (wsId: D.ID, id: D.ID, body: PatchBody<D.DemandLineDTO>) =>
        patch<D.DemandLineDTO>(API.demand(wsId, id), body),
      remove: (wsId: D.ID, id: D.ID, version?: number) => del(API.demand(wsId, id), { version }),
      batch: (wsId: D.ID, ops: DemandOp[]) =>
        post<{ upserted: D.DemandLineDTO[]; deleted: D.ID[] }>(API.demandBatch(wsId), { ops }),
    },

    allocations: {
      create: (wsId: D.ID, a: NewAllocation) => post<D.AllocationDTO>(API.allocations(wsId), a),
      update: (wsId: D.ID, id: D.ID, body: PatchBody<D.AllocationDTO>) =>
        patch<D.AllocationDTO>(API.allocations(wsId, id), body),
      remove: (wsId: D.ID, id: D.ID, version?: number) => del(API.allocations(wsId, id), { version }),
      batch: (wsId: D.ID, ops: AllocationOp[], label?: string) =>
        post<AllocationBatchResponse>(API.allocationsBatch(wsId), { ops, label } satisfies AllocationBatchRequest),
      respond: (wsId: D.ID, id: D.ID, r: RespondRequest) => post<D.AllocationDTO>(API.allocationRespond(wsId, id), r),
    },

    marketplace: {
      propose: (wsId: D.ID, r: ProposeRequest) => post<D.AllocationDTO>(API.propose(wsId), r),
      setOffer: (wsId: D.ID, personId: D.ID, quarterKey: D.QuarterKey, body: OfferBody) =>
        put<D.MarketplaceOfferDTO>(API.offer(wsId, personId, quarterKey), body),
      withdrawOffer: (wsId: D.ID, personId: D.ID, quarterKey: D.QuarterKey) =>
        del(API.offer(wsId, personId, quarterKey)),
    },

    jira: {
      mappings: (wsId: D.ID) => get<JiraMappings>(API.jiraMappings(wsId)),
      autoMatch: (wsId: D.ID) => post<JiraMappings>(API.jiraAutoMatch(wsId)),
      saveProjectMappings: (wsId: D.ID, projects: D.JiraProjectMappingDTO[]) =>
        put<JiraMappings>(API.jiraProjectMappings(wsId), { projects }),
      savePeopleMappings: (wsId: D.ID, people: D.IdentityMappingDTO[]) =>
        put<JiraMappings>(API.jiraPeopleMappings(wsId), { people }),
    },

    calibration: {
      list: (wsId: D.ID) => get<D.TribeCalibrationDTO[]>(API.calibration(wsId)),
      save: (wsId: D.ID, tribeId: D.ID, body: CalibrationPut) =>
        put<D.TribeCalibrationDTO>(API.calibration(wsId, tribeId), body),
    },

    sync: {
      startJira: (wsId: D.ID) => post<{ job: D.SyncJobDTO }>(API.syncJira(wsId)),
      step: (wsId: D.ID, jobId: D.ID) => post<{ job: D.SyncJobDTO }>(API.syncStep(wsId, jobId)),
      jobs: (wsId: D.ID) => get<D.SyncJobDTO[]>(API.syncJobs(wsId)),
      health: (wsId: D.ID) => get<D.SyncHealthDTO>(API.syncHealth(wsId)),
    },

    delivery: {
      rows: (wsId: D.ID, q: DeliveryQuery = {}) => get<D.DeliveryRowDTO[]>(API.delivery(wsId), { ...q }),
    },

    planview: {
      preview: (wsId: D.ID, r: { from?: D.ISODate; to?: D.ISODate } = {}) =>
        post<D.PlanviewPreviewDTO>(API.planviewPreview(wsId), r),
      apply: (wsId: D.ID, r: PlanviewApplyRequest) =>
        post<{ created: number; updated: number; skipped: number }>(API.planviewApply(wsId), r),
      testMapping: (wsId: D.ID) =>
        post<{ source: unknown; mapped: Record<string, unknown>; missing: string[] }>(API.planviewTestMapping(wsId)),
    },

    /** Legacy connection settings (HS-08 rules), `/api/integrations/*?wsId=` with their v1.1 shapes. */
    integrationSettings: {
      config: (wsId: D.ID) => get<LegacyIntegrationConfig>(LEGACY.integrationsConfig, { wsId }),
      save: (wsId: D.ID, body: LegacyIntegrationSave) =>
        t.request<LegacyIntegrationConfig>('POST', LEGACY.integrationsConfig, body, { query: { wsId } }),
      testJira: (wsId: D.ID) =>
        t.request<{ ok: boolean; displayName?: string; storyPointsFieldId: string | null }>(
          'POST',
          LEGACY.jiraTest,
          {},
          { query: { wsId } },
        ),
      testPlanview: (wsId: D.ID) =>
        t.request<{ ok: boolean; flavour?: string; projectCount?: number }>(
          'POST',
          LEGACY.planviewTest,
          {},
          { query: { wsId } },
        ),
    },

    /** Legacy Stripe checkout (public mode, ST-06): `{ plan, orgSlug }` → `{ url }`. */
    billing: {
      checkout: (plan: D.Plan, orgSlug: string) => post<{ url: string }>(LEGACY.checkout, { plan, orgSlug }),
    },

    /**
     * Legacy QBR sprint module (`/api/qbr/*`, SH-05; only while `features.qbrSprintModule` is on). The path is
     * relative to /api/qbr, e.g. 'overview', `quarter/${id}`; the workspace goes in the query.
     */
    qbr: {
      get: <T>(wsId: D.ID, path: string, query: Record<string, string> = {}) =>
        get<T>(`/api/qbr/${path}`, { wsId, ...query }),
      post: <T>(wsId: D.ID, path: string, body: unknown = {}) =>
        t.request<T>('POST', `/api/qbr/${path}`, body, { query: { wsId } }),
      remove: <T>(wsId: D.ID, path: string) =>
        t.request<T>('DELETE', `/api/qbr/${path}`, undefined, { query: { wsId } }),
    },

    /** ST-09 cockpit. `GET /api/v2/platform/overview` is requested from A (handoff-C.md §7). */
    platform: {
      overview: () => get<PlatformOverview>(API.platformOverview),
    },
  };
}

/** Routes outside the §4.3 `API` builder (legacy v1.1 endpoints kept by the coordinator, plus requests to A). */
export const LEGACY = {
  integrationsConfig: '/api/integrations/config',
  jiraTest: '/api/integrations/jira/test',
  planviewTest: '/api/integrations/planview/test',
  checkout: '/api/checkout',
} as const;

export interface LegacyIntegrationConfig {
  jira: {
    configured: boolean;
    domain: string;
    email: string;
    projectKeys: string[];
    boardIds: number[];
    storyPointsFieldId?: string;
    hasSecret: boolean;
  };
  planview: {
    configured: boolean;
    flavour: 'adaptivework' | 'generic';
    baseUrl: string;
    username?: string;
    hasSecret: boolean;
    generic?: {
      projectsPath: string;
      assignmentsPath: string;
      authHeaderName?: string;
      fieldMap: Record<string, string>;
    };
  };
  settings?: unknown;
}

export interface LegacyIntegrationSave {
  jira?: Partial<Omit<LegacyIntegrationConfig['jira'], 'configured' | 'hasSecret'>> & { apiToken?: string };
  planview?: Partial<Omit<LegacyIntegrationConfig['planview'], 'configured' | 'hasSecret' | 'generic'>> & {
    secret?: string;
    generic?: Partial<NonNullable<LegacyIntegrationConfig['planview']['generic']>>;
  };
}

/** @deprecated use `PlatformOverview` from shared/contracts/api. */
export type PlatformOverviewResponse = PlatformOverview;
