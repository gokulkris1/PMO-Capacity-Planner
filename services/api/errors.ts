/**
 * The one error type every client call rejects with (BACKLOG §4.3 `ApiRequestError`, PL-05#AC3).
 * Built from the server's `ApiError` body (`shared/contracts/api.ts`); raw response text is never
 * surfaced as a message.
 */
import type { ApiError, ApiErrorCode } from '../../shared/contracts/api';

export class ApiRequestError extends Error {
  status!: number;
  code!: string;
  fields?: Record<string, string>;
  requestId?: string;
  body?: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    extra: { fields?: Record<string, string>; requestId?: string; body?: unknown } = {},
  ) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.fields = extra.fields;
    this.requestId = extra.requestId;
    this.body = extra.body;
  }
}

/** Client-only code for a request that never reached the server. */
export const NETWORK_ERROR_CODE = 'network_error';

const CODE_BY_STATUS: Record<number, ApiErrorCode> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  410: 'gone',
  413: 'payload_too_large',
  429: 'rate_limited',
};

const MESSAGE_BY_CODE: Record<string, string> = {
  bad_request: 'Some details need correcting.',
  unauthorized: 'Please sign in again.',
  forbidden: "You don't have permission to do that.",
  entitlement: "Your plan doesn't include this.",
  feature_disabled: 'This feature is turned off for your organisation.',
  not_found: 'Not found.',
  conflict: 'This record changed since you loaded it.',
  gone: 'This action is no longer available.',
  payload_too_large: 'Too many changes in one go.',
  rate_limited: 'Too many requests. Wait a moment and try again.',
  migration_pending: 'PMO Capacity Planner is being updated. This usually takes under a minute.',
  server_error: 'Something went wrong.',
  [NETWORK_ERROR_CODE]: 'Network error. Check your connection and try again.',
};

export function isApiErrorBody(body: unknown): body is ApiError {
  return (
    !!body &&
    typeof body === 'object' &&
    typeof (body as ApiError).error === 'string' &&
    typeof (body as ApiError).code === 'string'
  );
}

/** Maps any non-2xx response to an ApiRequestError. */
export function errorFromResponse(status: number, body: unknown, requestId?: string): ApiRequestError {
  if (isApiErrorBody(body)) {
    return new ApiRequestError(status, body.code, body.error, {
      fields: body.fields,
      requestId: body.requestId ?? requestId,
      body,
    });
  }
  const code: string = CODE_BY_STATUS[status] ?? 'server_error';
  return new ApiRequestError(status, code, MESSAGE_BY_CODE[code] ?? MESSAGE_BY_CODE.server_error, {
    requestId,
    body: body ?? undefined,
  });
}

export function networkError(cause: unknown): ApiRequestError {
  return new ApiRequestError(0, NETWORK_ERROR_CODE, MESSAGE_BY_CODE[NETWORK_ERROR_CODE], { body: String(cause) });
}

/**
 * The text to show for an error (DS-03#AC6): validation and conflict messages from the API are
 * shown as written; anything unexpected becomes the generic message with the request reference.
 */
export function userMessage(e: unknown): string {
  if (e instanceof ApiRequestError) {
    if (e.status >= 400 && e.status < 500 && e.status !== 401) return e.message;
    if (e.code === 'migration_pending' || e.code === NETWORK_ERROR_CODE) return MESSAGE_BY_CODE[e.code];
    // UAT-01: a server setting is missing; the API's message names it and says who can fix it.
    if (e.code === 'not_configured' && e.message) return e.message;
    // QA-009: an outbound integration failed (502) or timed out (504); the API's message is written for people.
    if ((e.status === 502 || e.status === 504) && e.message && e.message !== MESSAGE_BY_CODE.server_error)
      return e.message;
    return e.requestId
      ? `Something went wrong. Try again, or quote reference ${e.requestId}.`
      : 'Something went wrong. Try again.';
  }
  return 'Something went wrong. Try again.';
}
