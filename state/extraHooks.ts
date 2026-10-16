/**
 * Additive hooks (handoff-C.md §3): account/org/integration/platform actions for B1's pages and the
 * export audit for B2's report pages. Each returns a stable, per-runtime object.
 */
import {
  clientGapsFor,
  type AccountActions,
  type ClientGaps,
  type IntegrationSettings,
  type OrgAdmin,
  type PendingInvitation,
  type PlatformAdmin,
  type RecordExport,
} from './accountActions';
import { useRuntime } from './session';

/** Sign-up, password reset, e-mail verification, invitations, org creation and the profile (AU-*, ST-01). */
export function useAccountActions(): AccountActions {
  return clientGapsFor(useRuntime()).auth as AccountActions;
}

/** Workspaces, invitations and billing for org admins (ST-02, ST-03, ST-06). */
export function useOrgAdmin(): OrgAdmin {
  return clientGapsFor(useRuntime()).org;
}

/** Jira / Planview connection settings (ST-05, JI-01, PV-01). */
export function useIntegrationSettings(): IntegrationSettings {
  return clientGapsFor(useRuntime()).integrations;
}

/** The platform cockpit (PA-01); `overview()` is 404 for anyone but a platform admin. */
export function usePlatformAdmin(): PlatformAdmin {
  return clientGapsFor(useRuntime()).platform;
}

/** B1's single-object shape, so `components/shell/clientGaps` callers switch one import. */
export function useClientGaps(): ClientGaps {
  return clientGapsFor(useRuntime());
}

/**
 * RP-04#AC4: call after a report file is produced: `recordExport({kind: 'qbr-pack', format: 'pdf'})`.
 * The server writes the `export.pdf` / `export.csv` audit event with the report name.
 */
export function useRecordExport(): RecordExport {
  return clientGapsFor(useRuntime()).recordExport;
}

/** B1 kept invitation links in memory for its demo; DemoTransport serves real invitations, so this is a no-op. */
export function rememberDemoInvitation(_inv: PendingInvitation): void {}
