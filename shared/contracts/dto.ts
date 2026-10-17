import type { FeatureFlags } from '../features';
import type { UtilisationThresholds } from '../utilisation';
import type { Plan, Entitlements } from '../entitlements';
import type { Permission } from '../permissions';

export type ID = string;            // UUIDv4 for new rows; legacy text ids (e.g. 'r1') kept unchanged
export type ISODate = string;       // 'YYYY-MM-DD'
export type ISODateTime = string;   // RFC 3339, UTC
export type QuarterKey = string;    // calendar quarter 'YYYY-Qn'
export const QUARTER_KEY_RE = /^\d{4}-Q[1-4]$/;
export type OrgRole = 'ORG_ADMIN' | 'MEMBER';
export type WorkspaceRole = 'WORKSPACE_ADMIN' | 'PLANNER' | 'CONTRIBUTOR' | 'VIEWER';
export type { Plan, Entitlements, Permission, FeatureFlags, UtilisationThresholds };

export interface UserRef { id: ID; name: string }
export interface Versioned { version: number; updatedAt: ISODateTime; updatedBy: UserRef | null }

export interface CraftDTO extends Versioned {
  id: ID; name: string; short: string; description: string | null; family: string | null; archived: boolean; sortOrder: number;
  /** QA-014: created from a v1.1 craft id the catalogue did not know; shown "Imported - review" until an admin saves it. */
  needsReview?: boolean;
  /** The v1.1 craft id it was created from (migration 0011). */
  importedFrom?: string | null;
}
export interface TribeDTO extends Versioned { id: ID; name: string; leadName: string | null; archived: boolean }
export interface ChapterDTO extends Versioned { id: ID; name: string; craftId: ID | null; leadPersonId: ID | null; archived: boolean }
export interface TeamDTO extends Versioned { id: ID; name: string; archived: boolean }

export type PersonType = 'Permanent' | 'Contractor' | 'Part-Time';
export type Proficiency = 1 | 2 | 3;
export interface SecondaryCraftDTO { craftId: ID; proficiency: Proficiency; maxPct: number }
export interface PersonDTO extends Versioned {
  id: ID; name: string; email: string | null; role: string /* job title */; type: PersonType; department: string;
  location: string | null; totalCapacity: number; dailyRate: number | null;
  teamId: ID | null; chapterId: ID | null; homeTribeId: ID | null; linkedUserId: ID | null;
  primaryCraft: ID | null; secondaryCrafts: SecondaryCraftDTO[]; tribeAffinity: ID[]; skills: string[];
  targetUtil: number; // default 100
}

export type ProjectStatus = 'Active' | 'On Hold' | 'Planning' | 'Completed';
export type ProjectStage = 'Pipeline' | 'Initiated' | 'Mobilising' | 'In Flight' | 'Closing';
export type Priority = 'Critical' | 'High' | 'Medium' | 'Low';
export interface ProjectDTO extends Versioned {
  id: ID; name: string; status: ProjectStatus; priority: Priority; description: string;
  startDate: ISODate | null; endDate: ISODate | null; budget: number | null;
  tribeId: ID | null; stage: ProjectStage | null; initiatedOn: ISODate | null; ownerUserId: ID | null;
  jiraKey: string | null; planviewId: string | null; source: 'manual' | 'planview';
}

export type DemandStatus = 'Forecast' | 'Confirmed';
export interface DemandLineDTO extends Versioned {
  id: ID; projectId: ID; quarterKey: QuarterKey; craftId: ID; fte: number; status: DemandStatus;
  ownerUserId: ID | null; note: string | null; createdAt: ISODateTime;
}

export type AllocationSource = 'manual' | 'marketplace' | 'planview' | 'jira';
export type AllocationState = 'tentative' | 'confirmed' | 'declined';
export interface AllocationDTO extends Versioned {
  id: ID; resourceId: ID; projectId: ID; percentage: number; startDate: ISODate | null; endDate: ISODate | null;
  craftId: ID | null; source: AllocationSource; state: AllocationState; notes: string | null;
  externalRef: string | null; demandLineId: ID | null;
  proposedAt: ISODateTime | null; proposedBy: UserRef | null; respondedAt: ISODateTime | null;
}

export interface MarketplaceOfferDTO { personId: ID; quarterKey: QuarterKey; pct: number; craftIds: ID[]; note: string | null; createdBy: UserRef; createdAt: ISODateTime }
export interface CraftChangeRequestDTO {
  id: ID; personId: ID; current: SecondaryCraftDTO[]; proposed: SecondaryCraftDTO[];
  status: 'pending' | 'approved' | 'rejected'; submittedBy: UserRef; submittedAt: ISODateTime;
  decidedBy: UserRef | null; decidedAt: ISODateTime | null; reason: string | null;
}

export interface PlanningSettings {
  fiscalYearStartMonth: 1 | 4 | 7 | 10; thresholds: UtilisationThresholds; defaultTargetUtil: number;
  sprintLengthDays: number; planviewOwnership: 'locked' | 'overridable';
}
export interface OrgDTO extends Versioned {
  id: ID; name: string; slug: string; logoUrl: string | null; plan: Plan; features: FeatureFlags;
  planning: PlanningSettings; defaultWorkspaceVisibility: 'org' | 'members';
}
export interface WorkspaceDTO { id: ID; orgId: ID; name: string; dataVersion: number; createdAt: ISODateTime }

export type SyncStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'partial';
export interface SyncJobDTO {
  id: ID; provider: 'jira' | 'planview'; trigger: 'schedule' | 'manual'; status: SyncStatus;
  pagesDone: number; issuesSeen: number; error: string | null; rateLimitedUntil: ISODateTime | null;
  startedAt: ISODateTime | null; finishedAt: ISODateTime | null; requestedBy: UserRef | null;
}
export interface SyncHealthDTO {
  provider: 'jira'; configured: boolean; state: 'ok' | 'failed' | 'stale' | 'running' | 'never';
  lastSuccessAt: ISODateTime | null; lastJob: SyncJobDTO | null; recentJobs: SyncJobDTO[];
}
export interface DeliverySummaryDTO {
  health: SyncHealthDTO;
  byProjectQbr1: Array<{ projectId: ID; plannedFte: number; impliedFte: number }>;
}
export interface JiraProjectMappingDTO {
  jiraKey: string; jiraName: string; boardIds: number[]; projectId: ID | null; tribeId: ID | null;
  matchMethod: 'key' | 'name' | 'manual' | 'none'; confirmed: boolean;
}
export interface IdentityMappingDTO {
  provider: 'jira' | 'planview'; externalId: string; displayName: string; email: string | null; personId: ID | null;
  matchMethod: 'accountId' | 'email' | 'name' | 'manual' | 'none'; confirmed: boolean; lastSeenAt: ISODateTime | null;
}
export interface TribeCalibrationDTO extends Versioned {
  tribeId: ID; pointsPerSprintPerFte: number; sprintLengthDays: number; isDefault: boolean;
  suggestedValue: number | null; suggestedBasis: { sprintNames: string[]; points: number; fte: number } | null; note: string | null;
}
export interface DeliveryRowDTO {
  key: string; label: string; tribeId: ID | null; projectId: ID | null; sprintId: string | null; sprintName: string | null;
  quarterKey: QuarterKey | null; from: ISODate; to: ISODate;
  pointsTotal: number; pointsDone: number; issuesDone: number; impliedFte: number; plannedFte: number;
}
export interface FieldChange { field: string; from: string | null; to: string | null }
export interface PlanviewProjectChange { externalId: string; name: string; projectId: ID | null; changes: FieldChange[] }
export interface PlanviewAssignmentChange {
  externalId: string; projectExternalId: string; personExternalId: string; personName: string;
  projectId: ID | null; personId: ID | null; changes: FieldChange[];
}
export interface PlanviewPreviewDTO {
  previewId: ID; expiresAt: ISODateTime; partial: boolean;
  projects: { new: PlanviewProjectChange[]; changed: PlanviewProjectChange[]; removed: PlanviewProjectChange[] };
  assignments: {
    new: PlanviewAssignmentChange[]; changed: PlanviewAssignmentChange[]; removed: PlanviewAssignmentChange[];
    unmatchedPeople: Array<{ externalId: string; name: string; email: string | null; suggestedPersonId: ID | null }>;
  };
}

export interface WorkspaceSnapshot {
  org: OrgDTO; workspace: WorkspaceDTO;
  people: PersonDTO[]; projects: ProjectDTO[]; allocations: AllocationDTO[]; demand: DemandLineDTO[];
  tribes: TribeDTO[]; chapters: ChapterDTO[]; teams: TeamDTO[]; crafts: CraftDTO[];
  offers: MarketplaceOfferDTO[];
  craftRequests: CraftChangeRequestDTO[];   // pending: all for Planner+, own for Contributor, none for Viewer
  delivery: DeliverySummaryDTO | null;
  serverTime: ISODateTime;
}

export interface SessionUser { id: ID; email: string; name: string; isPlatformAdmin: boolean; emailVerified: boolean; twoFactorEnabled: boolean }
export interface MeWorkspace { id: ID; name: string; role: WorkspaceRole; implicit: boolean; permissions: Permission[]; linkedPersonId: ID | null }
export interface MeResponse {
  user: SessionUser;
  org: { id: ID; name: string; slug: string; logoUrl: string | null; role: OrgRole; plan: Plan; features: FeatureFlags; planning: PlanningSettings } | null;
  workspaces: MeWorkspace[];
  entitlements: Entitlements;
  appMode: 'public' | 'internal';
}
