/** Workspace-scoped loaders (every query filters by workspace_id, PL-04#AC10) and reference validators. */
import type {
  AllocationDTO,
  CraftChangeRequestDTO,
  DemandLineDTO,
  MarketplaceOfferDTO,
  PersonDTO,
  ProjectDTO,
} from '../../../shared/contracts/dto';
import type { Queryable } from './db';
import { one } from './db';
import {
  ALLOCATION_COLUMNS,
  ALLOCATION_JOINS,
  CRAFT_REQUEST_COLUMNS,
  CRAFT_REQUEST_JOINS,
  DEMAND_COLUMNS,
  OFFER_COLUMNS,
  PERSON_COLUMNS,
  PROJECT_COLUMNS,
  allocationDTO,
  craftRequestDTO,
  demandDTO,
  offerDTO,
  personDTO,
  projectDTO,
} from './dto';
import { badRequest } from './errors';

export async function loadPeople(q: Queryable, wsId: string, id?: string): Promise<PersonDTO[]> {
  const rows = await q.query(
    `SELECT ${PERSON_COLUMNS} FROM resources r LEFT JOIN users ub ON ub.id = r.updated_by
     WHERE r.workspace_id = $1 ${id ? 'AND r.id = $2' : ''} ORDER BY lower(r.name), r.id`,
    id ? [wsId, id] : [wsId],
  );
  return rows.map(personDTO);
}
export async function loadPerson(q: Queryable, wsId: string, id: string): Promise<PersonDTO | null> {
  return (await loadPeople(q, wsId, id))[0] ?? null;
}

export async function loadProjects(q: Queryable, wsId: string, id?: string): Promise<ProjectDTO[]> {
  const rows = await q.query(
    `SELECT ${PROJECT_COLUMNS} FROM projects p LEFT JOIN users ub ON ub.id = p.updated_by
     WHERE p.workspace_id = $1 ${id ? 'AND p.id = $2' : ''} ORDER BY lower(p.name), p.id`,
    id ? [wsId, id] : [wsId],
  );
  return rows.map(projectDTO);
}
export async function loadProject(q: Queryable, wsId: string, id: string): Promise<ProjectDTO | null> {
  return (await loadProjects(q, wsId, id))[0] ?? null;
}

export async function loadAllocations(q: Queryable, wsId: string, ids?: string[]): Promise<AllocationDTO[]> {
  const rows = await q.query(
    `SELECT ${ALLOCATION_COLUMNS} FROM allocations a ${ALLOCATION_JOINS}
     WHERE a.workspace_id = $1 ${ids ? 'AND a.id = ANY($2::text[])' : ''} ORDER BY a.resource_id, a.start_date NULLS FIRST, a.id`,
    ids ? [wsId, ids] : [wsId],
  );
  return rows.map(allocationDTO);
}
export async function loadAllocation(q: Queryable, wsId: string, id: string): Promise<AllocationDTO | null> {
  return (await loadAllocations(q, wsId, [id]))[0] ?? null;
}

export async function loadDemand(q: Queryable, wsId: string, ids?: string[]): Promise<DemandLineDTO[]> {
  const rows = await q.query(
    `SELECT ${DEMAND_COLUMNS} FROM demand_lines d LEFT JOIN users ub ON ub.id = d.updated_by
     WHERE d.workspace_id = $1 ${ids ? 'AND d.id = ANY($2::text[])' : ''} ORDER BY d.project_id, d.quarter_key, d.craft_id`,
    ids ? [wsId, ids] : [wsId],
  );
  return rows.map(demandDTO);
}
export async function loadDemandLine(q: Queryable, wsId: string, id: string): Promise<DemandLineDTO | null> {
  return (await loadDemand(q, wsId, [id]))[0] ?? null;
}

export async function loadOffers(q: Queryable, wsId: string): Promise<MarketplaceOfferDTO[]> {
  const rows = await q.query(
    `SELECT ${OFFER_COLUMNS} FROM marketplace_offers o LEFT JOIN users cb ON cb.id = o.created_by
     WHERE o.workspace_id = $1 ORDER BY o.quarter_key, o.person_id`,
    [wsId],
  );
  return rows.map(offerDTO);
}

export async function loadCraftRequests(
  q: Queryable,
  wsId: string,
  filter: { status?: string; personId?: string; id?: string } = {},
): Promise<CraftChangeRequestDTO[]> {
  const params: unknown[] = [wsId];
  const where = ['c.workspace_id = $1'];
  if (filter.status) {
    params.push(filter.status);
    where.push(`c.status = $${params.length}`);
  }
  if (filter.personId) {
    params.push(filter.personId);
    where.push(`c.person_id = $${params.length}`);
  }
  if (filter.id) {
    params.push(filter.id);
    where.push(`c.id = $${params.length}`);
  }
  const rows = await q.query(
    `SELECT ${CRAFT_REQUEST_COLUMNS} FROM craft_change_requests c ${CRAFT_REQUEST_JOINS}
     WHERE ${where.join(' AND ')} ORDER BY c.submitted_at DESC`,
    params,
  );
  return rows.map(craftRequestDTO);
}

// ── Reference validation (400 with a field message) ────────────────────────

export async function assertCraft(q: Queryable, orgId: string, craftId: string, field: string, allowArchived = false) {
  const c = await one<{ archived: boolean }>(q, `SELECT archived FROM crafts WHERE org_id = $1 AND id = $2`, [
    orgId,
    craftId,
  ]);
  if (!c) throw badRequest('Unknown craft', { [field]: 'Unknown craft' });
  if (c.archived && !allowArchived) throw badRequest('This craft is archived', { [field]: 'This craft is archived' });
}

export async function assertOrgRow(
  q: Queryable,
  table: 'tribes' | 'chapters' | 'org_teams',
  orgId: string,
  id: string,
  field: string,
) {
  if (!(await one(q, `SELECT 1 AS x FROM ${table} WHERE org_id = $1 AND id = $2`, [orgId, id]))) {
    throw badRequest('Unknown reference', { [field]: 'Not found in this organisation' });
  }
}

export async function assertOrgUser(q: Queryable, orgId: string, userId: string, field: string) {
  const ok = await one(
    q,
    `SELECT 1 AS x FROM users u LEFT JOIN org_memberships m ON m.user_id = u.id
     WHERE u.id::text = $2 AND (m.org_id = $1 OR (m.org_id IS NULL AND u.org_id = $1))`,
    [orgId, userId],
  );
  if (!ok) throw badRequest('Not a member of this organisation', { [field]: 'Not a member of this organisation' });
}

export async function assertInWorkspace(
  q: Queryable,
  table: 'resources' | 'projects',
  wsId: string,
  id: string,
  field: string,
) {
  if (!(await one(q, `SELECT 1 AS x FROM ${table} WHERE workspace_id = $1 AND id = $2`, [wsId, id]))) {
    throw badRequest('Not in this workspace', { [field]: 'Not in this workspace' });
  }
}

/** Keeps projects.craft_demand (read by v1.1) in sync with demand_lines (PL-04#AC8). */
export async function syncProjectCraftDemand(q: Queryable, projectId: string): Promise<void> {
  await q.query(
    `UPDATE projects SET craft_demand = coalesce((
       SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('quarterKey', d.quarter_key, 'craftId', d.craft_id,
                'fte', d.fte::float8, 'note', d.note)) ORDER BY d.quarter_key, d.craft_id)
       FROM demand_lines d WHERE d.project_id = $1), '[]'::jsonb)
     WHERE id = $1`,
    [projectId],
  );
}
