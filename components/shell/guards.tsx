import { useEffect, type ReactNode } from 'react';
import { Navigate, Outlet, useLocation, useParams } from 'react-router-dom';
import type { Permission } from '../../shared/permissions';
import type { FeatureFlag } from '../../shared/features';
import { useBootState, useFeature, useSession, useWorkspace, useWorkspaceData } from '../../state';
import { Skeleton } from '../ui/Skeleton';
import { BootErrorPage, ForbiddenPage, MaintenancePage, NotFoundPage } from '../../pages/system/SystemPages';
import { AppShell } from './AppShell';
import { DEMO_ENABLED } from './env';
import { lastWorkspace, rememberWorkspace, WorkspaceBaseProvider, workspaceBase } from './workspacePath';

/**
 * Full-viewport loading state while the session resolves. When the boot failed (QA-011) it shows why instead of
 * spinning forever: the maintenance notice for a 503 (the runtime retries on its own and boots as soon as the API
 * is ready), or an error with "Try again" for anything else.
 */
export function SessionLoading() {
  const { bootError, maintenance, retry } = useBootState();
  if (bootError && (maintenance || bootError.status === 503 || bootError.code === 'migration_pending'))
    return <MaintenancePage onRetry={() => void retry()} autoRetry={!!maintenance} />;
  if (bootError) return <BootErrorPage error={bootError} onRetry={() => void retry()} />;
  return (
    <div className="pcp-session-loading">
      <Skeleton variant="page" label="your workspace" />
    </div>
  );
}

/** Signed-out users go to /login?next=<deep link> (SH-01#AC5). */
export function RequireSession({ children }: { children?: ReactNode }) {
  const { status } = useSession();
  const location = useLocation();
  if (status === 'loading') return <SessionLoading />;
  if (status === 'anonymous') {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  return children ? <>{children}</> : <Outlet />;
}

/** Where a signed-in user lands: last-used workspace Home, else first; platform admins without an org: /cockpit. */
export function useHomeHref(): string | null {
  const { me } = useSession();
  if (!me) return null;
  if (!me.org || me.workspaces.length === 0) return me.user.isPlatformAdmin ? '/cockpit' : '/create';
  const remembered = lastWorkspace(me.org.slug);
  const ws = me.workspaces.find((w) => w.id === remembered) ?? me.workspaces[0];
  return `${workspaceBase(me.org.slug, ws.id)}/home`;
}

/** `/o/:org` and old URLs → the default workspace (SH-01#AC2). `sub` is the target below the workspace. */
export function OrgRedirect({ sub }: { sub: string }) {
  const { me } = useSession();
  const { org } = useParams();
  if (!me) return <SessionLoading />;
  if (!me.org || (org && me.org.slug !== org)) return <ForbiddenPage scope="workspace" fullPage homeHref="/" />;
  const remembered = lastWorkspace(me.org.slug);
  const ws = me.workspaces.find((w) => w.id === remembered) ?? me.workspaces[0];
  if (!ws) return <Navigate to="/create" replace />;
  return <Navigate to={`${workspaceBase(me.org.slug, ws.id)}/${sub}`} replace />;
}

/**
 * Validates `/o/:org/w/:ws` (or `/demo/w/:ws`), selects the workspace in the store, handles 403/503 from
 * the data load and renders the AppShell around the child routes.
 */
export function WorkspaceLayout({ demo = false }: { demo?: boolean }) {
  const { org: orgParam, ws: wsParam } = useParams();
  const { me, status } = useSession();
  const { workspace, workspaces, switchWorkspace } = useWorkspace();
  const data = useWorkspaceData();
  const target = workspaces.find((w) => w.id === wsParam) ?? null;
  const orgSlug = me?.org?.slug ?? null;

  useEffect(() => {
    if (target && workspace?.id !== target.id) switchWorkspace(target.id);
  }, [target, workspace?.id, switchWorkspace]);

  useEffect(() => {
    if (target && orgSlug && !demo) rememberWorkspace(orgSlug, target.id);
  }, [target, orgSlug, demo]);

  if (demo && !DEMO_ENABLED) return <NotFoundPage fullPage />;
  if (demo && status === 'anonymous') return <Navigate to="/login?next=%2Fdemo" replace />;
  if (!me) return <SessionLoading />;

  const fallback = me.org && me.workspaces[0] ? `${workspaceBase(me.org.slug, me.workspaces[0].id)}/home` : '/';
  if (!demo && (!me.org || me.org.slug !== orgParam))
    return <ForbiddenPage scope="workspace" fullPage homeHref={fallback} />;
  if (!target) return <ForbiddenPage scope="workspace" fullPage homeHref={fallback} />;

  const err = data.error;
  if (err?.code === 'migration_pending' || err?.status === 503)
    return <MaintenancePage onRetry={() => void data.reload()} autoRetry />;
  if (err?.status === 403) return <ForbiddenPage scope="workspace" fullPage homeHref={fallback} />;

  const base = demo ? `/demo/w/${encodeURIComponent(target.id)}` : workspaceBase(orgParam ?? '', target.id);
  return (
    <WorkspaceBaseProvider base={base}>
      <AppShell>{workspace?.id === target.id ? <Outlet /> : <Skeleton variant="page" label="workspace" />}</AppShell>
    </WorkspaceBaseProvider>
  );
}

/** Route-level permission gate: renders 403 inside the shell when the permission is missing. */
export function RequirePermission({
  anyOf,
  children,
  requiredRole,
  notFound,
}: {
  anyOf: Permission[];
  children: ReactNode;
  /** Role name for the 403 copy, e.g. "Org Admin". */
  requiredRole?: string;
  /** Render 404 instead of 403 (hidden surfaces such as Billing in internal mode). */
  notFound?: boolean;
}) {
  const { can } = useWorkspace();
  if (anyOf.some((p) => can(p))) return <>{children}</>;
  return notFound ? <NotFoundPage /> : <ForbiddenPage requiredRole={requiredRole} />;
}

/** Feature-flag gate: 404 when the flag is off (SH-05#AC2). */
export function RequireFeature({ flag, children }: { flag: FeatureFlag; children: ReactNode }) {
  const on = useFeature(flag);
  return on ? <>{children}</> : <NotFoundPage />;
}
