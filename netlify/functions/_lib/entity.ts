/** Helpers shared by the versioned entity handlers (PL-04). */
import { randomUUID } from 'node:crypto';
import type { Queryable } from './db';
import { badRequest, conflict, notFound } from './errors';
import { UUID_RE } from './authz';
import type { UserRef, ISODateTime } from '../../../shared/contracts/dto';

/** PL-04#AC5: client-supplied ids must be UUIDs; omitted ids get a server UUIDv4. */
export function newId(supplied: unknown): string {
  if (supplied === undefined || supplied === null || supplied === '') return randomUUID();
  if (typeof supplied !== 'string' || !UUID_RE.test(supplied))
    throw badRequest('id must be a UUID', { id: 'Must be a UUID' });
  return supplied.toLowerCase();
}

export function requireVersion(v: unknown, field = 'version'): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  if (!Number.isInteger(n) || n < 0) throw badRequest('version is required', { [field]: 'Required' });
  return n;
}

export async function bumpDataVersion(q: Queryable, wsId: string): Promise<number> {
  const rows = await q.query<{ data_version: number }>(
    'UPDATE workspaces SET data_version = data_version + 1 WHERE id = $1 RETURNING data_version',
    [wsId],
  );
  return Number(rows[0]?.data_version ?? 0);
}

/** A typed value for `buildSet`: plain, JSONB (stringified + cast) or an array with a cast. */
export type SetValue = { jsonb: unknown } | { array: unknown[]; cast: string } | unknown;

export function buildSet(values: Record<string, SetValue>, start: number): { sql: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  let i = start;
  for (const [col, v] of Object.entries(values)) {
    if (v && typeof v === 'object' && 'jsonb' in (v as object)) {
      parts.push(`${col} = $${i}::jsonb`);
      params.push(JSON.stringify((v as { jsonb: unknown }).jsonb));
    } else if (v && typeof v === 'object' && 'array' in (v as object) && 'cast' in (v as object)) {
      parts.push(`${col} = $${i}::${(v as { cast: string }).cast}`);
      params.push((v as { array: unknown[] }).array);
    } else {
      parts.push(`${col} = $${i}`);
      params.push(v);
    }
    i++;
  }
  return { sql: parts.join(', '), params };
}

export interface VersionedDto {
  version: number;
  updatedAt: ISODateTime;
  updatedBy: UserRef | null;
}

/** After a versioned UPDATE matched no row: 404 when the row is gone, else 409 with the latest row (PL-04#AC3). */
export async function staleOrMissing<T extends VersionedDto>(
  load: () => Promise<T | null>,
  label = 'record',
): Promise<never> {
  const current = await load();
  if (!current) throw notFound(`This ${label} no longer exists.`);
  throw conflict('This record changed', {
    current,
    changedBy: current.updatedBy,
    changedAt: current.updatedAt,
  });
}

export function quarterRange(quarterKey: string): { from: string; to: string } {
  const [y, q] = quarterKey.split('-Q').map(Number);
  const startMonth = (q - 1) * 3;
  const from = new Date(Date.UTC(y, startMonth, 1));
  const to = new Date(Date.UTC(y, startMonth + 3, 0));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export function quarterKeyOf(d: Date): string {
  return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
}

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Runs a statement inside a SAVEPOINT and swallows its failure. Used only for v1.1 dual-writes whose legacy CHECK
 * constraints may differ between databases (users.role, users.plan): the 2.0 write must not fail because of them.
 * Must be called inside a transaction.
 */
export async function bestEffort(q: Queryable, text: string, params: unknown[] = []): Promise<boolean> {
  await q.query('SAVEPOINT best_effort');
  try {
    await q.query(text, params);
    await q.query('RELEASE SAVEPOINT best_effort');
    return true;
  } catch {
    await q.query('ROLLBACK TO SAVEPOINT best_effort');
    return false;
  }
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'org'
  );
}
