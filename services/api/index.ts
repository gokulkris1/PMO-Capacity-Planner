/**
 * Client API layer (PL-05). Pages never import this directly: they use the hooks in `state/`.
 * `state/` and the legacy AI shim are the only consumers.
 */
export { ApiRequestError, errorFromResponse, isApiErrorBody, NETWORK_ERROR_CODE, userMessage } from './errors';
export { withQuery, type HttpMethod, type RequestOptions, type Transport, type TransportEvent } from './transport';
export {
  HttpTransport,
  readCookie,
  CSRF_COOKIE,
  CSRF_HEADER,
  LEGACY_TOKEN_KEY,
  LEGACY_USER_KEY,
  type LegacyExchangeResult,
} from './httpTransport';
export {
  DemoTransport,
  DEMO_STORAGE_KEY,
  demoOptionsFromSearch,
  newUuid,
  type DemoTransportOptions,
} from './demoTransport';
export { createApiClient, type ApiClient, type StructureKind } from './client';
export {
  buildDemoDb,
  DEMO_ROLES,
  DEMO_PASSWORD,
  DEMO_OTP,
  DEMO_WORKSPACE_ID,
  DEMO_LINKED_PERSON_ID,
  type DemoRole,
} from './demo/seed';
