import { useCallback } from 'react';
import type { Permission } from '../../shared/permissions';
import { useWorkspace } from '../../state';
import { useMediaQuery } from '../ui/hooks';

/** Below this width the planning pages are read-only (SH-09#AC2): no inline editing, no add or bulk actions. */
export const READ_ONLY_VIEWPORT = '(max-width: 767px)';

/** Planning edits that are hidden on a phone; reading, exporting and responding to one's own proposals stay. */
const EDIT_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>([
  'people.write',
  'projects.write',
  'demand.write',
  'allocations.write',
  'allocations.propose',
  'offers.write',
  'import.csv',
]);

/**
 * `useWorkspace().can` for planning pages: the same permissions, except that planning edits are off below 768 px
 * (QA-016, SH-09#AC2). Settings and account pages keep using `useWorkspace().can`.
 */
export function useViewportCan(): (p: Permission) => boolean {
  const { can } = useWorkspace();
  const readOnly = useMediaQuery(READ_ONLY_VIEWPORT);
  return useCallback((p: Permission) => can(p) && !(readOnly && EDIT_PERMISSIONS.has(p)), [can, readOnly]);
}
