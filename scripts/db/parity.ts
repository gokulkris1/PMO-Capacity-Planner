/**
 * npm run db:parity -- --snapshot before.json     (before migrating: record counts and row checksums)
 * npm run db:parity -- --before before.json       (after migrating: compare, PL-14#AC1)
 *
 * Compares per-table row counts and per-row checksums of the v1.1 columns of users(id, email, password_hash),
 * resources, projects, allocations, workspace_members, organizations and workspaces. Prints
 * "0 rows lost, 0 credential changes" or the differences and exits 1. New 2.0 columns are not part of the checksum,
 * so additive migrations and backfills of new columns do not count as changes. No values are printed, only ids.
 */
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { connect, pgSession } from './migrate';
import type { Queryable } from '../../netlify/functions/_lib/db';

interface TableSpec {
  key: string;
  cols: string[];
}

/** v1.1 columns only (present before and after 2.0). */
export const PARITY_TABLES: Record<string, TableSpec> = {
  users: { key: 'id::text', cols: ['id', 'email', 'password_hash'] },
  organizations: { key: 'id::text', cols: ['id', 'name', 'slug'] },
  workspaces: { key: 'id::text', cols: ['id', 'org_id', 'name'] },
  workspace_members: { key: "user_id::text || ':' || workspace_id::text", cols: ['user_id', 'workspace_id', 'role'] },
  resources: {
    key: 'id::text',
    cols: ['id', 'workspace_id', 'name', 'role', 'type', 'total_capacity', 'email', 'craft_profile'],
  },
  projects: {
    key: 'id::text',
    cols: ['id', 'workspace_id', 'name', 'status', 'priority', 'start_date', 'end_date', 'craft_demand'],
  },
  allocations: {
    key: 'id::text',
    cols: ['id', 'workspace_id', 'resource_id', 'project_id', 'percentage', 'start_date', 'end_date'],
  },
};

export interface ParitySnapshot {
  takenAt: string;
  tables: Record<string, { count: number; rows: Record<string, string> }>;
}

export async function takeSnapshot(q: Queryable): Promise<ParitySnapshot> {
  const out: ParitySnapshot = { takenAt: new Date().toISOString(), tables: {} };
  for (const [table, spec] of Object.entries(PARITY_TABLES)) {
    const hash = `md5(concat_ws('|', ${spec.cols.map((c) => `coalesce(${c}::text, '∅')`).join(', ')}))`;
    const rows = await q.query<{ k: string; h: string }>(`SELECT ${spec.key} AS k, ${hash} AS h FROM ${table}`);
    out.tables[table] = { count: rows.length, rows: Object.fromEntries(rows.map((r) => [r.k, r.h])) };
  }
  return out;
}

export interface ParityReport {
  lost: Record<string, string[]>;
  changed: Record<string, string[]>;
  credentialChanges: string[];
  counts: Record<string, { before: number; after: number }>;
}

export function compareSnapshots(before: ParitySnapshot, after: ParitySnapshot): ParityReport {
  const report: ParityReport = { lost: {}, changed: {}, credentialChanges: [], counts: {} };
  for (const table of Object.keys(PARITY_TABLES)) {
    const b = before.tables[table] ?? { count: 0, rows: {} };
    const a = after.tables[table] ?? { count: 0, rows: {} };
    report.counts[table] = { before: b.count, after: a.count };
    for (const [k, h] of Object.entries(b.rows)) {
      if (!(k in a.rows)) (report.lost[table] ??= []).push(k);
      else if (a.rows[k] !== h) {
        if (table === 'users') report.credentialChanges.push(k);
        else (report.changed[table] ??= []).push(k);
      }
    }
  }
  return report;
}

export function summarise(r: ParityReport): { ok: boolean; text: string } {
  const lost = Object.values(r.lost).reduce((n, l) => n + l.length, 0);
  const changed = Object.values(r.changed).reduce((n, l) => n + l.length, 0);
  const lines = [`${lost} rows lost, ${r.credentialChanges.length} credential changes`];
  if (changed) lines.push(`${changed} rows changed in v1.1 columns`);
  for (const [t, ids] of Object.entries(r.lost))
    lines.push(`  lost ${t}: ${ids.slice(0, 20).join(', ')}${ids.length > 20 ? ' …' : ''}`);
  for (const [t, ids] of Object.entries(r.changed))
    lines.push(`  changed ${t}: ${ids.slice(0, 20).join(', ')}${ids.length > 20 ? ' …' : ''}`);
  if (r.credentialChanges.length)
    lines.push(`  credential changes (user ids): ${r.credentialChanges.slice(0, 20).join(', ')}`);
  for (const [t, c] of Object.entries(r.counts))
    lines.push(`  ${t.padEnd(18)} ${String(c.before).padStart(7)} → ${c.after}`);
  return { ok: lost === 0 && changed === 0 && r.credentialChanges.length === 0, text: lines.join('\n') };
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const flag = (n: string) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
  const snapshotPath = flag('--snapshot');
  const beforePath = flag('--before');
  if (!snapshotPath && !beforePath) {
    console.error('Usage: db:parity -- --snapshot before.json | --before before.json');
    return 1;
  }
  const client = connect();
  await client.connect();
  try {
    const now = await takeSnapshot(pgSession(client));
    if (snapshotPath) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- operator-supplied output path
      writeFileSync(snapshotPath, JSON.stringify(now));
      console.log(
        `Snapshot written to ${snapshotPath}: ${Object.entries(now.tables)
          .map(([t, v]) => `${t}=${v.count}`)
          .join(', ')}`,
      );
      return 0;
    }
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- operator-supplied input path
    const before = JSON.parse(readFileSync(beforePath!, 'utf8')) as ParitySnapshot;
    const { ok, text } = summarise(compareSnapshots(before, now));
    console.log(text);
    return ok ? 0 : 1;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && /parity\.ts$/.test(process.argv[1])) {
  main().then((code) => process.exit(code));
}
