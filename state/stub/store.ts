/**
 * WP-0 STUB: a tiny in-memory external store (no provider needed) holding the demo session,
 * the demo workspace snapshot and the undo stack. Nothing is persisted: a page reload resets
 * the demo data. C replaces this with `state/store.ts` (PL-06).
 *
 * Demo-only switches (read once from the URL on first load, browser only):
 *   ?demoRole=ORG_ADMIN|WORKSPACE_ADMIN|PLANNER|CONTRIBUTOR|VIEWER   (default ORG_ADMIN)
 *   ?demoPlatformAdmin=1                                             (adds platform.admin)
 *   ?demoSignedOut=1                                                 (start anonymous)
 */
import type * as D from '../../shared/contracts/dto';
import { buildDemoMe, buildDemoSnapshot, DEMO_ROLES, type DemoRole } from './demoData';

export interface UndoEntry {
  label: string;
  snapshot: D.WorkspaceSnapshot;
}

export interface StubState {
  status: 'loading' | 'anonymous' | 'authenticated';
  me: D.MeResponse | null;
  role: DemoRole;
  isPlatformAdmin: boolean;
  activeWorkspaceId: D.ID | null;
  snapshot: D.WorkspaceSnapshot;
  undo: UndoEntry[];
  conflict: null | { entity: string; name: string; changedBy: string; changedAt: string };
}

const UNDO_LIMIT = 20;

function readParams(): { role: DemoRole; isPlatformAdmin: boolean; signedOut: boolean } {
  let role: DemoRole = 'ORG_ADMIN';
  let isPlatformAdmin = false;
  let signedOut = false;
  try {
    if (typeof window !== 'undefined' && window.location) {
      const p = new URLSearchParams(window.location.search);
      const r = p.get('demoRole');
      if (r && (DEMO_ROLES as readonly string[]).includes(r)) role = r as DemoRole;
      isPlatformAdmin = p.get('demoPlatformAdmin') === '1';
      signedOut = p.get('demoSignedOut') === '1';
    }
  } catch {
    /* non-browser environment */
  }
  return { role, isPlatformAdmin, signedOut };
}

function initialState(): StubState {
  const { role, isPlatformAdmin, signedOut } = readParams();
  const snapshot = buildDemoSnapshot();
  const me = signedOut ? null : buildDemoMe(snapshot, role, isPlatformAdmin);
  return {
    status: signedOut ? 'anonymous' : 'authenticated',
    me,
    role,
    isPlatformAdmin,
    activeWorkspaceId: me?.workspaces[0]?.id ?? null,
    snapshot,
    undo: [],
    conflict: null,
  };
}

let state: StubState = initialState();
const listeners = new Set<() => void>();

export function getState(): StubState {
  return state;
}

export function setState(update: (s: StubState) => StubState): void {
  state = update(state);
  listeners.forEach((l) => l());
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Replaces the snapshot, bumps `dataVersion` and records an undo entry. */
export function commit(label: string, next: (s: D.WorkspaceSnapshot) => D.WorkspaceSnapshot): void {
  setState((s) => {
    const updated = next(s.snapshot);
    return {
      ...s,
      snapshot: {
        ...updated,
        workspace: { ...updated.workspace, dataVersion: s.snapshot.workspace.dataVersion + 1 },
        serverTime: new Date().toISOString(),
      },
      undo: [...s.undo, { label, snapshot: s.snapshot }].slice(-UNDO_LIMIT),
    };
  });
}

/** Test helper: resets the stub to its initial demo state. Not part of the public `state/` surface. */
export function resetStubState(): void {
  state = initialState();
  listeners.forEach((l) => l());
}

export function newId(): D.ID {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
