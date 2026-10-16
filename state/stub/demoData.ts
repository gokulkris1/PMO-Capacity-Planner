/**
 * WP-0 STUB: the v1.1 demo data in `constants.ts` (MOCK_RESOURCES, MOCK_PROJECTS,
 * MOCK_ALLOCATIONS, PMO_CRAFTS, TEAMS) converted to 2.0 DTOs (`version: 1`, legacy ids kept).
 *
 * Derived structure (the v1.1 data has no tribes or chapters):
 *  - tribes   = distinct `project.clientName` values, id `tribe-<slug>`;
 *  - chapters = one per above-the-table craft in use, id `chapter-<craftId>`, people assigned by
 *               primary craft, lead = first person found with role containing "Lead" (else none);
 *  - demand   = `project.craftDemand`, one line per (quarter, craft), id `d-<project>-<quarter>-<craft>`,
 *               status Confirmed from stage Initiated onwards, Forecast for Pipeline.
 *
 * Pure (no React). C replaces this with `DemoTransport` (ST-10) and may delete the file.
 */
import { MOCK_ALLOCATIONS, MOCK_PROJECTS, MOCK_RESOURCES, PMO_CRAFTS, TEAMS } from '../../constants';
import type * as D from '../../shared/contracts/dto';
import { DEFAULT_FEATURES } from '../../shared/features';
import { DEFAULT_THRESHOLDS } from '../../shared/utilisation';
import { entitlementsFor } from '../../shared/entitlements';
import { permissionsFor } from '../../shared/permissions';

export const DEMO_ORG_ID = 'demo-org';
export const DEMO_WORKSPACE_ID = 'demo';
export const DEMO_USER: D.SessionUser = {
  id: 'demo-user',
  email: 'demo.user@example.com',
  name: 'Demo User',
  isPlatformAdmin: false,
  emailVerified: true,
  twoFactorEnabled: false,
};
/** The demo user is linked to this person so My Plan and "own" permissions have data. */
export const DEMO_LINKED_PERSON_ID = 'r9';
const STAMP: D.ISODateTime = '2026-10-01T09:00:00.000Z';
const v = { version: 1, updatedAt: STAMP, updatedBy: null } satisfies D.Versioned;

const slug = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export const DEMO_PLANNING: D.PlanningSettings = {
  fiscalYearStartMonth: 1,
  thresholds: DEFAULT_THRESHOLDS,
  defaultTargetUtil: 100,
  sprintLengthDays: 14,
  planviewOwnership: 'locked',
};

export function buildDemoSnapshot(now: Date = new Date()): D.WorkspaceSnapshot {
  const tribeNames = [...new Set(MOCK_PROJECTS.map((p) => p.clientName).filter((n): n is string => !!n))];
  const tribes: D.TribeDTO[] = tribeNames.map((name) => ({
    ...v,
    id: `tribe-${slug(name)}`,
    name,
    leadName: null,
    archived: false,
  }));
  const tribeIdByName = new Map(tribes.map((t) => [t.name.toLowerCase(), t.id]));

  const crafts: D.CraftDTO[] = PMO_CRAFTS.map((c, i) => ({
    ...v,
    id: c.id,
    name: c.name,
    short: c.short,
    description: c.description ?? null,
    family: null,
    archived: false,
    sortOrder: i,
  }));

  const primaryCrafts = [...new Set(MOCK_RESOURCES.map((r) => r.primaryCraft).filter((c): c is string => !!c))];
  const chapters: D.ChapterDTO[] = primaryCrafts.map((craftId) => {
    const holders = MOCK_RESOURCES.filter((r) => r.primaryCraft === craftId);
    const lead = holders.find((r) => /lead/i.test(r.role));
    return {
      ...v,
      id: `chapter-${craftId}`,
      name: PMO_CRAFTS.find((c) => c.id === craftId)?.name ?? craftId,
      craftId,
      leadPersonId: lead?.id ?? null,
      archived: false,
    };
  });

  const teams: D.TeamDTO[] = TEAMS.map((t) => ({ ...v, id: t.id, name: t.name, archived: false }));

  const people: D.PersonDTO[] = MOCK_RESOURCES.map((r) => {
    const affinity = (r.tribeAffinity ?? [])
      .map((n) => tribeIdByName.get(n.toLowerCase()))
      .filter((x): x is string => !!x);
    return {
      ...v,
      id: r.id,
      name: r.name,
      email: r.email ?? null,
      role: r.role,
      type: r.type as D.PersonType,
      department: r.department,
      location: r.location ?? null,
      totalCapacity: r.totalCapacity,
      dailyRate: r.dailyRate ?? null,
      teamId: r.teamId ?? null,
      chapterId: r.primaryCraft ? `chapter-${r.primaryCraft}` : null,
      homeTribeId: affinity[0] ?? null,
      linkedUserId: r.id === DEMO_LINKED_PERSON_ID ? DEMO_USER.id : null,
      primaryCraft: r.primaryCraft ?? null,
      secondaryCrafts: (r.secondaryCrafts ?? []).map((s) => ({
        craftId: s.craftId,
        proficiency: s.proficiency,
        maxPct: s.maxPct ?? 40,
      })),
      tribeAffinity: affinity,
      skills: r.skills ?? [],
      targetUtil: r.targetUtil ?? 100,
    };
  });

  const projects: D.ProjectDTO[] = MOCK_PROJECTS.map((p) => ({
    ...v,
    id: p.id,
    name: p.name,
    status: p.status as D.ProjectStatus,
    priority: p.priority,
    description: p.description,
    startDate: p.startDate ?? null,
    endDate: p.endDate ?? null,
    budget: p.budget ?? null,
    tribeId: p.clientName ? (tribeIdByName.get(p.clientName.toLowerCase()) ?? null) : null,
    stage: p.stage ?? null,
    initiatedOn: p.initiatedOn ?? null,
    ownerUserId: null,
    jiraKey: p.jiraKey ?? null,
    planviewId: p.planviewId ?? null,
    source: p.planviewId ? 'planview' : 'manual',
  }));

  const demand: D.DemandLineDTO[] = MOCK_PROJECTS.flatMap((p) =>
    (p.craftDemand ?? []).map((d) => ({
      ...v,
      id: `d-${p.id}-${d.quarterKey}-${d.craftId}`,
      projectId: p.id,
      quarterKey: d.quarterKey,
      craftId: d.craftId,
      fte: d.fte,
      status: (p.stage === 'Pipeline' ? 'Forecast' : 'Confirmed') as D.DemandStatus,
      ownerUserId: null,
      note: d.note ?? null,
      createdAt: STAMP,
    })),
  );

  const allocations: D.AllocationDTO[] = MOCK_ALLOCATIONS.map((a) => ({
    ...v,
    id: a.id,
    resourceId: a.resourceId,
    projectId: a.projectId,
    percentage: a.percentage,
    startDate: a.startDate ?? null,
    endDate: a.endDate ?? null,
    craftId: a.craftId ?? null,
    source: a.source ?? 'manual',
    state: 'confirmed',
    notes: a.notes ?? null,
    externalRef: null,
    demandLineId: null,
    proposedAt: null,
    proposedBy: null,
    respondedAt: null,
  }));

  return {
    org: {
      ...v,
      id: DEMO_ORG_ID,
      name: 'Demo Organisation',
      slug: 'demo',
      logoUrl: null,
      plan: 'ENTERPRISE',
      features: { ...DEFAULT_FEATURES },
      planning: DEMO_PLANNING,
      defaultWorkspaceVisibility: 'org',
    },
    workspace: {
      id: DEMO_WORKSPACE_ID,
      orgId: DEMO_ORG_ID,
      name: 'IE Portfolio & Change Office',
      dataVersion: 1,
      createdAt: STAMP,
    },
    people,
    projects,
    allocations,
    demand,
    tribes,
    chapters,
    teams,
    crafts,
    offers: [],
    craftRequests: [],
    delivery: null,
    serverTime: now.toISOString(),
  };
}

export type DemoRole = 'ORG_ADMIN' | D.WorkspaceRole;
export const DEMO_ROLES: readonly DemoRole[] = ['ORG_ADMIN', 'WORKSPACE_ADMIN', 'PLANNER', 'CONTRIBUTOR', 'VIEWER'];

/** The `/api/v2/me` response the demo user would get with the given role. */
export function buildDemoMe(
  snapshot: D.WorkspaceSnapshot,
  role: DemoRole = 'ORG_ADMIN',
  isPlatformAdmin = false,
): D.MeResponse {
  const orgRole: D.OrgRole = role === 'ORG_ADMIN' ? 'ORG_ADMIN' : 'MEMBER';
  const workspaceRole: D.WorkspaceRole = role === 'ORG_ADMIN' ? 'WORKSPACE_ADMIN' : role;
  const permissions = permissionsFor({ isPlatformAdmin, orgRole, workspaceRole });
  const o = snapshot.org;
  return {
    user: { ...DEMO_USER, isPlatformAdmin },
    org: {
      id: o.id,
      name: o.name,
      slug: o.slug,
      logoUrl: o.logoUrl,
      role: orgRole,
      plan: o.plan,
      features: o.features,
      planning: o.planning,
    },
    workspaces: [
      {
        id: snapshot.workspace.id,
        name: snapshot.workspace.name,
        role: workspaceRole,
        implicit: role === 'ORG_ADMIN',
        permissions,
        linkedPersonId: DEMO_LINKED_PERSON_ID,
      },
    ],
    entitlements: entitlementsFor(o.plan, 'internal'),
    appMode: 'internal',
  };
}
