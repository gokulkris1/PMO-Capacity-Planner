/**
 * components/shell — app frame, routing helpers and workspace context (SH-01…SH-03, SH-06, SH-07, SH-09).
 * Pages import from here: `useWsPath`, `useTimeBasis` + `TimeBasisControl`, `RequirePermission`, `RequireFeature`.
 */
export { AppShell } from './AppShell';
export { AppProviders } from './AppProviders';
export { Sidebar } from './Sidebar';
export { TopBar, WorkspaceSwitcher, NotificationsBell, UserMenu, HelpMenu } from './TopBar';
export { SearchDialog, searchTarget } from './SearchDialog';
export { ErrorBoundary } from './ErrorBoundary';
export { ProductMark, Wordmark } from './ProductMark';
export { useNavGroups, AREA_LABEL, type NavGroup, type NavItem } from './nav';
export { useEmbedded } from './embedded';
export { useTimeBasis, TimeBasisControl, BASIS_KEYS, type BasisKey, type TimeBasisState } from './TimeBasis';
export {
  useWsPath,
  useWorkspaceBase,
  workspaceBase,
  rememberWorkspace,
  lastWorkspace,
  safeNext,
  WorkspaceBaseProvider,
} from './workspacePath';
export {
  RequireSession,
  RequirePermission,
  RequireFeature,
  WorkspaceLayout,
  OrgRedirect,
  SessionLoading,
  useHomeHref,
} from './guards';
export { APP_MODE, APP_VERSION, DEMO_ENABLED, SIGNUP_ENABLED } from './env';
