/**
 * Typed HTTP errors mapped 1:1 to `ApiErrorCode` from shared/contracts/api.ts (PL-01#AC2-3).
 * Handlers throw these; `withApi` turns them into `ApiError` JSON bodies. Anything else becomes a
 * generic 500 with a request id: no SQL, constraint or upstream text ever reaches the client.
 */
import type { ApiErrorCode } from '../../../shared/contracts/api';
import type { UserRef, ISODateTime } from '../../../shared/contracts/dto';

export interface HttpErrorExtra {
  fields?: Record<string, string>;
  current?: unknown;
  changedBy?: UserRef | null;
  changedAt?: ISODateTime | null;
  retryAfterSec?: number;
  /** Logged, never returned. */
  logMessage?: string;
  /** Additional JSON keys merged into the body (e.g. `{ secretCleared }`). */
  body?: Record<string, unknown>;
}

export class HttpError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly extra: HttpErrorExtra;
  constructor(status: number, code: ApiErrorCode, message: string, extra: HttpErrorExtra = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const badRequest = (message: string, fields?: Record<string, string>) =>
  new HttpError(400, 'bad_request', message, { fields });
export const unauthorized = (message = 'Sign in to continue.') => new HttpError(401, 'unauthorized', message);
export const forbidden = (message = 'You do not have permission to do this.') =>
  new HttpError(403, 'forbidden', message);
export const notFound = (message = 'Not found') => new HttpError(404, 'not_found', message);
export const conflict = (message: string, extra: HttpErrorExtra = {}) => new HttpError(409, 'conflict', message, extra);
export const gone = (message: string) => new HttpError(410, 'gone', message);
/** PL-03#AC1: message for retired v1.1 endpoints. */
export const GONE_MESSAGE = 'PMO Capacity Planner was updated. Reload the page.';
export const payloadTooLarge = (message = 'Request is too large.') => new HttpError(413, 'payload_too_large', message);
export const rateLimited = (message: string, retryAfterSec: number) =>
  new HttpError(429, 'rate_limited', message, { retryAfterSec });
export const entitlementError = (message: string) => new HttpError(403, 'entitlement', message);
export const featureDisabled = (message = 'This feature is turned off for your organisation.') =>
  new HttpError(403, 'feature_disabled', message);
export const migrationPending = () =>
  new HttpError(503, 'migration_pending', 'PMO Capacity Planner is being updated. This usually takes under a minute.', {
    retryAfterSec: 3,
  });
export const upstreamError = (message: string, logMessage?: string) =>
  new HttpError(502, 'server_error', message, { logMessage });
export const serviceUnavailable = (message: string, logMessage?: string) =>
  new HttpError(503, 'server_error', message, { logMessage });
