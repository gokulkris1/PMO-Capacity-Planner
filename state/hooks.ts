/**
 * The hooks of the client data layer (BACKLOG §4.3). Each reads the DataRuntime store with
 * `useSyncExternalStore` and returns a memoised object, so results are safe in dependency lists.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type * as D from '../shared/contracts/dto';
import type { Permission } from '../shared/permissions';
import { resolveFeatures, type FeatureFlag } from '../shared/features';
import { entitled, type EntitlementFeature, type Entitlements } from '../shared/entitlements';
import { DEFAULT_THRESHOLDS, type UtilisationThresholds } from '../shared/utilisation';
import type { ApiClient } from '../services/api/client';
import { ApiRequestError } from '../services/api/errors';
import { today } from '../utils/clock';
import { rollingQuarterViews } from '../utils/quarters';
import type { QuarterView } from '../utils/viewModels/types';
import { buildMutations, type Mutations } from './mutations';
import type { ConflictInfo, DataRuntime, MaintenanceState, RuntimeState, SessionNotice } from './runtime';
import { useRuntime } from './session';

function useRuntimeState(): [RuntimeState, DataRuntime] {
  const rt = useRuntime();
  const state = useSyncExternalStore(rt.subscribe, rt.getState, rt.getState);
  return [state, rt];
}

export function useSession(): {
  status: 'loading' | 'anonymous' | 'authenticated';
  me: D.MeResponse | null;
  mode: 'live' | 'demo';
  login(email: string, password: string, otp?: string): Promise<{ require2FA: boolean }>;
  logout(opts?: { everywhere?: boolean }): Promise<void>;
  refreshMe(): Promise<void>;
} {
  const [s, rt] = useRuntimeState();
  return useMemo(
    () => ({
      status: s.status,
      me: s.me,
      mode: s.mode,
      login: (email: string, password: string, otp?: string) => rt.login(email, password, otp),
      logout: (opts?: { everywhere?: boolean }) => rt.logout(opts),
      refreshMe: () => rt.refreshMe(),
    }),
    [s.status, s.me, s.mode, rt],
  );
}

export function useWorkspace(): {
  org: D.MeResponse['org'];
  workspace: D.MeWorkspace | null;
  workspaces: D.MeWorkspace[];
  can(p: Permission): boolean;
  isOwnPerson(personId: D.ID): boolean;
  thresholds: UtilisationThresholds;
  switchWorkspace(wsId: D.ID): void;
} {
  const [s, rt] = useRuntimeState();
  return useMemo(() => {
    const workspaces = s.me?.workspaces ?? [];
    const workspace = workspaces.find((w) => w.id === s.activeWorkspaceId) ?? null;
    const perms = new Set<Permission>(workspace?.permissions ?? []);
    if (s.me?.user.isPlatformAdmin) perms.add('platform.admin');
    return {
      org: s.me?.org ?? null,
      workspace,
      workspaces,
      can: (p: Permission) => perms.has(p),
      isOwnPerson: (personId: D.ID) => !!workspace?.linkedPersonId && workspace.linkedPersonId === personId,
      thresholds: s.me?.org?.planning.thresholds ?? s.snapshot?.org.planning.thresholds ?? DEFAULT_THRESHOLDS,
      switchWorkspace: (wsId: D.ID) => rt.switchWorkspace(wsId),
    };
  }, [s.me, s.activeWorkspaceId, s.snapshot?.org.planning.thresholds, rt]);
}

export function useFeature(flag: FeatureFlag): boolean {
  const [s] = useRuntimeState();
  return resolveFeatures(s.me?.org?.features)[flag];
}

/** Signed-out fallback: nothing is entitled. */
const FALLBACK_ENTITLEMENTS: Entitlements = {
  plan: 'BASIC',
  maxPeople: 0,
  maxProjects: 0,
  maxWorkspaces: 0,
  aiQueriesPerMonth: 0,
  scenarios: false,
  csvImport: false,
  csvExport: false,
  pdfExport: false,
  integrations: false,
  billingVisible: false,
};

export function useEntitlements(): Entitlements & { has(f: EntitlementFeature): boolean } {
  const [s] = useRuntimeState();
  return useMemo(() => {
    const e = s.me?.entitlements ?? FALLBACK_ENTITLEMENTS;
    return { ...e, has: (f: EntitlementFeature) => entitled(e, f) };
  }, [s.me]);
}

/** Four rolling quarters (QBR1 = the quarter containing today, `utils/clock`), fiscal labels applied (A-1). */
export function useQuarters(): QuarterView[] {
  const [s] = useRuntimeState();
  const fy = s.me?.org?.planning.fiscalYearStartMonth ?? s.snapshot?.org.planning.fiscalYearStartMonth ?? 1;
  const day = today();
  return useMemo(() => rollingQuarterViews(day, fy), [day, fy]);
}

export function useWorkspaceData(): {
  status: 'loading' | 'ready' | 'error';
  error: ApiRequestError | null;
  snapshot: D.WorkspaceSnapshot | null;
  reload(): Promise<void>;
} {
  const [s, rt] = useRuntimeState();
  const reload = useCallback(() => rt.loadSnapshot(), [rt]);
  const status: 'loading' | 'ready' | 'error' = s.dataStatus === 'error' ? 'error' : s.snapshot ? 'ready' : 'loading';
  return useMemo(
    () => ({ status, error: s.dataError, snapshot: s.snapshot, reload }),
    [status, s.dataError, s.snapshot, reload],
  );
}

/**
 * QA-011 / SH-07#AC4: why the app is not booting yet. `bootError` is set when `/me` failed with something other
 * than 401 (the app would otherwise sit on "Loading your workspace"); `maintenance` is set while the API answers
 * 503 and the runtime is retrying on its own. `retry()` tries again at once.
 */
export function useBootState(): {
  bootError: ApiRequestError | null;
  maintenance: MaintenanceState | null;
  retry(): Promise<void>;
} {
  const [s, rt] = useRuntimeState();
  const bootError = s.status === 'loading' && s.dataStatus === 'error' ? s.dataError : null;
  return useMemo(
    () => ({ bootError, maintenance: s.maintenance, retry: () => rt.retryNow() }),
    [bootError, s.maintenance, rt],
  );
}

export function useConflict(): {
  conflict: null | ConflictInfo;
  resolve(action: 'reload' | 'dismiss'): void;
} {
  const [s, rt] = useRuntimeState();
  return useMemo(
    () => ({ conflict: s.conflict, resolve: (action: 'reload' | 'dismiss') => rt.resolveConflict(action) }),
    [s.conflict, rt],
  );
}

export function useUndo(): { canUndo: boolean; label: string | null; undo(): Promise<void> } {
  const [s, rt] = useRuntimeState();
  return useMemo(() => {
    const top = s.undo[s.undo.length - 1];
    return { canUndo: !!top, label: top?.label ?? null, undo: () => rt.undo() };
  }, [s.undo, rt]);
}

const mutationsByRuntime = new WeakMap<DataRuntime, Mutations>();

/** One stable object per runtime (safe in effect dependency lists). */
export function useMutations(): Mutations {
  const rt = useRuntime();
  let m = mutationsByRuntime.get(rt);
  if (!m) {
    m = buildMutations(rt);
    mutationsByRuntime.set(rt, m);
  }
  return m;
}

/* ── additions to §4.3 (see handoff-C.md §3) ───────────────────────────────────── */

/**
 * Session-level messages B shows as a toast or on the sign-in page:
 * 'session-expired' and 'legacy-session-expired' ("Please sign in again.", AC-03#AC2),
 * 'permissions-changed' (AC-04#AC3), 'data-updated' ("Updated with the latest changes.", PL-06#AC3).
 */
export function useSessionNotice(): { notice: SessionNotice | null; dismiss(): void } {
  const [s, rt] = useRuntimeState();
  return useMemo(() => ({ notice: s.notice, dismiss: () => rt.dismissNotice() }), [s.notice, rt]);
}

/**
 * The typed API client for calls that are not snapshot mutations (auth pages, invitations, members,
 * workspaces, Jira mappings, calibration, delivery, Planview, AI, audit, sample data, export audit).
 * After calls that change the session or snapshot, call `refreshMe()` / `reload()`.
 */
export function useApi(): {
  api: ApiClient;
  orgId: D.ID | null;
  workspaceId: D.ID | null;
  reload(): Promise<void>;
  refreshMe(): Promise<void>;
} {
  const [s, rt] = useRuntimeState();
  const orgId = s.me?.org?.id ?? null;
  const workspaceId = s.activeWorkspaceId;
  return useMemo(
    () => ({ api: rt.api, orgId, workspaceId, reload: () => rt.loadSnapshot(), refreshMe: () => rt.refreshMe() }),
    [rt, orgId, workspaceId],
  );
}

/**
 * JI-01#AC4 "Sync now": starts (or joins) a Jira sync job and steps it while the component is
 * mounted (each step ≤ 8 s server-side). When the job finishes the snapshot is reloaded.
 */
export function useJiraSync(): {
  job: D.SyncJobDTO | null;
  running: boolean;
  error: ApiRequestError | null;
  start(): Promise<void>;
} {
  const rt = useRuntime();
  const [job, setJob] = useState<D.SyncJobDTO | null>(null);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const start = useCallback(async () => {
    const wsId = rt.getState().activeWorkspaceId;
    if (!wsId) return;
    setError(null);
    try {
      let { job: j } = await rt.api.sync.startJira(wsId);
      if (alive.current) setJob(j);
      while (alive.current && (j.status === 'queued' || j.status === 'running')) {
        const waitMs = j.rateLimitedUntil ? Math.max(0, Date.parse(j.rateLimitedUntil) - Date.now()) : 0;
        if (waitMs > 0) await new Promise((r) => setTimeout(r, Math.min(waitMs, 30_000)));
        ({ job: j } = await rt.api.sync.step(wsId, j.id));
        if (alive.current) setJob(j);
      }
      if (j.status === 'succeeded' || j.status === 'partial') await rt.loadSnapshot();
    } catch (e) {
      if (alive.current)
        setError(e instanceof ApiRequestError ? e : new ApiRequestError(0, 'server_error', 'Something went wrong.'));
    }
  }, [rt]);
  const running = !!job && (job.status === 'queued' || job.status === 'running');
  return useMemo(() => ({ job, running, error, start }), [job, running, error, start]);
}
