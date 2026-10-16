/** Legacy GET /api/workspace_lookup (AC-02#AC7): the caller's org slug, from the database. */
import { requireActor, withApi } from './_lib/api';
import { one } from './_lib/db';
import { notFound } from './_lib/errors';

export const handler = withApi({ fn: 'workspace_lookup' }, async (ctx) => {
  if (ctx.method !== 'GET') throw notFound('Not found');
  const actor = requireActor(ctx);
  const row = await one<{ slug: string | null }>(
    ctx.db,
    `SELECT o.slug FROM organizations o
     WHERE o.id = coalesce((SELECT org_id FROM org_memberships WHERE user_id = $1), (SELECT org_id FROM users WHERE id = $1))`,
    [actor.userId],
  );
  return { orgSlug: row?.slug ?? null };
});
