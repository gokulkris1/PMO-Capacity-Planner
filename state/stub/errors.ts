/** WP-0 STUB: the error type every client call rejects with (BACKLOG §4.3). C keeps the shape. */
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
