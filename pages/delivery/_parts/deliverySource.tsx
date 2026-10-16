/**
 * Delivery data source for the Jira & Planview pages (JI-02…JI-07, PV-01/02) and the delivery signal on
 * Home, Projects and Tribes (JI-06).
 *
 * WHY THIS EXISTS: the frozen `state/index.ts` surface (BACKLOG §4.3) exposes only `snapshot.delivery`
 * (sync health + QBR1 planned/implied per project). Mappings, identities, calibration, sprint rows, sync
 * jobs and Planview preview/apply have API routes (`API.jiraMappings`, `API.calibration`, `API.delivery`,
 * `API.syncJira`, `API.planviewPreview`, …) but no client hook yet. Pages therefore read this interface:
 *
 *   - `<DeliverySourceProvider value={…}>` — package C / I provide an API-backed implementation
 *     (requested in docs/release/handoff-B2.md §6). Nothing else in the pages changes.
 *   - without a provider, demo mode (`useSession().mode === 'demo'`) gets a deterministic in-memory
 *     sample derived from the demo snapshot, so the screens can be explored without Jira;
 *   - otherwise only `snapshot.delivery` is used and the remaining tabs show their "not set up" states.
 *
 * No network calls are made here.
 */
import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import type * as D from '../../../shared/contracts/dto';
import { useQuarters, useSession, useWorkspace, ApiRequestError, type QuarterView } from '../../../state';
import { buildAllocationGrid } from '../../../utils/viewModels';
import { DEFAULT_THRESHOLDS } from '../../../shared/utilisation';

export interface PlanviewApplyResult {
  created: number;
  updated: number;
  skipped: number;
}
export interface PlanviewFieldTest {
  source: unknown;
  fields: Array<{
    entity: 'project' | 'assignment';
    field: string;
    path: string;
    value: string | null;
    required: boolean;
  }>;
}

export interface DeliverySource {
  provider: 'api' | 'demo' | 'none';
  configured: { jira: boolean; planview: boolean };
  health: D.SyncHealthDTO | null;
  byProjectQbr1: D.DeliverySummaryDTO['byProjectQbr1'];
  mappings: D.JiraProjectMappingDTO[];
  identities: D.IdentityMappingDTO[];
  calibrations: D.TribeCalibrationDTO[];
  /** DeliveryRowDTO grouped by sprint (all tribes, newest last). */
  sprintRows: D.DeliveryRowDTO[];
  /** DeliveryRowDTO grouped by tribe × quarter. */
  quarterRows: D.DeliveryRowDTO[];
  syncNow(): Promise<D.SyncJobDTO>;
  stepJob(jobId: D.ID): Promise<D.SyncJobDTO>;
  autoMatch(): Promise<void>;
  saveProjectMappings(rows: D.JiraProjectMappingDTO[]): Promise<void>;
  savePeopleMappings(rows: D.IdentityMappingDTO[]): Promise<void>;
  saveCalibration(tribeId: D.ID, pointsPerSprintPerFte: number, note: string): Promise<void>;
  planviewPreview(): Promise<D.PlanviewPreviewDTO>;
  planviewApply(
    previewId: D.ID,
    accept: { projects: string[]; assignments: string[]; personMatches: Record<string, D.ID> },
  ): Promise<PlanviewApplyResult>;
  planviewTestMapping(): Promise<PlanviewFieldTest>;
}

const DeliverySourceContext = createContext<DeliverySource | null>(null);
export function DeliverySourceProvider({ value, children }: { value: DeliverySource; children: ReactNode }) {
  return <DeliverySourceContext.Provider value={value}>{children}</DeliverySourceContext.Provider>;
}

const unavailable = () =>
  Promise.reject(new ApiRequestError(503, 'server_error', 'Delivery data is not available in this build yet.'));

function snapshotOnly(s: D.WorkspaceSnapshot | null): DeliverySource {
  const health = s?.delivery?.health ?? null;
  return {
    provider: 'none',
    configured: { jira: !!health?.configured, planview: false },
    health,
    byProjectQbr1: s?.delivery?.byProjectQbr1 ?? [],
    mappings: [],
    identities: [],
    calibrations: [],
    sprintRows: [],
    quarterRows: [],
    syncNow: unavailable,
    stepJob: unavailable,
    autoMatch: unavailable,
    saveProjectMappings: unavailable,
    savePeopleMappings: unavailable,
    saveCalibration: unavailable,
    planviewPreview: unavailable,
    planviewApply: unavailable,
    planviewTestMapping: unavailable,
  };
}

/** The delivery source for the current page (provider → demo sample → snapshot only). */
export function useDelivery(s: D.WorkspaceSnapshot | null): DeliverySource {
  const ctx = useContext(DeliverySourceContext);
  const { mode } = useSession();
  const quarters = useQuarters();
  const { workspace } = useWorkspace();
  const demoState = useSyncExternalStore(subscribe, getDemo, getDemo);
  const useDemo = !ctx && mode === 'demo' && !!s;
  return useMemo(() => {
    if (ctx) return ctx;
    if (!useDemo || !s) return snapshotOnly(s);
    const st = demoState ?? initDemo(s, quarters);
    return demoSource(st, s, quarters, workspace?.permissions ?? []);
  }, [ctx, useDemo, s, demoState, quarters, workspace]);
}

/* ── demo sample (deterministic, in memory) ──────────────────────────────────────── */

interface DemoState {
  health: D.SyncHealthDTO;
  mappings: D.JiraProjectMappingDTO[];
  identities: D.IdentityMappingDTO[];
  calibrations: D.TribeCalibrationDTO[];
  sprintRows: D.DeliveryRowDTO[];
  planviewApplied: boolean;
}
let demo: DemoState | null = null;
const listeners = new Set<() => void>();
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
function getDemo() {
  return demo;
}
function setDemo(next: DemoState) {
  demo = next;
  listeners.forEach((l) => l());
}

/** Small deterministic hash → [0, 1). */
function rand(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
const r1 = (n: number) => Math.round(n * 10) / 10;

function quarterKeyOf(isoDate: string): string {
  const [y, m] = isoDate.split('-').map(Number);
  return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
}

function initDemo(s: D.WorkspaceSnapshot, quarters: QuarterView[]): DemoState {
  const now = new Date(s.serverTime);
  const jiraProjects = s.projects.filter((p) => p.jiraKey);
  const mappings: D.JiraProjectMappingDTO[] = [
    ...jiraProjects.map((p, i) => ({
      jiraKey: p.jiraKey ?? '',
      jiraName: p.name,
      boardIds: [100 + i],
      projectId: p.id,
      tribeId: p.tribeId,
      matchMethod: 'key' as const,
      confirmed: i < jiraProjects.length - 1,
    })),
    {
      jiraKey: 'NEB',
      jiraName: 'Nebula Data Platform',
      boardIds: [140],
      projectId: null,
      tribeId: null,
      matchMethod: 'none',
      confirmed: false,
    },
    {
      jiraKey: 'OPSX',
      jiraName: 'Ops Excellence',
      boardIds: [141],
      projectId: null,
      tribeId: null,
      matchMethod: 'none',
      confirmed: false,
    },
  ];
  const identities: D.IdentityMappingDTO[] = s.people.slice(0, 7).map((p, i) => ({
    provider: 'jira' as const,
    externalId: `5b10a2844c20165700ed${String(1000 + i)}`,
    displayName: p.name,
    email: i % 3 === 2 ? null : p.email,
    personId: i === 4 ? null : p.id,
    matchMethod: (i === 4
      ? 'none'
      : i % 3 === 2
        ? 'name'
        : i % 2
          ? 'email'
          : 'accountId') as D.IdentityMappingDTO['matchMethod'],
    confirmed: i < 3,
    lastSeenAt: addDays(now, -i).toISOString(),
  }));
  identities.push({
    provider: 'jira',
    externalId: '5b10a2844c20165700ed9999',
    displayName: 'Contractor (Acme)',
    email: null,
    personId: null,
    matchMethod: 'none',
    confirmed: false,
    lastSeenAt: addDays(now, -2).toISOString(),
  });
  const tribesWithJira = new Set(mappings.filter((m) => m.tribeId).map((m) => m.tribeId as string));
  const calibrations: D.TribeCalibrationDTO[] = s.tribes.map((t, i) => {
    const has = tribesWithJira.has(t.id);
    const current = has ? [9, 11, 10, 8][i % 4] : 10;
    return {
      version: 1,
      updatedAt: addDays(now, -20 - i * 7).toISOString(),
      updatedBy: has ? { id: 'u-analyst', name: 'Priya Nair' } : null,
      tribeId: t.id,
      pointsPerSprintPerFte: current,
      sprintLengthDays: 14,
      isDefault: !has,
      suggestedValue: has ? Math.round((current + (rand(t.id) - 0.4) * 4) * 2) / 2 : null,
      suggestedBasis: has
        ? {
            sprintNames: ['Sprint 41', 'Sprint 42', 'Sprint 43'],
            points: Math.round(60 + rand(t.name) * 60),
            fte: r1(2 + rand(t.id + 'f') * 2.5),
          }
        : null,
      note: has ? 'Re-checked at the Q3 QBR.' : null,
    };
  });

  // Last 6 closed sprints + the active one, per mapped tribe (two-week cadence, ending before "now").
  const planned = plannedFteByTribe(s, quarters);
  const sprintRows: D.DeliveryRowDTO[] = [];
  for (const tribeId of tribesWithJira) {
    const cal = calibrations.find((c) => c.tribeId === tribeId);
    const ppf = cal?.pointsPerSprintPerFte ?? 10;
    const plannedFte = planned.get(tribeId) ?? 1;
    for (let k = 6; k >= 0; k--) {
      const start = addDays(now, -14 * k - 10);
      const end = addDays(start, 13);
      const n = 44 - k;
      const seed = `${tribeId}-${n}`;
      const committed = Math.round(plannedFte * ppf * (0.95 + rand(seed) * 0.35));
      const active = k === 0;
      const done = active ? Math.round(committed * 0.45) : Math.round(committed * (0.7 + rand(seed + 'd') * 0.3));
      sprintRows.push({
        key: `${tribeId}:${n}`,
        label: `Sprint ${n}`,
        tribeId,
        projectId: null,
        sprintId: String(n),
        sprintName: `Sprint ${n}`,
        quarterKey: quarterKeyOf(iso(start)),
        from: iso(start),
        to: iso(end),
        pointsTotal: committed,
        pointsDone: done,
        issuesDone: Math.round(done / 3),
        impliedFte: r1(done / ppf),
        plannedFte: r1(plannedFte),
      });
    }
  }

  const jobs: D.SyncJobDTO[] = Array.from({ length: 10 }, (_, i) => {
    const started = addDays(now, -i);
    started.setUTCHours(5, 0, 12, 0);
    const failed = i === 3;
    const partial = i === 6;
    return {
      id: `job-${10 - i}`,
      provider: 'jira',
      trigger: i === 1 ? 'manual' : 'schedule',
      status: failed ? 'failed' : partial ? 'partial' : 'succeeded',
      pagesDone: failed ? 2 : 14 + (i % 3),
      issuesSeen: failed ? 180 : 1310 + i * 7,
      error: failed
        ? 'Jira rejected the credentials (401). Ask a PMO Admin to update the API token.'
        : partial
          ? 'Rate limited by Jira; resumed on the next run.'
          : null,
      rateLimitedUntil: null,
      startedAt: started.toISOString(),
      finishedAt: new Date(started.getTime() + (failed ? 4000 : 38000 + i * 900)).toISOString(),
      requestedBy: i === 1 ? { id: 'u-analyst', name: 'Priya Nair' } : null,
    };
  });
  const lastOk = jobs.find((j) => j.status === 'succeeded') ?? null;
  return {
    health: {
      provider: 'jira',
      configured: true,
      state: 'ok',
      lastSuccessAt: lastOk?.finishedAt ?? null,
      lastJob: jobs[0],
      recentJobs: jobs,
    },
    mappings,
    identities,
    calibrations,
    sprintRows,
    planviewApplied: false,
  };
}

/** Planned FTE per tribe in QBR1 (Σ project-pivot booking % ÷ 100 for the tribe's projects). */
function plannedFteByTribe(s: D.WorkspaceSnapshot, quarters: QuarterView[]): Map<D.ID, number> {
  const grid = buildAllocationGrid(s, quarters, {
    groupBy: 'tribe',
    pivot: 'project',
    includeTentative: false,
    thresholds: DEFAULT_THRESHOLDS,
  });
  const out = new Map<D.ID, number>();
  for (const g of grid.groups) out.set(g.id, (g.totals[0]?.pct ?? 0) / 100);
  return out;
}

function demoSource(st: DemoState, s: D.WorkspaceSnapshot, quarters: QuarterView[], perms: string[]): DeliverySource {
  const can = (p: string) => perms.includes(p);
  const guard = (p: string) => {
    if (!can(p)) throw new ApiRequestError(403, 'forbidden', 'You do not have permission to do that.');
  };
  const confirmedProjects = new Map(
    st.mappings.filter((m) => m.confirmed && m.projectId).map((m) => [m.projectId as string, m]),
  );
  // Planned vs implied FTE per mapped project in QBR1, from the latest three sprints of its tribe.
  const plannedGrid = buildAllocationGrid(s, quarters, {
    groupBy: 'none',
    pivot: 'project',
    includeTentative: false,
    thresholds: DEFAULT_THRESHOLDS,
  });
  const byProjectQbr1 = [...confirmedProjects.keys()].map((projectId) => {
    const row = plannedGrid.groups
      .flatMap((g) => g.rows)
      .find((r) => r.kind === 'project' && r.projectId === projectId);
    const plannedFte = r1((row?.cells[0]?.pct ?? 0) / 100);
    const k = rand(projectId);
    const impliedFte = r1(plannedFte * (k < 0.33 ? 1.35 : k < 0.66 ? 0.95 : 0.65));
    return { projectId, plannedFte, impliedFte };
  });
  const quarterRows: D.DeliveryRowDTO[] = [];
  const byTribeQuarter = new Map<string, D.DeliveryRowDTO[]>();
  for (const r of st.sprintRows) {
    const k = `${r.tribeId}|${r.quarterKey}`;
    byTribeQuarter.set(k, [...(byTribeQuarter.get(k) ?? []), r]);
  }
  for (const [k, rows] of byTribeQuarter) {
    const [tribeId, quarterKey] = k.split('|');
    quarterRows.push({
      key: k,
      label: quarterKey,
      tribeId,
      projectId: null,
      sprintId: null,
      sprintName: null,
      quarterKey,
      from: rows[0].from,
      to: rows[rows.length - 1].to,
      pointsTotal: rows.reduce((x, r) => x + r.pointsTotal, 0),
      pointsDone: rows.reduce((x, r) => x + r.pointsDone, 0),
      issuesDone: rows.reduce((x, r) => x + r.issuesDone, 0),
      impliedFte: r1(rows.reduce((x, r) => x + r.impliedFte, 0) / rows.length),
      plannedFte: r1(rows.reduce((x, r) => x + r.plannedFte, 0) / rows.length),
    });
  }
  const pvPreview: D.PlanviewPreviewDTO = {
    previewId: 'pv-preview-demo',
    expiresAt: new Date(new Date(s.serverTime).getTime() + 30 * 60000).toISOString(),
    partial: false,
    projects: st.planviewApplied
      ? { new: [], changed: [], removed: [] }
      : {
          new: [
            {
              externalId: 'PV-1042',
              name: 'Customer Portal Refresh',
              projectId: null,
              changes: [{ field: 'Start date', from: null, to: '2027-02-01' }],
            },
            {
              externalId: 'PV-1043',
              name: 'Branch Network Consolidation',
              projectId: null,
              changes: [{ field: 'Start date', from: null, to: '2027-04-05' }],
            },
          ],
          changed: [
            {
              externalId: 'PV-2001',
              name: s.projects[1]?.name ?? 'Skyline API',
              projectId: s.projects[1]?.id ?? null,
              changes: [
                { field: 'End date', from: s.projects[1]?.endDate ?? null, to: '2027-05-31' },
                { field: 'Status', from: 'Active', to: 'Active' },
              ].filter((c) => c.from !== c.to),
            },
          ],
          removed: [{ externalId: 'PV-0999', name: 'Legacy CRM Sunset', projectId: null, changes: [] }],
        },
    assignments: st.planviewApplied
      ? { new: [], changed: [], removed: [], unmatchedPeople: [] }
      : {
          new: [
            {
              externalId: 'PVA-77',
              projectExternalId: 'PV-1042',
              personExternalId: 'PVP-3',
              personName: s.people[2]?.name ?? 'Agnese Markusevska',
              projectId: null,
              personId: s.people[2]?.id ?? null,
              changes: [{ field: 'Allocation', from: null, to: '40% · 1 Feb – 30 Jun 2027' }],
            },
            {
              externalId: 'PVA-78',
              projectExternalId: 'PV-1042',
              personExternalId: 'PVP-91',
              personName: 'Sam Whelan',
              projectId: null,
              personId: null,
              changes: [{ field: 'Allocation', from: null, to: '50% · 1 Feb – 30 Jun 2027' }],
            },
          ],
          changed: [
            {
              externalId: 'PVA-12',
              projectExternalId: 'PV-2001',
              personExternalId: 'PVP-1',
              personName: s.people[0]?.name ?? 'Tom Hayes',
              projectId: s.projects[1]?.id ?? null,
              personId: s.people[0]?.id ?? null,
              changes: [{ field: 'Percent', from: '25%', to: '30%' }],
            },
          ],
          removed: [],
          unmatchedPeople: [
            { externalId: 'PVP-91', name: 'Sam Whelan', email: 'sam.whelan@example.com', suggestedPersonId: null },
          ],
        },
  };
  return {
    provider: 'demo',
    configured: { jira: true, planview: true },
    health: st.health,
    byProjectQbr1,
    mappings: st.mappings,
    identities: st.identities,
    calibrations: st.calibrations,
    sprintRows: st.sprintRows,
    quarterRows,
    async syncNow() {
      guard('integrations.run');
      const running = st.health.recentJobs.find((j) => j.status === 'running' || j.status === 'queued');
      if (running) return running;
      const job: D.SyncJobDTO = {
        id: `job-${Date.now()}`,
        provider: 'jira',
        trigger: 'manual',
        status: 'running',
        pagesDone: 0,
        issuesSeen: 0,
        error: null,
        rateLimitedUntil: null,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        requestedBy: { id: 'demo-user', name: 'Demo User' },
      };
      setDemo({
        ...st,
        health: {
          ...st.health,
          state: 'running',
          lastJob: job,
          recentJobs: [job, ...st.health.recentJobs].slice(0, 10),
        },
      });
      return job;
    },
    async stepJob(jobId) {
      const cur = getDemo() ?? st;
      const job = cur.health.recentJobs.find((j) => j.id === jobId);
      if (!job) throw new ApiRequestError(404, 'not_found', 'Sync job not found.');
      const pagesDone = job.pagesDone + 5;
      const done = pagesDone >= 15;
      const next: D.SyncJobDTO = {
        ...job,
        pagesDone,
        issuesSeen: job.issuesSeen + 460,
        status: done ? 'succeeded' : 'running',
        finishedAt: done ? new Date().toISOString() : null,
      };
      setDemo({
        ...cur,
        health: {
          ...cur.health,
          state: done ? 'ok' : 'running',
          lastSuccessAt: done ? next.finishedAt : cur.health.lastSuccessAt,
          lastJob: next,
          recentJobs: cur.health.recentJobs.map((j) => (j.id === jobId ? next : j)),
        },
      });
      return next;
    },
    async autoMatch() {
      guard('integrations.run');
      const cur = getDemo() ?? st;
      const byName = new Map(s.projects.map((p) => [p.name.toLowerCase(), p]));
      const byKey = new Map(s.projects.filter((p) => p.jiraKey).map((p) => [p.jiraKey?.toLowerCase(), p]));
      setDemo({
        ...cur,
        mappings: cur.mappings.map((m) => {
          if (m.confirmed) return m;
          const k = byKey.get(m.jiraKey.toLowerCase());
          if (k) return { ...m, projectId: k.id, tribeId: k.tribeId, matchMethod: 'key' };
          const fuzzy = [...byName.values()].find((p) =>
            m.jiraName.toLowerCase().startsWith(p.name.toLowerCase().split(' ')[0]),
          );
          const n = byName.get(m.jiraName.toLowerCase()) ?? fuzzy;
          if (n) return { ...m, projectId: n.id, tribeId: n.tribeId, matchMethod: 'name' };
          return m;
        }),
      });
    },
    async saveProjectMappings(rows) {
      guard('integrations.run');
      const cur = getDemo() ?? st;
      const map = new Map(rows.map((r) => [r.jiraKey, r]));
      setDemo({ ...cur, mappings: cur.mappings.map((m) => map.get(m.jiraKey) ?? m) });
    },
    async savePeopleMappings(rows) {
      guard('integrations.run');
      const cur = getDemo() ?? st;
      const map = new Map(rows.map((r) => [r.externalId, r]));
      setDemo({ ...cur, identities: cur.identities.map((m) => map.get(m.externalId) ?? m) });
    },
    async saveCalibration(tribeId, value, note) {
      guard('integrations.run');
      const cur = getDemo() ?? st;
      setDemo({
        ...cur,
        calibrations: cur.calibrations.map((c) =>
          c.tribeId === tribeId
            ? {
                ...c,
                pointsPerSprintPerFte: value,
                isDefault: false,
                note,
                version: c.version + 1,
                updatedAt: new Date().toISOString(),
                updatedBy: { id: 'demo-user', name: 'Demo User' },
              }
            : c,
        ),
      });
    },
    async planviewPreview() {
      guard('integrations.run');
      return pvPreview;
    },
    async planviewApply(_previewId, accept) {
      guard('integrations.run');
      const cur = getDemo() ?? st;
      setDemo({ ...cur, planviewApplied: true });
      const created =
        accept.projects.filter((id) => id.startsWith('PV-10')).length +
        accept.assignments.filter((id) => id === 'PVA-77' || id === 'PVA-78').length;
      const updated = accept.projects.length + accept.assignments.length - created;
      return { created, updated, skipped: 0 };
    },
    async planviewTestMapping() {
      guard('integrations.run');
      return {
        source: {
          project: {
            Id: 'PV-1042',
            Name: 'Customer Portal Refresh',
            State: { Name: 'Active' },
            StartDate: '2027-02-01',
            DueDate: null,
            Manager: { DisplayName: 'Aoife Byrne' },
          },
          assignment: {
            Id: 'PVA-77',
            Work: { Id: 'PV-1042' },
            Resource: { Name: 'Agnese Markusevska', Email: 'agnese@example.com' },
            Allocation: 0.4,
            Start: '2027-02-01',
            End: '2027-06-30',
          },
        },
        fields: [
          { entity: 'project', field: 'Project id', path: 'Id', value: 'PV-1042', required: true },
          { entity: 'project', field: 'Name', path: 'Name', value: 'Customer Portal Refresh', required: true },
          { entity: 'project', field: 'Status', path: 'State.Name', value: 'Active', required: false },
          { entity: 'project', field: 'Start', path: 'StartDate', value: '2027-02-01', required: true },
          { entity: 'project', field: 'End', path: 'DueDate', value: null, required: true },
          { entity: 'project', field: 'Manager', path: 'Manager.DisplayName', value: 'Aoife Byrne', required: false },
          { entity: 'assignment', field: 'Assignment id', path: 'Id', value: 'PVA-77', required: true },
          { entity: 'assignment', field: 'Project id', path: 'Work.Id', value: 'PV-1042', required: true },
          {
            entity: 'assignment',
            field: 'Person name',
            path: 'Resource.Name',
            value: 'Agnese Markusevska',
            required: true,
          },
          {
            entity: 'assignment',
            field: 'Email',
            path: 'Resource.Email',
            value: 'agnese@example.com',
            required: false,
          },
          { entity: 'assignment', field: 'Percent', path: 'Allocation', value: '0.4', required: true },
          { entity: 'assignment', field: 'Start', path: 'Start', value: '2027-02-01', required: true },
          { entity: 'assignment', field: 'End', path: 'End', value: '2027-06-30', required: true },
        ],
      };
    },
  };
}

/** Delivery signal wording (JI-06#AC1): implied > planned × 1.2 → more; < × 0.8 → less; else in line. */
export function deliverySignal(
  plannedFte: number,
  impliedFte: number,
): { kind: 'more' | 'less' | 'inline'; label: string } {
  if (plannedFte <= 0 && impliedFte <= 0) return { kind: 'inline', label: 'In line' };
  if (impliedFte > plannedFte * 1.2) return { kind: 'more', label: 'Jira shows more effort than planned' };
  if (impliedFte < plannedFte * 0.8) return { kind: 'less', label: 'Jira shows less effort than planned' };
  return { kind: 'inline', label: 'In line' };
}
