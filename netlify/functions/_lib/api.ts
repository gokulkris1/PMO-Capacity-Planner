/**
 * `withApi(options, handler)`: the single wrapper every function uses (PL-01#AC1).
 * It provides CORS (allow-list, never `*`), the Origin check, request ids, JSON parsing with a size cap,
 * the schema check (auto-migrate), authentication, CSRF for cookie sessions, zod validation helpers,
 * error mapping to `ApiError`, security headers and one structured log line per request.
 */
import type { Handler, HandlerEvent, HandlerResponse } from '@netlify/functions';
import { randomUUID } from 'node:crypto';
import { ZodError, type ZodType } from 'zod';
import type { ApiError } from '../../../shared/contracts/api';
import type { AuditContext } from './audit';
import type { Actor } from './auth';
import { authenticate } from './auth';
import { safeEqual } from './crypto';
import type { Db } from './db';
import { getDb } from './db';
import { requireEnv } from './env';
import { HttpError, badRequest, forbidden, payloadTooLarge, unauthorized } from './errors';
import type { Headers } from './http';
import {
  CSRF_COOKIE,
  SECURITY_HEADERS,
  clientIp,
  corsHeaders,
  lowerHeaders,
  originAllowed,
  parseCookies,
} from './http';
import { errorFields, log } from './log';
import { ensureSchema } from './migrate';
import { outboundHttpError } from './net';

export interface ApiOptions {
  /** Function name for logs. */
  fn: string;
  /** 'required' (default): 401 without a session. 'optional': actor may be null. 'none': never authenticates. */
  auth?: 'required' | 'optional' | 'none';
  /** CSRF check for cookie-authenticated POST/PUT/PATCH/DELETE (default true). */
  csrf?: boolean;
  /** Ensure migrations are applied before handling (default true). */
  schemaCheck?: boolean;
  /** PL-01#AC6: refuse to serve when JWT_SECRET is missing (default true). */
  requireJwtSecret?: boolean;
  maxBodyBytes?: number;
  /** Do not JSON-parse the body (webhooks need the raw text). */
  rawBody?: boolean;
}

export interface Ctx {
  event: HandlerEvent;
  fn: string;
  requestId: string;
  method: string;
  /** Path below `/api/<fn>` or `/.netlify/functions/<fn>`, always starting with '/'. */
  subpath: string;
  query: Record<string, string>;
  headers: Headers;
  cookies: Record<string, string>;
  body: unknown;
  rawBody: string;
  ip: string | null;
  userAgent: string | null;
  db: Db;
  actor: Actor | null;
  /** Set-Cookie values to send. */
  setCookies: string[];
  /** Extra response headers. */
  responseHeaders: Record<string, string>;
  /** Why an optional authentication failed (expired/revoked token); thrown by requireActor. */
  authError?: unknown;
}

export class Reply {
  constructor(
    readonly status: number,
    readonly body: unknown,
    readonly contentType = 'application/json',
    readonly headers: Record<string, string> = {},
  ) {}
}
export const reply = (status: number, body: unknown) => new Reply(status, body);
export const noContent = () => new Reply(204, null);
export const textReply = (status: number, body: string, contentType: string, headers: Record<string, string> = {}) =>
  new Reply(status, body, contentType, headers);

export function requireActor(ctx: Ctx): Actor {
  if (!ctx.actor) throw ctx.authError ?? unauthorized();
  return ctx.actor;
}

export function auditCtx(ctx: Ctx, actorType?: AuditContext['actorType']): AuditContext {
  return {
    requestId: ctx.requestId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    actorUserId: ctx.actor?.userId ?? null,
    actorType: actorType ?? (ctx.actor ? (ctx.actor.isPlatformAdmin ? 'platform_admin' : 'user') : 'system'),
  };
}

/** Validates with zod; on failure 400 `{ code: 'bad_request', fields: { 'a.b': 'message' } }` (PL-01#AC3). */
export function parseWith<T>(schema: ZodType<T>, data: unknown, message = 'Check the highlighted fields.'): T {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  throw badRequest(message, zodFields(r.error));
}

export function zodFields(e: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of e.issues) {
    const key = issue.path.map(String).join('.') || '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  return fields;
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * AC-03#AC3: a cookie-authenticated POST/PUT/PATCH/DELETE must echo the `pcp_csrf` cookie in `X-CSRF-Token`.
 * Bearer-authenticated requests (v1.1 clients, scripts, tests) are exempt.
 */
export function assertCsrf(ctx: Ctx): void {
  if (!ctx.actor || ctx.actor.authMethod !== 'cookie' || !MUTATING.has(ctx.method)) return;
  const sent = ctx.headers['x-csrf-token'] ?? '';
  const cookie = ctx.cookies[CSRF_COOKIE] ?? '';
  if (!sent || !cookie || !safeEqual(sent, cookie)) throw forbidden('CSRF check failed');
}

function subpathOf(path: string, fn: string): string {
  const p = path || '/';
  const markers = [`/.netlify/functions/${fn}`, `/api/${fn}`];
  for (const m of markers) {
    const idx = p.indexOf(m);
    if (idx >= 0) {
      const rest = p.slice(idx + m.length);
      if (rest === '' || rest.startsWith('/')) return (rest || '/').replace(/\/+$/, '') || '/';
    }
  }
  return p.replace(/\/+$/, '') || '/';
}

function toResponse(
  status: number,
  body: unknown,
  headers: Record<string, string>,
  cookies: string[],
  contentType: string,
): HandlerResponse {
  const h: Record<string, string> = { ...SECURITY_HEADERS, ...headers };
  let text = '';
  if (status !== 204 && body !== null && body !== undefined) {
    h['Content-Type'] = contentType;
    text = typeof body === 'string' && contentType !== 'application/json' ? body : JSON.stringify(body);
  }
  const res: HandlerResponse = { statusCode: status, headers: h, body: text };
  if (cookies.length) res.multiValueHeaders = { 'Set-Cookie': cookies };
  return res;
}

export function errorBody(err: HttpError, requestId: string): ApiError {
  const body: ApiError & Record<string, unknown> = { error: err.message, code: err.code, requestId };
  if (err.extra.fields) body.fields = err.extra.fields;
  if (err.extra.current !== undefined) body.current = err.extra.current;
  if (err.extra.changedBy !== undefined) body.changedBy = err.extra.changedBy ?? undefined;
  if (err.extra.changedAt !== undefined) body.changedAt = err.extra.changedAt ?? undefined;
  if (err.extra.body) Object.assign(body, err.extra.body);
  return body;
}

export function withApi(opts: ApiOptions, fn: (ctx: Ctx) => Promise<unknown>): Handler {
  return async (event: HandlerEvent) => {
    const started = Date.now();
    const headers = lowerHeaders(event.headers as Record<string, string | undefined>);
    const requestId = headers['x-nf-request-id'] || headers['x-request-id'] || randomUUID();
    const cors = corsHeaders(headers);
    const baseHeaders: Record<string, string> = { ...cors, 'x-request-id': requestId };
    const method = (event.httpMethod || 'GET').toUpperCase();
    const subpath = subpathOf(event.path, opts.fn);
    let ctx: Ctx | null = null;
    let status = 500;

    const finish = (res: HandlerResponse): HandlerResponse => {
      status = res.statusCode;
      log(status >= 500 ? 'error' : 'info', {
        event: 'request',
        requestId,
        fn: opts.fn,
        route: `${method} ${subpath}`,
        status,
        durationMs: Date.now() - started,
        userId: ctx?.actor?.userId,
      });
      return res;
    };

    if (method === 'OPTIONS') {
      if (!originAllowed(headers)) return finish(toResponse(403, null, baseHeaders, [], 'application/json'));
      return finish(toResponse(204, null, baseHeaders, [], 'application/json'));
    }

    try {
      if (!originAllowed(headers)) throw forbidden('Origin not allowed');
      if (opts.requireJwtSecret !== false) requireEnv('JWT_SECRET');

      let rawBody = event.body ?? '';
      if (event.isBase64Encoded && rawBody) rawBody = Buffer.from(rawBody, 'base64').toString('utf8');
      if (Buffer.byteLength(rawBody, 'utf8') > (opts.maxBodyBytes ?? 1024 * 1024)) throw payloadTooLarge();
      let body: unknown = {};
      if (!opts.rawBody && rawBody.trim()) {
        try {
          body = JSON.parse(rawBody);
        } catch {
          throw badRequest('Request body must be valid JSON.');
        }
      }

      let lazyDb: Db | null = null;
      const db = (): Db => (lazyDb ??= getDb());
      if (opts.schemaCheck !== false) await ensureSchema(db());

      const query: Record<string, string> = {};
      for (const [k, v] of Object.entries(event.queryStringParameters ?? {})) if (typeof v === 'string') query[k] = v;

      ctx = {
        event,
        fn: opts.fn,
        requestId,
        method,
        subpath,
        query,
        headers,
        cookies: parseCookies(headers['cookie']),
        body,
        rawBody,
        ip: clientIp(headers),
        userAgent: headers['user-agent'] ?? null,
        get db() {
          return db();
        },
        actor: null,
        setCookies: [],
        responseHeaders: {},
      };

      const authMode = opts.auth ?? 'required';
      if (authMode !== 'none') {
        try {
          ctx.actor = await authenticate({ headers, cookies: ctx.cookies }, db());
        } catch (e) {
          if (authMode === 'required') throw e;
          ctx.actor = null;
          ctx.authError = e;
        }
        if (!ctx.actor && authMode === 'required') throw unauthorized();
        if (opts.csrf !== false) assertCsrf(ctx);
      }

      const out = await fn(ctx);
      const extra = { ...baseHeaders, ...ctx.responseHeaders };
      if (out instanceof Reply) {
        return finish(toResponse(out.status, out.body, { ...extra, ...out.headers }, ctx.setCookies, out.contentType));
      }
      if (out === undefined) return finish(toResponse(204, null, extra, ctx.setCookies, 'application/json'));
      return finish(toResponse(200, out, extra, ctx.setCookies, 'application/json'));
    } catch (e) {
      const cookies = ctx?.setCookies ?? [];
      const extra = { ...baseHeaders, ...(ctx?.responseHeaders ?? {}) };
      let err: HttpError;
      if (e instanceof HttpError) err = e;
      else if (e instanceof ZodError) err = badRequest('Check the highlighted fields.', zodFields(e));
      // A malformed id reaching a uuid column (invalid_text_representation) means "no such row", never a 500.
      else if ((e as { code?: unknown })?.code === '22P02') err = new HttpError(404, 'not_found', 'Not found');
      // Jira, Planview or OpenAI unreachable, slow or failing: 502/504 with a human message, never 500 (QA-009).
      else if (outboundHttpError(e)) err = outboundHttpError(e)!;
      else {
        log('error', {
          event: 'unhandled',
          requestId,
          fn: opts.fn,
          route: `${method} ${subpath}`,
          userId: ctx?.actor?.userId,
          err: errorFields(e),
        });
        err = new HttpError(500, 'server_error', 'Server error');
      }
      if (err.extra.logMessage) {
        log(err.status >= 500 ? 'error' : 'warn', {
          event: 'http_error',
          requestId,
          fn: opts.fn,
          status: err.status,
          message: err.extra.logMessage,
        });
      }
      if (err.extra.retryAfterSec) extra['Retry-After'] = String(Math.max(1, Math.ceil(err.extra.retryAfterSec)));
      return finish(toResponse(err.status, errorBody(err, requestId), extra, cookies, 'application/json'));
    }
  };
}
