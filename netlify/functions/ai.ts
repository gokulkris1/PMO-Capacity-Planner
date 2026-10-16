/**
 * POST /api/ai (HS-11, SEC-16, SEC-29): off unless the org enables `aiAssistant`; the client sends
 * `{ wsId, question }` only and the server builds the prompt from workspace data; per-org monthly quota with an
 * atomic check-and-increment; upstream failures return a generic 502; only OPENAI_API_KEY is read.
 */
import { z } from 'zod';
import { auditCtx, parseWith, withApi } from './_lib/api';
import { audit } from './_lib/audit';
import { orgEntitlements, requireFeature, requireWorkspace } from './_lib/authz';
import { buildSystemPrompt } from './_lib/aiPrompt';
import { optionalEnv } from './_lib/env';
import { badRequest, forbidden, notFound, rateLimited, serviceUnavailable, upstreamError } from './_lib/errors';
import { buildSnapshot } from './_lib/handlers/snapshot';
import { readJson, safeFetch } from './_lib/net';
import { errorFields, log } from './_lib/log';

const schema = z.object({
  wsId: z.string().uuid('Choose a workspace'),
  question: z.string().trim().min(1, 'Ask a question').max(2000, 'Keep questions under 2,000 characters'),
});

export const handler = withApi({ fn: 'ai' }, async (ctx) => {
  if (ctx.method !== 'POST') throw notFound('Not found');
  const raw = (ctx.body ?? {}) as { question?: unknown };
  if (typeof raw.question === 'string' && raw.question.length > 2000) {
    throw badRequest('Keep questions under 2,000 characters', { question: 'Keep questions under 2,000 characters' });
  }
  const body = parseWith(schema, ctx.body);
  const access = await requireWorkspace(ctx, body.wsId);
  requireFeature(access.org, 'aiAssistant');
  if (!access.permissions.has('ai.use')) throw forbidden();
  const apiKey = optionalEnv('OPENAI_API_KEY');
  if (!apiKey) throw serviceUnavailable('The AI service is not configured.', 'OPENAI_API_KEY missing');

  const limit = orgEntitlements(access.org).aiQueriesPerMonth;
  const used = await ctx.db.query<{ n: number }>(
    `UPDATE organizations SET
       ai_queries_month = CASE WHEN ai_quota_reset_at < date_trunc('month', now()) THEN 1 ELSE ai_queries_month + 1 END,
       ai_quota_reset_at = CASE WHEN ai_quota_reset_at < date_trunc('month', now()) THEN date_trunc('month', now()) ELSE ai_quota_reset_at END
     WHERE id = $1 AND ($2::int IS NULL OR ai_quota_reset_at < date_trunc('month', now()) OR ai_queries_month < $2::int)
     RETURNING ai_queries_month AS n`,
    [access.orgId, limit],
  );
  if (!used.length) {
    const reset = new Date();
    const next = Date.UTC(reset.getUTCFullYear(), reset.getUTCMonth() + 1, 1);
    throw rateLimited(`Your organisation has used this month's ${limit} AI questions.`, (next - Date.now()) / 1000);
  }

  const snapshot = await buildSnapshot(ctx.db, access, ctx.actor?.userId ?? null);
  const system = buildSystemPrompt(snapshot, access.role);
  let answer: string;
  try {
    const res = await safeFetch(
      'https://api.openai.com/v1/chat/completions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: optionalEnv('OPENAI_MODEL', 'gpt-4o-mini'),
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: body.question },
          ],
          temperature: 0.2,
          max_tokens: 500,
        }),
      },
      { label: 'AI service', timeoutMs: 7000 },
    );
    const { json } = await readJson(res);
    if (!res.ok) throw new Error(`AI upstream ${res.status}`);
    const content = (json as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message?.content;
    answer = typeof content === 'string' && content.trim() ? content.trim() : 'No answer was generated.';
  } catch (e) {
    log('warn', { event: 'ai.upstream_failed', requestId: ctx.requestId, err: errorFields(e) });
    await ctx.db
      .query(`UPDATE organizations SET ai_queries_month = greatest(ai_queries_month - 1, 0) WHERE id = $1`, [
        access.orgId,
      ])
      .catch(() => undefined);
    throw upstreamError('The AI service is unavailable. Try again later.');
  }
  await audit(ctx.db, auditCtx(ctx), {
    action: 'ai.query',
    orgId: access.orgId,
    workspaceId: access.workspaceId,
    targetType: 'workspace',
    targetId: access.workspaceId,
    after: { questionLength: body.question.length, quotaUsed: used[0].n },
  });
  // `response` keeps the v1.1 client working; the 2.0 contract field is `answer`.
  return { answer, response: answer };
});
