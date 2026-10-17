/**
 * /api/v2/* — per-entity API with optimistic concurrency (PL-04). One function, internal router.
 * Authentication is resolved by withApi; each route declares whether a session is required.
 */
import { withApi } from './_lib/api';
import { v2Router } from './_lib/v2routes';

export const handler = withApi({ fn: 'v2', auth: 'optional', maxBodyBytes: 4 * 1024 * 1024 }, (ctx) =>
  v2Router.dispatch(ctx, ctx.subpath),
);
