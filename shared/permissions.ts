import type { OrgRole, WorkspaceRole } from './contracts/dto';

export const PERMISSIONS = [
  'org.view', 'org.manage', 'org.billing', 'org.members.manage', 'org.audit.view', 'workspace.manage',
  'workspace.members.manage', 'workspace.audit.view', 'structure.write',
  'data.read', 'people.write', 'people.write.own', 'craftProfile.approve', 'projects.write', 'demand.write',
  'allocations.write', 'allocations.propose', 'allocations.respond.own', 'offers.write', 'offers.write.own',
  'scenario.write', 'qbr.write', 'qbr.commit',
  'integrations.view', 'integrations.manage', 'integrations.run',
  'import.csv', 'export', 'ai.use', 'platform.admin',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const VIEWER: Permission[] = ['org.view', 'data.read', 'export', 'ai.use'];
const CONTRIBUTOR: Permission[] = [...VIEWER, 'people.write.own', 'allocations.respond.own', 'offers.write.own'];
const PLANNER: Permission[] = [...CONTRIBUTOR, 'people.write', 'craftProfile.approve', 'projects.write', 'demand.write',
  'allocations.write', 'allocations.propose', 'offers.write', 'scenario.write', 'qbr.write',
  'integrations.view', 'integrations.run', 'import.csv'];
const WORKSPACE_ADMIN: Permission[] = [...PLANNER, 'workspace.members.manage', 'workspace.audit.view', 'structure.write',
  'qbr.commit', 'integrations.manage'];

export const WORKSPACE_ROLE_PERMISSIONS: Record<WorkspaceRole, readonly Permission[]> = { VIEWER, CONTRIBUTOR, PLANNER, WORKSPACE_ADMIN };
export const ORG_ADMIN_PERMISSIONS: readonly Permission[] = ['org.manage', 'org.billing', 'org.members.manage', 'org.audit.view', 'workspace.manage'];
export const WORKSPACE_ROLE_RANK: Record<WorkspaceRole, number> = { VIEWER: 1, CONTRIBUTOR: 2, PLANNER: 3, WORKSPACE_ADMIN: 4 };
export const ROLE_LABEL: Record<WorkspaceRole | 'ORG_ADMIN', string> = {
  ORG_ADMIN: 'Org Admin', WORKSPACE_ADMIN: 'PMO Admin', PLANNER: 'Planner', CONTRIBUTOR: 'Squad member', VIEWER: 'Viewer',
};

/** What a member linked to a person record may always do for that person: answer proposals made to them, offer
 *  their own capacity and suggest changes to their own crafts. v1.1 squad members migrated as Viewers keep these. */
export const OWN_RECORD_PERMISSIONS: readonly Permission[] = ['people.write.own', 'allocations.respond.own', 'offers.write.own'];

/** ORG_ADMIN implies WORKSPACE_ADMIN in every workspace of the org. Feature flags and entitlements are checked separately. */
export function permissionsFor(a: {
  isPlatformAdmin: boolean;
  orgRole: OrgRole | null;
  workspaceRole: WorkspaceRole | null;
  /** The user is linked to a person record in this workspace. */
  linkedToPerson?: boolean;
}): Permission[] {
  const set = new Set<Permission>();
  const ws: WorkspaceRole | null = a.orgRole === 'ORG_ADMIN' ? 'WORKSPACE_ADMIN' : a.workspaceRole;
  if (ws) WORKSPACE_ROLE_PERMISSIONS[ws].forEach((p) => set.add(p));
  if (ws && a.linkedToPerson) OWN_RECORD_PERMISSIONS.forEach((p) => set.add(p));
  if (a.orgRole === 'ORG_ADMIN') ORG_ADMIN_PERMISSIONS.forEach((p) => set.add(p));
  if (a.orgRole) set.add('org.view');
  if (a.isPlatformAdmin) set.add('platform.admin');
  return PERMISSIONS.filter((p) => set.has(p));
}

/** Legacy dual-write/dual-read mapping (workspace_members.role CHECK IN ('PMO_ADMIN','WORKSPACE_OWNER','USER')). */
export type LegacyWorkspaceRole = 'PMO_ADMIN' | 'WORKSPACE_OWNER' | 'USER';
export function toLegacyWorkspaceRole(r: WorkspaceRole): LegacyWorkspaceRole {
  return r === 'WORKSPACE_ADMIN' ? 'PMO_ADMIN' : r === 'PLANNER' ? 'WORKSPACE_OWNER' : 'USER';
}
export function fromLegacyWorkspaceRole(r: string | null | undefined): WorkspaceRole {
  if (r === 'PMO_ADMIN' || r === 'WORKSPACE_ADMIN') return 'WORKSPACE_ADMIN';
  if (r === 'WORKSPACE_OWNER' || r === 'PLANNER') return 'PLANNER';
  if (r === 'CONTRIBUTOR') return 'CONTRIBUTOR';
  return 'VIEWER';
}
export function fromLegacyUserRole(r: string | null | undefined): { isPlatformAdmin: boolean; orgRole: OrgRole | null } {
  if (r === 'SUPERUSER') return { isPlatformAdmin: true, orgRole: null };
  if (r === 'ORG_ADMIN' || r === 'ADMIN') return { isPlatformAdmin: false, orgRole: 'ORG_ADMIN' };
  return { isPlatformAdmin: false, orgRole: 'MEMBER' };
}
