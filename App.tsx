/**
 * PMO Capacity Planner — router only (SH-01). Every view is a URL; pages are lazy chunks (SH-08).
 * Route → module mapping lives in components/shell/pages.manifest.ts (one line per route to integrate B2).
 */
import { Suspense, type ReactNode } from 'react';
import { BrowserRouter, HashRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { useSession } from './state';
import { AppProviders } from './components/shell/AppProviders';
import { HASH_ROUTER, IS_DEV } from './components/shell/env';
import {
  OrgRedirect,
  RequireFeature,
  RequirePermission,
  RequireSession,
  SessionLoading,
  WorkspaceLayout,
} from './components/shell/guards';
import { ADMIN_PAGES, AUTH_PAGES, B2_PAGES, SETTINGS_PAGES, SYSTEM_PAGES } from './components/shell/pages.manifest';
import { NotFoundPage } from './pages/system/SystemPages';
import { Skeleton } from './components/ui/Skeleton';

const Router = HASH_ROUTER ? HashRouter : BrowserRouter;

function Page({ children }: { children: ReactNode }) {
  return <Suspense fallback={<Skeleton variant="page" label="page" />}>{children}</Suspense>;
}

function FullPage({ children }: { children: ReactNode }) {
  return <Suspense fallback={<SessionLoading />}>{children}</Suspense>;
}

/** Settings index → the first section the user may see. */
function SettingsIndex() {
  return <Navigate to="profile" replace />;
}

/** `/demo` → the demo workspace (ST-10). */
function DemoEntry() {
  const { me, status } = useSession();
  if (status === 'loading') return <SessionLoading />;
  if (status === 'anonymous') return <Navigate to="/login?next=%2Fdemo" replace />;
  const ws = me?.workspaces[0]?.id ?? 'demo';
  return <Navigate to={`/demo/w/${encodeURIComponent(ws)}/home`} replace />;
}

function TribeRoute() {
  const { tribeId } = useParams();
  const Tribe = B2_PAGES.tribe;
  return <Tribe key={tribeId} />;
}

/** The routes inside a workspace (shared by `/o/:org/w/:ws` and `/demo/w/:ws`). */
function workspaceRoutes() {
  const P = B2_PAGES;
  const S = SETTINGS_PAGES;
  return (
    <>
      <Route index element={<Navigate to="home" replace />} />
      <Route path="home" element={<P.home />} />
      <Route path="me" element={<P.myPlan />} />
      <Route path="plan" element={<Navigate to="capacity" replace />} />
      <Route path="plan/capacity" element={<P.capacity />} />
      <Route path="plan/demand" element={<P.demand />} />
      <Route path="plan/allocations" element={<P.allocations />} />
      <Route path="plan/marketplace" element={<P.marketplace />} />
      <Route path="org" element={<Navigate to="people" replace />} />
      <Route path="org/people" element={<P.people />} />
      <Route path="org/projects" element={<P.projects />} />
      <Route path="org/tribes" element={<P.tribes />} />
      <Route path="org/tribes/:tribeId" element={<TribeRoute />} />
      <Route path="delivery" element={<Navigate to="jira-planview" replace />} />
      <Route path="delivery/jira-planview" element={<P.delivery />} />
      <Route
        path="delivery/sprints"
        element={
          <RequireFeature flag="qbrSprintModule">
            <P.sprints />
          </RequireFeature>
        }
      />
      <Route
        path="reports"
        element={
          <RequirePermission anyOf={['export']} requiredRole="Viewer">
            <P.reports />
          </RequirePermission>
        }
      />
      <Route path="settings" element={<S.layout />}>
        <Route index element={<SettingsIndex />} />
        <Route path="profile" element={<S.profile />} />
        <Route
          path="organisation"
          element={
            <RequirePermission anyOf={['org.manage']} requiredRole="Org Admin">
              <S.organisation />
            </RequirePermission>
          }
        />
        <Route
          path="members"
          element={
            <RequirePermission anyOf={['org.members.manage', 'workspace.members.manage']} requiredRole="PMO Admin">
              <S.members />
            </RequirePermission>
          }
        />
        <Route
          path="structure"
          element={
            <RequirePermission anyOf={['structure.write', 'people.write']} requiredRole="Planner">
              <S.structure />
            </RequirePermission>
          }
        />
        <Route
          path="crafts"
          element={
            <RequirePermission anyOf={['structure.write', 'people.write']} requiredRole="Planner">
              <S.crafts />
            </RequirePermission>
          }
        />
        <Route
          path="planning"
          element={
            <RequirePermission anyOf={['org.manage', 'people.write']} requiredRole="Planner">
              <S.planning />
            </RequirePermission>
          }
        />
        <Route
          path="integrations"
          element={
            <RequirePermission anyOf={['integrations.view']} requiredRole="Planner">
              <S.integrations />
            </RequirePermission>
          }
        />
        <Route
          path="features"
          element={
            <RequirePermission anyOf={['org.manage']} requiredRole="Org Admin">
              <S.features />
            </RequirePermission>
          }
        />
        <Route
          path="billing"
          element={
            <RequirePermission anyOf={['org.billing']} notFound>
              <S.billing />
            </RequirePermission>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
      {IS_DEV ? <Route path="kit" element={<SYSTEM_PAGES.kit />} /> : null}
      <Route path="*" element={<NotFoundPage />} />
    </>
  );
}

export default function App() {
  const A = AUTH_PAGES;
  return (
    <Router>
      <AppProviders>
        <Routes>
          {/* Auth and first run (ST-07, ST-08, AC-05, AC-07) */}
          <Route path="/" element={<FullPage><A.login /></FullPage>} />
          <Route path="/login" element={<FullPage><A.login /></FullPage>} />
          <Route path="/register" element={<FullPage><A.register /></FullPage>} />
          <Route path="/reset" element={<FullPage><A.reset /></FullPage>} />
          <Route path="/verify-email" element={<FullPage><A.verifyEmail /></FullPage>} />
          <Route path="/invite/:token" element={<FullPage><A.invite /></FullPage>} />
          <Route
            path="/create"
            element={
              <RequireSession>
                <FullPage>
                  <A.createOrg />
                </FullPage>
              </RequireSession>
            }
          />

          {/* Platform admin (ST-09): 404 unless platform.admin */}
          <Route
            path="/cockpit"
            element={
              <RequireSession>
                <FullPage>
                  <ADMIN_PAGES.cockpit />
                </FullPage>
              </RequireSession>
            }
          />

          {/* Demo (ST-10) */}
          <Route path="/demo" element={<DemoEntry />} />
          <Route path="/demo/w/:ws" element={<WorkspaceLayout demo />}>
            {workspaceRoutes()}
          </Route>

          {/* Workspace routes and old-URL redirects (SH-01) */}
          <Route element={<RequireSession />}>
            <Route path="/o/:org" element={<OrgRedirect sub="home" />} />
            <Route path="/o/:org/settings" element={<OrgRedirect sub="settings/organisation" />} />
            <Route path="/o/:org/directory" element={<OrgRedirect sub="org/people" />} />
            <Route path="/o/:org/w" element={<OrgRedirect sub="home" />} />
            <Route path="/o/:org/w/:ws" element={<WorkspaceLayout />}>
              {workspaceRoutes()}
            </Route>
          </Route>

          <Route path="*" element={<Page><NotFoundPage fullPage /></Page>} />
        </Routes>
      </AppProviders>
    </Router>
  );
}
