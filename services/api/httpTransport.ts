/**
 * HttpTransport: the ONLY module that calls `fetch(` (PL-05#AC1, C checklist §4.4).
 *
 * - Cookie session: `credentials: 'include'`; the session cookie (`pcp_session`, HttpOnly) is never
 *   read by script.
 * - CSRF: every POST/PUT/PATCH/DELETE carries `X-CSRF-Token` copied from the `pcp_csrf` cookie
 *   (AC-03#AC3).
 * - 401: one `POST /api/auth/refresh` per page load (shared by concurrent requests), then the
 *   failed request is retried once; a second 401 (or a failed refresh) emits `session-expired`
 *   (AC-03#AC5, PL-05#AC2).
 * - Errors: any non-2xx becomes an `ApiRequestError` built from the `ApiError` body; a request that
 *   never reaches the server becomes status 0 / code `network_error` (PL-05#AC3).
 * - Legacy v1.1 bearer token: `exchangeLegacyToken()` trades `localStorage.pcp_token` for the
 *   cookie session once via `POST /api/auth/session`, then removes `pcp_token`/`pcp_user`
 *   (AC-03#AC2).
 */
import { API } from '../../shared/contracts/api';
import { errorFromResponse, networkError } from './errors';
import {
  MUTATING_METHODS,
  TransportEvents,
  withQuery,
  type HttpMethod,
  type RequestOptions,
  type Transport,
  type TransportEvent,
} from './transport';

export const CSRF_COOKIE = 'pcp_csrf';
export const CSRF_HEADER = 'X-CSRF-Token';
export const LEGACY_TOKEN_KEY = 'pcp_token';
export const LEGACY_USER_KEY = 'pcp_user';

/** Endpoints whose 401 means "bad credentials", not "session expired": never refreshed or retried. */
const NO_REFRESH_PATHS: ReadonlySet<string> = new Set([
  API.login,
  API.register,
  API.logout,
  API.refresh,
  API.sessionExchange,
  API.resetSend,
  API.resetConfirm,
  API.changePassword,
  API.twoFactor,
]);

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;
type StorageLike = Pick<Storage, 'getItem' | 'removeItem'>;

export interface HttpTransportOptions {
  /** Prefix for every path (default '' = same origin). */
  baseUrl?: string;
  /** Injected for tests; defaults to the global fetch. */
  fetchImpl?: FetchLike;
  /** Returns `document.cookie` (injected for tests). */
  getCookies?: () => string;
}

export type LegacyExchangeResult = 'none' | 'exchanged' | 'expired' | 'failed';

export function readCookie(cookies: string, name: string): string | null {
  for (const part of cookies.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export class HttpTransport implements Transport {
  readonly kind = 'http' as const;
  private readonly events = new TransportEvents();
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly getCookies: () => string;
  private refreshPromise: Promise<boolean> | null = null;

  constructor(o: HttpTransportOptions = {}) {
    this.baseUrl = o.baseUrl ?? '';
    this.fetchImpl = o.fetchImpl ?? ((input, init) => fetch(input, init));
    this.getCookies = o.getCookies ?? (() => (typeof document !== 'undefined' ? document.cookie : ''));
  }

  on(event: TransportEvent, listener: () => void): () => void {
    return this.events.on(event, listener);
  }

  async request<T>(method: HttpMethod, path: string, body?: unknown, init: RequestOptions = {}): Promise<T> {
    const url = withQuery(path, init.query);
    let res = await this.send(method, url, body, init);
    const pathOnly = path.split('?')[0];
    if (res.status === 401 && init.retryOn401 !== false && !NO_REFRESH_PATHS.has(pathOnly)) {
      const refreshed = await this.refreshOnce();
      if (refreshed) res = await this.send(method, url, body, init);
      if (res.status === 401) {
        this.events.emit('session-expired');
      }
    }
    return this.parse<T>(res);
  }

  /** AC-03#AC2: exchanges a v1.1 bearer token for the cookie session, once. */
  async exchangeLegacyToken(storage: StorageLike | null): Promise<LegacyExchangeResult> {
    if (!storage) return 'none';
    let token: string | null = null;
    try {
      token = storage.getItem(LEGACY_TOKEN_KEY);
    } catch {
      return 'none';
    }
    if (!token) return 'none';
    let res: Response;
    try {
      res = await this.fetchImpl(this.baseUrl + API.sessionExchange, {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      });
    } catch {
      return 'failed';
    }
    if (res.ok || res.status === 401) {
      try {
        storage.removeItem(LEGACY_TOKEN_KEY);
        storage.removeItem(LEGACY_USER_KEY);
      } catch {
        /* storage blocked: nothing to clean */
      }
      return res.ok ? 'exchanged' : 'expired';
    }
    return 'failed';
  }

  private async send(method: HttpMethod, url: string, body: unknown, init: RequestOptions): Promise<Response> {
    const headers: Record<string, string> = { Accept: 'application/json', ...(init.headers ?? {}) };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (MUTATING_METHODS.has(method)) {
      const csrf = readCookie(this.getCookies(), CSRF_COOKIE);
      if (csrf) headers[CSRF_HEADER] = csrf;
    }
    try {
      return await this.fetchImpl(this.baseUrl + url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'include',
        signal: init.signal,
      });
    } catch (e) {
      throw networkError(e);
    }
  }

  /** At most one refresh per page load; concurrent 401s share it. */
  private refreshOnce(): Promise<boolean> {
    if (!this.refreshPromise) {
      this.refreshPromise = this.send('POST', API.refresh, undefined, {})
        .then((r) => r.ok)
        .catch(() => false);
    }
    return this.refreshPromise;
  }

  private async parse<T>(res: Response): Promise<T> {
    const requestId = res.headers.get('x-request-id') ?? undefined;
    const type = res.headers.get('content-type') ?? '';
    let data: unknown = undefined;
    if (res.status !== 204) {
      const text = await res.text();
      if (text) {
        if (type.includes('json')) {
          try {
            data = JSON.parse(text);
          } catch {
            data = undefined;
          }
        } else if (res.ok) {
          data = text; // e.g. CSV exports
        }
      }
    }
    if (!res.ok) throw errorFromResponse(res.status, data, requestId);
    return data as T;
  }
}
