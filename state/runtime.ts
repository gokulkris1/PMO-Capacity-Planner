/**
 * DataRuntime: the client data layer behind the hooks (PL-06). Framework-free (no React import):
 * it owns the session (`/me`), the active workspace, the workspace snapshot, the optimistic
 * mutation queue, the undo stack (20 per session), the conflict dialog state and session notices.
 *
 * Optimistic updates: the visible snapshot is the last server snapshot with every pending
 * mutation's local change applied on top. Mutations are sent one at a time (so each reads the
 * latest confirmed versions); on success the server's response is folded into the server
 * snapshot, on failure the pending change is simply dropped (rollback) and the error is re-thrown.
 *
 * Nothing here writes business data to localStorage (PL-06#AC5): only `pcp.ui.lastWorkspace`.
 */
import type * as D from '../shared/contracts/dto';
import { LEGACY_STORAGE_KEYS, UI_STORAGE_PREFIX } from '../constants';
import { createApiClient, type ApiClient } from '../services/api/client';
import { ApiRequestError } from '../services/api/errors';
import { HttpTransport } from '../services/api/httpTransport';
import type { Transport } from '../services/api/transport';
import { createStore, type Store } from './store';

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type SessionNoticeKind = 'session-expired' | 'legacy-session-expired' | 'permissions-changed' | 'data-updated';
export interface SessionNotice {
  kind: SessionNoticeKind;
  message: string;
}
export const NOTICE_MESSAGE: Record<SessionNoticeKind, string> = {
  'session-expired': 'Your session has expired. Please sign in again.',
  'legacy-session-expired': 'Please sign in again.',
  'permissions-changed': 'Your permissions changed. The page has been refreshed.',
  'data-updated': 'Updated with the latest changes.',
};

export interface ConflictInfo {
  entity: string;
  name: string;
  changedBy: string;
  changedAt: string;
}

export interface UndoEntry {
  label: string;
  run: () => Promise<void>;
}

export interface RuntimeState {
  mode: 'live' | 'demo';
  status: 'loading' | 'anonymous' | 'authenticated';
  me: D.MeResponse | null;
  activeWorkspaceId: D.ID | null;
  dataStatus: 'idle' | 'loading' | 'ready' | 'error';
  dataError: ApiRequestError | null;
  /** Visible snapshot: server snapshot + pending optimistic changes. */
  snapshot: D.WorkspaceSnapshot | null;
  undo: UndoEntry[];
  conflict: ConflictInfo | null;
  notice: SessionNotice | null;
  pendingCount: number;
}

export interface RuntimeOptions {
  transport: Transport;
  mode?: 'live' | 'demo';
  /** UI-preference storage (localStorage in the browser); also purged of v1.1 keys on start. */
  storage?: StorageLike | null;
  /** Re-fetch `/me` and the snapshot on focus when the last fetch is older than this (AC-04#AC3). */
  refetchAfterMs?: number;
  /** Clock for the focus throttle (tests). */
  nowMs?: () => number;
}

export const UNDO_LIMIT = 20;

function asApiError(e: unknown): ApiRequestError {
  return e instanceof ApiRequestError ? e : new ApiRequestError(0, 'server_error', 'Something went wrong.');
}
export const LAST_WORKSPACE_KEY = `${UI_STORAGE_PREFIX}lastWorkspace`;

/** One optimistic change waiting for the server. */
interface Pending {
  id: number;
  apply: (s: D.WorkspaceSnapshot) => D.WorkspaceSnapshot;
}

export interface MutationSpec<T> {
  label: string;
  /** Local change shown immediately. */
  optimistic?: (s: D.WorkspaceSnapshot) => D.WorkspaceSnapshot;
  /** Runs when it is this mutation's turn; read versions from `server`. */
  send: (ctx: { wsId: D.ID; orgId: D.ID | null; server: D.WorkspaceSnapshot; api: ApiClient }) => Promise<T>;
  /** Folds the server response into the server snapshot. */
  commit: (server: D.WorkspaceSnapshot, result: T) => D.WorkspaceSnapshot;
  /** How the workspace data version moves: +1 (default), an exact value, or unchanged. */
  dataVersion?: (result: T) => number | 'increment' | 'unchanged';
  /** Builds the undo action from the snapshots before/after (return null when not undoable). */
  inverse?: (before: D.WorkspaceSnapshot, after: D.WorkspaceSnapshot, result: T) => UndoEntry['run'] | null;
  /** On a 409 with `current`, folds the latest row into the server snapshot. */
  onConflict?: (server: D.WorkspaceSnapshot, current: unknown) => D.WorkspaceSnapshot;
  /** Name shown in the conflict dialog ("{name} changed it at {time}"). */
  entity?: { kind: string; name: string };
}

function safeStorage(s: StorageLike | null | undefined) {
  return {
    get(k: string): string | null {
      try {
        return s?.getItem(k) ?? null;
      } catch {
        return null;
      }
    },
    set(k: string, v: string) {
      try {
        s?.setItem(k, v);
      } catch {
        /* storage blocked */
      }
    },
    remove(k: string) {
      try {
        s?.removeItem(k);
      } catch {
        /* storage blocked */
      }
    },
  };
}

export class DataRuntime {
  readonly api: ApiClient;
  readonly transport: Transport;
  private readonly store: Store<RuntimeState>;
  private readonly storage: ReturnType<typeof safeStorage>;
  private readonly rawStorage: StorageLike | null;
  private readonly refetchAfterMs: number;
  private readonly nowMs: () => number;
  private server: D.WorkspaceSnapshot | null = null;
  private pending: Pending[] = [];
  private pendingSeq = 0;
  private queue: Promise<unknown> = Promise.resolve();
  /** `${id}:${version}` produced by this session's own writes (for rebasing queued batch ops). */
  private readonly ownVersions = new Set<string>();
  private started: Promise<void> | null = null;
  private lastFetchAt = 0;
  private snapshotSeq = 0;

  constructor(o: RuntimeOptions) {
    this.transport = o.transport;
    this.api = createApiClient(o.transport);
    this.rawStorage = o.storage ?? null;
    this.storage = safeStorage(o.storage);
    this.refetchAfterMs = o.refetchAfterMs ?? 60_000;
    this.nowMs = o.nowMs ?? (() => Date.now());
    this.store = createStore<RuntimeState>({
      mode: o.mode ?? (o.transport.kind === 'demo' ? 'demo' : 'live'),
      status: 'loading',
      me: null,
      activeWorkspaceId: null,
      dataStatus: 'idle',
      dataError: null,
      snapshot: null,
      undo: [],
      conflict: null,
      notice: null,
      pendingCount: 0,
    });
    o.transport.on('session-expired', () => this.handleSessionExpired());
  }

  /* ── store access ─────────────────────────────────────────────────────────────── */

  getState = (): RuntimeState => this.store.getState();

  subscribe = (listener: () => void): (() => void) => {
    void this.start();
    return this.store.subscribe(listener);
  };

  private set(patch: Partial<RuntimeState>): void {
    this.store.setState((s) => ({ ...s, ...patch }));
  }

  /** The confirmed server snapshot (tests and mutation builders). */
  serverSnapshot(): D.WorkspaceSnapshot | null {
    return this.server;
  }

  private publish(): void {
    let visible = this.server;
    if (visible) {
      for (const p of this.pending) {
        try {
          visible = p.apply(visible);
        } catch {
          /* an optimistic change that no longer applies is shown when the server confirms it */
        }
      }
    }
    this.set({ snapshot: visible, pendingCount: this.pending.length });
  }

  /* ── session ──────────────────────────────────────────────────────────────────── */

  /** Boots once: purges v1.1 storage, exchanges a legacy token, loads `/me` and the workspace. */
  start(): Promise<void> {
    if (!this.started) this.started = this.boot();
    return this.started;
  }

  private async boot(): Promise<void> {
    for (const k of LEGACY_STORAGE_KEYS) this.storage.remove(k);
    if (this.transport instanceof HttpTransport) {
      const r = await this.transport.exchangeLegacyToken(this.rawStorage);
      if (r === 'expired')
        this.set({ notice: { kind: 'legacy-session-expired', message: NOTICE_MESSAGE['legacy-session-expired'] } });
      if (r !== 'exchanged' && !this.transport.mayHaveSession()) {
        this.set({ me: null, status: 'anonymous' });
        return;
      }
    } else {
      this.storage.remove('pcp_user');
    }
    try {
      await this.loadMe();
    } catch (e) {
      // Not a 401: the API is down or being migrated (SH-07#AC4). Surface it through useWorkspaceData().
      this.set({ status: 'loading', dataStatus: 'error', dataError: asApiError(e) });
      return;
    }
    if (this.getState().status === 'authenticated')
      await this.selectWorkspace(this.getState().activeWorkspaceId).catch(() => undefined);
  }

  /** Re-reads `/me` and (re)selects a workspace: after accepting an invitation, creating an org, etc. */
  async reloadSession(preferredWorkspaceId?: D.ID | null): Promise<void> {
    await this.loadMe();
    if (this.getState().status === 'authenticated')
      await this.selectWorkspace(preferredWorkspaceId ?? this.getState().activeWorkspaceId);
  }

  private async loadMe(): Promise<D.MeResponse | null> {
    try {
      const me = await this.api.auth.me();
      this.lastFetchAt = this.nowMs();
      this.set({ me, status: 'authenticated' });
      return me;
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 401) {
        this.set({ me: null, status: 'anonymous' });
        return null;
      }
      this.set({ status: this.getState().me ? 'authenticated' : 'anonymous' });
      throw e;
    }
  }

  async login(email: string, password: string, otp?: string): Promise<{ require2FA: boolean }> {
    const res = await this.api.auth.login({ email, password, ...(otp ? { otp } : {}) });
    if ('require2FA' in res && res.require2FA) return { require2FA: true };
    this.set({ notice: null });
    await this.loadMe();
    await this.selectWorkspace(this.getState().activeWorkspaceId);
    return { require2FA: false };
  }

  async logout(opts: { everywhere?: boolean } = {}): Promise<void> {
    try {
      if (opts.everywhere) await this.api.auth.logoutEverywhere();
      else await this.api.auth.logout();
    } catch {
      /* signing out locally even if the server call fails */
    }
    this.clearSession();
  }

  private clearSession(notice: SessionNotice | null = null): void {
    this.server = null;
    this.pending = [];
    this.set({
      status: 'anonymous',
      me: null,
      snapshot: null,
      dataStatus: 'idle',
      dataError: null,
      undo: [],
      conflict: null,
      notice,
      pendingCount: 0,
    });
  }

  private handleSessionExpired(): void {
    if (this.getState().status !== 'authenticated') return;
    this.clearSession({ kind: 'session-expired', message: NOTICE_MESSAGE['session-expired'] });
  }

  /** Re-reads `/me`; a change to the active workspace's permissions raises the "permissions changed" notice. */
  async refreshMe(): Promise<void> {
    const before = this.activeMeWorkspace();
    const me = await this.loadMe();
    if (!me) return;
    const after = me.workspaces.find((w) => w.id === this.getState().activeWorkspaceId) ?? null;
    if (before && (!after || before.permissions.join() !== after.permissions.join())) {
      this.set({ notice: { kind: 'permissions-changed', message: NOTICE_MESSAGE['permissions-changed'] } });
    }
    if (!after) await this.selectWorkspace(null);
  }

  activeMeWorkspace(): D.MeWorkspace | null {
    const s = this.getState();
    return s.me?.workspaces.find((w) => w.id === s.activeWorkspaceId) ?? null;
  }

  dismissNotice(): void {
    this.set({ notice: null });
  }

  /* ── workspace and snapshot ───────────────────────────────────────────────────── */

  /** SH-01: selects a workspace (route param, switcher). Unknown ids fall back to the last used or first. */
  switchWorkspace(wsId: D.ID): void {
    if (this.getState().status !== 'authenticated') {
      this.set({ activeWorkspaceId: wsId });
      return;
    }
    if (wsId === this.getState().activeWorkspaceId && this.getState().dataStatus !== 'idle') return;
    void this.selectWorkspace(wsId).catch(() => undefined);
  }

  private async selectWorkspace(preferred: D.ID | null): Promise<void> {
    const me = this.getState().me;
    const list = me?.workspaces ?? [];
    const last = this.storage.get(LAST_WORKSPACE_KEY);
    const chosen = list.find((w) => w.id === preferred) ?? list.find((w) => w.id === last) ?? list[0] ?? null;
    if (!chosen) {
      this.server = null;
      this.pending = [];
      this.set({
        activeWorkspaceId: preferred,
        snapshot: null,
        dataStatus: preferred ? 'error' : 'idle',
        dataError: preferred ? new ApiRequestError(403, 'forbidden', "You don't have access to this workspace.") : null,
      });
      return;
    }
    if (preferred && chosen.id !== preferred) {
      // SH-01#AC3: a workspace the user cannot open is a 403, not a silent switch.
      this.server = null;
      this.pending = [];
      this.set({
        activeWorkspaceId: preferred,
        snapshot: null,
        dataStatus: 'error',
        dataError: new ApiRequestError(403, 'forbidden', "You don't have access to this workspace."),
      });
      return;
    }
    const changed = chosen.id !== this.getState().activeWorkspaceId || !this.server;
    this.storage.set(LAST_WORKSPACE_KEY, chosen.id);
    if (changed) {
      this.server = null;
      this.pending = [];
      this.set({
        activeWorkspaceId: chosen.id,
        snapshot: null,
        undo: [],
        conflict: null,
        dataStatus: 'loading',
        dataError: null,
      });
    }
    await this.loadSnapshot();
  }

  /** Reloads the active workspace snapshot (also the conflict dialog's "Reload"). */
  async loadSnapshot(): Promise<void> {
    if (this.getState().status === 'loading' && this.getState().dataStatus === 'error') {
      // The boot failed (e.g. 503 migration_pending): "Try again" re-runs it.
      this.started = null;
      this.set({ dataStatus: 'idle', dataError: null });
      return this.start();
    }
    const wsId = this.getState().activeWorkspaceId;
    if (!wsId || this.getState().status !== 'authenticated') return;
    const seq = ++this.snapshotSeq;
    if (!this.server) this.set({ dataStatus: 'loading', dataError: null });
    try {
      const s = await this.api.workspace.snapshot(wsId);
      if (seq !== this.snapshotSeq || wsId !== this.getState().activeWorkspaceId) return;
      this.server = s;
      this.lastFetchAt = this.nowMs();
      this.set({ dataStatus: 'ready', dataError: null });
      this.publish();
    } catch (e) {
      if (seq !== this.snapshotSeq) return;
      const err = e instanceof ApiRequestError ? e : new ApiRequestError(0, 'server_error', 'Something went wrong.');
      if (!this.server) this.set({ dataStatus: 'error', dataError: err });
      throw err;
    }
  }

  /**
   * Refetch on focus (AC-04#AC3, PL-06#AC3): at most every `refetchAfterMs`. Reloads `/me`; reloads the
   * snapshot when nothing is pending and raises "Updated with the latest changes." when another user's
   * change advanced the data version.
   */
  async onFocus(): Promise<void> {
    if (this.getState().status !== 'authenticated') return;
    if (this.nowMs() - this.lastFetchAt < this.refetchAfterMs) return;
    this.lastFetchAt = this.nowMs();
    try {
      await this.refreshMe();
      const wsId = this.getState().activeWorkspaceId;
      if (!wsId || this.pending.length > 0 || !this.server) return;
      const s = await this.api.workspace.snapshot(wsId);
      if (this.pending.length > 0 || wsId !== this.getState().activeWorkspaceId) return;
      const advanced = s.workspace.dataVersion > (this.server?.workspace.dataVersion ?? 0);
      this.server = s;
      this.publish();
      if (advanced) this.set({ notice: { kind: 'data-updated', message: NOTICE_MESSAGE['data-updated'] } });
    } catch {
      /* a failed background refresh is not an error for the user */
    }
  }

  /* ── conflict and undo ────────────────────────────────────────────────────────── */

  resolveConflict(action: 'reload' | 'dismiss'): void {
    this.set({ conflict: null });
    if (action === 'reload') void this.loadSnapshot().catch(() => undefined);
  }

  async undo(): Promise<void> {
    const stack = this.getState().undo;
    const top = stack[stack.length - 1];
    if (!top) return;
    this.set({ undo: stack.slice(0, -1) });
    await top.run();
  }

  private pushUndo(entry: UndoEntry): void {
    this.store.setState((s) => ({ ...s, undo: [...s.undo, entry].slice(-UNDO_LIMIT) }));
  }

  /* ── mutations ────────────────────────────────────────────────────────────────── */

  /** Marks `${id}:${version}` as produced by this session (used to rebase queued batch ops). */
  noteOwnVersion(id: D.ID, version: number): void {
    this.ownVersions.add(`${id}:${version}`);
  }

  /** True when every version after `from` up to `to` was produced by this session's own writes. */
  ownedSince(id: D.ID, from: number, to: number): boolean {
    for (let v = from + 1; v <= to; v++) if (!this.ownVersions.has(`${id}:${v}`)) return false;
    return true;
  }

  requireWorkspace(): { wsId: D.ID; server: D.WorkspaceSnapshot } {
    const wsId = this.getState().activeWorkspaceId;
    if (!wsId || !this.server)
      throw new ApiRequestError(409, 'conflict', 'The workspace is still loading. Try again in a moment.');
    return { wsId, server: this.server };
  }

  mutate<T>(m: MutationSpec<T>, opts: { undoable?: boolean } = {}): Promise<T> {
    let wsId: D.ID;
    try {
      wsId = this.requireWorkspace().wsId;
    } catch (e) {
      return Promise.reject(e);
    }
    const pending: Pending | null = m.optimistic ? { id: ++this.pendingSeq, apply: m.optimistic } : null;
    if (pending) {
      this.pending.push(pending);
      this.publish();
    }
    const drop = () => {
      if (pending) this.pending = this.pending.filter((p) => p !== pending);
    };
    const run = async (): Promise<T> => {
      if (wsId !== this.getState().activeWorkspaceId || !this.server) {
        drop();
        this.publish();
        throw new ApiRequestError(409, 'conflict', 'The workspace changed before this edit was saved.');
      }
      const before = this.server;
      try {
        const result = await m.send({
          wsId,
          orgId: this.getState().me?.org?.id ?? null,
          server: before,
          api: this.api,
        });
        if (wsId !== this.getState().activeWorkspaceId || !this.server) return result;
        let after = m.commit(this.server, result);
        const dv = m.dataVersion ? m.dataVersion(result) : 'increment';
        if (dv !== 'unchanged') {
          const next = dv === 'increment' ? after.workspace.dataVersion + 1 : Math.max(dv, after.workspace.dataVersion);
          after = { ...after, workspace: { ...after.workspace, dataVersion: next } };
        }
        this.server = after;
        drop();
        this.publish();
        if (opts.undoable !== false && m.inverse) {
          const inv = m.inverse(before, after, result);
          if (inv) this.pushUndo({ label: m.label, run: inv });
        }
        return result;
      } catch (e) {
        drop();
        this.handleMutationError(e, m);
        this.publish();
        throw e;
      }
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  private handleMutationError<T>(e: unknown, m: MutationSpec<T>): void {
    if (!(e instanceof ApiRequestError)) return;
    if (e.status === 409 && e.code === 'conflict') {
      const body = (e.body ?? {}) as { current?: unknown; changedBy?: D.UserRef; changedAt?: string };
      if (body.current !== undefined && this.server && m.onConflict) {
        this.server = m.onConflict(this.server, body.current);
      }
      if (body.current !== undefined || body.changedBy) {
        this.set({
          conflict: {
            entity: m.entity?.kind ?? 'record',
            name: m.entity?.name ?? 'This record',
            changedBy: body.changedBy?.name ?? 'Someone',
            changedAt: body.changedAt ?? '',
          },
        });
      }
    } else if (e.status === 403 && e.code === 'forbidden') {
      void this.refreshMe().catch(() => undefined);
      this.set({ notice: { kind: 'permissions-changed', message: NOTICE_MESSAGE['permissions-changed'] } });
    }
  }

  /** Waits for every queued mutation (tests). */
  async settle(): Promise<void> {
    await this.queue;
  }
}
