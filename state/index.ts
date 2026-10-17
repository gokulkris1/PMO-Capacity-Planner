// state/index.ts — public surface of the client data layer (BACKLOG §4.3, frozen signatures).
//
// The hooks read a DataRuntime (state/runtime.ts) through React context. Mount <DataProvider> once
// at the root (docs/release/handoff-C.md §4); without it the hooks use a fallback runtime chosen
// from the URL (/demo or ?demo=1 → DemoTransport, else HttpTransport).
//
// Frozen (§4.3): useSession, useWorkspace, useFeature, useEntitlements, useQuarters,
// useWorkspaceData, useConflict, useUndo, useMutations, ApiRequestError, TimeBasis, QuarterView.
// Additive (handoff-C.md §3): DataProvider, useSessionNotice, useApi, useJiraSync, userMessage,
// useAccountActions, useOrgAdmin, useIntegrationSettings, usePlatformAdmin, useClientGaps,
// useRecordExport, useDelivery (+ their types).
export { ApiRequestError, userMessage } from '../services/api/errors';
export type { TimeBasis, QuarterView } from '../utils/viewModels/types';
export {
  useSession,
  useWorkspace,
  useFeature,
  useEntitlements,
  useQuarters,
  useWorkspaceData,
  useConflict,
  useUndo,
  useMutations,
  useSessionNotice,
  useApi,
  useJiraSync,
  useBootState,
} from './hooks';
export { DataProvider, type DataProviderProps } from './session';
export type { MaintenanceState, SessionNotice, SessionNoticeKind } from './runtime';
export {
  useAccountActions,
  useOrgAdmin,
  useIntegrationSettings,
  usePlatformAdmin,
  useClientGaps,
  useRecordExport,
  rememberDemoInvitation,
} from './extraHooks';
export type {
  AccountActions,
  OrgAdmin,
  IntegrationSettings,
  PlatformAdmin,
  ClientGaps,
  RecordExport,
  PendingInvitation,
  JiraConnection,
  PlanviewConnection,
  PlatformOverview,
  InvitationLookup,
} from './accountActions';
export {
  useDelivery,
  deliverySignalOf,
  type DeliverySource,
  type PlanviewApplyResult,
  type PlanviewFieldTest,
} from './delivery';
