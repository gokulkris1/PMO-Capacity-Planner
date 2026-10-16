/**
 * Authorisation (AC-02, AC-09, UAM-02). Tenant is always resolved from the resource (`workspaces.org_id`), never
 * from a client-supplied orgId. Roles come from `org_memberships` / `workspace_members.access_role`, with a
 * dual-read fallback to the v1.1 columns for rows written by v1.1 code (rollback window).
 * Permissions come only from `shared/permissions.ts`.
 *
 * Platform admins without a membership get read-only support access (org.view, data.read, export) and every such
 * request writes `support.access` (AC-07#AC5). Writes need a real membership (support grants are AC-12, Should).
 */
import type { Actor } from './auth';
import type { Ctx } from './api';
import { auditCtx, requireActor } from './api';
import { auditBestEffort } from './audit';
import type { Queryable } from './db';
import { one } from './db';
import { entitlementError, featureDisabled, forbidden, notFound } from './errors';
import { appMode } from './env';
import { ORG_COLUMNS, featuresOf, planOf } from './dto';
import {
  ORG_ADMIN_PERMISSIONS,
  ROLE_LABEL,
  WORKSPACE_ROLE_PERMISSIONS,
  fromLegacyWorkspaceRole,
  permissionsFor,
  type Permission,
} from '../../../shared/permissions';
import type { OrgRole, WorkspaceRole } from '../../../shared/contracts/dto';
import { entitlementsFor, type Entitlements } from '../../../shared/entitlements';
import type { FeatureFlag } from '../../../shared/features';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type OrgRowData = Record<string, unknown>;

export interface WorkspaceAccess {
  workspaceId: string;
  workspaceName: string;
  orgId: string;
  org: OrgRowData;
  orgRole: OrgRole | null;
  role: WorkspaceRole | null;
  implicit: boolean;
  permissions: Set<Permission>;
  linkedPersonId: string | null;
  viaPlatformAdmin: boolean;
}

export interface OrgAccess {
  orgId: string;
  org: OrgRowData;
  orgRole: OrgRole | null;
  /** Workspaces (in this org) where the actor is WORKSPACE_ADMIN by explicit membership. */
  adminWorkspaceIds: string[];
  permissions: Set<Permission>;
  viaPlatformAdmin: boolean;
}

const SUPPORT_READ: Permission[] = ['org.view', 'data.read', 'export', 'platform.admin'];

/** Org role from the 2.0 table, else from the v1.1 columns (users.org_id + users.role). */
export function effectiveOrgRole(
  orgId: string,
  membershipRole: unknown,
  userOrgId: unknown,
  userRole: unknown,
): OrgRole | null {
  if (membershipRole === 'ORG_ADMIN' || membershipRole === 'MEMBER') return membershipRole;
  if (userOrgId && String(userOrgId) === orgId) {
    return ['ORG_ADMIN', 'ADMIN', 'SUPERUSER'].includes(String(userRole)) ? 'ORG_ADMIN' : 'MEMBER';
  }
  return null;
}

export function effectiveWorkspaceRole(accessRole: unknown, legacyRole: unknown): WorkspaceRole | null {
  if (accessRole) return fromLegacyWorkspaceRole(String(accessRole));
  if (legacyRole) return fromLegacyWorkspaceRole(String(legacyRole));
  return null;
}

export async function resolveWorkspaceAccess(
  q: Queryable,
  actor: Actor,
  wsId: string,
): Promise<WorkspaceAccess | 'not_found'> {
  if (!UUID_RE.test(wsId)) return 'not_found';
  const row = await one(
    q,
    `SELECT w.id AS ws_id, w.name AS ws_name, w.org_id AS ws_org_id,
            wm.access_role, wm.role AS legacy_ws_role, om.role AS org_role, u.org_id AS user_org_id, u.role AS user_role,
            (SELECT r.id FROM resources r WHERE r.workspace_id = w.id AND r.linked_user_id = $2 ORDER BY r.id LIMIT 1)
              AS linked_person_id,
            ${ORG_COLUMNS}
     FROM workspaces w
     JOIN organizations o ON o.id = w.org_id
     LEFT JOIN users u ON u.id = $2
     LEFT JOIN org_memberships om ON om.org_id = w.org_id AND om.user_id = $2
     LEFT JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = $2
     WHERE w.id = $1`,
    [wsId, actor.userId],
  );
  if (!row) return 'not_found';
  const orgId = String(row.ws_org_id);
  const orgRole = effectiveOrgRole(orgId, row.org_role, row.user_org_id, row.user_role);
  let role: WorkspaceRole | null = null;
  let implicit = false;
  if (orgRole) {
    // A membership only counts for users of the same org (stray cross-tenant rows from v1.1 are ignored).
    role = effectiveWorkspaceRole(row.access_role, row.legacy_ws_role);
    if (orgRole === 'ORG_ADMIN' && role !== 'WORKSPACE_ADMIN') {
      implicit = role === null;
      role = 'WORKSPACE_ADMIN';
    } else if (!role && row.default_workspace_visibility !== 'members') {
      role = 'VIEWER';
      implicit = true;
    }
  }
  let permissions = new Set<Permission>(
    permissionsFor({ isPlatformAdmin: actor.isPlatformAdmin, orgRole, workspaceRole: role }),
  );
  let viaPlatformAdmin = false;
  if (!role && actor.isPlatformAdmin) {
    permissions = new Set(SUPPORT_READ);
    viaPlatformAdmin = true;
  }
  if (!role && !viaPlatformAdmin) permissions = new Set();
  return {
    workspaceId: String(row.ws_id),
    workspaceName: String(row.ws_name),
    orgId,
    org: { ...row, id: orgId },
    orgRole,
    role,
    implicit,
    permissions,
    linkedPersonId: row.linked_person_id ? String(row.linked_person_id) : null,
    viaPlatformAdmin,
  };
}

/** Required role label for the friendliest 403 message. */
export function roleNeeded(perm: Permission): string {
  if ((ORG_ADMIN_PERMISSIONS as readonly Permission[]).includes(perm)) return ROLE_LABEL.ORG_ADMIN;
  for (const r of ['VIEWER', 'CONTRIBUTOR', 'PLANNER', 'WORKSPACE_ADMIN'] as WorkspaceRole[]) {
    if (WORKSPACE_ROLE_PERMISSIONS[r].includes(perm)) return ROLE_LABEL[r];
  }
  return 'a higher';
}

export function denied(perm: Permission) {
  return forbidden(`You need the ${roleNeeded(perm)} role to do this.`);
}

/**
 * Resolves the workspace and asserts at least one of `perms` (none = any access).
 * Unknown workspace: 404. Known workspace without access (incl. other tenants): 403.
 */
export async function requireWorkspace(
  ctx: Ctx,
  wsId: string,
  perms: Permission | Permission[] = [],
  q: Queryable = ctx.db,
): Promise<WorkspaceAccess> {
  const actor = requireActor(ctx);
  const access = await resolveWorkspaceAccess(q, actor, wsId);
  if (access === 'not_found') throw notFound('Workspace not found');
  if (access.permissions.size === 0) throw forbidden("You don't have access to this workspace.");
  const list = Array.isArray(perms) ? perms : [perms];
  if (list.length && !list.some((p) => access.permissions.has(p))) throw denied(list[0]);
  if (access.viaPlatformAdmin) {
    await auditBestEffort(ctx.db, auditCtx(ctx, 'platform_admin'), {
      action: 'support.access',
      orgId: access.orgId,
      workspaceId: access.workspaceId,
      targetType: 'workspace',
      targetId: access.workspaceId,
      after: { route: `${ctx.method} ${ctx.subpath}` },
    });
  }
  return access;
}

export function has(access: { permissions: Set<Permission> }, p: Permission): boolean {
  return access.permissions.has(p);
}

// ── Org level ─────────────────────────────────────────────────────────────

export async function resolveOrgAccess(q: Queryable, actor: Actor, orgId: string): Promise<OrgAccess | 'not_found'> {
  if (!UUID_RE.test(orgId)) return 'not_found';
  const row = await one(
    q,
    `SELECT ${ORG_COLUMNS}, om.role AS org_role, u.org_id AS user_org_id, u.role AS user_role,
            (SELECT coalesce(array_agg(wm.workspace_id::text), '{}') FROM workspace_members wm
               JOIN workspaces w2 ON w2.id = wm.workspace_id
              WHERE wm.user_id = $2 AND w2.org_id = o.id
                AND coalesce(wm.access_role, CASE wm.role WHEN 'PMO_ADMIN' THEN 'WORKSPACE_ADMIN' END) = 'WORKSPACE_ADMIN'
            ) AS admin_ws
     FROM organizations o
     LEFT JOIN users u ON u.id = $2
     LEFT JOIN org_memberships om ON om.org_id = o.id AND om.user_id = $2
     WHERE o.id = $1`,
    [orgId, actor.userId],
  );
  if (!row) return 'not_found';
  const orgRole = effectiveOrgRole(orgId, row.org_role, row.user_org_id, row.user_role);
  const adminWorkspaceIds = orgRole && Array.isArray(row.admin_ws) ? (row.admin_ws as unknown[]).map(String) : [];
  const permissions = new Set<Permission>();
  let viaPlatformAdmin = false;
  if (orgRole === 'ORG_ADMIN') {
    permissionsFor({ isPlatformAdmin: actor.isPlatformAdmin, orgRole, workspaceRole: null }).forEach((p) =>
      permissions.add(p),
    );
  } else if (orgRole === 'MEMBER') {
    permissions.add('org.view');
    if (adminWorkspaceIds.length) {
      for (const p of ['structure.write', 'workspace.members.manage', 'workspace.audit.view'] as Permission[]) {
        permissions.add(p);
      }
    }
  }
  if (actor.isPlatformAdmin) {
    permissions.add('platform.admin');
    if (!orgRole) {
      viaPlatformAdmin = true;
      permissions.add('org.view');
      permissions.add('org.audit.view');
    }
  }
  return { orgId, org: row, orgRole, adminWorkspaceIds, permissions, viaPlatformAdmin };
}

export async function requireOrg(
  ctx: Ctx,
  orgId: string,
  perms: Permission | Permission[] = [],
  q: Queryable = ctx.db,
): Promise<OrgAccess> {
  const actor = requireActor(ctx);
  const access = await resolveOrgAccess(q, actor, orgId);
  if (access === 'not_found') throw notFound('Organisation not found');
  if (access.permissions.size === 0 || (!access.orgRole && !access.viaPlatformAdmin)) {
    throw forbidden("You don't have access to this organisation.");
  }
  const list = Array.isArray(perms) ? perms : [perms];
  if (list.length && !list.some((p) => access.permissions.has(p))) throw denied(list[0]);
  if (access.viaPlatformAdmin) {
    await auditBestEffort(ctx.db, auditCtx(ctx, 'platform_admin'), {
      action: 'support.access',
      orgId,
      targetType: 'org',
      targetId: orgId,
      after: { route: `${ctx.method} ${ctx.subpath}` },
    });
  }
  return access;
}

// ── Feature flags and entitlements (SH-05, PL-07) ─────────────────────────

export function requireFeature(org: OrgRowData, flag: FeatureFlag): void {
  if (!featuresOf(org.features)[flag]) throw featureDisabled();
}

export function orgEntitlements(org: OrgRowData): Entitlements {
  return entitlementsFor(planOf(org.plan), appMode());
}

const LIMIT_NOUN: Record<string, string> = {
  maxPeople: 'people',
  maxProjects: 'projects',
  maxWorkspaces: 'workspaces',
};

/** 403 entitlement when creating `adding` more items would exceed the plan limit (edits are never blocked). */
export function assertWithinLimit(
  org: OrgRowData,
  limit: 'maxPeople' | 'maxProjects' | 'maxWorkspaces',
  countAfter: number,
): void {
  const e = orgEntitlements(org);
  const max = e[limit];
  if (max !== null && countAfter > max) {
    throw entitlementError(`Your ${e.plan} plan allows up to ${max} ${LIMIT_NOUN[limit]}.`);
  }
}

export function assertEntitled(org: OrgRowData, feature: 'csvImport' | 'csvExport' | 'scenarios' | 'integrations') {
  const e = orgEntitlements(org);
  if (!e[feature]) throw entitlementError(`Your ${e.plan} plan does not include this feature.`);
}
