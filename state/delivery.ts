/**
 * Delivery data for the Jira & Planview pages (JI-02…JI-07, PV-01/02) and the delivery signal (JI-06).
 * Additive to §4.3, requested by B2: `useDelivery(s)` returns exactly B2's interim `DeliverySource`
 * (`pages/delivery/_parts/deliverySource.tsx`), backed by the §4.3 routes on either transport —
 * DemoTransport serves its seeded mappings, calibrations, sync jobs, delivery rows and Planview source.
 *
 * One cache per runtime and workspace, so every page shares the loaded lists. Each list loads only when
 * the member may read it (`integrations.view` for mappings, calibration and the Planview config;
 * `data.read` for health and delivery rows); the rest stay empty.
 */
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type * as D from '../shared/contracts/dto';
import { ApiRequestError } from '../services/api/errors';
import { deliverySignal } from '../utils/viewModels/delivery';
import type { DataRuntime } from './runtime';
import { useRuntime } from './session';

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
  /** DeliveryRowDTO per tribe × sprint (all tribes, oldest first). */
  sprintRows: D.DeliveryRowDTO[];
  /** DeliveryRowDTO per tribe × quarter. */
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

interface DeliveryCache {
  wsId: D.ID;
  loaded: boolean;
  health: D.SyncHealthDTO | null;
  planviewConfigured: boolean;
  mappings: D.JiraProjectMappingDTO[];
  identities: D.IdentityMappingDTO[];
  calibrations: D.TribeCalibrationDTO[];
  sprintRows: D.DeliveryRowDTO[];
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const isLive = (j: D.SyncJobDTO) => j.status === 'queued' || j.status === 'running';

/** Tribe × sprint rows → tribe × quarter rows (sums of points; mean FTE across the quarter's sprints). */
export function quarterRowsOf(sprintRows: D.DeliveryRowDTO[]): D.DeliveryRowDTO[] {
  const groups = new Map<string, D.DeliveryRowDTO[]>();
  for (const r of sprintRows) {
    if (!r.quarterKey) continue;
    const k = `${r.tribeId ?? ''}|${r.quarterKey}`;
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  const out: D.DeliveryRowDTO[] = [];
  for (const [k, rows] of groups) {
    const sorted = [...rows].sort((a, b) => a.from.localeCompare(b.from));
    const quarterKey = sorted[0].quarterKey as D.QuarterKey;
    out.push({
      key: k,
      label: quarterKey,
      tribeId: sorted[0].tribeId,
      projectId: null,
      sprintId: null,
      sprintName: null,
      quarterKey,
      from: sorted[0].from,
      to: sorted[sorted.length - 1].to,
      pointsTotal: sorted.reduce((x, r) => x + r.pointsTotal, 0),
      pointsDone: sorted.reduce((x, r) => x + r.pointsDone, 0),
      issuesDone: sorted.reduce((x, r) => x + r.issuesDone, 0),
      impliedFte: r1(sorted.reduce((x, r) => x + r.impliedFte, 0) / sorted.length),
      plannedFte: r1(sorted.reduce((x, r) => x + r.plannedFte, 0) / sorted.length),
    });
  }
  return out.sort((a, b) => (a.tribeId ?? '').localeCompare(b.tribeId ?? '') || a.from.localeCompare(b.from));
}

const PV_FIELDS: Record<string, { field: string; required: boolean }> = {
  'project.id': { field: 'Project id', required: true },
  'project.name': { field: 'Name', required: true },
  'project.status': { field: 'Status', required: false },
  'project.start': { field: 'Start', required: true },
  'project.end': { field: 'End', required: true },
  'project.manager': { field: 'Manager', required: false },
  'assignment.id': { field: 'Assignment id', required: true },
  'assignment.project': { field: 'Project id', required: true },
  'assignment.person': { field: 'Person name', required: true },
  'assignment.email': { field: 'Email', required: false },
  'assignment.percent': { field: 'Percent', required: true },
  'assignment.start': { field: 'Start', required: true },
  'assignment.end': { field: 'End', required: true },
};

/** `POST …/planview/test-mapping` (`{source, mapped, missing}`) → B2's field table. */
export function planviewFieldTest(r: {
  source: unknown;
  mapped: Record<string, unknown>;
  missing: string[];
}): PlanviewFieldTest {
  const keys = [...Object.keys(r.mapped), ...r.missing.filter((k) => !(k in r.mapped))];
  return {
    source: r.source,
    fields: keys.map((path) => {
      const entity: 'project' | 'assignment' = path.startsWith('assignment.') ? 'assignment' : 'project';
      const known = PV_FIELDS[path];
      const raw = r.mapped[path];
      const name = path.slice(path.indexOf('.') + 1);
      return {
        entity,
        field: known?.field ?? name.charAt(0).toUpperCase() + name.slice(1),
        path,
        value: raw === undefined || raw === null || r.missing.includes(path) ? null : String(raw),
        required: known?.required ?? false,
      };
    }),
  };
}

class DeliveryStore {
  private state: DeliveryCache | null = null;
  private loading: Promise<void> | null = null;
  private readonly listeners = new Set<() => void>();
  constructor(private readonly rt: DataRuntime) {}

  getState = (): DeliveryCache | null => this.state;
  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  private set(patch: Partial<DeliveryCache>): void {
    if (!this.state) return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  private perms(): Set<string> {
    return new Set(this.rt.activeMeWorkspace()?.permissions ?? []);
  }

  private ws(): D.ID {
    const ws = this.rt.getState().activeWorkspaceId;
    if (!ws) throw new ApiRequestError(409, 'conflict', 'Open a workspace first.');
    return ws;
  }

  /** Loads (or reloads) every list the member may read for the active workspace. */
  ensure(wsId: D.ID, force = false): Promise<void> {
    if (!force && this.state?.wsId === wsId && (this.state.loaded || this.loading))
      return this.loading ?? Promise.resolve();
    if (this.state?.wsId !== wsId)
      this.state = {
        wsId,
        loaded: false,
        health: null,
        planviewConfigured: false,
        mappings: [],
        identities: [],
        calibrations: [],
        sprintRows: [],
      };
    const api = this.rt.api;
    const perms = this.perms();
    const soft = <T>(p: Promise<T>, fallback: T) => p.catch(() => fallback);
    const canView = perms.has('integrations.view');
    const run = Promise.all([
      soft(api.sync.health(wsId), null),
      canView
        ? soft(api.jira.mappings(wsId), { projects: [], people: [] })
        : Promise.resolve({ projects: [], people: [] }),
      canView ? soft(api.calibration.list(wsId), []) : Promise.resolve([]),
      soft(api.delivery.rows(wsId, { groupBy: 'tribe' }), []),
      canView
        ? soft(
            api.integrationSettings.config(wsId).then((c) => c.planview.configured),
            false,
          )
        : Promise.resolve(false),
    ]).then(([health, maps, calibrations, rows, planviewConfigured]) => {
      if (this.state?.wsId !== wsId) return;
      this.set({
        loaded: true,
        health,
        mappings: maps.projects,
        identities: maps.people,
        calibrations,
        sprintRows: [...rows].sort(
          (a, b) => a.from.localeCompare(b.from) || (a.tribeId ?? '').localeCompare(b.tribeId ?? ''),
        ),
        planviewConfigured,
      });
    });
    this.loading = run.finally(() => {
      if (this.loading === tracked) this.loading = null;
    });
    const tracked = this.loading;
    return tracked;
  }

  private noteJob(job: D.SyncJobDTO): void {
    const h = this.state?.health;
    if (!h) return;
    const recent = h.recentJobs.some((j) => j.id === job.id)
      ? h.recentJobs.map((j) => (j.id === job.id ? job : j))
      : [job, ...h.recentJobs].slice(0, 10);
    const done = job.status === 'succeeded' || job.status === 'partial';
    this.set({
      health: {
        ...h,
        state: isLive(job) ? 'running' : job.status === 'failed' ? 'failed' : 'ok',
        lastJob: job,
        lastSuccessAt: done ? (job.finishedAt ?? h.lastSuccessAt) : h.lastSuccessAt,
        recentJobs: recent,
      },
    });
  }

  private async afterDataChange(): Promise<void> {
    const ws = this.ws();
    await Promise.all([this.ensure(ws, true), this.rt.loadSnapshot()]);
  }

  source(s: D.WorkspaceSnapshot, c: DeliveryCache | null): DeliverySource {
    const api = this.rt.api;
    const health = c?.health ?? s.delivery?.health ?? null;
    const sprintRows = c?.sprintRows ?? [];
    return {
      provider: this.rt.transport.kind === 'demo' ? 'demo' : 'api',
      configured: { jira: !!health?.configured, planview: !!c?.planviewConfigured },
      health,
      byProjectQbr1: s.delivery?.byProjectQbr1 ?? [],
      mappings: c?.mappings ?? [],
      identities: c?.identities ?? [],
      calibrations: c?.calibrations ?? [],
      sprintRows,
      quarterRows: quarterRowsOf(sprintRows),
      syncNow: async () => {
        const { job } = await api.sync.startJira(this.ws());
        this.noteJob(job);
        return job;
      },
      stepJob: async (jobId) => {
        const { job } = await api.sync.step(this.ws(), jobId);
        this.noteJob(job);
        if (job.status === 'succeeded' || job.status === 'partial') await this.afterDataChange();
        return job;
      },
      autoMatch: async () => {
        const res = await api.jira.autoMatch(this.ws());
        this.set({ mappings: res.projects, identities: res.people });
      },
      saveProjectMappings: async (rows) => {
        const res = await api.jira.saveProjectMappings(this.ws(), rows);
        this.set({ mappings: res.projects, identities: res.people });
        await this.rt.loadSnapshot();
      },
      savePeopleMappings: async (rows) => {
        const res = await api.jira.savePeopleMappings(this.ws(), rows);
        this.set({ mappings: res.projects, identities: res.people });
      },
      saveCalibration: async (tribeId, pointsPerSprintPerFte, note) => {
        const ws = this.ws();
        const cur = this.state?.calibrations.find((x) => x.tribeId === tribeId);
        const saved = await api.calibration.save(ws, tribeId, {
          pointsPerSprintPerFte,
          sprintLengthDays: cur?.sprintLengthDays ?? 14,
          note,
          version: cur?.version ?? 0,
        });
        const list = this.state?.calibrations ?? [];
        this.set({
          calibrations: list.some((x) => x.tribeId === tribeId)
            ? list.map((x) => (x.tribeId === tribeId ? saved : x))
            : [...list, saved],
        });
        await this.afterDataChange();
      },
      planviewPreview: () => api.planview.preview(this.ws()),
      planviewApply: async (previewId, accept) => {
        const res = await api.planview.apply(this.ws(), {
          previewId,
          accept: { projects: accept.projects, assignments: accept.assignments },
          personMatches: accept.personMatches,
        });
        await this.rt.loadSnapshot();
        return res;
      },
      planviewTestMapping: async () => planviewFieldTest(await api.planview.testMapping(this.ws())),
    };
  }
}

const stores = new WeakMap<DataRuntime, DeliveryStore>();
export function deliveryStoreFor(rt: DataRuntime): DeliveryStore {
  let st = stores.get(rt);
  if (!st) {
    st = new DeliveryStore(rt);
    stores.set(rt, st);
  }
  return st;
}

const unavailable = () => Promise.reject(new ApiRequestError(409, 'conflict', 'Open a workspace first.'));

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

/**
 * The delivery source for the current page. Pass the snapshot from `useWorkspaceData()`; with no
 * snapshot (loading, no workspace) every list is empty and the actions reject.
 */
export function useDelivery(s: D.WorkspaceSnapshot | null): DeliverySource {
  const rt = useRuntime();
  const store = deliveryStoreFor(rt);
  const cache = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const wsId = s?.workspace.id ?? null;
  useEffect(() => {
    if (wsId) void store.ensure(wsId);
  }, [store, wsId]);
  return useMemo(() => {
    if (!s) return snapshotOnly(null);
    return store.source(s, cache?.wsId === s.workspace.id ? cache : null);
  }, [store, s, cache]);
}

/** B2's signal wording (JI-06#AC1) as `{kind, label}`, over the pure `deliverySignal` in utils/viewModels. */
export function deliverySignalOf(
  plannedFte: number,
  impliedFte: number,
): { kind: 'more' | 'less' | 'inline'; label: string } {
  const sig = deliverySignal(plannedFte, impliedFte);
  if (sig === 'more') return { kind: 'more', label: 'Jira shows more effort than planned' };
  if (sig === 'less') return { kind: 'less', label: 'Jira shows less effort than planned' };
  return { kind: 'inline', label: 'In line' };
}
