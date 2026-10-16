/**
 * Demo database for DemoTransport (ST-10): the v1.1 demo data in `constants.ts` turned into 2.0
 * entities, plus the extras the 2.0 pages need to be explorable (a tentative proposal and an offer
 * for the Marketplace, a pending craft change, Jira mappings, sprint snapshots, calibration, a
 * Planview source with one new and one changed record, and a few other members).
 *
 * Derived structure (the v1.1 data has no tribes or chapters): tribes = distinct
 * `project.clientName`; chapters = one per above-the-table craft in use (lead = the holder whose job
 * title contains "Lead"); `homeTribeId` = first tribe affinity; demand status Confirmed for In Flight
 * and Mobilising projects, else Forecast (DM-01#AC1); "Legacy Patching" is Planview-sourced so the
 * Planview lock can be tried (AL-05#AC2).
 *
 * Pure: no React, DOM, Node or Netlify imports.
 */
import {
  DEFAULT_CRAFT_CATALOGUE,
  DEFAULT_PLANNING,
  MOCK_ALLOCATIONS,
  MOCK_PROJECTS,
  MOCK_RESOURCES,
  TEAMS,
} from '../../../constants';
import { defaultDemandStatus } from '../../../types';
import type * as D from '../../../shared/contracts/dto';
import type { AuditEventDTO } from '../../../shared/contracts/api';
import { DEFAULT_FEATURES } from '../../../shared/features';
import { allocationShare } from '../../../utils/craftEngine';
import { addDays, dayNumber, isoFromDayNumber } from '../../../utils/quarters';

export const DEMO_ORG_ID = 'demo-org';
export const DEMO_WORKSPACE_ID = 'demo';
export const DEMO_USER_ID = 'demo-user';
/** The demo user is linked to this person so My Plan and "own" permissions have data. */
export const DEMO_LINKED_PERSON_ID = 'r9';
export const DEMO_PASSWORD = 'demo-password';
/** One-time code accepted for the 2FA demo user (twofa@example.com). */
export const DEMO_OTP = '246810';

export type DemoRole = 'ORG_ADMIN' | D.WorkspaceRole;
export const DEMO_ROLES: readonly DemoRole[] = ['ORG_ADMIN', 'WORKSPACE_ADMIN', 'PLANNER', 'CONTRIBUTOR', 'VIEWER'];

export interface DemoUser {
  id: D.ID;
  email: string;
  name: string;
  password: string;
  isPlatformAdmin: boolean;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  orgRole: D.OrgRole | null;
  lastSignInAt: D.ISODateTime | null;
}

export interface DemoMembership {
  userId: D.ID;
  workspaceId: D.ID;
  role: D.WorkspaceRole;
  linkedPersonId: D.ID | null;
}

export interface DemoInvitation {
  id: D.ID;
  token: string;
  email: string;
  orgRole: D.OrgRole;
  workspaces: Array<{ workspaceId: D.ID; role: D.WorkspaceRole }>;
  invitedBy: D.ID;
  expiresAt: D.ISODateTime;
  acceptedAt: D.ISODateTime | null;
  revokedAt: D.ISODateTime | null;
}

export interface PlanviewSourceProject {
  externalId: string;
  name: string;
  status: D.ProjectStatus;
  startDate: D.ISODate;
  endDate: D.ISODate;
}
export interface PlanviewSourceAssignment {
  externalId: string;
  projectExternalId: string;
  personExternalId: string;
  personName: string;
  email: string | null;
  percentage: number;
  startDate: D.ISODate;
  endDate: D.ISODate;
}

export interface DemoWorkspace {
  workspace: D.WorkspaceDTO;
  people: D.PersonDTO[];
  projects: D.ProjectDTO[];
  allocations: D.AllocationDTO[];
  demand: D.DemandLineDTO[];
  offers: D.MarketplaceOfferDTO[];
  craftRequests: D.CraftChangeRequestDTO[];
  calibrations: D.TribeCalibrationDTO[];
  jiraConfigured: boolean;
  jiraProjects: D.JiraProjectMappingDTO[];
  identities: D.IdentityMappingDTO[];
  syncJobs: D.SyncJobDTO[];
  deliveryRows: D.DeliveryRowDTO[];
  planviewConfigured: boolean;
  planviewSource: { projects: PlanviewSourceProject[]; assignments: PlanviewSourceAssignment[] };
  previews: Array<{ preview: D.PlanviewPreviewDTO; createdAt: D.ISODateTime }>;
}

export interface DemoDb {
  appMode: 'public' | 'internal';
  org: D.OrgDTO;
  users: DemoUser[];
  memberships: DemoMembership[];
  invitations: DemoInvitation[];
  tribes: D.TribeDTO[];
  chapters: D.ChapterDTO[];
  teams: D.TeamDTO[];
  crafts: D.CraftDTO[];
  workspaces: Record<D.ID, DemoWorkspace>;
  audit: AuditEventDTO[];
  /** The signed-in user (stands in for the session cookie). */
  sessionUserId: D.ID | null;
  aiQueriesThisMonth: number;
}

const STAMP: D.ISODateTime = '2026-10-01T09:00:00.000Z';
const v = { version: 1, updatedAt: STAMP, updatedBy: null } satisfies D.Versioned;

const slug = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export interface SeedOptions {
  role?: DemoRole;
  isPlatformAdmin?: boolean;
  signedIn?: boolean;
  appMode?: 'public' | 'internal';
  plan?: D.Plan;
  now?: Date;
}

/** Builds the people/projects/allocations/demand of the demo workspace (also used by "Install sample data"). */
export function seedWorkspaceData(
  tribes: D.TribeDTO[],
  newId?: () => D.ID,
): Pick<DemoWorkspace, 'people' | 'projects' | 'allocations' | 'demand'> {
  const id = (legacy: string) => (newId ? newId() : legacy);
  const tribeIdByName = new Map(tribes.map((t) => [t.name.toLowerCase(), t.id]));
  const personId = new Map(MOCK_RESOURCES.map((r) => [r.id, id(r.id)]));
  const projectId = new Map(MOCK_PROJECTS.map((p) => [p.id, id(p.id)]));

  const people: D.PersonDTO[] = MOCK_RESOURCES.map((r) => {
    const affinity = (r.tribeAffinity ?? [])
      .map((n) => tribeIdByName.get(n.toLowerCase()))
      .filter((x): x is string => !!x);
    return {
      ...v,
      id: personId.get(r.id)!,
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
      linkedUserId: null,
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

  const planviewIds: Record<string, string> = { p4: 'PV-0004' };
  const projects: D.ProjectDTO[] = MOCK_PROJECTS.map((p) => ({
    ...v,
    id: projectId.get(p.id)!,
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
    planviewId: planviewIds[p.id] ?? p.planviewId ?? null,
    source: planviewIds[p.id] || p.planviewId ? 'planview' : 'manual',
  }));

  const demand: D.DemandLineDTO[] = MOCK_PROJECTS.flatMap((p) =>
    (p.craftDemand ?? []).map((d) => ({
      ...v,
      id: newId ? newId() : `d-${p.id}-${d.quarterKey}-${d.craftId}`,
      projectId: projectId.get(p.id)!,
      quarterKey: d.quarterKey,
      craftId: d.craftId,
      fte: d.fte,
      status: defaultDemandStatus(p.stage ?? null),
      ownerUserId: null,
      note: d.note ?? null,
      createdAt: STAMP,
    })),
  );

  const planviewAllocs: Record<string, string> = { a9: 'PVA-9', a23: 'PVA-23' };
  const allocations: D.AllocationDTO[] = MOCK_ALLOCATIONS.map((a) => ({
    ...v,
    id: id(a.id),
    resourceId: personId.get(a.resourceId)!,
    projectId: projectId.get(a.projectId)!,
    percentage: a.percentage,
    startDate: a.startDate ?? null,
    endDate: a.endDate ?? null,
    craftId: a.craftId ?? null,
    source: planviewAllocs[a.id] ? 'planview' : (a.source ?? 'manual'),
    state: 'confirmed',
    notes: a.notes ?? null,
    externalRef: planviewAllocs[a.id] ?? null,
    demandLineId: null,
    proposedAt: null,
    proposedBy: null,
    respondedAt: null,
  }));
  return { people, projects, allocations, demand };
}

function deliveryRowsFor(
  projects: D.ProjectDTO[],
  allocations: D.AllocationDTO[],
  calibrations: D.TribeCalibrationDTO[],
): D.DeliveryRowDTO[] {
  const lastEnd = dayNumber('2026-10-13');
  const points: Record<string, number[]> = {
    APOLLO: [34, 38, 31, 40, 36, 42],
    SKY: [22, 18, 25, 21, 24, 20],
    PHX: [28, 30, 33, 29, 35, 31],
  };
  const rows: D.DeliveryRowDTO[] = [];
  for (const p of projects) {
    const pts = p.jiraKey ? points[p.jiraKey] : undefined;
    if (!pts) continue;
    const cal = calibrations.find((c) => c.tribeId === p.tribeId);
    const ppf = cal && !cal.isDefault ? cal.pointsPerSprintPerFte : 10;
    pts.forEach((total, i) => {
      const sprintNo = 38 + i;
      const to = isoFromDayNumber(lastEnd - 14 * (pts.length - 1 - i));
      const from = addDays(to, -13);
      const range = { key: '', label: '', start: from, end: to };
      const planned =
        allocations
          .filter((a) => a.projectId === p.id && a.state !== 'declined')
          .reduce((x, a) => x + a.percentage * allocationShare(a, range, p), 0) / 100;
      const done = Math.round(total * 0.85);
      rows.push({
        key: `${p.jiraKey}-${sprintNo}`,
        label: `Sprint ${sprintNo}`,
        tribeId: p.tribeId,
        projectId: p.id,
        sprintId: `${p.jiraKey}-s${sprintNo}`,
        sprintName: `Sprint ${sprintNo}`,
        quarterKey: `${to.slice(0, 4)}-Q${Math.floor((Number(to.slice(5, 7)) - 1) / 3) + 1}`,
        from,
        to,
        pointsTotal: total,
        pointsDone: done,
        issuesDone: Math.round(done / 3),
        impliedFte: Math.round((done / ppf) * 100) / 100,
        plannedFte: Math.round(planned * 100) / 100,
      });
    });
  }
  return rows;
}

export function buildDemoDb(o: SeedOptions = {}): DemoDb {
  const now = o.now ?? new Date();
  const role = o.role ?? 'ORG_ADMIN';
  const tribeNames = [...new Set(MOCK_PROJECTS.map((p) => p.clientName).filter((n): n is string => !!n))];
  const leadNames: Record<string, string> = { Digital: 'Aoife Byrne', Payments: 'Declan Moore' };
  const tribes: D.TribeDTO[] = tribeNames.map((name) => ({
    ...v,
    id: `tribe-${slug(name)}`,
    name,
    leadName: leadNames[name] ?? null,
    archived: false,
  }));
  const crafts: D.CraftDTO[] = DEFAULT_CRAFT_CATALOGUE.map((c) => ({ ...v, ...c }));
  const primaryCrafts = [...new Set(MOCK_RESOURCES.map((r) => r.primaryCraft).filter((c): c is string => !!c))];
  const chapters: D.ChapterDTO[] = primaryCrafts.map((craftId) => {
    const lead = MOCK_RESOURCES.find((r) => r.primaryCraft === craftId && /lead/i.test(r.role));
    return {
      ...v,
      id: `chapter-${craftId}`,
      name: crafts.find((c) => c.id === craftId)?.name ?? craftId,
      craftId,
      leadPersonId: lead?.id ?? null,
      archived: false,
    };
  });
  const teams: D.TeamDTO[] = TEAMS.map((t) => ({ ...v, id: t.id, name: t.name, archived: false }));

  const base = seedWorkspaceData(tribes);
  const people = base.people.map((p) =>
    p.id === DEMO_LINKED_PERSON_ID
      ? { ...p, linkedUserId: DEMO_USER_ID }
      : p.id === 'r1'
        ? { ...p, linkedUserId: 'u-tom' }
        : p.id === 'r8'
          ? { ...p, linkedUserId: 'u-noma' }
          : p,
  );
  const tom: D.UserRef = { id: 'u-tom', name: 'Tom Hayes' };
  const nebulaBa = base.demand.find(
    (l) => l.projectId === 'p3' && l.quarterKey === '2027-Q1' && l.craftId === 'pmo-analytics',
  );
  const allocations: D.AllocationDTO[] = [
    ...base.allocations,
    {
      ...v,
      id: 'a-proposal-1',
      resourceId: DEMO_LINKED_PERSON_ID,
      projectId: 'p3',
      percentage: 20,
      startDate: '2027-01-11',
      endDate: '2027-03-31',
      craftId: 'pmo-analytics',
      source: 'marketplace',
      state: 'tentative',
      notes: null,
      externalRef: null,
      demandLineId: nebulaBa?.id ?? null,
      proposedAt: '2026-10-12T10:15:00.000Z',
      proposedBy: tom,
      respondedAt: null,
      updatedBy: tom,
    },
  ];

  const calibrations: D.TribeCalibrationDTO[] = [
    {
      ...v,
      tribeId: 'tribe-digital',
      pointsPerSprintPerFte: 12,
      sprintLengthDays: 14,
      isDefault: false,
      suggestedValue: 11.5,
      suggestedBasis: { sprintNames: ['Sprint 41', 'Sprint 42', 'Sprint 43'], points: 186, fte: 5.4 },
      note: 'Calibrated at the Q3 QBR',
      updatedBy: tom,
    },
    {
      ...v,
      tribeId: 'tribe-payments',
      pointsPerSprintPerFte: 10,
      sprintLengthDays: 14,
      isDefault: true,
      suggestedValue: 9,
      suggestedBasis: { sprintNames: ['Sprint 41', 'Sprint 42', 'Sprint 43'], points: 55, fte: 2.1 },
      note: null,
    },
  ];

  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();
  const job = (id: string, startedMin: number, status: D.SyncStatus, error: string | null = null): D.SyncJobDTO => ({
    id,
    provider: 'jira',
    trigger: 'schedule',
    status,
    pagesDone: status === 'failed' ? 1 : 6,
    issuesSeen: status === 'failed' ? 40 : 214,
    error,
    rateLimitedUntil: null,
    startedAt: minutesAgo(startedMin),
    finishedAt: minutesAgo(startedMin - 2),
    requestedBy: null,
  });

  const demo: DemoWorkspace = {
    workspace: {
      id: DEMO_WORKSPACE_ID,
      orgId: DEMO_ORG_ID,
      name: 'IE Portfolio & Change Office',
      dataVersion: 1,
      createdAt: STAMP,
    },
    people,
    projects: base.projects,
    allocations,
    demand: base.demand,
    offers: [
      {
        personId: 'r4',
        quarterKey: '2026-Q4',
        pct: 50,
        craftIds: ['programme-mgmt', 'pmo-analytics'],
        note: 'Free until Nebula starts in January',
        createdBy: tom,
        createdAt: '2026-10-08T08:30:00.000Z',
      },
    ],
    craftRequests: [
      {
        id: 'cr-1',
        personId: 'r8',
        current: people.find((p) => p.id === 'r8')!.secondaryCrafts,
        proposed: [
          ...people.find((p) => p.id === 'r8')!.secondaryCrafts,
          { craftId: 'change-mgmt', proficiency: 1, maxPct: 20 },
        ],
        status: 'pending',
        submittedBy: { id: 'u-noma', name: 'Noma Odigie' },
        submittedAt: '2026-10-14T15:20:00.000Z',
        decidedBy: null,
        decidedAt: null,
        reason: null,
      },
    ],
    calibrations,
    jiraConfigured: true,
    jiraProjects: [
      {
        jiraKey: 'APOLLO',
        jiraName: 'Apollo Revamp',
        boardIds: [11],
        projectId: 'p1',
        tribeId: 'tribe-digital',
        matchMethod: 'key',
        confirmed: true,
      },
      {
        jiraKey: 'SKY',
        jiraName: 'Skyline API',
        boardIds: [12],
        projectId: 'p2',
        tribeId: 'tribe-payments',
        matchMethod: 'key',
        confirmed: true,
      },
      {
        jiraKey: 'PHX',
        jiraName: 'Phoenix Mobile',
        boardIds: [13, 14],
        projectId: 'p5',
        tribeId: 'tribe-digital',
        matchMethod: 'key',
        confirmed: true,
      },
      {
        jiraKey: 'ORION',
        jiraName: 'Orion Security',
        boardIds: [15],
        projectId: null,
        tribeId: null,
        matchMethod: 'none',
        confirmed: false,
      },
      {
        jiraKey: 'DATA',
        jiraName: 'Data Platform Spikes',
        boardIds: [16],
        projectId: null,
        tribeId: null,
        matchMethod: 'none',
        confirmed: false,
      },
    ],
    identities: [
      {
        provider: 'jira',
        externalId: '5f1a-noma',
        displayName: 'Noma Odigie',
        email: 'noma.odigie@company.ie',
        personId: 'r8',
        matchMethod: 'email',
        confirmed: true,
        lastSeenAt: minutesAgo(700),
      },
      {
        provider: 'jira',
        externalId: '5f1a-claire',
        displayName: 'Claire Ryan',
        email: 'claire.ryan@company.ie',
        personId: 'r2',
        matchMethod: 'email',
        confirmed: false,
        lastSeenAt: minutesAgo(700),
      },
      {
        provider: 'jira',
        externalId: '5f1a-gokul',
        displayName: 'Gokul G',
        email: null,
        personId: null,
        matchMethod: 'none',
        confirmed: false,
        lastSeenAt: minutesAgo(700),
      },
    ],
    syncJobs: [job('job-3', 660, 'succeeded'), job('job-2', 2100, 'succeeded'), job('job-1', 3540, 'succeeded')],
    deliveryRows: deliveryRowsFor(base.projects, allocations, calibrations),
    planviewConfigured: true,
    planviewSource: {
      projects: [
        {
          externalId: 'PV-0004',
          name: 'Legacy Patching',
          status: 'On Hold',
          startDate: '2026-10-01',
          endDate: '2027-08-31',
        },
        {
          externalId: 'PV-1001',
          name: 'Atlas Data Platform',
          status: 'Planning',
          startDate: '2027-01-04',
          endDate: '2027-12-17',
        },
      ],
      assignments: [
        {
          externalId: 'PVA-9',
          projectExternalId: 'PV-0004',
          personExternalId: 'pv-kd',
          personName: 'Kerrie Dalton',
          email: 'kerrie.dalton@company.ie',
          percentage: 30,
          startDate: '2026-10-01',
          endDate: '2027-03-31',
        },
        {
          externalId: 'PVA-23',
          projectExternalId: 'PV-0004',
          personExternalId: 'pv-lo',
          personName: "Linda O'Dwyer",
          email: 'linda.odwyer@company.ie',
          percentage: 40,
          startDate: '2026-10-01',
          endDate: '2027-06-30',
        },
        {
          externalId: 'PVA-31',
          projectExternalId: 'PV-1001',
          personExternalId: 'pv-mv',
          personName: 'Mary Vithalani',
          email: 'mary.vithalani@company.ie',
          percentage: 20,
          startDate: '2027-01-04',
          endDate: '2027-06-30',
        },
        {
          externalId: 'PVA-40',
          projectExternalId: 'PV-1001',
          personExternalId: 'pv-jb',
          personName: 'Jordan Blake',
          email: null,
          percentage: 50,
          startDate: '2027-01-04',
          endDate: '2027-12-17',
        },
      ],
    },
    previews: [],
  };

  const orgRole: D.OrgRole = role === 'ORG_ADMIN' ? 'ORG_ADMIN' : 'MEMBER';
  const users: DemoUser[] = [
    {
      id: DEMO_USER_ID,
      email: 'demo.user@example.com',
      name: 'Demo User',
      password: DEMO_PASSWORD,
      isPlatformAdmin: !!o.isPlatformAdmin,
      emailVerified: true,
      twoFactorEnabled: false,
      orgRole,
      lastSignInAt: STAMP,
    },
    {
      id: 'u-tom',
      email: 'tom.hayes@company.ie',
      name: 'Tom Hayes',
      password: DEMO_PASSWORD,
      isPlatformAdmin: false,
      emailVerified: true,
      twoFactorEnabled: false,
      orgRole: 'MEMBER',
      lastSignInAt: STAMP,
    },
    {
      id: 'u-noma',
      email: 'noma.odigie@company.ie',
      name: 'Noma Odigie',
      password: DEMO_PASSWORD,
      isPlatformAdmin: false,
      emailVerified: true,
      twoFactorEnabled: false,
      orgRole: 'MEMBER',
      lastSignInAt: STAMP,
    },
    {
      id: 'u-aoife',
      email: 'aoife.byrne@company.ie',
      name: 'Aoife Byrne',
      password: DEMO_PASSWORD,
      isPlatformAdmin: false,
      emailVerified: true,
      twoFactorEnabled: false,
      orgRole: 'MEMBER',
      lastSignInAt: null,
    },
    {
      id: 'u-twofa',
      email: 'twofa@example.com',
      name: 'Two Factor',
      password: DEMO_PASSWORD,
      isPlatformAdmin: false,
      emailVerified: true,
      twoFactorEnabled: true,
      orgRole: 'MEMBER',
      lastSignInAt: null,
    },
  ];
  const memberships: DemoMembership[] = [
    {
      userId: DEMO_USER_ID,
      workspaceId: DEMO_WORKSPACE_ID,
      role: role === 'ORG_ADMIN' ? 'WORKSPACE_ADMIN' : role,
      linkedPersonId: DEMO_LINKED_PERSON_ID,
    },
    { userId: 'u-tom', workspaceId: DEMO_WORKSPACE_ID, role: 'PLANNER', linkedPersonId: 'r1' },
    { userId: 'u-noma', workspaceId: DEMO_WORKSPACE_ID, role: 'CONTRIBUTOR', linkedPersonId: 'r8' },
    { userId: 'u-aoife', workspaceId: DEMO_WORKSPACE_ID, role: 'VIEWER', linkedPersonId: null },
    { userId: 'u-twofa', workspaceId: DEMO_WORKSPACE_ID, role: 'VIEWER', linkedPersonId: null },
  ];

  return {
    appMode: o.appMode ?? 'internal',
    org: {
      ...v,
      id: DEMO_ORG_ID,
      name: 'Demo Organisation',
      slug: 'demo',
      logoUrl: null,
      plan: o.plan ?? 'ENTERPRISE',
      features: { ...DEFAULT_FEATURES },
      planning: { ...DEFAULT_PLANNING },
      defaultWorkspaceVisibility: 'org',
    },
    users,
    memberships,
    invitations: [],
    tribes,
    chapters,
    teams,
    crafts,
    workspaces: { [DEMO_WORKSPACE_ID]: demo },
    audit: [],
    sessionUserId: o.signedIn === false ? null : DEMO_USER_ID,
    aiQueriesThisMonth: 0,
  };
}
