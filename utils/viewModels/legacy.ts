/**
 * WP-0 STUB HELPER — adapters from the 2.0 DTO snapshot to the v1.1 domain types, so the
 * view-model stubs can reuse `utils/craftEngine.ts` unchanged. Package C may delete this
 * file once `craftEngine` takes DTOs / catalogue arguments directly (ORG-06).
 *
 * Pure: no React, DOM, Node or Netlify imports.
 */
import type * as D from '../../shared/contracts/dto';
import type { Allocation, CraftDemand, Project, ProjectStatus, Resource, ResourceType } from '../../types';
import { quarterFromKey, type Quarter } from '../quarters';
import type { QuarterView } from './types';

export interface LegacyModel {
  resources: Resource[];
  projects: Project[];
  allocations: Allocation[];
}

/** Converts a QuarterView (ISO dates) into the craftEngine `Quarter` (local Date objects). */
export function toLegacyQuarter(q: QuarterView): Quarter {
  const out = quarterFromKey(q.key, q.index);
  if (!out) throw new Error(`Invalid quarter key: ${q.key}`);
  return out;
}

export function toLegacyQuarters(quarters: QuarterView[]): Quarter[] {
  return quarters.map(toLegacyQuarter);
}

export function toLegacyResource(p: D.PersonDTO, tribeName: (id: D.ID) => string | undefined): Resource {
  return {
    id: p.id,
    name: p.name,
    role: p.role,
    type: p.type as ResourceType,
    department: p.department,
    teamId: p.teamId ?? undefined,
    skills: p.skills,
    totalCapacity: p.totalCapacity,
    email: p.email ?? undefined,
    location: p.location ?? undefined,
    dailyRate: p.dailyRate ?? undefined,
    primaryCraft: p.primaryCraft ?? undefined,
    secondaryCrafts: p.secondaryCrafts.map((c) => ({
      craftId: c.craftId,
      proficiency: c.proficiency,
      maxPct: c.maxPct,
    })),
    tribeAffinity: p.tribeAffinity.map((id) => tribeName(id) ?? id),
    targetUtil: p.targetUtil,
  };
}

export function toLegacyProject(
  p: D.ProjectDTO,
  demand: D.DemandLineDTO[],
  tribeName: (id: D.ID) => string | undefined,
): Project {
  const byKey = new Map<string, CraftDemand>();
  for (const l of demand) {
    if (l.projectId !== p.id) continue;
    const k = `${l.quarterKey}|${l.craftId}`;
    const prev = byKey.get(k);
    byKey.set(k, {
      quarterKey: l.quarterKey,
      craftId: l.craftId,
      fte: (prev?.fte ?? 0) + l.fte,
      note: l.note ?? undefined,
    });
  }
  return {
    id: p.id,
    name: p.name,
    status: p.status as ProjectStatus,
    priority: p.priority,
    description: p.description,
    startDate: p.startDate ?? undefined,
    endDate: p.endDate ?? undefined,
    budget: p.budget ?? undefined,
    clientName: p.tribeId ? tribeName(p.tribeId) : undefined,
    stage: p.stage ?? undefined,
    initiatedOn: p.initiatedOn ?? undefined,
    craftDemand: [...byKey.values()],
    jiraKey: p.jiraKey ?? undefined,
    planviewId: p.planviewId ?? undefined,
  };
}

export function toLegacyAllocation(a: D.AllocationDTO): Allocation {
  return {
    id: a.id,
    resourceId: a.resourceId,
    projectId: a.projectId,
    percentage: a.percentage,
    startDate: a.startDate ?? undefined,
    endDate: a.endDate ?? undefined,
    notes: a.notes ?? undefined,
    craftId: a.craftId ?? undefined,
    source: a.source,
  };
}

/** Declined bookings never count; tentative ones count unless `includeTentative` is false. */
export function countedAllocations(s: D.WorkspaceSnapshot, includeTentative = true): D.AllocationDTO[] {
  return s.allocations.filter((a) => a.state === 'confirmed' || (includeTentative && a.state === 'tentative'));
}

export function toLegacy(s: D.WorkspaceSnapshot, opts: { includeTentative?: boolean } = {}): LegacyModel {
  const tribes = new Map(s.tribes.map((t) => [t.id, t.name]));
  const tribeName = (id: D.ID) => tribes.get(id);
  return {
    resources: s.people.map((p) => toLegacyResource(p, tribeName)),
    projects: s.projects.map((p) => toLegacyProject(p, s.demand, tribeName)),
    allocations: countedAllocations(s, opts.includeTentative ?? true).map(toLegacyAllocation),
  };
}
