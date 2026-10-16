/**
 * GET /orgs/:orgId/audit (AC-10#AC4): ORG_ADMIN sees the org's events; WORKSPACE_ADMIN only events of workspaces
 * they administer (workspaceId required); JSON pages (cursor) or CSV.
 * POST /workspaces/:wsId/audit/export (RP-04#AC4): the client reports a PDF/CSV export.
 */
import { z } from 'zod';
import type { AuditEventDTO } from '../../../../shared/contracts/api';
import type { Ctx } from '../api';
import { auditCtx, noContent, parseWith, textReply } from '../api';
import { audit } from '../audit';
import { requireOrg, requireWorkspace, UUID_RE } from '../authz';
import { iso } from '../db';
import { badRequest, forbidden } from '../errors';
import type { Params } from '../router';

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; // CSV injection guard
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export async function orgAudit(ctx: Ctx, p: Params) {
  const access = await requireOrg(ctx, p.orgId, ['org.audit.view', 'workspace.audit.view']);
  const wsId = ctx.query.workspaceId;
  if (wsId !== undefined && !UUID_RE.test(wsId)) throw badRequest('Invalid workspaceId', { workspaceId: 'Invalid' });
  if (!access.permissions.has('org.audit.view')) {
    if (!wsId || !access.adminWorkspaceIds.includes(wsId))
      throw forbidden('You can only view the audit log of workspaces you administer.');
  }
  const params: unknown[] = [p.orgId];
  const where = ['e.org_id = $1'];
  if (wsId) {
    params.push(wsId);
    where.push(`e.workspace_id = $${params.length}`);
  }
  for (const [key, op] of [
    ['from', '>='],
    ['to', '<='],
  ] as const) {
    const v = ctx.query[key];
    if (v) {
      if (Number.isNaN(Date.parse(v))) throw badRequest(`Invalid ${key}`, { [key]: 'Use an ISO date' });
      params.push(new Date(v).toISOString());
      where.push(`e.occurred_at ${op} $${params.length}`);
    }
  }
  if (ctx.query.action) {
    params.push(ctx.query.action);
    where.push(`e.action = $${params.length}`);
  }
  if (ctx.query.cursor) {
    if (!/^\d+$/.test(ctx.query.cursor)) throw badRequest('Invalid cursor', { cursor: 'Invalid' });
    params.push(ctx.query.cursor);
    where.push(`e.id < $${params.length}::bigint`);
  }
  const csv = ctx.query.format === 'csv';
  const limit = csv ? 5000 : Math.min(Math.max(Number(ctx.query.limit) || 100, 1), 500);
  const rows = await ctx.db.query(
    `SELECT e.id::text AS id, e.occurred_at, e.actor_user_id, u.name AS actor_name, e.actor_type, e.action, e.workspace_id,
            e.target_type, e.target_id, e.before, e.after, e.request_id
     FROM audit_events e LEFT JOIN users u ON u.id = e.actor_user_id
     WHERE ${where.join(' AND ')} ORDER BY e.id DESC LIMIT ${limit + 1}`,
    params,
  );
  const page = rows.slice(0, limit);
  const events: AuditEventDTO[] = page.map((r) => ({
    id: String(r.id),
    occurredAt: iso(r.occurred_at) ?? '',
    actor: r.actor_user_id ? { id: String(r.actor_user_id), name: String(r.actor_name ?? 'Unknown user') } : null,
    actorType: String(r.actor_type),
    action: String(r.action),
    workspaceId: r.workspace_id ? String(r.workspace_id) : null,
    targetType: r.target_type ? String(r.target_type) : null,
    targetId: r.target_id ? String(r.target_id) : null,
    before: r.before ?? null,
    after: r.after ?? null,
    requestId: r.request_id ? String(r.request_id) : null,
  }));
  if (csv) {
    const header = [
      'occurredAt',
      'actor',
      'actorType',
      'action',
      'workspaceId',
      'targetType',
      'targetId',
      'before',
      'after',
      'requestId',
    ];
    const lines = events.map((e) =>
      [
        e.occurredAt,
        e.actor?.name ?? '',
        e.actorType,
        e.action,
        e.workspaceId,
        e.targetType,
        e.targetId,
        e.before,
        e.after,
        e.requestId,
      ]
        .map(csvCell)
        .join(','),
    );
    return textReply(200, [header.join(','), ...lines].join('\n') + '\n', 'text/csv; charset=utf-8', {
      'Content-Disposition': 'attachment; filename="audit-events.csv"',
    });
  }
  return { events, next: rows.length > limit ? events[events.length - 1].id : null };
}

export async function exportAudit(ctx: Ctx, p: Params) {
  const access = await requireWorkspace(ctx, p.wsId, 'export');
  const body = parseWith(
    z.object({ kind: z.enum(['pdf', 'csv']), report: z.string().trim().min(1).max(120) }),
    ctx.body,
  );
  await audit(ctx.db, auditCtx(ctx), {
    action: `export.${body.kind}`,
    orgId: access.orgId,
    workspaceId: p.wsId,
    targetType: 'report',
    targetId: body.report,
  });
  return noContent();
}
