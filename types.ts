/**
 * Domain types for PMO Capacity Planner.
 *
 * Two layers live here:
 *
 * 1. **2.0 domain (use this in new code).** The wire DTOs are defined once in
 *    `shared/contracts/dto.ts` and re-exported below under domain names, together with the
 *    user-facing labels for each enum. Tribes, chapters, teams and crafts are first-class entities
 *    (ids, never `project.clientName` text); the craft catalogue is org-editable (seeded from
 *    `PMO_CRAFTS`); allocations carry state (tentative/confirmed/declined) and provenance
 *    (manual/marketplace/planview/jira); demand lines, marketplace offers, craft change requests
 *    and per-tribe story-point calibration (keyed by tribe id) are entities of their own.
 *
 * 2. **v1.1 legacy types** (`Resource`, `Project`, `Allocation`, `getAllocationStatus`, the QBR
 *    sprint-module types, …) still used by the old UI and the QBR module. They are retired as
 *    package B replaces the views (list in docs/release/handoff-C.md §6). Do not use them in new
 *    code: `getAllocationStatus`/`AllocationStatus`/`getStatusColor` are replaced by
 *    `bandFor`/`bandForLoad`/`BAND_LABEL` in `shared/utilisation.ts` (RP-03).
 */
import type * as D from './shared/contracts/dto';

/* ═══════════════════════════════════════════════════════════════
   2.0 domain
   ═══════════════════════════════════════════════════════════════ */

export type {
  ID,
  ISODate,
  ISODateTime,
  QuarterKey,
  UserRef,
  Versioned,
  CraftDTO as CraftEntity,
  TribeDTO as Tribe,
  ChapterDTO as Chapter,
  TeamDTO as TeamEntity,
  PersonDTO as Person,
  PersonType,
  Proficiency,
  SecondaryCraftDTO as BelowTableCraft,
  ProjectDTO as ProjectEntity,
  ProjectStage as ProjectStageId,
  DemandStatus,
  DemandLineDTO as DemandLine,
  AllocationSource,
  AllocationState,
  AllocationDTO as Booking,
  MarketplaceOfferDTO as MarketplaceOffer,
  CraftChangeRequestDTO as CraftChangeRequest,
  TribeCalibrationDTO as TribeCalibration,
  PlanningSettings,
  WorkspaceSnapshot,
} from './shared/contracts/dto';

/** Org-structure entity kinds editable in Settings › Structure and Settings › Crafts. */
export type StructureKind = 'tribes' | 'chapters' | 'teams' | 'crafts';
export const STRUCTURE_KINDS: readonly StructureKind[] = ['tribes', 'chapters', 'teams', 'crafts'];
export const STRUCTURE_LABEL: Record<StructureKind, { one: string; many: string }> = {
  tribes: { one: 'Tribe', many: 'Tribes' },
  chapters: { one: 'Chapter', many: 'Chapters' },
  teams: { one: 'Team', many: 'Teams' },
  crafts: { one: 'Craft', many: 'Crafts' },
};

/** PPL-02#AC3 proficiency levels for below-the-table crafts. */
export const PROFICIENCY_LABEL: Record<D.Proficiency, string> = {
  1: 'Can assist',
  2: 'Can own with support',
  3: 'Can own independently',
};

/** Default cap for a below-the-table craft (PPL-02#AC3). */
export const DEFAULT_BELOW_TABLE_CAP_PCT = 40;

export const ALLOCATION_STATE_LABEL: Record<D.AllocationState, string> = {
  tentative: 'Tentative',
  confirmed: 'Confirmed',
  declined: 'Declined',
};

/** AL-05#AC1 provenance labels. */
export const ALLOCATION_SOURCE_LABEL: Record<D.AllocationSource, string> = {
  manual: 'Manual',
  marketplace: 'Marketplace',
  planview: 'Planview',
  jira: 'Jira',
};

export const DEMAND_STATUS_LABEL: Record<D.DemandStatus, string> = { Forecast: 'Forecast', Confirmed: 'Confirmed' };

export const PROJECT_STAGE_ORDER: readonly D.ProjectStage[] = [
  'Pipeline',
  'Initiated',
  'Mobilising',
  'In Flight',
  'Closing',
];
export const PROJECT_STAGE_HINT: Record<D.ProjectStage, string> = {
  Pipeline: 'Idea or business case: demand is a forecast',
  Initiated: 'Approved: craft demand must be captured',
  Mobilising: 'Staffing in progress',
  'In Flight': 'Delivering',
  Closing: 'Winding down: capacity releasing',
};
/** DM-01#AC1: demand captured for a project in these stages defaults to Confirmed, otherwise Forecast. */
export function defaultDemandStatus(stage: D.ProjectStage | null): D.DemandStatus {
  return stage === 'In Flight' || stage === 'Mobilising' ? 'Confirmed' : 'Forecast';
}

export const PROJECT_STATUSES: readonly D.ProjectStatus[] = ['Active', 'On Hold', 'Planning', 'Completed'];
export const PRIORITIES: readonly D.Priority[] = ['Critical', 'High', 'Medium', 'Low'];
export const PERSON_TYPES: readonly D.PersonType[] = ['Permanent', 'Contractor', 'Part-Time'];

/* ═══════════════════════════════════════════════════════════════
   v1.1 legacy types (old UI only; see header)
   ═══════════════════════════════════════════════════════════════ */

export enum ResourceType {
  PERMANENT = 'Permanent',
  CONTRACTOR = 'Contractor',
  PART_TIME = 'Part-Time',
}

export enum ProjectStatus {
  ACTIVE = 'Active',
  ON_HOLD = 'On Hold',
  PLANNING = 'Planning',
  COMPLETED = 'Completed',
}

/** @deprecated RP-03: use `UtilBand`/`bandFor` from shared/utilisation.ts. */
export enum AllocationStatus {
  UNDER = 'Under',
  OPTIMAL = 'Optimal',
  HIGH = 'High',
  OVER = 'Over',
}

export type Priority = 'Critical' | 'High' | 'Medium' | 'Low';

/** @deprecated SH-01: every view is a route. */
export type ViewTab =
  | 'dashboard'
  | 'allocations'
  | 'by-project'
  | 'by-resource'
  | 'by-skills'
  | 'by-team'
  | 'by-tribe'
  | 'what-if'
  | 'qbr'
  | 'crafts'
  | 'demand'
  | 'marketplace'
  | 'utilisation'
  | 'integrations';

/** v1.1 craft ("above the table" = primary, "below the table" = secondary). 2.0: `CraftEntity`. */
export interface Craft {
  id: string;
  name: string;
  short: string; // 2–4 letter chip label, e.g. 'PM', 'SM'
  color: string;
  description?: string;
}

/** 1 = can assist, 2 = can own with support, 3 = can own independently */
export type CraftProficiency = 1 | 2 | 3;

export interface SecondaryCraft {
  craftId: string;
  proficiency: CraftProficiency;
  /** Max share of a person's capacity they are willing/able to give to this craft (default 40) */
  maxPct?: number;
}

export type ProjectStage = 'Pipeline' | 'Initiated' | 'Mobilising' | 'In Flight' | 'Closing';

/** Anticipated need for a craft on a project in a given quarter, in FTE (1.0 = one full person) */
export interface CraftDemand {
  quarterKey: string; // e.g. '2026-Q4'
  craftId: string;
  fte: number;
  note?: string;
}

export interface Team {
  id: string;
  name: string;
  color: string;
}

export interface Resource {
  id: string;
  name: string;
  role: string;
  type: ResourceType;
  department: string;
  teamId?: string;
  teamName?: string;
  skills?: string[];
  totalCapacity: number; // usually 100
  avatarInitials?: string;
  email?: string;
  location?: string;
  dailyRate?: number;
  /** Above-the-table craft: the role the person is hired and reported for */
  primaryCraft?: string;
  /** Below-the-table crafts: what else the person can credibly contribute */
  secondaryCrafts?: SecondaryCraft[];
  /** Tribes the person has history with (v1.1: names; 2.0: tribe ids) */
  tribeAffinity?: string[];
  /** Utilisation target for this person (default 100) */
  targetUtil?: number;
}

export interface Project {
  id: string;
  name: string;
  status: ProjectStatus;
  priority: Priority;
  description: string;
  startDate?: string; // ISO date string
  endDate?: string; // ISO date string
  budget?: number;
  clientName?: string; // v1.1 tribe name (2.0: tribeId)
  color?: string;
  stage?: ProjectStage;
  initiatedOn?: string; // ISO date the project was initiated / entered the pipeline
  craftDemand?: CraftDemand[];
  jiraKey?: string; // linked Jira project key
  planviewId?: string; // linked Planview external id
}

export interface Allocation {
  id: string;
  resourceId: string;
  projectId: string;
  percentage: number;
  startDate?: string;
  endDate?: string;
  notes?: string;
  /** Craft the person performs on this project. Omitted = their primary (above-the-table) craft */
  craftId?: string;
  /** Where this allocation came from */
  source?: 'manual' | 'marketplace' | 'planview' | 'jira';
}

/** @deprecated A-9: the localStorage What-If page is removed in 2.0. */
export interface WhatIfScenario {
  id: string;
  name: string;
  description: string;
  allocations: Allocation[];
  createdAt: string;
}

/** @deprecated */
export interface CapacitySummary {
  resourceId: string;
  totalAllocated: number;
  available: number;
  status: AllocationStatus;
}

/** @deprecated RP-03: use `bandForLoad()` from shared/utilisation.ts. */
export function getAllocationStatus(pct: number): AllocationStatus {
  if (pct > 100) return AllocationStatus.OVER;
  if (pct >= 80) return AllocationStatus.HIGH;
  if (pct >= 60) return AllocationStatus.OPTIMAL;
  return AllocationStatus.UNDER;
}

/** @deprecated RP-03/DS-07: colours come from band tokens, never from code. */
export function getStatusColor(status: AllocationStatus): string {
  switch (status) {
    case AllocationStatus.OVER:
      return '#ef4444';
    case AllocationStatus.HIGH:
      return '#f59e0b';
    case AllocationStatus.OPTIMAL:
      return '#10b981';
    case AllocationStatus.UNDER:
      return '#6b7280';
  }
}

/* ═══════════════════════════════════════════════════════════════
   QBR sprint-planning module types (legacy, behind the qbrSprintModule flag)
   ═══════════════════════════════════════════════════════════════ */

export type QBRMemberType = 'INTERNAL' | 'VENDOR' | 'CONTRACTOR';
export type QBROKRLevel = 'LEADERSHIP' | 'TRIBE' | 'COE';
export type QBRSquadRole = 'LEAD' | 'MEMBER' | 'ADVISOR';

export interface QBRTribe {
  id: string;
  name: string;
  description?: string;
  lead_name?: string;
  color: string;
  member_count?: number;
  squad_count?: number;
}

export interface QBRChapter {
  id: string;
  name: string;
  description?: string;
  lead_name?: string;
  color: string;
  member_count?: number;
}

export interface QBRCoE {
  id: string;
  name: string;
  description?: string;
  lead_name?: string;
  color: string;
  member_count?: number;
}

export interface QBRQuarter {
  id: string;
  label: string;
  start_date: string;
  end_date: string;
  is_active: boolean;
  sprints: QBRSprint[];
}

export interface QBRSprint {
  id: string;
  quarter_id: string;
  sprint_number: number;
  label: string;
  start_date: string;
  end_date: string;
}

export interface QBRMember {
  id: string;
  name: string;
  email?: string;
  role_title?: string;
  tribe_id?: string;
  tribe_name?: string;
  chapter_id?: string;
  chapter_name?: string;
  coe_id?: string;
  coe_name?: string;
  member_type: QBRMemberType;
  daily_rate?: number;
  skills?: string[];
  avatar_color: string;
  total_capacity: number;
  bookings?: QBRBooking[];
}

export interface QBROKR {
  id: string;
  title: string;
  description?: string;
  level: QBROKRLevel;
  parent_okr_id?: string;
  tribe_id?: string;
  tribe_name?: string;
  quarter_id?: string;
  progress: number;
  children?: QBROKR[];
  projects?: QBRProject[];
}

export interface QBRProject {
  id: string;
  name: string;
  description?: string;
  tribe_id?: string;
  tribe_name?: string;
  okr_id?: string;
  okr_title?: string;
  status: 'PLANNING' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED';
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  start_quarter_id?: string;
  end_quarter_id?: string;
  color: string;
}

export interface QBRSquad {
  id: string;
  name: string;
  tribe_id?: string;
  tribe_name?: string;
  project_id?: string;
  project_name?: string;
  okr_id?: string;
  members: QBRSquadMember[];
}

export interface QBRSquadMember {
  id: string;
  member_id: string;
  member_name: string;
  squad_role: QBRSquadRole;
  chapter_name?: string;
  tribe_name?: string;
  coe_name?: string;
  member_type: QBRMemberType;
}

export interface QBRBooking {
  id: string;
  member_id: string;
  member_name?: string;
  project_id: string;
  project_name?: string;
  project_color?: string;
  sprint_id: string;
  sprint_number?: number;
  percentage: number;
  scenario_id?: string;
  notes?: string;
}

export interface QBRScenario {
  id: string;
  name: string;
  description?: string;
  quarter_id: string;
  is_committed: boolean;
  created_by?: string;
  created_at?: string;
  bookings?: QBRBooking[];
}
