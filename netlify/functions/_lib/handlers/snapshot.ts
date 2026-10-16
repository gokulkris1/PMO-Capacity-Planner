/**
 * GET /workspaces/:wsId/snapshot (PL-04#AC1: ≤ 6 data queries) and POST /workspaces/:wsId/sample-data (PL-04#AC9).
 */
import { randomUUID } from 'node:crypto';
import type { WorkspaceSnapshot } from '../../../../shared/contracts/dto';
import type { Ctx } from '../api';
import { auditCtx, reply, requireActor } from '../api';
import { audit } from '../audit';
import type { WorkspaceAccess } from '../authz';
import { has, requireWorkspace } from '../authz';
import { seedCrafts } from '../catalog';
import type { Queryable } from '../db';
import { json, one, withTx } from '../db';
import {
  CRAFT_REQUEST_COLUMNS,
  CRAFT_REQUEST_JOINS,
  OFFER_COLUMNS,
  chapterDTO,
  craftDTO,
  craftRequestDTO,
  offerDTO,
  orgDTO,
  teamDTO,
  tribeDTO,
  workspaceDTO,
} from '../dto';
import { conflict } from '../errors';
import { bumpDataVersion, quarterKeyOf, quarterRange } from '../entity';
import { loadAllocations, loadDemand, loadPeople, loadProjects, syncProjectCraftDemand } from '../loaders';
import { deliverySummary } from '../jira/summary';
import type { Params } from '../router';

type R = Record<string, unknown>;
/** OFFER_COLUMNS with the offers alias renamed (the outer query uses `o` for organizations). */
const OFFER_COLUMNS_O2 = OFFER_COLUMNS.replace(/\bo\./g, 'o2.');

export async function buildSnapshot(q: Queryable, access: WorkspaceAccess): Promise<WorkspaceSnapshot> {
  const wsId = access.workspaceId;
  const requestFilter = has(access, 'craftProfile.approve')
    ? 'TRUE'
    : has(access, 'people.write.own') && access.linkedPersonId
      ? 'c.person_id = $2'
      : 'FALSE';
  const structure = q.query(
    `SELECT w.id, w.org_id, w.name, w.data_version, w.created_at, (SELECT name FROM users WHERE id = o.updated_by) AS org_updated_by_name,
       row_to_json(o.*) AS org,
       (SELECT coalesce(json_agg(row_to_json(t) ORDER BY lower(t.name)), '[]') FROM (SELECT x.*, ub.name AS updated_by_name FROM tribes x LEFT JOIN users ub ON ub.id = x.updated_by WHERE x.org_id = w.org_id) t) AS tribes,
       (SELECT coalesce(json_agg(row_to_json(t) ORDER BY lower(t.name)), '[]') FROM (SELECT x.*, ub.name AS updated_by_name FROM chapters x LEFT JOIN users ub ON ub.id = x.updated_by WHERE x.org_id = w.org_id) t) AS chapters,
       (SELECT coalesce(json_agg(row_to_json(t) ORDER BY lower(t.name)), '[]') FROM (SELECT x.*, ub.name AS updated_by_name FROM org_teams x LEFT JOIN users ub ON ub.id = x.updated_by WHERE x.org_id = w.org_id) t) AS teams,
       (SELECT coalesce(json_agg(row_to_json(t) ORDER BY t.sort_order, lower(t.name)), '[]') FROM (SELECT x.*, ub.name AS updated_by_name FROM crafts x LEFT JOIN users ub ON ub.id = x.updated_by WHERE x.org_id = w.org_id) t) AS crafts,
       (SELECT coalesce(json_agg(row_to_json(t)), '[]') FROM (SELECT ${OFFER_COLUMNS_O2} FROM marketplace_offers o2 LEFT JOIN users cb ON cb.id = o2.created_by WHERE o2.workspace_id = w.id) t) AS offers,
       (SELECT coalesce(json_agg(row_to_json(t)), '[]') FROM (SELECT ${CRAFT_REQUEST_COLUMNS} FROM craft_change_requests c ${CRAFT_REQUEST_JOINS}
          WHERE c.workspace_id = w.id AND c.status = 'pending' AND ${requestFilter} ORDER BY c.submitted_at DESC) t) AS craft_requests
     FROM workspaces w JOIN organizations o ON o.id = w.org_id WHERE w.id = $1`,
    requestFilter === 'c.person_id = $2' ? [wsId, access.linkedPersonId] : [wsId],
  );
  const [structRows, people, projects, allocations, demand] = await Promise.all([
    structure,
    loadPeople(q, wsId),
    loadProjects(q, wsId),
    loadAllocations(q, wsId),
    loadDemand(q, wsId),
  ]);
  const s = structRows[0] as R;
  const org = { ...json<R>(s.org, {}), updated_by_name: s.org_updated_by_name };
  const delivery = await deliverySummary(q, wsId, projects, allocations);
  return {
    org: orgDTO(org),
    workspace: workspaceDTO(s),
    people,
    projects,
    allocations,
    demand,
    tribes: json<R[]>(s.tribes, []).map(tribeDTO),
    chapters: json<R[]>(s.chapters, []).map(chapterDTO),
    teams: json<R[]>(s.teams, []).map(teamDTO),
    crafts: json<R[]>(s.crafts, []).map(craftDTO),
    offers: json<R[]>(s.offers, []).map(offerDTO),
    craftRequests: json<R[]>(s.craft_requests, []).map(craftRequestDTO),
    delivery,
    serverTime: new Date().toISOString(),
  };
}

export async function getSnapshot(ctx: Ctx, p: Params): Promise<WorkspaceSnapshot> {
  const access = await requireWorkspace(ctx, p.wsId, 'data.read');
  return buildSnapshot(ctx.db, access);
}

// ── Sample data (fresh UUIDs, never r1/p1) ─────────────────────────────────

const SAMPLE_TRIBES = ['Payments', 'Lending', 'Digital Experience'];
const SAMPLE_PEOPLE: Array<{
  name: string;
  role: string;
  craft: string;
  below?: [string, 1 | 2 | 3, number];
  tribe: number;
  target?: number;
}> = [
  { name: 'Noma Odigie', role: 'Scrum Master', craft: 'scrum-master', below: ['business-analysis', 2, 30], tribe: 0 },
  {
    name: 'Tom Hayes',
    role: 'Chapter Lead, Delivery',
    craft: 'project-mgmt',
    below: ['programme-mgmt', 3, 50],
    tribe: 1,
  },
  { name: 'Emer Ward', role: 'Chapter Lead, Analysis', craft: 'business-analysis', tribe: 2 },
  { name: 'Liam Murphy', role: 'Project Manager', craft: 'project-mgmt', tribe: 0 },
  { name: 'Aoife Brennan', role: 'Product Manager', craft: 'product-mgmt', below: ['change-mgmt', 1, 20], tribe: 2 },
  { name: 'Sean Doyle', role: 'Digital Planner', craft: 'digital-planning', tribe: 1 },
  {
    name: 'Priya Sharma',
    role: 'PMO Analyst',
    craft: 'pmo-analytics',
    below: ['tooling-admin', 3, 40],
    tribe: 0,
    target: 80,
  },
  { name: 'Ciaran Burke', role: 'Change Lead', craft: 'change-mgmt', tribe: 2 },
];
const SAMPLE_PROJECTS: Array<{ name: string; tribe: number; stage: string; status: string }> = [
  { name: 'Phoenix Payments Platform', tribe: 0, stage: 'In Flight', status: 'Active' },
  { name: 'Ledger Modernisation', tribe: 1, stage: 'Mobilising', status: 'Active' },
  { name: 'Customer Portal Refresh', tribe: 2, stage: 'In Flight', status: 'Active' },
  { name: 'Open Banking APIs', tribe: 0, stage: 'Initiated', status: 'Planning' },
  { name: 'Credit Decisioning', tribe: 1, stage: 'Pipeline', status: 'Planning' },
];
// [person, project, pct, craft or null = primary, quarters from QBR1]
const SAMPLE_BOOKINGS: Array<[number, number, number, string | null, number]> = [
  [0, 0, 60, null, 4],
  [0, 2, 30, 'business-analysis', 2],
  [1, 1, 80, null, 4],
  [2, 2, 50, null, 3],
  [2, 3, 40, null, 2],
  [3, 0, 100, null, 4],
  [4, 2, 70, null, 4],
  [5, 1, 50, null, 2],
  [5, 4, 30, null, 2],
  [6, 0, 40, null, 4],
  [7, 2, 60, null, 3],
];
const SAMPLE_DEMAND: Array<[number, string, number, number]> = [
  [0, 'scrum-master', 1, 0],
  [0, 'project-mgmt', 1, 0],
  [1, 'project-mgmt', 1, 0],
  [2, 'business-analysis', 1.5, 0],
  [3, 'product-mgmt', 0.5, 1],
  [3, 'business-analysis', 1, 1],
  [4, 'digital-planning', 0.5, 2],
];

function quarterKeys(n: number): string[] {
  const now = new Date();
  const out: string[] = [];
  for (let i = 0; i < n; i++)
    out.push(quarterKeyOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 3 * i, 1))));
  return out;
}

export async function installSampleData(ctx: Ctx, p: Params) {
  const access = await requireWorkspace(ctx, p.wsId, 'people.write');
  const actor = requireActor(ctx);
  await withTx(async (q) => {
    const existing = await one<{ n: number }>(
      q,
      `SELECT (SELECT count(*) FROM resources WHERE workspace_id = $1) + (SELECT count(*) FROM projects WHERE workspace_id = $1) AS n`,
      [p.wsId],
    );
    if (Number(existing?.n ?? 0) > 0) throw conflict('This workspace already has data.');
    await seedCrafts(q, access.orgId);
    const tribeIds: string[] = [];
    for (const name of SAMPLE_TRIBES) {
      const found = await one<{ id: string }>(
        q,
        `SELECT id FROM tribes WHERE org_id = $1 AND lower(name) = lower($2)`,
        [access.orgId, name],
      );
      if (found) tribeIds.push(found.id);
      else {
        const id = randomUUID();
        await q.query(`INSERT INTO tribes (id, org_id, name, updated_by) VALUES ($1, $2, $3, $4)`, [
          id,
          access.orgId,
          name,
          actor.userId,
        ]);
        tribeIds.push(id);
      }
    }
    const qk = quarterKeys(4);
    const personIds: string[] = [];
    for (const s of SAMPLE_PEOPLE) {
      const id = randomUUID();
      personIds.push(id);
      const profile = {
        primaryCraft: s.craft,
        secondaryCrafts: s.below ? [{ craftId: s.below[0], proficiency: s.below[1], maxPct: s.below[2] }] : [],
        tribeAffinity: [SAMPLE_TRIBES[s.tribe]],
        targetUtil: s.target ?? 100,
      };
      await q.query(
        `INSERT INTO resources (id, workspace_id, name, role, type, department, total_capacity, avatar_initials, skills, craft_profile,
           home_tribe_id, tribe_affinity_ids, updated_by)
         VALUES ($1, $2, $3, $4, 'Permanent', 'PMO', 100, $5, '{}', $6::jsonb, $7, $8::text[], $9)`,
        [
          id,
          p.wsId,
          s.name,
          s.role,
          s.name
            .split(' ')
            .map((w) => w[0])
            .join('')
            .slice(0, 2),
          JSON.stringify(profile),
          tribeIds[s.tribe],
          [tribeIds[s.tribe]],
          actor.userId,
        ],
      );
    }
    const first = quarterRange(qk[0]).from;
    const last = quarterRange(qk[3]).to;
    const projectIds: string[] = [];
    for (const pr of SAMPLE_PROJECTS) {
      const id = randomUUID();
      projectIds.push(id);
      await q.query(
        `INSERT INTO projects (id, workspace_id, name, status, priority, description, start_date, end_date, tribe_id, client_name, stage, source, craft_demand, updated_by)
         VALUES ($1, $2, $3, $4, 'Medium', '', $5, $6, $7, $8, $9, 'manual', '[]'::jsonb, $10)`,
        [
          id,
          p.wsId,
          pr.name,
          pr.status,
          first,
          last,
          tribeIds[pr.tribe],
          SAMPLE_TRIBES[pr.tribe],
          pr.stage,
          actor.userId,
        ],
      );
    }
    for (const [pi, pj, pct, craft, quarters] of SAMPLE_BOOKINGS) {
      await q.query(
        `INSERT INTO allocations (id, workspace_id, resource_id, project_id, percentage, start_date, end_date, craft_id, source, state, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'manual', 'confirmed', $9)`,
        [
          randomUUID(),
          p.wsId,
          personIds[pi],
          projectIds[pj],
          pct,
          first,
          quarterRange(qk[quarters - 1]).to,
          craft ?? SAMPLE_PEOPLE[pi].craft,
          actor.userId,
        ],
      );
    }
    for (const [pj, craft, fte, qi] of SAMPLE_DEMAND) {
      await q.query(
        `INSERT INTO demand_lines (id, org_id, workspace_id, project_id, quarter_key, craft_id, fte, status, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          randomUUID(),
          access.orgId,
          p.wsId,
          projectIds[pj],
          qk[qi],
          craft,
          fte,
          SAMPLE_PROJECTS[pj].stage === 'In Flight' ? 'Confirmed' : 'Forecast',
          actor.userId,
        ],
      );
    }
    for (const id of projectIds) await syncProjectCraftDemand(q, id);
    await bumpDataVersion(q, p.wsId);
    await audit(q, auditCtx(ctx), {
      action: 'workspace.sample_data',
      orgId: access.orgId,
      workspaceId: p.wsId,
      targetType: 'workspace',
      targetId: p.wsId,
      after: { people: personIds.length, projects: projectIds.length },
    });
  });
  const fresh = await requireWorkspace(ctx, p.wsId, 'data.read');
  return reply(201, await buildSnapshot(ctx.db, fresh));
}
