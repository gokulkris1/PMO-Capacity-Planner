/**
 * Transport interface (PL-05#AC5). Every server call goes through a Transport, so moving to the
 * Jira Forge bridge in Release 3.0 means adding one `ForgeBridgeTransport` and nothing else.
 *
 * Implementations: `HttpTransport` (fetch, cookie session, CSRF) and `DemoTransport` (in-memory,
 * same routes, statuses and permission rules). No React or DOM imports here.
 */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  /** Appended as a query string; null/undefined values are skipped. */
  query?: Record<string, QueryValue>;
  /** Extra request headers. */
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Set false to skip the 401 → refresh → retry cycle (auth endpoints do this automatically). */
  retryOn401?: boolean;
}

export type TransportEvent = 'session-expired';

export interface Transport {
  /** 'http' in live mode, 'demo' for DemoTransport (and 'forge' in Release 3.0). */
  readonly kind: 'http' | 'demo';
  request<T>(method: HttpMethod, path: string, body?: unknown, init?: RequestOptions): Promise<T>;
  /** Subscribes to transport events; returns the unsubscribe function. */
  on(event: TransportEvent, listener: () => void): () => void;
}

/** Appends `query` to `path` (keeps an existing query string). */
export function withQuery(path: string, query?: Record<string, QueryValue>): string {
  if (!query) return path;
  const parts = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  if (parts.length === 0) return path;
  return `${path}${path.includes('?') ? '&' : '?'}${parts.join('&')}`;
}

/** Small event emitter shared by the transports. */
export class TransportEvents {
  private listeners = new Map<TransportEvent, Set<() => void>>();

  on(event: TransportEvent, listener: () => void): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }

  emit(event: TransportEvent): void {
    this.listeners.get(event)?.forEach((l) => l());
  }
}

export const MUTATING_METHODS: ReadonlySet<HttpMethod> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
