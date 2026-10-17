/**
 * Outbound HTTP safety (HS-08, SEC-11, SEC-15): host allow-rules, private-range rejection, no redirects followed,
 * hard timeouts (≤ 8 s, Netlify kills functions at 10 s).
 */
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { HttpError, badRequest, gatewayTimeout, upstreamError } from './errors';

export const JIRA_HOST_RE = /^[a-z0-9-]+\.(atlassian\.net|jira\.com)$/;
export const JIRA_DOMAIN_MESSAGE = 'Enter your Jira Cloud site, e.g. acme.atlassian.net';
export const PLANVIEW_URL_MESSAGE = 'Planview URL must be a public HTTPS address';
export const MAX_OUTBOUND_MS = 8000;

export class UpstreamError extends Error {
  constructor(
    readonly provider: string,
    readonly status: number,
    message: string,
    readonly retryAfterSec: number | null = null,
  ) {
    super(message);
    this.name = 'UpstreamError';
  }
}
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}
/** The remote host could not be reached at all: DNS failure, connection refused or reset, TLS failure (QA-009). */
export class UnreachableError extends Error {
  constructor(
    readonly provider: string,
    readonly host: string,
    readonly causeCode: string | null,
  ) {
    super(`Could not reach ${provider} at ${host}. Check the address and try again in a minute.`);
    this.name = 'UnreachableError';
  }
}

/**
 * QA-009: what the API answers when an outbound call fails, so a Jira or Planview outage is never a 500. A timeout is
 * 504 and an unreachable host or a failed upstream answer is 502, each with a message a person can act on
 * (`code: server_error`, per the ApiError contract). Returns null for anything that is not an outbound failure.
 */
export function outboundHttpError(e: unknown): HttpError | null {
  if (e instanceof TimeoutError) return gatewayTimeout(`${e.message}. Try again in a minute.`, e.message);
  if (e instanceof UnreachableError)
    return upstreamError(e.message, `${e.provider} unreachable: ${e.causeCode ?? 'network'}`);
  if (e instanceof UpstreamError) {
    if (e.message.startsWith('Unexpected redirect')) return upstreamError(e.message);
    if (e.status === 401 || e.status === 403)
      return upstreamError(
        `${e.provider} rejected the credentials (${e.status}). Check the email and API token in Settings › Integrations.`,
      );
    return upstreamError(`${e.provider} ${e.status}: ${e.message}`.slice(0, 200));
  }
  return null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** The low-level code of a fetch failure (undici puts it on `cause`), e.g. ENOTFOUND or ECONNREFUSED. */
function networkCode(e: unknown): string | null {
  const err = e as { code?: unknown; cause?: { code?: unknown; errno?: unknown } };
  const code = err?.cause?.code ?? err?.code;
  return typeof code === 'string' ? code : null;
}

export function normaliseJiraDomain(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const d = raw
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/[/?#].*$/, '')
    .toLowerCase();
  return JIRA_HOST_RE.test(d) ? d : null;
}

export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    if (x === '::1' || x === '::') return true;
    if (
      x.startsWith('fc') ||
      x.startsWith('fd') ||
      x.startsWith('fe8') ||
      x.startsWith('fe9') ||
      x.startsWith('fea') ||
      x.startsWith('feb')
    )
      return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }
  return true;
}

type Lookup = (host: string) => Promise<string[]>;
let lookupImpl: Lookup = async (host) => (await dnsLookup(host, { all: true })).map((r) => r.address);
/** Tests replace DNS resolution. */
export function setDnsLookup(fn: Lookup | null): void {
  lookupImpl = fn ?? (async (host) => (await dnsLookup(host, { all: true })).map((r) => r.address));
}

/** HS-08#AC3: https, no explicit port, not an IP literal, and no DNS answer in a private/loopback/link-local range. */
export async function assertPublicHttpsUrl(raw: unknown, field = 'baseUrl'): Promise<string> {
  const fail = () => badRequest(PLANVIEW_URL_MESSAGE, { [field]: PLANVIEW_URL_MESSAGE });
  if (typeof raw !== 'string' || !raw.trim()) throw fail();
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw fail();
  }
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (u.protocol !== 'https:' || u.port !== '' || u.username || u.password || isIP(host) || !host.includes('.')) {
    throw fail();
  }
  let addresses: string[];
  try {
    addresses = await lookupImpl(host);
  } catch {
    throw fail();
  }
  if (!addresses.length || addresses.some(isPrivateAddress)) throw fail();
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
}

/** Fetch with an AbortController deadline, never following redirects (HS-08#AC4). */
export async function safeFetch(
  url: string,
  init: RequestInit,
  opts: { label: string; timeoutMs?: number },
): Promise<Response> {
  const timeoutMs = Math.min(opts.timeoutMs ?? MAX_OUTBOUND_MS, MAX_OUTBOUND_MS);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = () => new TimeoutError(`${opts.label} did not respond within ${Math.round(timeoutMs / 100) / 10}s`);
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(timedOut());
      controller.abort();
    }, timeoutMs);
  });
  try {
    const res = await Promise.race([fetch(url, { ...init, redirect: 'manual', signal: controller.signal }), timeout]);
    if ((res.status >= 300 && res.status < 400) || res.type === 'opaqueredirect') {
      throw new UpstreamError(opts.label, 502, `Unexpected redirect from ${hostOf(url)}`);
    }
    return res;
  } catch (e) {
    if (e instanceof TimeoutError || e instanceof UpstreamError) throw e;
    if ((e as Error)?.name === 'AbortError') throw timedOut();
    // fetch() rejects (TypeError "fetch failed", DNS, refused, reset, TLS): the host is unreachable, not a server bug.
    throw new UnreachableError(opts.label, hostOf(url), networkCode(e));
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function readJson(res: Response): Promise<{ text: string; json: unknown }> {
  const text = await res.text();
  try {
    return { text, json: text ? JSON.parse(text) : null };
  } catch {
    return { text, json: null };
  }
}

/** A short, safe message from an upstream error body (never the raw body). */
export function upstreamMessage(json: unknown, text: string): string {
  const j = json as Record<string, unknown> | null;
  if (j && typeof j === 'object') {
    if (Array.isArray(j.errorMessages) && j.errorMessages.length) return String(j.errorMessages[0]).slice(0, 200);
    for (const k of ['message', 'Message', 'error_description', 'errorMessage']) {
      if (typeof j[k] === 'string') return String(j[k]).slice(0, 200);
    }
  }
  return (text || '').replace(/\s+/g, ' ').slice(0, 120) || 'Upstream request failed';
}
