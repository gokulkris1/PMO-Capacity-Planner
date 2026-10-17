/** Test fixtures for the pure view-model tests. */
import type * as D from '../../shared/contracts/dto';
import { DEFAULT_PLANNING } from '../../constants';
import { DEFAULT_FEATURES } from '../../shared/features';
import { createApiClient } from '../../services/api/client';
import { DemoTransport } from '../../services/api/demoTransport';
import { rollingQuarterViews } from '../../utils/quarters';

/** QBR1 = Q4 2026 … QBR4 = Q3 2027 (BACKLOG header date). */
export const TODAY = '2026-10-16';
export const QUARTERS = rollingQuarterViews(TODAY, 1);

/** The demo workspace exactly as DemoTransport serves it. */
export async function demoSnapshot(role: 'ORG_ADMIN' | 'PLANNER' = 'ORG_ADMIN'): Promise<D.WorkspaceSnapshot> {
  return createApiClient(new DemoTransport({ role })).workspace.snapshot('demo');
}

const v = { version: 1, updatedAt: '2026-10-01T00:00:00.000Z', updatedBy: null };

export function person(id: string, o: Partial<D.PersonDTO> = {}): D.PersonDTO {
  return {
    ...v,
    id,
    name: o.name ?? `Person ${id}`,
    email: null,
    role: 'PM',
    type: 'Permanent',
    department: 'PMO',
    location: null,
    totalCapacity: 100,
    dailyRate: null,
    teamId: null,
    chapterId: null,
    homeTribeId: null,
    linkedUserId: null,
    primaryCraft: 'pm',
    secondaryCrafts: [],
    tribeAffinity: [],
    skills: [],
    targetUtil: 100,
    ...o,
  };
}

export function project(id: string, o: Partial<D.ProjectDTO> = {}): D.ProjectDTO {
  return {
    ...v,
    id,
    name: o.name ?? `Project ${id}`,
    status: 'Active',
    priority: 'Medium',
    description: '',
    startDate: null,
    endDate: null,
    budget: null,
    tribeId: null,
    stage: 'In Flight',
    initiatedOn: null,
    ownerUserId: null,
    jiraKey: null,
    planviewId: null,
    source: 'manual',
    ...o,
  };
}

export function alloc(
  id: string,
  o: Partial<D.AllocationDTO> & { resourceId: string; projectId: string; percentage: number },
): D.AllocationDTO {
  return {
    ...v,
    id,
    startDate: null,
    endDate: null,
    craftId: null,
    source: 'manual',
    state: 'confirmed',
    notes: null,
    externalRef: null,
    demandLineId: null,
    proposedAt: null,
    proposedBy: null,
    respondedAt: null,
    ...o,
  };
}

export function demandLine(
  id: string,
  o: Partial<D.DemandLineDTO> & { projectId: string; quarterKey: string; craftId: string; fte: number },
): D.DemandLineDTO {
  return { ...v, id, status: 'Confirmed', ownerUserId: null, note: null, createdAt: '2026-09-01T00:00:00.000Z', ...o };
}

export function craft(id: string, short: string, o: Partial<D.CraftDTO> = {}): D.CraftDTO {
  return { ...v, id, name: o.name ?? id, short, description: null, family: null, archived: false, sortOrder: 0, ...o };
}

export function tribe(id: string, name: string, o: Partial<D.TribeDTO> = {}): D.TribeDTO {
  return { ...v, id, name, leadName: null, archived: false, ...o };
}

/** A minimal snapshot; pass the lists you need. */
export function snapshot(o: Partial<D.WorkspaceSnapshot> = {}): D.WorkspaceSnapshot {
  return {
    org: {
      ...v,
      id: 'org',
      name: 'Org',
      slug: 'org',
      logoUrl: null,
      plan: 'ENTERPRISE',
      features: { ...DEFAULT_FEATURES },
      planning: { ...DEFAULT_PLANNING },
      defaultWorkspaceVisibility: 'org',
    },
    workspace: { id: 'ws', orgId: 'org', name: 'WS', dataVersion: 1, createdAt: '2026-01-01T00:00:00.000Z' },
    people: [],
    projects: [],
    allocations: [],
    demand: [],
    tribes: [],
    chapters: [],
    teams: [],
    crafts: [craft('pm', 'PM'), craft('sm', 'SM'), craft('ba', 'BA')],
    offers: [],
    craftRequests: [],
    delivery: null,
    serverTime: '2026-10-16T09:00:00.000Z',
    ...o,
  };
}
