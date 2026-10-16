/**
 * /api/qbr/* — legacy QBR sprint-planning module, now tenant-isolated (HS-04, SEC-04).
 * Every route needs `?wsId=` and workspace access: reads data.read, writes qbr.write, scenario commit/delete and
 * seeding qbr.commit. The org is derived from the workspace; a client `orgId` is ignored. Id-addressed rows are
 * looked up inside the workspace (404 otherwise) and multi-statement writes run in one transaction.
 */
import type { Ctx } from './_lib/api';
import { auditCtx, reply, requireActor, withApi } from './_lib/api';
import { audit } from './_lib/audit';
import type { WorkspaceAccess } from './_lib/authz';
import { requireWorkspace, UUID_RE } from './_lib/authz';
import type { Queryable } from './_lib/db';
import { one, withTx } from './_lib/db';
import { isProduction } from './_lib/env';
import { badRequest, forbidden, notFound } from './_lib/errors';
import { seedQbr } from './_lib/qbrSeed';

const NOT_IN_WS = 'Not in this workspace';

function wsIdOf(ctx: Ctx): string {
  const wsId = ctx.query.wsId;
  if (!wsId || !UUID_RE.test(wsId)) throw badRequest('wsId query parameter is required', { wsId: 'Required' });
  return wsId;
}

function idOf(raw: string | undefined): string {
  if (!raw || !UUID_RE.test(raw)) throw notFound('Not found');
  return raw;
}

async function belongs(q: Queryable, sql: string, params: unknown[], field: string) {
  if (!(await one(q, sql, params))) throw badRequest(NOT_IN_WS, { [field]: NOT_IN_WS });
}

async function reads(ctx: Ctx, access: WorkspaceAccess, parts: string[]) {
  const ws = access.workspaceId;
  const db = ctx.db;
  const route = parts[0];
  if (route === 'overview' && parts.length === 1) {
    const [tribes, chapters, coe, quarters, counts] = await Promise.all([
      db.query(
        `SELECT t.*, count(DISTINCT m.id)::int AS member_count, count(DISTINCT s.id)::int AS squad_count FROM qbr_tribes t
         LEFT JOIN qbr_members m ON m.tribe_id = t.id LEFT JOIN qbr_squads s ON s.tribe_id = t.id
         WHERE t.workspace_id = $1 GROUP BY t.id ORDER BY t.name`,
        [ws],
      ),
      db.query(
        `SELECT c.*, count(DISTINCT m.id)::int AS member_count FROM qbr_chapters c LEFT JOIN qbr_members m ON m.chapter_id = c.id
         WHERE c.workspace_id = $1 GROUP BY c.id ORDER BY c.name`,
        [ws],
      ),
      db.query(
        `SELECT g.*, count(DISTINCT m.id)::int AS member_count FROM qbr_coe_groups g LEFT JOIN qbr_members m ON m.coe_id = g.id
         WHERE g.workspace_id = $1 GROUP BY g.id ORDER BY g.name`,
        [ws],
      ),
      db.query(`SELECT * FROM qbr_quarters WHERE workspace_id = $1 ORDER BY start_date`, [ws]),
      db.query(
        `SELECT (SELECT count(*)::int FROM qbr_members WHERE workspace_id = $1) AS members,
                (SELECT count(*)::int FROM qbr_projects WHERE workspace_id = $1) AS projects`,
        [ws],
      ),
    ]);
    return {
      tribes,
      chapters,
      coe,
      quarters,
      stats: { members: counts[0].members, projects: counts[0].projects, tribes: tribes.length, chapters: chapters.length, coe: coe.length },
    };
  }
  if (route === 'quarter' && parts.length === 2) {
    const id = idOf(parts[1]);
    const quarter = await one(db, `SELECT * FROM qbr_quarters WHERE id = $1 AND workspace_id = $2`, [id, ws]);
    if (!quarter) throw notFound('Quarter not found');
    const sprints = await db.query(`SELECT * FROM qbr_sprints WHERE quarter_id = $1 ORDER BY sprint_number`, [id]);
    const bookings = await db.query(
      `SELECT b.*, p.name AS project_name, p.color AS project_color, m.name AS member_name FROM qbr_bookings b
       JOIN qbr_projects p ON p.id = b.project_id JOIN qbr_members m ON m.id = b.member_id
       WHERE b.workspace_id = $2 AND b.sprint_id IN (SELECT id FROM qbr_sprints WHERE quarter_id = $1) AND b.scenario_id IS NULL
       ORDER BY m.name, b.sprint_id`,
      [id, ws],
    );
    return { quarter, sprints, bookings };
  }
  if (route === 'members' && parts.length === 1) {
    return {
      members: await db.query(
        `SELECT m.*, t.name AS tribe_name, t.color AS tribe_color, c.name AS chapter_name, c.color AS chapter_color,
                g.name AS coe_name, g.color AS coe_color
         FROM qbr_members m LEFT JOIN qbr_tribes t ON t.id = m.tribe_id LEFT JOIN qbr_chapters c ON c.id = m.chapter_id
         LEFT JOIN qbr_coe_groups g ON g.id = m.coe_id WHERE m.workspace_id = $1 ORDER BY t.name, c.name, m.name`,
        [ws],
      ),
    };
  }
  if (route === 'projects' && parts.length === 1) {
    return {
      projects: await db.query(
        `SELECT p.*, t.name AS tribe_name, o.title AS okr_title FROM qbr_projects p LEFT JOIN qbr_tribes t ON t.id = p.tribe_id
         LEFT JOIN qbr_okrs o ON o.id = p.okr_id WHERE p.workspace_id = $1 ORDER BY p.name`,
        [ws],
      ),
    };
  }
  if (route === 'okrs' && parts.length === 1) {
    return {
      okrs: await db.query(
        `SELECT o.*, t.name AS tribe_name FROM qbr_okrs o LEFT JOIN qbr_tribes t ON t.id = o.tribe_id WHERE o.workspace_id = $1 ORDER BY o.level, o.title`,
        [ws],
      ),
    };
  }
  if (route === 'squads' && parts.length === 1) {
    const squads = await db.query(
      `SELECT s.*, t.name AS tribe_name, p.name AS project_name FROM qbr_squads s LEFT JOIN qbr_tribes t ON t.id = s.tribe_id
       LEFT JOIN qbr_projects p ON p.id = s.project_id WHERE s.workspace_id = $1 ORDER BY s.name`,
      [ws],
    );
    const squadMembers = await db.query(
      `SELECT sm.*, m.name AS member_name, m.member_type, c.name AS chapter_name, t.name AS tribe_name, g.name AS coe_name
       FROM qbr_squad_members sm JOIN qbr_members m ON m.id = sm.member_id LEFT JOIN qbr_chapters c ON c.id = m.chapter_id
       LEFT JOIN qbr_tribes t ON t.id = m.tribe_id LEFT JOIN qbr_coe_groups g ON g.id = m.coe_id
       WHERE sm.squad_id IN (SELECT id FROM qbr_squads WHERE workspace_id = $1)`,
      [ws],
    );
    return { squads, squadMembers };
  }
  if (route === 'scenarios' && parts.length === 1) {
    const quarterId = ctx.query.quarterId && UUID_RE.test(ctx.query.quarterId) ? ctx.query.quarterId : null;
    return {
      scenarios: await db.query(
        `SELECT * FROM qbr_scenarios WHERE workspace_id = $1 AND ($2::uuid IS NULL OR quarter_id = $2) ORDER BY created_at DESC`,
        [ws, quarterId],
      ),
    };
  }
  if (route === 'scenario' && parts.length === 2) {
    const id = idOf(parts[1]);
    if (!(await one(db, `SELECT 1 AS x FROM qbr_scenarios WHERE id = $1 AND workspace_id = $2`, [id, ws]))) throw notFound('Scenario not found');
    return {
      bookings: await db.query(
        `SELECT b.*, p.name AS project_name, p.color AS project_color, m.name AS member_name FROM qbr_bookings b
         JOIN qbr_projects p ON p.id = b.project_id JOIN qbr_members m ON m.id = b.member_id
         WHERE b.scenario_id = $1 AND b.workspace_id = $2 ORDER BY m.name, b.sprint_id`,
        [id, ws],
      ),
    };
  }
  throw notFound('Not found');
}

async function upsertBooking(ctx: Ctx, access: WorkspaceAccess) {
  const b = (ctx.body ?? {}) as Record<string, unknown>;
  const memberId = String(b.memberId ?? '');
  const projectId = String(b.projectId ?? '');
  const sprintId = String(b.sprintId ?? '');
  const scenarioId = b.scenarioId ? String(b.scenarioId) : null;
  if (!memberId || !projectId || !sprintId) throw badRequest('memberId, projectId, sprintId required');
  const pct = Number(b.percentage);
  if (!Number.isFinite(pct) || pct > 100) throw badRequest('Percentage must be 0–100', { percentage: 'Use 0–100' });
  const ws = access.workspaceId;
  return withTx(async (q) => {
    const uuidOr = (v: string, field: string) => {
      if (!UUID_RE.test(v)) throw badRequest(NOT_IN_WS, { [field]: NOT_IN_WS });
    };
    uuidOr(memberId, 'memberId');
    uuidOr(projectId, 'projectId');
    uuidOr(sprintId, 'sprintId');
    await belongs(q, `SELECT 1 AS x FROM qbr_members WHERE id = $1 AND workspace_id = $2`, [memberId, ws], 'memberId');
    await belongs(q, `SELECT 1 AS x FROM qbr_projects WHERE id = $1 AND workspace_id = $2`, [projectId, ws], 'projectId');
    await belongs(q, `SELECT 1 AS x FROM qbr_sprints s JOIN qbr_quarters qu ON qu.id = s.quarter_id WHERE s.id = $1 AND qu.workspace_id = $2`, [sprintId, ws], 'sprintId');
    if (scenarioId) {
      uuidOr(scenarioId, 'scenarioId');
      await belongs(q, `SELECT 1 AS x FROM qbr_scenarios WHERE id = $1 AND workspace_id = $2`, [scenarioId, ws], 'scenarioId');
    }
    const key = [memberId, projectId, sprintId, scenarioId];
    if (pct <= 0) {
      await q.query(
        `DELETE FROM qbr_bookings WHERE member_id = $1 AND project_id = $2 AND sprint_id = $3 AND scenario_id IS NOT DISTINCT FROM $4::uuid`,
        key,
      );
      return { success: true, deleted: true };
    }
    let rows = await q.query(
      `UPDATE qbr_bookings SET percentage = $5, notes = $6 WHERE member_id = $1 AND project_id = $2 AND sprint_id = $3
         AND scenario_id IS NOT DISTINCT FROM $4::uuid RETURNING *`,
      [...key, Math.round(pct), b.notes ?? null],
    );
    if (!rows.length) {
      rows = await q.query(
        `INSERT INTO qbr_bookings (org_id, workspace_id, member_id, project_id, sprint_id, percentage, scenario_id, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [access.orgId, ws, memberId, projectId, sprintId, Math.round(pct), scenarioId, b.notes ?? null],
      );
    }
    await audit(q, auditCtx(ctx), { action: 'qbr.booking', orgId: access.orgId, workspaceId: ws, targetType: 'qbr_booking', targetId: String(rows[0].id) });
    return { success: true, booking: rows[0] };
  });
}

async function writes(ctx: Ctx, access: WorkspaceAccess, parts: string[]) {
  const ws = access.workspaceId;
  const actor = requireActor(ctx);
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  if (ctx.method === 'POST' && parts[0] === 'booking' && parts.length === 1) return upsertBooking(ctx, access);
  if (ctx.method === 'POST' && parts[0] === 'scenario' && parts.length === 1) {
    const name = String(body.name ?? '').trim();
    const quarterId = String(body.quarterId ?? '');
    if (!name || !UUID_RE.test(quarterId)) throw badRequest('name and quarterId required');
    return withTx(async (q) => {
      await belongs(q, `SELECT 1 AS x FROM qbr_quarters WHERE id = $1 AND workspace_id = $2`, [quarterId, ws], 'quarterId');
      const [scenario] = await q.query(
        `INSERT INTO qbr_scenarios (org_id, workspace_id, name, description, quarter_id, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [access.orgId, ws, name, body.description ?? null, quarterId, actor.userId],
      );
      await q.query(
        `INSERT INTO qbr_bookings (org_id, workspace_id, member_id, project_id, sprint_id, percentage, scenario_id, notes)
         SELECT org_id, workspace_id, member_id, project_id, sprint_id, percentage, $1, notes FROM qbr_bookings
         WHERE workspace_id = $2 AND scenario_id IS NULL AND sprint_id IN (SELECT id FROM qbr_sprints WHERE quarter_id = $3)`,
        [scenario.id, ws, quarterId],
      );
      await audit(q, auditCtx(ctx), { action: 'qbr.scenario_create', orgId: access.orgId, workspaceId: ws, targetType: 'qbr_scenario', targetId: String(scenario.id) });
      return reply(201, { success: true, scenario });
    });
  }
  if (ctx.method === 'POST' && parts[0] === 'scenario' && parts[2] === 'commit' && parts.length === 3) {
    if (!access.permissions.has('qbr.commit')) throw forbidden('You need the PMO Admin role to do this.');
    const id = idOf(parts[1]);
    return withTx(async (q) => {
      const sc = await one(q, `SELECT * FROM qbr_scenarios WHERE id = $1 AND workspace_id = $2`, [id, ws]);
      if (!sc) throw notFound('Scenario not found');
      await q.query(
        `DELETE FROM qbr_bookings WHERE workspace_id = $1 AND scenario_id IS NULL AND sprint_id IN (SELECT id FROM qbr_sprints WHERE quarter_id = $2)`,
        [ws, sc.quarter_id],
      );
      await q.query(`UPDATE qbr_bookings SET scenario_id = NULL WHERE scenario_id = $1 AND workspace_id = $2`, [id, ws]);
      await q.query(`UPDATE qbr_scenarios SET is_committed = true WHERE id = $1`, [id]);
      await audit(q, auditCtx(ctx), { action: 'qbr.scenario_commit', orgId: access.orgId, workspaceId: ws, targetType: 'qbr_scenario', targetId: id });
      return { success: true };
    });
  }
  if (ctx.method === 'POST' && parts[0] === 'squad' && parts.length === 1) {
    const name = String(body.name ?? '').trim();
    if (!name) throw badRequest('Squad name required');
    return withTx(async (q) => {
      const optional = async (v: unknown, table: string, field: string) => {
        if (!v) return null;
        const s = String(v);
        if (!UUID_RE.test(s)) throw badRequest(NOT_IN_WS, { [field]: NOT_IN_WS });
        await belongs(q, `SELECT 1 AS x FROM ${table} WHERE id = $1 AND workspace_id = $2`, [s, ws], field);
        return s;
      };
      const tribeId = await optional(body.tribeId, 'qbr_tribes', 'tribeId');
      const projectId = await optional(body.projectId, 'qbr_projects', 'projectId');
      const okrId = await optional(body.okrId, 'qbr_okrs', 'okrId');
      const [squad] = await q.query(
        `INSERT INTO qbr_squads (org_id, workspace_id, name, tribe_id, project_id, okr_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [access.orgId, ws, name, tribeId, projectId, okrId],
      );
      for (const m of Array.isArray(body.members) ? (body.members as Array<Record<string, unknown>>) : []) {
        const memberId = await optional(m.memberId, 'qbr_members', 'members');
        const role = ['LEAD', 'MEMBER', 'ADVISOR'].includes(String(m.role)) ? String(m.role) : 'MEMBER';
        await q.query(`INSERT INTO qbr_squad_members (squad_id, member_id, squad_role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [squad.id, memberId, role]);
      }
      return reply(201, { success: true, squad });
    });
  }
  if (ctx.method === 'POST' && parts[0] === 'seed' && parts.length === 1) {
    // HS-04#AC6: never in production, except for platform admins.
    if (isProduction() && !actor.isPlatformAdmin) throw forbidden('Demo data cannot be loaded in production.');
    if (!access.permissions.has('qbr.commit') && !actor.isPlatformAdmin) throw forbidden('You need the PMO Admin role to do this.');
    return withTx(async (q) => {
      const stats = await seedQbr(q, access.orgId, ws);
      await audit(q, auditCtx(ctx), { action: 'qbr.seed', orgId: access.orgId, workspaceId: ws, targetType: 'workspace', targetId: ws });
      return { success: true, message: 'QBR demo data seeded successfully', stats };
    });
  }
  if (ctx.method === 'DELETE' && parts[0] === 'scenario' && parts.length === 2) {
    if (!access.permissions.has('qbr.commit')) throw forbidden('You need the PMO Admin role to do this.');
    const id = idOf(parts[1]);
    return withTx(async (q) => {
      if (!(await one(q, `SELECT 1 AS x FROM qbr_scenarios WHERE id = $1 AND workspace_id = $2`, [id, ws]))) throw notFound('Scenario not found');
      await q.query(`DELETE FROM qbr_bookings WHERE scenario_id = $1 AND workspace_id = $2`, [id, ws]);
      await q.query(`DELETE FROM qbr_scenarios WHERE id = $1 AND workspace_id = $2`, [id, ws]);
      await audit(q, auditCtx(ctx), { action: 'qbr.scenario_delete', orgId: access.orgId, workspaceId: ws, targetType: 'qbr_scenario', targetId: id });
      return { success: true };
    });
  }
  throw notFound('Not found');
}

export const handler = withApi({ fn: 'qbr' }, async (ctx) => {
  const wsId = wsIdOf(ctx);
  const parts = ctx.subpath.split('/').filter(Boolean);
  if (ctx.method === 'GET') return reads(ctx, await requireWorkspace(ctx, wsId, 'data.read'), parts);
  const seeding = parts[0] === 'seed';
  const access = await requireWorkspace(ctx, wsId, seeding ? [] : 'qbr.write');
  return writes(ctx, access, parts);
});
