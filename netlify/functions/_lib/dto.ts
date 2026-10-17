/**
 * Row -> DTO mappers (shared/contracts/dto.ts). SQL selects dates as `::text`; timestamps go through `iso()`.
 * Column lists live here so every query returns the same shape.
 */
import type {
  AllocationDTO,
  ChapterDTO,
  CraftChangeRequestDTO,
  CraftDTO,
  DemandLineDTO,
  MarketplaceOfferDTO,
  OrgDTO,
  PersonDTO,
  PlanningSettings,
  ProjectDTO,
  SecondaryCraftDTO,
  TeamDTO,
  TribeDTO,
  UserRef,
  WorkspaceDTO,
  PersonType,
  ProjectStatus,
  ProjectStage,
  Priority,
  AllocationSource,
  AllocationState,
  DemandStatus,
  Plan,
  Proficiency,
} from '../../../shared/contracts/dto';
import { DEFAULT_THRESHOLDS } from '../../../shared/utilisation';
import { resolveFeatures, type FeatureFlags } from '../../../shared/features';
import { iso, json, num, numOrNull } from './db';

type R = Record<string, unknown>;
const s = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

export function userRef(id: unknown, name: unknown): UserRef | null {
  if (!id) return null;
  return { id: String(id), name: s(name) || 'Unknown user' };
}

function versioned(r: R) {
  return {
    version: num(r.version, 1),
    updatedAt: iso(r.updated_at) ?? new Date(0).toISOString(),
    updatedBy: userRef(r.updated_by, r.updated_by_name),
  };
}

/** `LEFT JOIN users ub ON ub.id = x.updated_by` gives the updater's name. */
export const UPDATED_BY_JOIN = (alias: string) => `LEFT JOIN users ub ON ub.id = ${alias}.updated_by`;

// ── Organisation ───────────────────────────────────────────────────────────

export const DEFAULT_PLANNING: PlanningSettings = {
  fiscalYearStartMonth: 1,
  thresholds: DEFAULT_THRESHOLDS,
  defaultTargetUtil: 100,
  sprintLengthDays: 14,
  planviewOwnership: 'locked',
};

export function planningOf(raw: unknown): PlanningSettings {
  const p = json<Partial<PlanningSettings>>(raw, {});
  return {
    ...DEFAULT_PLANNING,
    ...p,
    thresholds: { ...DEFAULT_THRESHOLDS, ...(p.thresholds ?? {}) },
  };
}

export function featuresOf(raw: unknown): FeatureFlags {
  return resolveFeatures(json<Partial<FeatureFlags>>(raw, {}));
}

export function planOf(raw: unknown): Plan {
  const p = String(raw ?? 'BASIC').toUpperCase();
  return (['BASIC', 'PRO', 'MAX', 'ENTERPRISE'].includes(p) ? p : 'BASIC') as Plan;
}

export const ORG_COLUMNS =
  'o.id, o.name, o.slug, o.logo_url, o.plan, o.features, o.planning, o.default_workspace_visibility, o.version, o.updated_at, o.updated_by, o.created_at, o.ai_queries_month, o.ai_quota_reset_at, o.stripe_customer_id, o.stripe_subscription_id';

export function orgDTO(r: R): OrgDTO {
  return {
    id: String(r.id),
    name: String(r.name ?? ''),
    slug: String(r.slug ?? ''),
    logoUrl: s(r.logo_url),
    plan: planOf(r.plan),
    features: featuresOf(r.features),
    planning: planningOf(r.planning),
    defaultWorkspaceVisibility: r.default_workspace_visibility === 'members' ? 'members' : 'org',
    ...versioned(r),
  };
}

export const WORKSPACE_COLUMNS = 'w.id, w.org_id, w.name, w.data_version, w.created_at';
export function workspaceDTO(r: R): WorkspaceDTO {
  return {
    id: String(r.id),
    orgId: String(r.org_id),
    name: String(r.name ?? ''),
    dataVersion: num(r.data_version, 1),
    createdAt: iso(r.created_at) ?? new Date(0).toISOString(),
  };
}

// ── Structure ──────────────────────────────────────────────────────────────

export function craftDTO(r: R): CraftDTO {
  return {
    id: String(r.id),
    name: String(r.name),
    short: String(r.short),
    description: s(r.description),
    family: s(r.family),
    archived: !!r.archived,
    sortOrder: num(r.sort_order, 0),
    needsReview: !!r.needs_review,
    importedFrom: s(r.imported_from),
    ...versioned(r),
  };
}
export function tribeDTO(r: R): TribeDTO {
  return { id: String(r.id), name: String(r.name), leadName: s(r.lead_name), archived: !!r.archived, ...versioned(r) };
}
export function chapterDTO(r: R): ChapterDTO {
  return {
    id: String(r.id),
    name: String(r.name),
    craftId: s(r.craft_id),
    leadPersonId: s(r.lead_person_id),
    archived: !!r.archived,
    ...versioned(r),
  };
}
export function teamDTO(r: R): TeamDTO {
  return { id: String(r.id), name: String(r.name), archived: !!r.archived, ...versioned(r) };
}

// ── People ─────────────────────────────────────────────────────────────────

export const PERSON_COLUMNS = `r.id, r.workspace_id, r.name, r.email, r.role, r.type, r.department, r.location, r.total_capacity,
  r.daily_rate_eur, r.team_id, r.chapter_id, r.home_tribe_id, r.linked_user_id, r.skills, r.craft_profile,
  r.tribe_affinity_ids, r.target_util, r.version, r.updated_at, r.updated_by, ub.name AS updated_by_name`;

const PERSON_TYPES: PersonType[] = ['Permanent', 'Contractor', 'Part-Time'];

export function secondaryCraftsOf(raw: unknown): SecondaryCraftDTO[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is R => !!x && typeof x === 'object' && typeof (x as R).craftId === 'string')
    .map((x) => ({
      craftId: String(x.craftId),
      proficiency: Math.min(3, Math.max(1, Math.round(num(x.proficiency, 1)))) as Proficiency,
      maxPct: num(x.maxPct, 40),
    }));
}

/**
 * The person's target utilisation (A-4, QA-022). craft_profile.targetUtil when set (2.0 dual-writes it, and a
 * rolled-back v1.1 writes only it); else `target_util`, filled by migration 0010 for v1.1 part-timers; else the
 * same PO rule for a row written without a target since: capacity below 100 % is the target; else 100.
 */
export function targetUtilOf(r: R, cp: R): number {
  const fromProfile = num(cp.targetUtil, 0);
  if (fromProfile > 0) return fromProfile;
  const migrated = num(r.target_util, 0);
  if (migrated > 0) return migrated;
  const capacity = num(r.total_capacity, 100);
  return capacity > 0 && capacity < 100 ? capacity : 100;
}

export function personDTO(r: R): PersonDTO {
  const cp = json<R>(r.craft_profile, {});
  const affinity = Array.isArray(r.tribe_affinity_ids) ? (r.tribe_affinity_ids as unknown[]).map(String) : [];
  const type = PERSON_TYPES.includes(r.type as PersonType) ? (r.type as PersonType) : 'Permanent';
  return {
    id: String(r.id),
    name: String(r.name ?? ''),
    email: s(r.email),
    role: String(r.role ?? ''),
    type,
    department: String(r.department ?? ''),
    location: s(r.location),
    totalCapacity: num(r.total_capacity, 100),
    dailyRate: numOrNull(r.daily_rate_eur),
    teamId: s(r.team_id),
    chapterId: s(r.chapter_id),
    homeTribeId: s(r.home_tribe_id),
    linkedUserId: s(r.linked_user_id),
    primaryCraft: typeof cp.primaryCraft === 'string' && cp.primaryCraft ? cp.primaryCraft : null,
    secondaryCrafts: secondaryCraftsOf(cp.secondaryCrafts),
    tribeAffinity: affinity,
    skills: Array.isArray(r.skills) ? (r.skills as unknown[]).map(String) : [],
    targetUtil: targetUtilOf(r, cp),
    ...versioned(r),
  };
}

// ── Projects ───────────────────────────────────────────────────────────────

export const PROJECT_COLUMNS = `p.id, p.workspace_id, p.name, p.status, p.priority, p.description, p.start_date::text AS start_date,
  p.end_date::text AS end_date, p.budget, p.tribe_id, p.stage, p.initiated_on::text AS initiated_on, p.owner_user_id,
  p.jira_key, p.planview_id, p.source, p.version, p.updated_at, p.updated_by, ub.name AS updated_by_name`;

const STATUSES: ProjectStatus[] = ['Active', 'On Hold', 'Planning', 'Completed'];
const STAGES: ProjectStage[] = ['Pipeline', 'Initiated', 'Mobilising', 'In Flight', 'Closing'];
const PRIORITIES: Priority[] = ['Critical', 'High', 'Medium', 'Low'];

export function projectDTO(r: R): ProjectDTO {
  return {
    id: String(r.id),
    name: String(r.name ?? ''),
    status: STATUSES.includes(r.status as ProjectStatus) ? (r.status as ProjectStatus) : 'Active',
    priority: PRIORITIES.includes(r.priority as Priority) ? (r.priority as Priority) : 'Medium',
    description: String(r.description ?? ''),
    startDate: s(r.start_date),
    endDate: s(r.end_date),
    budget: numOrNull(r.budget),
    tribeId: s(r.tribe_id),
    stage: STAGES.includes(r.stage as ProjectStage) ? (r.stage as ProjectStage) : null,
    initiatedOn: s(r.initiated_on),
    ownerUserId: s(r.owner_user_id),
    jiraKey: s(r.jira_key),
    planviewId: s(r.planview_id),
    source: r.source === 'planview' ? 'planview' : 'manual',
    ...versioned(r),
  };
}

// ── Allocations ────────────────────────────────────────────────────────────

export const ALLOCATION_COLUMNS = `a.id, a.workspace_id, a.resource_id, a.project_id, a.percentage, a.start_date::text AS start_date,
  a.end_date::text AS end_date, a.craft_id, a.source, a.state, a.notes, a.external_ref, a.demand_line_id, a.proposed_at,
  a.proposed_by, pb.name AS proposed_by_name, a.responded_at, a.version, a.updated_at, a.updated_by, ub.name AS updated_by_name`;
export const ALLOCATION_JOINS = `LEFT JOIN users ub ON ub.id = a.updated_by LEFT JOIN users pb ON pb.id = a.proposed_by`;

const SOURCES: AllocationSource[] = ['manual', 'marketplace', 'planview', 'jira'];
const STATES: AllocationState[] = ['tentative', 'confirmed', 'declined'];

export function allocationDTO(r: R): AllocationDTO {
  return {
    id: String(r.id),
    resourceId: String(r.resource_id),
    projectId: String(r.project_id),
    percentage: num(r.percentage, 0),
    startDate: s(r.start_date),
    endDate: s(r.end_date),
    craftId: s(r.craft_id),
    source: SOURCES.includes(r.source as AllocationSource) ? (r.source as AllocationSource) : 'manual',
    state: STATES.includes(r.state as AllocationState) ? (r.state as AllocationState) : 'confirmed',
    notes: s(r.notes),
    externalRef: s(r.external_ref),
    demandLineId: s(r.demand_line_id),
    proposedAt: iso(r.proposed_at),
    proposedBy: userRef(r.proposed_by, r.proposed_by_name),
    respondedAt: iso(r.responded_at),
    ...versioned(r),
  };
}

// ── Demand, offers, craft requests ─────────────────────────────────────────

export const DEMAND_COLUMNS = `d.id, d.workspace_id, d.project_id, d.quarter_key, d.craft_id, d.fte, d.status, d.owner_user_id, d.note,
  d.created_at, d.version, d.updated_at, d.updated_by, ub.name AS updated_by_name`;

export function demandDTO(r: R): DemandLineDTO {
  return {
    id: String(r.id),
    projectId: String(r.project_id),
    quarterKey: String(r.quarter_key),
    craftId: String(r.craft_id),
    fte: num(r.fte, 0),
    status: (r.status === 'Confirmed' ? 'Confirmed' : 'Forecast') as DemandStatus,
    ownerUserId: s(r.owner_user_id),
    note: s(r.note),
    createdAt: iso(r.created_at) ?? new Date(0).toISOString(),
    ...versioned(r),
  };
}

export const OFFER_COLUMNS = `o.person_id, o.quarter_key, o.pct, o.craft_ids, o.note, o.created_by, cb.name AS created_by_name, o.created_at`;
export function offerDTO(r: R): MarketplaceOfferDTO {
  return {
    personId: String(r.person_id),
    quarterKey: String(r.quarter_key),
    pct: num(r.pct, 0),
    craftIds: Array.isArray(r.craft_ids) ? (r.craft_ids as unknown[]).map(String) : [],
    note: s(r.note),
    createdBy: userRef(r.created_by, r.created_by_name) ?? { id: '', name: 'Unknown user' },
    createdAt: iso(r.created_at) ?? new Date(0).toISOString(),
  };
}

export const CRAFT_REQUEST_COLUMNS = `c.id, c.person_id, c.current, c.proposed, c.status, c.submitted_by, sb.name AS submitted_by_name,
  c.submitted_at, c.decided_by, db.name AS decided_by_name, c.decided_at, c.reason`;
export const CRAFT_REQUEST_JOINS = `LEFT JOIN users sb ON sb.id = c.submitted_by LEFT JOIN users db ON db.id = c.decided_by`;
export function craftRequestDTO(r: R): CraftChangeRequestDTO {
  const status = r.status === 'approved' || r.status === 'rejected' ? r.status : 'pending';
  return {
    id: String(r.id),
    personId: String(r.person_id),
    current: secondaryCraftsOf(json(r.current, [])),
    proposed: secondaryCraftsOf(json(r.proposed, [])),
    status,
    submittedBy: userRef(r.submitted_by, r.submitted_by_name) ?? { id: '', name: 'Unknown user' },
    submittedAt: iso(r.submitted_at) ?? new Date(0).toISOString(),
    decidedBy: userRef(r.decided_by, r.decided_by_name),
    decidedAt: iso(r.decided_at),
    reason: s(r.reason),
  };
}
