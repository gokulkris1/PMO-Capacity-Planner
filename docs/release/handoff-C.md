# Hand-off — Package C (domain, data layer, client state, view-models)

Branch `worktree-agent-a74ab6ba429299f02`, based on `claude/resource-allocation-pmo-visibility-oi2g5f` at `0b29f20`.
Gate on the branch: `npm run typecheck`, `npm run lint`, `npm test` (20 suites, 288 tests, jest node + jsdom projects), `npm run build`, `npx prettier --check .` are all green.

## 1. Stories

### Done (C sub-tasks from BACKLOG §4.2)

| Story | What C delivered |
|---|---|
| PL-05 | `services/api`: `Transport` interface, `HttpTransport` (the only `fetch(`), `DemoTransport`, typed `createApiClient` with one method per §4.3 route, `ApiRequestError` mapping. Contract suite runs the same assertions against DemoTransport and a recorded HTTP fixture. |
| PL-06 | Real `state/**`: `DataRuntime` external store, every frozen hook, optimistic mutations with a serialised queue, rollback, 409 conflict dialog, 20-step undo, refetch on focus after 60 s, `<DataProvider>`. |
| AC-03 (client) | Cookie session, `credentials:'include'`, CSRF header from `pcp_csrf`, one shared refresh on 401 then sign-out ("Please sign in again."), legacy v1.1 token exchanged once via `/api/auth/session` then removed with the other `pcp_*` keys. |
| AC-04 (client) | `useSession`, `useWorkspace` (`can()`, `switchWorkspace`), permissions-changed / data-updated notices. |
| AC-05/07/08/09, ST-01…09 (client methods) | `useAccountActions`, `useOrgAdmin`, `useIntegrationSettings`, `usePlatformAdmin`, `useClientGaps` (B1's shape). |
| SH-05, PL-07 | `useFeature`, `useEntitlements`. |
| SH-06 | `buildSearchIndex` (accent-insensitive, max 5 per kind). |
| SH-07#AC4 (client) | A boot failure that is not a 401 (e.g. 503 `migration_pending`) surfaces as `useWorkspaceData().status === 'error'` with `error.status`/`error.code`; `reload()` re-runs the boot. Unknown workspace → 403 error in the same place. |
| HS-11 (client) | `api.ai.ask()`; `services/geminiService.ts` is a deprecated shim over it (see §6). HS-15: no `VITE_OPENAI_API_KEY` reads. |
| RP-03, ORG-06 | Same-number guarantee: one `loadIndex` computes every per-person load; tested across people rows, grid, outlook, tribe view, home. |
| ORG-03/04/05, PPL-01/02/05/07 | `buildPeopleRows`, `buildTribeView`, structure/craft view-models and validators, mutations. |
| PPL-03/04/06 | People CSV parser/validator/exporter (`utils/csvPeople.ts`), bulk/import/craft-request mutations. |
| AL-01…06, AL-07 | `buildAllocationGrid`, `setQuarterCell`, `copyForward`, `setQuarterCells` (paste: one batch, one undo), lock-aware mutations, undo. |
| DM-01…05 | `buildDemandGrid`, `buildCatalogue`, `buildOpenDemand`, `rankMatches`, `staffedFteByProjectCraft`, marketplace mutations. |
| JI-02…07, PV-01…03 (client) | Client methods, `useJiraSync`, `useDelivery` (B2's `DeliverySource` shape), delivery view-models (`buildProjectDelivery`, `buildSprintView`, `buildDeliveryTrend`, sync health). |
| RP-01/02/04 | `buildHome`, `buildCapacityOutlook`, report CSVs, QBR pack model + jsPDF renderer (lazy), `useRecordExport` for the export audit (RP-04#AC4). |
| ST-10 | `DemoTransport` serving every §4.3 route with the same permission and status semantics; `/demo` or `?demo=1` selects it (`?demoRole=`, `?demoPlatformAdmin=1`). |

### Not done / partial

- **Contract fixture** `tests/state/api/contract/http-contract.json` was recorded over real HTTP against a scratch Node server wrapping DemoTransport (cookies + CSRF), not against A's functions. I should re-record it against A's preview: `tests/state/api/contract/record.ts` explains how.
- **`context/AuthContext.tsx`** is not deleted: B's `App.tsx`, `index.tsx` and legacy `components/*` still import it (see §6).
- **`services/geminiService.ts`** is not deleted for the same reason; it is now a thin shim over `api.ai.ask`.
- `check:pure` / `check:guardrails` scripts are not in this base; purity is enforced by `tests/utils/purity.test.ts`.

## 2. Transport API (`services/api`)

```ts
interface Transport {
  readonly kind: 'http' | 'demo';
  request<T>(method: HttpMethod, path: string, body?: unknown, init?: RequestOptions): Promise<T>;
  on(event: 'session-expired', listener: () => void): () => void;
}
new HttpTransport({ baseUrl?, fetchImpl?, getCookies? })
new DemoTransport({ role?, isPlatformAdmin?, signedIn?, appMode?, plan?, acceptAnyPassword?, storage?, storageKey?, latencyMs?, db? })
createApiClient(transport)   // auth, health, ai, orgs, structure, members, invitations, workspace, people, craftRequests,
                             // projects, demand, allocations, marketplace, jira, calibration, sync, delivery, planview,
                             // integrationSettings (legacy /api/integrations/*), billing (legacy /api/checkout), platform
class ApiRequestError extends Error { status; code; fields?; requestId?; body? }  // 409 bodies carry `current`
userMessage(e)               // never shows raw server text for 5xx / network
```

Errors: every non-2xx becomes `ApiRequestError` from the `ApiError` body; network failures are `status 0, code 'network_error'`. Demo credentials: any password in `/demo` (tests use `demo-password`), OTP `246810`.

## 3. Hook API (`state/index.ts`)

Frozen (§4.3, unchanged signatures): `useSession`, `useWorkspace`, `useFeature`, `useEntitlements`, `useQuarters`, `useWorkspaceData`, `useConflict`, `useUndo`, `useMutations`, `ApiRequestError`, `TimeBasis`, `QuarterView`.

Additive:

| Export | Purpose |
|---|---|
| `DataProvider` | Mount once at the root (§4). |
| `useSessionNotice()` → `{ notice, dismiss }` | session-expired, legacy-session-expired, permissions-changed, data-updated banners. |
| `useApi()` → `{ api, orgId, workspaceId, reload, refreshMe }` | Typed client for calls that are not snapshot mutations. |
| `useJiraSync()` → `{ job, running, error, start }` | Runs a sync job to completion and reloads. |
| `userMessage(e)` | Safe user-facing text for any error. |
| `useAccountActions()` | `register`, `requestPasswordReset`, `confirmPasswordReset`, `sendVerification`, `checkVerification`, `lookupInvitation`, `acceptInvitation`, `createOrg`, `updateProfile`, `changePassword`, `setTwoFactor` (B1 names/signatures). |
| `useOrgAdmin()` | `createWorkspace`, `renameWorkspace`, `deleteWorkspace`, `listInvitations`, `resendInvitation`, `revokeInvitation`, `startCheckout`. |
| `useIntegrationSettings()` | `get` → `{jira: JiraConnection, planview: PlanviewConnection}`, `saveJira`, `testJira`, `savePlanview`, `testPlanview`. |
| `usePlatformAdmin()` | `overview()` → `PlatformOverview` (404 unless platform admin). |
| `useClientGaps()` | B1's single `ClientGaps` object (`auth`, `account`, `org`, `integrations`, `platform`); `rememberDemoInvitation` is a no-op kept for compatibility. |
| `useRecordExport()` → `({kind, format}) => Promise<void>` | RP-04#AC4 export audit (`POST …/audit/export {kind: format, report: kind}`). |
| `useDelivery(snapshot)` → `DeliverySource` | B2's exact shape; API-backed on both transports. Lists load per permission. |
| `deliverySignalOf(planned, implied)` → `{kind:'more'\|'less'\|'inline', label}` | B2's wording over the pure `deliverySignal`. |
| `useMutations().allocations.setQuarterCells(cells, label?)` | AL-07 paste: one `allocations/batch`, one undo step, 400 "Enter 0–200" if any value is out of range. |
| Types | `AccountActions`, `OrgAdmin`, `IntegrationSettings`, `PlatformAdmin`, `ClientGaps`, `RecordExport`, `PendingInvitation`, `JiraConnection`, `PlanviewConnection`, `PlatformOverview`, `InvitationLookup`, `DeliverySource`, `PlanviewApplyResult`, `PlanviewFieldTest`, `SessionNotice`, `SessionNoticeKind`, `DataProviderProps`. |

Additive pure exports (no React/state/services imports):

- `utils/viewModels`: `rankMatches`, `Match`, `staffedFteByProjectCraft`, `setQuarterCells`, `diffAllocations`, `inverseOps`, `MAX_CELL_PCT`, `MAX_BATCH_OPS`, `QuarterCellEdit`, plus everything in `marketplace`, `planning`, `delivery` (e.g. `buildOpenDemand`, `buildUnderTarget`, `buildTimeToStaff`, `buildCraftBalance`, `buildProjectRows`, `buildMyPlan`, validators, `deliverySignal`, `buildProjectDelivery`, `buildSprintView`, `buildDeliveryTrend`, `syncHealthBanner`).
- `utils/csvPeople`: `PEOPLE_CSV_COLUMNS`, `peopleTemplateCsv`, `parseCsv`, `ParsedPersonRow`, `validatePeopleCsv`, `peopleToCsv(people, s)` (B2 signatures) and `parsePeopleCsv`, `peopleCsvTemplate`, `PEOPLE_CSV_HEADERS`.
- `utils/reportData`: `utilisationByPersonCsv`, `utilisationByGroupCsv`, `openDemandLines`, `openDemandCsv`, `bookingsCsv`, `timeToStaffRows`, `medianHours`, `timeToStaffCsv`, `buildQbrPack`, `QbrPackData` (B2 signatures).
- `utils/qbrPackPdf`: `qbrPackModel`, `downloadQbrPack(data, {org, workspace, generatedAt, filename})` (dynamic-imports jsPDF via `utils/pdfExport`).
- `utils/csv`, `utils/search`, `utils/clock`, `utils/quarters`, `utils/qbrPack`, `utils/reports`, `utils/pdfExport`.

### Import switches for the integrator

| Page file(s) (owner) | Today imports | Switch to |
|---|---|---|
| Every user of `components/shell/clientGaps` (B1: `pages/auth/**`, `pages/settings/**`, `pages/admin/**`) | `useClientGaps`, `rememberDemoInvitation`, `PendingInvitation`, `JiraConnection`, `PlanviewConnection`, `PlatformOverview`, `ClientGaps` from `components/shell/clientGaps` | same names from `state` (or the granular `useAccountActions` / `useOrgAdmin` / `useIntegrationSettings` / `usePlatformAdmin`); then delete `components/shell/clientGaps.ts`. |
| B2 `pages/delivery/**`, `pages/home/**`, `pages/org/projects/**`, `pages/org/tribes/**` | `useDelivery`, `DeliverySource`, `PlanviewApplyResult`, `PlanviewFieldTest` from `pages/delivery/_parts/deliverySource` | same names from `state`; `deliverySignal` (object form) → `deliverySignalOf` from `state`. Drop `<DeliverySourceProvider>` (not needed); delete `deliverySource.tsx`. |
| B2 `pages/org/people/**` | `pages/org/people/_parts/peopleCsv` | `utils/csvPeople` (same export names). |
| B2 `pages/reports/**` | `pages/reports/_parts/reportData`, `pages/reports/_parts/qbrPackPdf` | `utils/reportData`, `utils/qbrPackPdf`; call `useRecordExport()` after each download. |
| B2 `pages/plan/marketplace/MarketplacePage.tsx` | `./rankMatches` | `rankMatches`, `Match` from `utils/viewModels`; delete `rankMatches.ts`. |
| B2 paste handler in the allocation grid (AL-07) | per-cell `allocations.setQuarterCell` | one `allocations.setQuarterCells(cells)`. |
| B2 staffed-per-craft helpers | local loops | `staffedFteByProjectCraft(s, quarters, {includeTentative})` from `utils/viewModels`. |

## 4. Provider mounting (for B / I)

In `index.tsx`, wrap the whole app once, above the router:

```tsx
import { DataProvider } from './state';

root.render(
  <React.StrictMode>
    <DataProvider forceDemo={import.meta.env.MODE === 'demo'}>
      <App />
    </DataProvider>
  </React.StrictMode>,
);
```

- Transport selection is automatic: path `/demo…` or `?demo=1` (or `forceDemo`) → `DemoTransport`; otherwise `HttpTransport`. Tests pass `runtime={…}`.
- The provider boots the session (`/api/v2/me`, legacy-token exchange, `pcp_*` purge), and refetches on `focus`/`visibilitychange` after 60 s.
- The workspace layout route calls `useWorkspace().switchWorkspace(params.ws)` when `:ws` changes; the last workspace is remembered under `pcp.ui.lastWorkspace`.
- Remove `<AuthProvider>` from `index.tsx`/`App.tsx` and replace `useAuth()` with `useSession()` / `useWorkspace()`; then `context/AuthContext.tsx` can be deleted.
- Show `useSessionNotice()` in the shell, `useConflict()` as the conflict dialog, and the `useWorkspaceData()` error states (403 → no-access page, 503 `migration_pending` → maintenance page).

## 5. Legacy exports to retire

- `types.ts`: `AllocationStatus`, `getAllocationStatus`, `getStatusColor`, `ViewTab`, `WhatIfScenario` and the other v1.1 types marked `@deprecated` (use DTOs from `shared/contracts/dto` re-exported in the 2.0 section).
- `constants.ts`: `PLAN_LIMITS` (use `shared/entitlements`), runtime use of `PMO_CRAFTS` / `CRAFT_BY_ID` (crafts come from the snapshot), `MOCK_*`, `TEAMS`, `PROJECT_STAGES`.
- `utils/dateFilteredUtil.ts`, `utils/timeGrid.ts` (+ `tests/utils/timeGrid.test.ts`): only legacy `components/*` use them; delete together with those components (SH-04).
- `utils/pdfExport.ts` `exportExecSummaryPDF` (use `renderQbrPack` / `downloadQbrPack`).
- `utils/reports.ts` overlaps `utils/reportData.ts`; keep whichever the pages settle on.
- `services/geminiService.ts` `getCapacityInsights` shim and `context/AuthContext.tsx` (once B drops the imports).

### Rewritten legacy files — drop from `LEGACY_FILES` (eslint.config.js) and `.prettierignore`

`types.ts`, `constants.ts`, `services/geminiService.ts`, `utils/craftEngine.ts`, `utils/quarters.ts`, `utils/pdfExport.ts`, `tests/utils/craftEngine.test.ts`. All seven pass the full lint config and Prettier with the ignores removed.

## 6. Requests

### For A (backend)

1. `PATCH /api/v2/me {name}` → `MeResponse` (profile, ST-01). Not in §4.3; DemoTransport serves it.
2. `POST /api/v2/orgs/:orgId/invitations/:id/resend` → `InvitationResponse` with a fresh token (old link stops working).
3. `GET /api/v2/platform/overview` → `PlatformOverview` (404 unless `isPlatformAdmin`).
4. `POST /api/auth/logout {everywhere:true}` revokes every session of the user ("Sign out everywhere").
5. `POST /api/auth/register` keeps returning `{emailVerificationRequired}`; `/api/verify/send` and `/api/verify/check` accept an optional `email` for signed-out verification.
6. `POST /api/v2/workspaces/:ws/audit/export {kind:'pdf'|'csv', report}` records `export.<kind>` with `targetType 'report'`, `targetId report`.
7. `scripts/check-pure.mjs` must allow the dynamic `import('./pdfExport')` in `utils/qbrPackPdf.ts` and `utils/pdfExport.ts`'s jsPDF import (they are the PDF boundary).

### For B / B1 / B2

1. Mount `<DataProvider>` as in §4 and switch the imports in §3.
2. Remove the imports of `context/AuthContext` (`App.tsx`, `index.tsx`, `components/{Login,AdminPanel,SuperAdminPanel,SuperuserCockpit,MemberManagement,SettingsHub,WorkspaceSwitcher,DirectoryProfile}.tsx`) and of `services/geminiService` (use `useApi().api.ai.ask`). C deletes both files afterwards (or I does).

### For I

1. Apply the `LEGACY_FILES` / `.prettierignore` removals in §5.
2. Re-record `tests/state/api/contract/http-contract.json` against A's preview (`tests/state/api/contract/record.ts`).
3. Move `utils/vite-env.d.ts` to the root if you prefer a single `vite/client` reference.
