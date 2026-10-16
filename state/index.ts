// state/index.ts — public surface of the client data layer (BACKLOG §4.3, frozen signatures).
//
// ┌───────────────────────────────────────────────────────────────────────────────────────┐
// │ WP-0 STUB. Every hook serves the v1.1 demo data (constants.ts) converted to DTOs, held  │
// │ in memory (`state/stub/**`); mutations apply locally and resolve. No network, no        │
// │ provider needed. Package C replaces the implementation (PL-05/PL-06) WITHOUT changing   │
// │ these exports. B must import only the names exported here.                             │
// │ Demo switches: ?demoRole=VIEWER|CONTRIBUTOR|PLANNER|WORKSPACE_ADMIN|ORG_ADMIN,          │
// │ ?demoPlatformAdmin=1, ?demoSignedOut=1 (see state/stub/store.ts).                       │
// └───────────────────────────────────────────────────────────────────────────────────────┘
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type * as D from '../shared/contracts/dto';
import type { Permission } from '../shared/permissions';
import { resolveFeatures, type FeatureFlag } from '../shared/features';
import { entitled, type Entitlements, type EntitlementFeature } from '../shared/entitlements';
import { DEFAULT_THRESHOLDS, type UtilisationThresholds } from '../shared/utilisation';
import type {
  AllocationOp,
  NewPerson,
  NewProject,
  NewDemandLine,
  PeopleBulkRequest,
  PeopleImportRequest,
  PeopleImportResponse,
  ProposeRequest,
  RespondRequest,
  InvitationRequest,
  InvitationResponse,
  MemberDTO,
  MemberPatch,
} from '../shared/contracts/api';
import { buildDemoMe } from './stub/demoData';
import { rollingQuarterViews } from './stub/quarters';
import { getState, setState, subscribe, type StubState } from './stub/store';
import { stubMutations } from './stub/mutations';

import { ApiRequestError } from './stub/errors';
import type { QuarterView } from '../utils/viewModels/types';

export { ApiRequestError };
export type { TimeBasis, QuarterView } from '../utils/viewModels/types';

function useStub(): StubState {
  return useSyncExternalStore(subscribe, getState, getState);
}

export function useSession(): {
  status: 'loading' | 'anonymous' | 'authenticated';
  me: D.MeResponse | null;
  mode: 'live' | 'demo';
  login(email: string, password: string, otp?: string): Promise<{ require2FA: boolean }>;
  logout(opts?: { everywhere?: boolean }): Promise<void>;
  refreshMe(): Promise<void>;
} {
  const s = useStub();
  return useMemo(
    () => ({
      status: s.status,
      me: s.me,
      mode: 'demo' as const,
      // STUB: any credentials sign in as the demo user with the current demo role.
      async login() {
        setState((st) => {
          const me = buildDemoMe(st.snapshot, st.role, st.isPlatformAdmin);
          return { ...st, status: 'authenticated', me, activeWorkspaceId: me.workspaces[0]?.id ?? null };
        });
        return { require2FA: false };
      },
      async logout() {
        setState((st) => ({ ...st, status: 'anonymous', me: null, activeWorkspaceId: null }));
      },
      async refreshMe() {
        /* STUB: nothing to refresh. */
      },
    }),
    [s.status, s.me],
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
  const s = useStub();
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
      thresholds: s.me?.org?.planning.thresholds ?? DEFAULT_THRESHOLDS,
      switchWorkspace: (wsId: D.ID) => setState((st) => ({ ...st, activeWorkspaceId: wsId })),
    };
  }, [s.me, s.activeWorkspaceId]);
}

export function useFeature(flag: FeatureFlag): boolean {
  const s = useStub();
  return resolveFeatures(s.me?.org?.features)[flag];
}

export function useEntitlements(): Entitlements & { has(f: EntitlementFeature): boolean } {
  const s = useStub();
  return useMemo(() => {
    const e = s.me?.entitlements ?? FALLBACK_ENTITLEMENTS;
    return { ...e, has: (f: EntitlementFeature) => entitled(e, f) };
  }, [s.me]);
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

export function useQuarters(): QuarterView[] {
  // 4 rolling quarters, fiscal labels applied
  const s = useStub();
  const fy = s.me?.org?.planning.fiscalYearStartMonth ?? s.snapshot.org.planning.fiscalYearStartMonth;
  // STUB: recomputed per day; C drives this from utils/clock.ts.
  const day = new Date().toDateString();
  return useMemo(() => rollingQuarterViews(new Date(day), fy), [day, fy]);
}

export function useWorkspaceData(): {
  status: 'loading' | 'ready' | 'error';
  error: ApiRequestError | null;
  snapshot: D.WorkspaceSnapshot | null;
  reload(): Promise<void>;
} {
  const s = useStub();
  const reload = useCallback(async () => {
    /* STUB: the in-memory snapshot is always current. */
  }, []);
  const snapshot = s.status === 'authenticated' ? s.snapshot : null;
  return useMemo(
    () => ({ status: snapshot ? ('ready' as const) : ('loading' as const), error: null, snapshot, reload }),
    [snapshot, reload],
  );
}

export function useConflict(): {
  conflict: null | { entity: string; name: string; changedBy: string; changedAt: string };
  resolve(action: 'reload' | 'dismiss'): void;
} {
  const s = useStub();
  return useMemo(
    () => ({ conflict: s.conflict, resolve: () => setState((st) => ({ ...st, conflict: null })) }),
    [s.conflict],
  );
}

export function useUndo(): { canUndo: boolean; label: string | null; undo(): Promise<void> } {
  const s = useStub();
  return useMemo(() => {
    const top = s.undo[s.undo.length - 1];
    return {
      canUndo: !!top,
      label: top?.label ?? null,
      async undo() {
        setState((st) => {
          const last = st.undo[st.undo.length - 1];
          return last ? { ...st, snapshot: last.snapshot, undo: st.undo.slice(0, -1) } : st;
        });
      },
    };
  }, [s.undo]);
}

export function useMutations(): {
  people: {
    create(p: NewPerson): Promise<D.PersonDTO>;
    update(id: D.ID, patch: Partial<D.PersonDTO>): Promise<D.PersonDTO>;
    remove(id: D.ID): Promise<void>;
    bulk(req: Omit<PeopleBulkRequest, 'versions'>): Promise<D.PersonDTO[]>;
    importRows(req: PeopleImportRequest): Promise<PeopleImportResponse>;
    requestCraftChange(personId: D.ID, crafts: D.SecondaryCraftDTO[]): Promise<D.CraftChangeRequestDTO>;
    decideCraftChange(id: D.ID, d: 'approve' | 'reject', reason?: string): Promise<D.CraftChangeRequestDTO>;
  };
  projects: {
    create(p: NewProject): Promise<D.ProjectDTO>;
    update(id: D.ID, patch: Partial<D.ProjectDTO>): Promise<D.ProjectDTO>;
    remove(id: D.ID): Promise<void>;
  };
  demand: {
    create(l: NewDemandLine): Promise<D.DemandLineDTO>;
    update(id: D.ID, patch: Partial<D.DemandLineDTO>): Promise<D.DemandLineDTO>;
    remove(id: D.ID): Promise<void>;
    copyForward(id: D.ID, toQuarterKeys: D.QuarterKey[]): Promise<void>;
  };
  allocations: {
    batch(ops: AllocationOp[], label: string): Promise<void>;
    setQuarterCell(a: {
      resourceId: D.ID;
      projectId: D.ID;
      craftId: D.ID | null;
      quarterKey: D.QuarterKey;
      pct: number;
    }): Promise<void>;
    copyForward(a: {
      resourceId: D.ID;
      projectId: D.ID;
      craftId: D.ID | null;
      fromQuarterKey: D.QuarterKey;
    }): Promise<void>;
    respond(id: D.ID, r: RespondRequest): Promise<void>;
  };
  marketplace: {
    propose(r: ProposeRequest): Promise<D.AllocationDTO>;
    setOffer(o: Omit<D.MarketplaceOfferDTO, 'createdBy' | 'createdAt'>): Promise<void>;
    withdrawOffer(personId: D.ID, quarterKey: D.QuarterKey): Promise<void>;
  };
  structure: {
    save(
      kind: 'tribes' | 'chapters' | 'teams' | 'crafts',
      entity: { id?: D.ID; version?: number } & Record<string, unknown>,
    ): Promise<void>;
    archive(kind: 'tribes' | 'chapters' | 'teams' | 'crafts', id: D.ID, archived: boolean): Promise<void>;
  };
  admin: {
    invite(r: InvitationRequest): Promise<InvitationResponse>;
    members(): Promise<MemberDTO[]>;
    updateMember(userId: D.ID, p: MemberPatch): Promise<void>;
    removeMember(userId: D.ID): Promise<void>;
    updateOrg(patch: Partial<D.OrgDTO>): Promise<void>;
  };
} {
  return stubMutations;
}
