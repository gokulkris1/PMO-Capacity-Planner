/**
 * DemoTransport (ST-10, PL-05#AC4): serves every §4.3 route from an in-memory database seeded from
 * `constants.ts` (`services/api/demo/seed.ts`), with the same response shapes, permission checks
 * and status codes as the API (`services/api/demo/server.ts`). Used for `/demo`, `npm run
 * dev:demo` (no backend), the offline demo, and tests.
 *
 * - Requests are atomic: a handler that throws leaves the database unchanged.
 * - Responses are deep copies, so callers can never mutate the database.
 * - Optional persistence to `sessionStorage` (`storage` option) keeps demo edits in this browser
 *   tab across reloads ("Changes stay in this browser"); nothing is written to `localStorage`.
 */
import type * as D from '../../shared/contracts/dto';
import { nowIso } from '../../utils/clock';
import { buildDemoDb, DEMO_ROLES, type DemoDb, type DemoRole, type SeedOptions } from './demo/seed';
import { handle } from './demo/server';
import {
  TransportEvents,
  withQuery,
  type HttpMethod,
  type RequestOptions,
  type Transport,
  type TransportEvent,
} from './transport';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface DemoTransportOptions extends SeedOptions {
  /** Demo sign-in accepts any password (default true). Contract tests pass false. */
  acceptAnyPassword?: boolean;
  /** Persist the demo database (use sessionStorage in the browser). */
  storage?: StorageLike | null;
  storageKey?: string;
  /** Simulated latency in ms (default 0). */
  latencyMs?: number;
  /** Start from this database instead of the seed. */
  db?: DemoDb;
}

export const DEMO_STORAGE_KEY = 'pcp.demo.db.v1';

function clone<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}

export function newUuid(): D.ID {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Reads `?demoRole=…`, `?demoPlatformAdmin=1` and `?demoSignedOut=1` (WP-0 demo switches). */
export function demoOptionsFromSearch(search: string): Pick<SeedOptions, 'role' | 'isPlatformAdmin' | 'signedIn'> {
  const p = new URLSearchParams(search);
  const r = p.get('demoRole');
  return {
    role: r && (DEMO_ROLES as readonly string[]).includes(r) ? (r as DemoRole) : undefined,
    isPlatformAdmin: p.get('demoPlatformAdmin') === '1',
    signedIn: p.get('demoSignedOut') === '1' ? false : undefined,
  };
}

export class DemoTransport implements Transport {
  readonly kind = 'demo' as const;
  private db: DemoDb;
  private readonly events = new TransportEvents();
  private readonly o: DemoTransportOptions;

  constructor(o: DemoTransportOptions = {}) {
    this.o = o;
    this.db = o.db ? this.withRole(clone(o.db)) : (this.load() ?? buildDemoDb(o));
  }

  on(event: TransportEvent, listener: () => void): () => void {
    return this.events.on(event, listener);
  }

  async request<T>(method: HttpMethod, path: string, body?: unknown, init: RequestOptions = {}): Promise<T> {
    if (this.o.latencyMs) await new Promise((r) => setTimeout(r, this.o.latencyMs));
    const full = withQuery(path, init.query);
    const [pathname, qs = ''] = full.split('?');
    const query: Record<string, string> = {};
    new URLSearchParams(qs).forEach((v, k) => {
      query[k] = v;
    });
    const backup = JSON.stringify(this.db);
    try {
      const result = handle(
        this.db,
        { method, path: pathname, query, body: clone(body) },
        { now: nowIso(), newId: newUuid, acceptAnyPassword: this.o.acceptAnyPassword ?? true },
      );
      if (method !== 'GET') this.save();
      return clone(result) as T;
    } catch (e) {
      this.db = JSON.parse(backup) as DemoDb;
      throw e;
    }
  }

  /** Test/demo helper: the current database (a copy). */
  dump(): DemoDb {
    return clone(this.db);
  }

  /** Resets to a fresh seed (and clears persisted demo data). */
  reset(o: SeedOptions = this.o): void {
    this.db = buildDemoDb(o);
    try {
      this.o.storage?.removeItem(this.o.storageKey ?? DEMO_STORAGE_KEY);
    } catch {
      /* storage blocked */
    }
  }

  /** Test helper: simulates the server expiring the session. */
  expireSession(): void {
    this.db.sessionUserId = null;
    this.events.emit('session-expired');
  }

  private load(): DemoDb | null {
    try {
      const raw = this.o.storage?.getItem(this.o.storageKey ?? DEMO_STORAGE_KEY);
      if (!raw) return null;
      const db = JSON.parse(raw) as DemoDb;
      if (!db || typeof db !== 'object' || !db.org || !db.workspaces) return null;
      return this.withRole(db);
    } catch {
      return null;
    }
  }

  /** Applies the `role` option (URL `?demoRole=`) to the demo user of a restored database. */
  private withRole(db: DemoDb): DemoDb {
    const role = this.o.role;
    if (!role) return db;
    const me = db.users.find((u) => u.id === 'demo-user');
    if (me) me.orgRole = role === 'ORG_ADMIN' ? 'ORG_ADMIN' : 'MEMBER';
    db.memberships = db.memberships.map((m) =>
      m.userId === 'demo-user'
        ? { ...m, role: role === 'ORG_ADMIN' ? 'WORKSPACE_ADMIN' : (role as D.WorkspaceRole) }
        : m,
    );
    return db;
  }

  private save(): void {
    try {
      this.o.storage?.setItem(this.o.storageKey ?? DEMO_STORAGE_KEY, JSON.stringify(this.db));
    } catch {
      /* quota or storage blocked: the demo keeps working in memory */
    }
  }
}
