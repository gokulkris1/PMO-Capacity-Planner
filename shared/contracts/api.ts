import type * as D from './dto';

export type ApiErrorCode = 'bad_request' | 'unauthorized' | 'forbidden' | 'not_found' | 'conflict' | 'gone'
  | 'payload_too_large' | 'rate_limited' | 'entitlement' | 'feature_disabled' | 'migration_pending' | 'server_error';
/** Every non-2xx JSON body. HTTP status: 400 bad_request, 401 unauthorized, 403 forbidden|entitlement|feature_disabled,
 *  404 not_found, 409 conflict, 410 gone, 413 payload_too_large, 429 rate_limited (+Retry-After), 500 server_error,
 *  502 upstream (code server_error), 503 migration_pending|server_error. */
export interface ApiError {
  error: string; code: ApiErrorCode; requestId?: string;
  fields?: Record<string, string>;                // 400: field path -> message
  current?: unknown; changedBy?: D.UserRef; changedAt?: D.ISODateTime;   // 409 version conflict
}

type Mutable<T> = Omit<T, 'id' | 'version' | 'updatedAt' | 'updatedBy'>;
export type NewPerson = Partial<Mutable<D.PersonDTO>> & { name: string; id?: D.ID };
export type NewProject = Partial<Mutable<D.ProjectDTO>> & { name: string; id?: D.ID };
export type NewDemandLine = Omit<Mutable<D.DemandLineDTO>, 'createdAt'> & { id?: D.ID };
export type NewAllocation = Partial<Mutable<D.AllocationDTO>> & { resourceId: D.ID; projectId: D.ID; percentage: number; id?: D.ID };
/** PATCH body for any versioned entity. */
export interface PatchBody<T> { version: number; patch: Partial<Mutable<T>> }

export type AllocationOp =
  | { op: 'create'; allocation: NewAllocation }
  | { op: 'update'; id: D.ID; version: number; patch: Partial<Mutable<D.AllocationDTO>> }
  | { op: 'delete'; id: D.ID; version: number };
export interface AllocationBatchRequest { ops: AllocationOp[]; label?: string }   // max 500 ops, atomic
export interface AllocationBatchResponse { upserted: D.AllocationDTO[]; deleted: D.ID[]; dataVersion: number }
export type DemandOp =
  | { op: 'create'; line: NewDemandLine }
  | { op: 'update'; id: D.ID; version: number; patch: Partial<Mutable<D.DemandLineDTO>> }
  | { op: 'delete'; id: D.ID; version: number };

export interface LoginRequest { email: string; password: string; otp?: string }
export type LoginResponse = { user: D.SessionUser } | { require2FA: true; email: string };
export interface PeopleBulkRequest { ids: D.ID[]; versions: Record<D.ID, number>; patch: { chapterId?: D.ID | null; teamId?: D.ID | null; targetUtil?: number; addSecondaryCraft?: D.SecondaryCraftDTO } }
export interface PeopleImportRow { name: string; email?: string; jobTitle?: string; type?: D.PersonType; location?: string; chapter?: string; team?: string; homeTribe?: string; targetPct?: number; aboveCraft?: string; belowCrafts?: D.SecondaryCraftDTO[]; skills?: string[] }
export interface PeopleImportRequest { rows: PeopleImportRow[]; createMissingStructure: boolean }
export interface PeopleImportResponse { created: number; updated: number; skipped: number; errors: Array<{ row: number; message: string }> }
export interface ProposeRequest { demandLineId: D.ID | null; projectId: D.ID; resourceId: D.ID; craftId: D.ID; quarterKey: D.QuarterKey; percentage: number; startDate: D.ISODate; endDate: D.ISODate }
export interface RespondRequest { decision: 'accept' | 'decline'; reason?: string }
export interface InvitationRequest { email: string; orgRole: D.OrgRole; workspaces: Array<{ workspaceId: D.ID; role: D.WorkspaceRole }> }
export interface InvitationResponse { invitation: { id: D.ID; email: string; expiresAt: D.ISODateTime }; inviteUrl: string }
export interface InvitationLookup { email: string; orgName: string; workspaces: Array<{ id: D.ID; name: string; role: D.WorkspaceRole }>; expiresAt: D.ISODateTime; existingUser: boolean }
export interface MemberDTO { userId: D.ID; name: string; email: string; orgRole: D.OrgRole; workspaces: Array<{ workspaceId: D.ID; role: D.WorkspaceRole }>; linkedPersonIds: D.ID[]; lastSignInAt: D.ISODateTime | null }
export interface MemberPatch { orgRole?: D.OrgRole; workspaces?: Array<{ workspaceId: D.ID; role: D.WorkspaceRole | null }> }
export interface AuditEventDTO { id: string; occurredAt: D.ISODateTime; actor: D.UserRef | null; actorType: string; action: string; workspaceId: D.ID | null; targetType: string | null; targetId: string | null; before: unknown; after: unknown; requestId: string | null }

const v2 = '/api/v2';
const ws = (w: string) => `${v2}/workspaces/${w}`;
const org = (o: string) => `${v2}/orgs/${o}`;
export const API = {
  // auth (existing function auth.ts)
  login: '/api/auth/login', register: '/api/auth/register', logout: '/api/auth/logout', refresh: '/api/auth/refresh',
  sessionExchange: '/api/auth/session', resetSend: '/api/auth/reset/send-otp', resetConfirm: '/api/auth/reset/confirm',
  twoFactor: '/api/auth/2fa', changePassword: '/api/auth/password', verifySend: '/api/verify/send', verifyCheck: '/api/verify/check',
  health: '/api/health', ai: '/api/ai',
  me: `${v2}/me`,
  createOrg: `${v2}/orgs`,
  org: (o: string) => org(o),
  orgWorkspaces: (o: string) => `${org(o)}/workspaces`,
  orgEntity: (o: string, kind: 'tribes' | 'chapters' | 'teams' | 'crafts', id?: string) => `${org(o)}/${kind}${id ? `/${id}` : ''}`,
  members: (o: string, userId?: string) => `${org(o)}/members${userId ? `/${userId}` : ''}`,
  invitations: (o: string, id?: string) => `${org(o)}/invitations${id ? `/${id}` : ''}`,
  invitationByToken: (token: string) => `${v2}/invitations/${token}`,
  invitationAccept: (token: string) => `${v2}/invitations/${token}/accept`,
  orgAudit: (o: string) => `${org(o)}/audit`,
  workspace: (w: string) => ws(w),
  workspaceMembers: (w: string, userId?: string) => `${ws(w)}/members${userId ? `/${userId}` : ''}`,
  snapshot: (w: string) => `${ws(w)}/snapshot`,
  sampleData: (w: string) => `${ws(w)}/sample-data`,
  people: (w: string, id?: string) => `${ws(w)}/people${id ? `/${id}` : ''}`,
  peopleBulk: (w: string) => `${ws(w)}/people/bulk`,
  peopleImport: (w: string) => `${ws(w)}/people/import`,
  craftRequestsFor: (w: string, personId: string) => `${ws(w)}/people/${personId}/craft-requests`,
  craftRequests: (w: string) => `${ws(w)}/craft-requests`,
  craftRequestDecision: (w: string, id: string, d: 'approve' | 'reject') => `${ws(w)}/craft-requests/${id}/${d}`,
  projects: (w: string, id?: string) => `${ws(w)}/projects${id ? `/${id}` : ''}`,
  demand: (w: string, id?: string) => `${ws(w)}/demand${id ? `/${id}` : ''}`,
  demandBatch: (w: string) => `${ws(w)}/demand/batch`,
  allocations: (w: string, id?: string) => `${ws(w)}/allocations${id ? `/${id}` : ''}`,
  allocationsBatch: (w: string) => `${ws(w)}/allocations/batch`,
  allocationRespond: (w: string, id: string) => `${ws(w)}/allocations/${id}/respond`,
  propose: (w: string) => `${ws(w)}/marketplace/propose`,
  offer: (w: string, personId: string, quarterKey: string) => `${ws(w)}/offers/${personId}/${quarterKey}`,
  exportAudit: (w: string) => `${ws(w)}/audit/export`,
  jiraMappings: (w: string) => `${ws(w)}/integrations/jira/mappings`,
  jiraAutoMatch: (w: string) => `${ws(w)}/integrations/jira/mappings/auto-match`,
  jiraProjectMappings: (w: string) => `${ws(w)}/integrations/jira/mappings/projects`,
  jiraPeopleMappings: (w: string) => `${ws(w)}/integrations/jira/mappings/people`,
  calibration: (w: string, tribeId?: string) => `${ws(w)}/calibration${tribeId ? `/${tribeId}` : ''}`,
  syncJira: (w: string) => `${ws(w)}/sync/jira`,
  syncJobs: (w: string) => `${ws(w)}/sync/jobs`,
  syncStep: (w: string, jobId: string) => `${ws(w)}/sync/jobs/${jobId}/step`,
  syncHealth: (w: string) => `${ws(w)}/sync/health`,
  delivery: (w: string) => `${ws(w)}/delivery`,
  planviewPreview: (w: string) => `${ws(w)}/planview/preview`,
  planviewApply: (w: string) => `${ws(w)}/planview/apply`,
  planviewTestMapping: (w: string) => `${ws(w)}/planview/test-mapping`,
  // legacy integrations config routes stay at /api/integrations/* (config, jira/test, jira/projects, jira/boards, planview/test) with HS-08 rules
} as const;
