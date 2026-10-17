/**
 * Audit events (AC-10, review §3.4). `audit(q, ctx, event)` is called with the transaction's `q` so a rolled-back
 * write leaves no audit row. Failed logins use `getDb()` directly (outside any transaction).
 * `before`/`after` pass through `redact()`: never passwords, hashes, OTPs, tokens or secrets.
 */
import type { Queryable } from './db';
import { log, errorFields } from './log';

export type ActorType = 'user' | 'platform_admin' | 'system' | 'integration' | 'webhook';

export interface AuditContext {
  requestId: string | null;
  ip: string | null;
  userAgent: string | null;
  actorUserId: string | null;
  actorType: ActorType;
}

export interface AuditEvent {
  action: string;
  orgId?: string | null;
  workspaceId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
  actorExtId?: string | null;
}

const SENSITIVE = /pass(word)?|hash|otp|token|secret|api[_-]?key|authorization|cookie|csrf|session/i;

export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (depth > 8) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 200).map((v) => redact(v, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE.test(k) ? '[redacted]' : redact(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 2000) return `${value.slice(0, 2000)}…`;
  return value;
}

export async function audit(q: Queryable, ctx: AuditContext, ev: AuditEvent): Promise<void> {
  const before = ev.before === undefined ? null : JSON.stringify(redact(ev.before));
  const after = ev.after === undefined ? null : JSON.stringify(redact(ev.after));
  await q.query(
    `INSERT INTO audit_events (org_id, workspace_id, actor_user_id, actor_type, actor_ext_id, action, target_type, target_id,
       before, after, ip, user_agent, request_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12, $13)`,
    [
      ev.orgId ?? null,
      ev.workspaceId ?? null,
      ctx.actorUserId,
      ctx.actorType,
      ev.actorExtId ?? null,
      ev.action,
      ev.targetType ?? null,
      ev.targetId ?? null,
      before,
      after,
      ctx.ip,
      ctx.userAgent ? ctx.userAgent.slice(0, 300) : null,
      ctx.requestId,
    ],
  );
}

/** For events that must never fail the request (failed logins, support access). */
export async function auditBestEffort(q: Queryable, ctx: AuditContext, ev: AuditEvent): Promise<void> {
  try {
    await audit(q, ctx, ev);
  } catch (e) {
    log('warn', { event: 'audit.write_failed', action: ev.action, err: errorFields(e) });
  }
}

export const SYSTEM_AUDIT: AuditContext = {
  requestId: null,
  ip: null,
  userAgent: null,
  actorUserId: null,
  actorType: 'system',
};
