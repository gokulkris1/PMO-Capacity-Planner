/**
 * Planview v2 (PV-01, PV-02, PV-03): POST /planview/preview · POST /planview/apply · POST /planview/test-mapping.
 * Preview is computed within ~7 s (partial flag when cut short) and stored 30 minutes. Apply runs in one transaction:
 * projects matched by planview_id (name/dates/status only, never demand), bookings matched by external_ref with
 * source 'planview'; manual and marketplace bookings are never touched.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  FieldChange,
  PlanviewAssignmentChange,
  PlanviewPreviewDTO,
  PlanviewProjectChange,
} from '../../../../shared/contracts/dto';
import type { Ctx } from '../api';
import { auditCtx, parseWith, requireActor } from '../api';
import { audit, redact } from '../audit';
import { requireWorkspace } from '../authz';
import type { Queryable } from '../db';
import { iso, json, one, withTx } from '../db';
import { conflict } from '../errors';
import { bumpDataVersion } from '../entity';
import { loadStored, planviewCreds } from '../integrationsStore';
import { TimeoutError, UpstreamError } from '../net';
import { upstreamError } from '../errors';
import type { NormalisedAssignment, NormalisedProject, PlanviewCreds } from '../planview/client';
import {
  adaptiveLogin,
  fetchAssignmentsRaw,
  fetchProjectsRaw,
  normaliseAssignments,
  normaliseProjects,
} from '../planview/client';
import type { Params } from '../router';

const PREVIEW_TTL_MS = 30 * 60 * 1000;
const STATUSES = ['Active', 'On Hold', 'Planning', 'Completed'];

const day = (v: string | null) => (v ? v.slice(0, 10) : null);
function mapStatus(s: string | null): string | null {
  if (!s) return null;
  const hit = STATUSES.find((x) => x.toLowerCase() === s.toLowerCase().replace(/_/g, ' '));
  return hit ?? null;
}
const personKey = (a: NormalisedAssignment) => (a.resourceEmail || a.resourceName || '').trim().toLowerCase();

function upstream(e: unknown): never {
  if (e instanceof UpstreamError) throw upstreamError(`Planview responded ${e.status}: ${e.message}`.slice(0, 200));
  if (e instanceof TimeoutError) throw upstreamError('Planview did not respond in time.');
  throw e;
}

interface PreviewPayload {
  dto: PlanviewPreviewDTO;
  projects: NormalisedProject[];
  assignments: Array<NormalisedAssignment & { personKey: string; suggestedPersonId: string | null }>;
}

export async function planviewPreview(ctx: Ctx, p: Params): Promise<PlanviewPreviewDTO> {
  await requireWorkspace(ctx, p.wsId, 'integrations.run');
  const actor = requireActor(ctx);
  const pv: PlanviewCreds = planviewCreds(await loadStored(ctx.db, p.wsId));
  const deadline = Date.now() + 7000;
  let partial = false;
  let projects: NormalisedProject[] = [];
  const assignments: NormalisedAssignment[] = [];
  try {
    projects = normaliseProjects(pv, await fetchProjectsRaw(pv, 6000));
    const session =
      pv.config.flavour === 'adaptivework'
        ? await adaptiveLogin(pv, Math.max(1000, deadline - Date.now() - 500))
        : undefined;
    for (const pr of projects) {
      const remaining = deadline - Date.now();
      if (remaining < 1200) {
        partial = true;
        break;
      }
      const raw = await fetchAssignmentsRaw(pv, pr.externalId, remaining - 500, session);
      assignments.push(...normaliseAssignments(pv, raw, pr.externalId));
    }
  } catch (e) {
    if (e instanceof TimeoutError && projects.length) partial = true;
    else upstream(e);
  }
  const fetchedProjectIds = new Set(projects.map((x) => x.externalId));
  const dbProjects = await ctx.db.query(
    `SELECT id, name, start_date::text AS start_date, end_date::text AS end_date, status, planview_id FROM projects
     WHERE workspace_id = $1 AND planview_id IS NOT NULL`,
    [p.wsId],
  );
  const byPv = new Map(dbProjects.map((r) => [String(r.planview_id), r]));
  const changeSet = {
    new: [] as PlanviewProjectChange[],
    changed: [] as PlanviewProjectChange[],
    removed: [] as PlanviewProjectChange[],
  };
  for (const x of projects) {
    const row = byPv.get(x.externalId);
    if (!row) {
      changeSet.new.push({ externalId: x.externalId, name: x.name, projectId: null, changes: [] });
      continue;
    }
    const changes: FieldChange[] = [];
    const cmp = (field: string, from: unknown, to: string | null) => {
      if (to !== null && (from ?? null) !== to)
        changes.push({ field, from: from === null || from === undefined ? null : String(from), to });
    };
    cmp('name', row.name, x.name || null);
    cmp('startDate', row.start_date, day(x.startDate));
    cmp('endDate', row.end_date, day(x.endDate));
    cmp('status', row.status, mapStatus(x.status));
    if (changes.length)
      changeSet.changed.push({ externalId: x.externalId, name: x.name, projectId: String(row.id), changes });
  }
  if (!partial) {
    for (const r of dbProjects) {
      if (!fetchedProjectIds.has(String(r.planview_id))) {
        changeSet.removed.push({
          externalId: String(r.planview_id),
          name: String(r.name),
          projectId: String(r.id),
          changes: [],
        });
      }
    }
  }
  // People: confirmed identities first, then email, then exact name (suggestions).
  const identities = await ctx.db.query(
    `SELECT external_id, person_id FROM external_identities WHERE workspace_id = $1 AND provider = 'planview'`,
    [p.wsId],
  );
  const idMap = new Map(identities.map((i) => [String(i.external_id), i.person_id ? String(i.person_id) : null]));
  const people = await ctx.db.query(
    `SELECT id, lower(name) AS name, lower(email) AS email FROM resources WHERE workspace_id = $1`,
    [p.wsId],
  );
  const suggest = (a: NormalisedAssignment): string | null => {
    const email = a.resourceEmail?.toLowerCase();
    if (email) {
      const hit = people.find((x) => x.email === email);
      if (hit) return String(hit.id);
    }
    const byName = people.filter((x) => x.name === a.resourceName.trim().toLowerCase());
    return byName.length === 1 ? String(byName[0].id) : null;
  };
  const dbAllocs = await ctx.db.query(
    `SELECT a.id, a.external_ref, a.percentage, a.start_date::text AS start_date, a.end_date::text AS end_date, a.resource_id, a.project_id, a.source,
            p.planview_id
     FROM allocations a LEFT JOIN projects p ON p.id = a.project_id WHERE a.workspace_id = $1 AND a.external_ref IS NOT NULL AND a.source = 'planview'`,
    [p.wsId],
  );
  const allocByRef = new Map(dbAllocs.map((a) => [String(a.external_ref), a]));
  const enriched = assignments
    .filter((a) => a.externalId && a.percent !== null)
    .map((a) => {
      const key = personKey(a);
      return { ...a, personKey: key, suggestedPersonId: idMap.get(key) ?? suggest(a) };
    });
  const aSet = {
    new: [] as PlanviewAssignmentChange[],
    changed: [] as PlanviewAssignmentChange[],
    removed: [] as PlanviewAssignmentChange[],
    unmatchedPeople: [] as PlanviewPreviewDTO['assignments']['unmatchedPeople'],
  };
  const unmatched = new Map<string, PlanviewPreviewDTO['assignments']['unmatchedPeople'][number]>();
  for (const a of enriched) {
    const projectId = byPv.get(a.projectExternalId)?.id ? String(byPv.get(a.projectExternalId)?.id) : null;
    const confirmedPerson = idMap.get(a.personKey) ?? null;
    if (!confirmedPerson && !unmatched.has(a.personKey)) {
      unmatched.set(a.personKey, {
        externalId: a.personKey,
        name: a.resourceName,
        email: a.resourceEmail,
        suggestedPersonId: a.suggestedPersonId,
      });
    }
    const base = {
      externalId: a.externalId,
      projectExternalId: a.projectExternalId,
      personExternalId: a.personKey,
      personName: a.resourceName,
      projectId,
      personId: confirmedPerson ?? a.suggestedPersonId,
    };
    const existing = allocByRef.get(a.externalId);
    if (!existing) {
      aSet.new.push({ ...base, changes: [] });
      continue;
    }
    const changes: FieldChange[] = [];
    if (Math.round(a.percent ?? 0) !== Number(existing.percentage))
      changes.push({ field: 'percentage', from: String(existing.percentage), to: String(Math.round(a.percent ?? 0)) });
    if (day(a.startDate) && day(a.startDate) !== existing.start_date)
      changes.push({ field: 'startDate', from: (existing.start_date as string) ?? null, to: day(a.startDate) });
    if (day(a.endDate) && day(a.endDate) !== existing.end_date)
      changes.push({ field: 'endDate', from: (existing.end_date as string) ?? null, to: day(a.endDate) });
    if (changes.length)
      aSet.changed.push({
        ...base,
        projectId: String(existing.project_id),
        personId: String(existing.resource_id),
        changes,
      });
  }
  if (!partial) {
    const fetchedRefs = new Set(enriched.map((a) => a.externalId));
    for (const a of dbAllocs) {
      if (!fetchedRefs.has(String(a.external_ref)) && fetchedProjectIds.has(String(a.planview_id))) {
        aSet.removed.push({
          externalId: String(a.external_ref),
          projectExternalId: String(a.planview_id),
          personExternalId: '',
          personName: '',
          projectId: String(a.project_id),
          personId: String(a.resource_id),
          changes: [],
        });
      }
    }
  }
  aSet.unmatchedPeople = [...unmatched.values()];
  const previewId = randomUUID();
  const expiresAt = new Date(Date.now() + PREVIEW_TTL_MS).toISOString();
  const dto: PlanviewPreviewDTO = { previewId, expiresAt, partial, projects: changeSet, assignments: aSet };
  const payload: PreviewPayload = { dto, projects, assignments: enriched };
  await ctx.db.query(`DELETE FROM planview_previews WHERE expires_at < now()`);
  await ctx.db.query(
    `INSERT INTO planview_previews (id, workspace_id, payload, created_by, expires_at) VALUES ($1, $2, $3::jsonb, $4, $5)`,
    [previewId, p.wsId, JSON.stringify(payload), actor.userId, expiresAt],
  );
  return dto;
}

const applySchema = z.object({
  previewId: z.string().uuid(),
  accept: z.object({ projects: z.array(z.string()).max(5000), assignments: z.array(z.string()).max(20000) }),
  personMatches: z.record(z.string(), z.string()).default({}),
});

export const PREVIEW_EXPIRED = 'This preview expired. Run it again.';

async function upsertPvIdentity(
  q: Queryable,
  orgId: string,
  wsId: string,
  key: string,
  personId: string,
  name: string,
  email: string | null,
) {
  await q.query(
    `INSERT INTO external_identities (id, org_id, workspace_id, person_id, provider, external_id, display_name, email, match_method, confirmed, last_seen_at)
     VALUES ($1, $2, $3, $4, 'planview', $5, $6, $7, 'manual', true, now())
     ON CONFLICT (workspace_id, provider, external_id) DO UPDATE SET person_id = EXCLUDED.person_id, match_method = 'manual', confirmed = true,
       last_seen_at = now()`,
    [randomUUID(), orgId, wsId, personId, key, name, email],
  );
}

export async function planviewApply(ctx: Ctx, p: Params) {
  const access = await requireWorkspace(ctx, p.wsId, 'integrations.run');
  const body = parseWith(applySchema, ctx.body);
  const actor = requireActor(ctx);
  return withTx(async (q) => {
    const row = await one(q, `SELECT payload, expires_at FROM planview_previews WHERE id = $1 AND workspace_id = $2`, [
      body.previewId,
      p.wsId,
    ]);
    if (!row || Date.parse(String(iso(row.expires_at))) < Date.now()) throw conflict(PREVIEW_EXPIRED);
    const payload = json<PreviewPayload>(row.payload, { dto: {} as PlanviewPreviewDTO, projects: [], assignments: [] });
    const acceptP = new Set(body.accept.projects);
    const acceptA = new Set(body.accept.assignments);
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const people = new Set(
      (await q.query(`SELECT id FROM resources WHERE workspace_id = $1`, [p.wsId])).map((r) => String(r.id)),
    );
    for (const [key, personId] of Object.entries(body.personMatches)) {
      if (!people.has(personId)) continue;
      const a = payload.assignments.find((x) => x.personKey === key);
      await upsertPvIdentity(q, access.orgId, p.wsId, key, personId, a?.resourceName ?? key, a?.resourceEmail ?? null);
    }
    const byExt = new Map(payload.projects.map((x) => [x.externalId, x]));
    for (const ch of payload.dto.projects.new) {
      if (!acceptP.has(ch.externalId)) continue;
      const x = byExt.get(ch.externalId);
      if (!x) continue;
      await q.query(
        `INSERT INTO projects (id, workspace_id, name, status, priority, description, start_date, end_date, planview_id, source, craft_demand, updated_by)
         VALUES ($1, $2, $3, $4, 'Medium', '', $5, $6, $7, 'planview', '[]'::jsonb, $8)`,
        [
          randomUUID(),
          p.wsId,
          x.name || x.externalId,
          mapStatus(x.status) ?? 'Active',
          day(x.startDate),
          day(x.endDate),
          x.externalId,
          actor.userId,
        ],
      );
      created++;
    }
    for (const ch of payload.dto.projects.changed) {
      if (!acceptP.has(ch.externalId) || !ch.projectId) continue;
      const x = byExt.get(ch.externalId);
      if (!x) continue;
      await q.query(
        `UPDATE projects SET name = coalesce($3, name), start_date = coalesce($4::date, start_date), end_date = coalesce($5::date, end_date),
           status = coalesce($6, status), version = version + 1, updated_at = now(), updated_by = $7
         WHERE workspace_id = $1 AND id = $2 AND planview_id IS NOT NULL`,
        [p.wsId, ch.projectId, x.name || null, day(x.startDate), day(x.endDate), mapStatus(x.status), actor.userId],
      );
      updated++;
    }
    for (const ch of payload.dto.projects.removed) {
      if (!acceptP.has(ch.externalId) || !ch.projectId) continue;
      await q.query(
        `UPDATE projects SET status = 'Completed', version = version + 1, updated_at = now(), updated_by = $3 WHERE workspace_id = $1 AND id = $2`,
        [p.wsId, ch.projectId, actor.userId],
      );
      updated++;
    }
    const projectIdFor = async (ext: string) =>
      (
        await one<{ id: string }>(q, `SELECT id FROM projects WHERE workspace_id = $1 AND planview_id = $2`, [
          p.wsId,
          ext,
        ])
      )?.id ?? null;
    const byRef = new Map(payload.assignments.map((a) => [a.externalId, a]));
    for (const ch of payload.dto.assignments.new) {
      if (!acceptA.has(ch.externalId)) continue;
      const a = byRef.get(ch.externalId);
      const personId = body.personMatches[ch.personExternalId] ?? ch.personId;
      const projectId = await projectIdFor(ch.projectExternalId);
      if (!a || !personId || !people.has(personId) || !projectId) {
        skipped++;
        continue;
      }
      await q.query(
        `INSERT INTO allocations (id, workspace_id, resource_id, project_id, percentage, start_date, end_date, source, state, external_ref, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'planview', 'confirmed', $8, $9)`,
        [
          randomUUID(),
          p.wsId,
          personId,
          projectId,
          Math.min(200, Math.max(1, Math.round(a.percent ?? 0))),
          day(a.startDate),
          day(a.endDate),
          a.externalId,
          actor.userId,
        ],
      );
      if (!body.personMatches[ch.personExternalId]) {
        await upsertPvIdentity(q, access.orgId, p.wsId, ch.personExternalId, personId, a.resourceName, a.resourceEmail);
      }
      created++;
    }
    for (const ch of payload.dto.assignments.changed) {
      if (!acceptA.has(ch.externalId)) continue;
      const a = byRef.get(ch.externalId);
      if (!a) continue;
      const rows = await q.query(
        `UPDATE allocations SET percentage = $3, start_date = coalesce($4::date, start_date), end_date = coalesce($5::date, end_date),
           version = version + 1, updated_at = now(), updated_by = $6
         WHERE workspace_id = $1 AND external_ref = $2 AND source = 'planview' RETURNING id`,
        [
          p.wsId,
          ch.externalId,
          Math.min(200, Math.max(1, Math.round(a.percent ?? 0))),
          day(a.startDate),
          day(a.endDate),
          actor.userId,
        ],
      );
      if (rows.length) updated++;
      else skipped++;
    }
    for (const ch of payload.dto.assignments.removed) {
      if (!acceptA.has(ch.externalId)) continue;
      await q.query(`DELETE FROM allocations WHERE workspace_id = $1 AND external_ref = $2 AND source = 'planview'`, [
        p.wsId,
        ch.externalId,
      ]);
      updated++;
    }
    await q.query(`DELETE FROM planview_previews WHERE id = $1`, [body.previewId]);
    await bumpDataVersion(q, p.wsId);
    await audit(q, auditCtx(ctx), {
      action: 'integration.import',
      orgId: access.orgId,
      workspaceId: p.wsId,
      targetType: 'planview',
      targetId: body.previewId,
      after: { created, updated, skipped },
    });
    return { created, updated, skipped };
  });
}

export async function planviewTestMapping(ctx: Ctx, p: Params) {
  await requireWorkspace(ctx, p.wsId, 'integrations.manage');
  const pv = planviewCreds(await loadStored(ctx.db, p.wsId));
  try {
    const projects = await fetchProjectsRaw(pv, 4000);
    const projectRaw = projects[0] ?? null;
    const mappedProject = projectRaw ? (normaliseProjects(pv, [projectRaw])[0] ?? null) : null;
    let assignmentRaw: Record<string, unknown> | null = null;
    let mappedAssignment: NormalisedAssignment | null = null;
    if (mappedProject) {
      const raw = await fetchAssignmentsRaw(pv, mappedProject.externalId, 3500);
      assignmentRaw = raw[0] ?? null;
      mappedAssignment = assignmentRaw
        ? (normaliseAssignments(pv, [assignmentRaw], mappedProject.externalId)[0] ?? null)
        : null;
    }
    const missing: string[] = [];
    if (!mappedProject?.externalId) missing.push('project.externalId');
    if (!mappedProject?.name) missing.push('project.name');
    if (mappedProject && !mappedAssignment) missing.push('assignment');
    if (mappedAssignment && !mappedAssignment.externalId) missing.push('assignment.externalId');
    if (mappedAssignment && !mappedAssignment.resourceName) missing.push('assignment.resourceName');
    if (mappedAssignment && mappedAssignment.percent === null && mappedAssignment.hours == null)
      missing.push('assignment.percent');
    return {
      source: redact({ project: projectRaw, assignment: assignmentRaw }),
      mapped: { project: mappedProject, assignment: mappedAssignment },
      missing,
    };
  } catch (e) {
    upstream(e);
  }
}
