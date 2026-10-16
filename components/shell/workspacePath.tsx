import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { readUiPref, writeUiPref } from '../ui/internal/utils';

/** The current workspace base path: `/o/:org/w/:ws` or `/demo/w/:ws` (demo mode, ST-10). */
const WorkspaceBaseContext = createContext<string | null>(null);

export function WorkspaceBaseProvider({ base, children }: { base: string; children: ReactNode }) {
  return <WorkspaceBaseContext.Provider value={base}>{children}</WorkspaceBaseContext.Provider>;
}

/** The base path of the workspace being viewed, e.g. "/o/acme/w/1f2e…". Null outside a workspace route. */
export function useWorkspaceBase(): string | null {
  return useContext(WorkspaceBaseContext);
}

/**
 * Builds links inside the current workspace: `const to = useWsPath(); <Link to={to('org/people?person=r1')}>`.
 * Works for both `/o/:org/w/:ws` and `/demo/w/:ws`.
 */
export function useWsPath(): (sub: string) => string {
  const base = useWorkspaceBase();
  return useCallback((sub: string) => `${base ?? ''}/${sub.replace(/^\//, '')}`, [base]);
}

export function workspaceBase(orgSlug: string, wsId: string): string {
  return `/o/${encodeURIComponent(orgSlug)}/w/${encodeURIComponent(wsId)}`;
}

/** Remembers the last workspace per org (UI preference) for `/o/:org` redirects (SH-01#AC2). */
export function rememberWorkspace(orgSlug: string, wsId: string): void {
  writeUiPref(`lastWorkspace.${orgSlug}`, wsId);
}

export function lastWorkspace(orgSlug: string): string | null {
  return readUiPref<string | null>(`lastWorkspace.${orgSlug}`, null);
}

/** Only same-origin relative paths are accepted for `?next=` (SH-01#AC5). */
export function safeNext(next: string | null | undefined): string | null {
  if (!next) return null;
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null;
  if (/^\/(login|register|reset)(\/|\?|$)/.test(next)) return null;
  return next;
}
