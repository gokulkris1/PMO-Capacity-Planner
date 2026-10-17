# Hand-off: B2 "Product pages" (Release 2.0)

| | |
|---|---|
| Package | B2 (optional fourth package, BACKLOG §4.1): `pages/home/**`, `pages/me/**`, `pages/plan/**`, `pages/org/**`, `pages/delivery/**`, `pages/reports/**`, and deletion of the legacy components these pages replace |
| Branch | `worktree-agent-a196fb0529870f434` (based on `claude/resource-allocation-pmo-visibility-oi2g5f` @ `0b29f20`). Not pushed, not merged. |
| Built against | WP-0 `state/index.ts` and `utils/viewModels/index.ts` stubs (only the names in BACKLOG §4.3 are imported). No `fetch`, no `window.alert/confirm/prompt`, no hex colours, lucide icons only, no emoji. |
| Gate | `npm run typecheck`, `npm run lint` (B2 files fully clean, no legacy exemptions), `npm test` (51/51), `npm run build` all green. Prettier clean on `pages/**`. |

## 1. Route map (one line per route for the router)

All pages are the **default export** of the file. Paths are relative to `/o/:org/w/:ws/`. Every page sets `document.title` to "{Page} · PMO Capacity Planner", renders its own PageHeader, and reads URL state with `react-router-dom` (`useParams`, `useSearchParams`), so it must render inside the router.

| Route | File | Gate (B1 applies in the router/nav) | Query parameters the page owns |
|---|---|---|---|
| `home` | `pages/home/HomePage.tsx` | `data.read` | `basis` |
| `me` | `pages/me/MyPlanPage.tsx` | linked person or CONTRIBUTOR (page shows the "not linked" EmptyState otherwise) | — |
| `plan/capacity` | `pages/plan/capacity/CapacityOutlookPage.tsx` | `data.read` | `pivot`, `craft`, `chapter`, `tribe`, `basis`, `signal` |
| `plan/demand` | `pages/plan/demand/DemandPage.tsx` | `data.read` | `tab=craft`, `stage`, `tribe`, `missing`, `q`, `project`, `edit=new`, `basis` |
| `plan/allocations` | `pages/plan/allocations/AllocationsPage.tsx` | `data.read` (edit: `allocations.write`) | `pivot=project`, `group`, `tentative=0`, `q` |
| `plan/marketplace` | `pages/plan/marketplace/MarketplacePage.tsx` | `data.read` (Viewers see only the catalogue) | `tab=open\|catalogue\|under\|proposals`, `view=catalogue`, `quarter`, `craft`, `tribe` |
| `org/people` | `pages/org/people/PeoplePage.tsx` | `data.read` | `person=<id>\|new`, `tab=requests`, `q`, `craft`, `chapter`, `tribe`, `band`, `skill`, `group`, `basis` |
| `org/projects` | `pages/org/projects/ProjectsPage.tsx` | `data.read` | `project=<id>\|new`, `stage`, `tribe`, `status`, `q` |
| `org/tribes` | `pages/org/tribes/TribesPage.tsx` | `data.read` | — |
| `org/tribes/:tribeId` | `pages/org/tribes/TribeDetailPage.tsx` | `data.read` | `basis` |
| `delivery/jira-planview` | `pages/delivery/jira-planview/DeliveryPage.tsx` | `data.read` (tabs other than Overview/Sprints need `integrations.view`; Planview tab only when configured, D-4) | `tab=overview\|sprints\|health\|mapping\|people\|calibration\|planview`, `tribe` |
| `delivery/sprints` | `pages/delivery/sprints/SprintsPage.tsx` | flag `qbrSprintModule` (router should 404 when off; the page also shows an EmptyState) | — |
| `reports` | `pages/reports/ReportsPage.tsx` | `export` (page shows a no-access EmptyState otherwise) | — |

Settings › Structure (ORG-03) and Settings › Crafts (ORG-04) are routed under `settings/` in §4.3, so they belong to B1 and are not in this package.

Suggested router lines (B1, `React.lazy` per SH-08):

```tsx
const HomePage = lazy(() => import('./pages/home/HomePage'));
// … same pattern for every file above …
<Route path="home" element={<HomePage />} />
<Route path="me" element={<MyPlanPage />} />
<Route path="plan/capacity" element={<CapacityOutlookPage />} />
<Route path="plan/demand" element={<DemandPage />} />
<Route path="plan/allocations" element={<AllocationsPage />} />
<Route path="plan/marketplace" element={<MarketplacePage />} />
<Route path="org/people" element={<PeoplePage />} />
<Route path="org/projects" element={<ProjectsPage />} />
<Route path="org/tribes" element={<TribesPage />} />
<Route path="org/tribes/:tribeId" element={<TribeDetailPage />} />
<Route path="delivery/jira-planview" element={<DeliveryPage />} />
{qbrSprintModule && <Route path="delivery/sprints" element={<SprintsPage />} />}
<Route path="reports" element={<ReportsPage />} />
```

Pages assume the shell provides `<main id="main">`, the page gutter background (`--color-bg`) and the global styles from `styles/base.css` (font, `box-sizing`, focus ring). Pages include their own horizontal gutter (`--page-gutter`; Allocations and Demand use the 16 px dense gutter).

## 2. Stories

**Done (Must):**

| Story | Where | Notes |
|---|---|---|
| RP-01 Home | `pages/home` | 4 KPI tiles with basis caption and QBR2 delta, four-quarter capacity vs demand chart (chart/table), Over capacity and Under target lists, Unstaffed demand, "Needs a decision" (craft approvals, my proposals, initiated projects without demand), recent activity, Jira sync failed/stale banner, My plan link for linked users, write links hidden for Viewers. |
| RP-02 Capacity Outlook | `pages/plan/capacity` | Stacked chart (above / below / undeclared / free hatch, demand marker, target line) with table view; pivot craft/chapter/tribe/person and filters in the URL; utilisation QBR1–4 + detail for the basis quarter (supply, load, free, demand, gap); under/over side lists honour filters and basis. |
| RP-04 Reports | `pages/reports` | QBR pack PDF (cover, squad utilisation chart + table, supply vs demand by craft, open demand, over/under, delivery signal by tribe, time to staff); jsPDF/autotable loaded on click. CSVs: utilisation by person, by tribe/chapter/craft, open demand, bookings, time to staff. On-page utilisation and demand reports. |
| PPL-01 People | `pages/org/people` | Columns per AC1; QBR1–4 visible at 1280 px (Chapter/Team fold under the name below 1440); filters Craft/Chapter/Tribe affinity/Band/Skill + search in the URL; group by with Σload ÷ Σtarget group totals; 0 % shows "Available" tint; header Add person + overflow Import/Export (Viewer: Export only). |
| PPL-02 Person drawer | `pages/org/people/PersonDrawer.tsx` | 720 px, `?person=`, tabs Profile/Crafts/Load/Bookings/Identity; inline validation, same craft above/below prevented, load bars + table, bookings with confirm/decline/edit dates, identities from the delivery seam; "Discard changes?" confirm. |
| PPL-03 Bulk edit | `_parts/BulkEditDialog.tsx` | Set chapter/team/target/add below craft in one `people.bulk` call; 409 → "1 person changed since you loaded the page…" with Reload; toast with Undo. |
| PPL-04 CSV import/export | `_parts/ImportPeopleDialog.tsx`, `_parts/peopleCsv.ts` | Template download, per-row validation preview, "Import {n} valid rows", create-missing checkbox, result summary; export of the current filter; hidden without `import.csv` + `csvImport` entitlement. |
| PPL-05 My plan | `pages/me` | Load tiles QBR1–4 with BandPill, Proposed to you (Accept / Decline with reason), My bookings, My crafts with Suggest changes and pending/approved/rejected outcome, four-quarter load bars, My offers per quarter + "Offer my capacity". |
| PPL-06 Craft-change approval (UI) | `_parts/CraftRequests.tsx`, banner on People | Requests tab with current vs proposed diff, own chapter first, Approve, Reject with required reason. |
| PPL-07 Projects | `pages/org/projects` | Stage pipeline filter, table per AC1 (no project colours), drawer Details/Demand/Staffing/Delivery/Links, tribe required ("Choose a tribe"), Planview-owned dates read-only "Managed in Planview". |
| ORG-05 Tribes | `pages/org/tribes` | List per AC1 (gap pill, people serving, delivery signal or "No Jira mapping"); tribe page with KPI tiles, demand vs staffed chart/table, projects, people serving, calibration card with Edit. |
| AL-01 Grid | `pages/plan/allocations` | People rows grouped by team/chapter/tribe, booking sub-rows with CraftChip, QBR headers "QBR1 · Q4 2026", sticky header/first column, partial-quarter icon + tooltip with dates, tentative toggle and dashed cells. |
| AL-02 Inline edit + keyboard | `AllocationGrid.tsx` | `role="grid"`, roving tabindex, arrows/Home/End, Enter or typing to edit, Enter/Tab commit, Escape cancel, 0–200 validation, 0 removes that quarter, over-capacity warning icon with "Takes {name} to {n}%"; Add booking dialog with above/below/undeclared craft groups. |
| AL-03 Copy forward + undo | `AllocationsPage.tsx` | Row menu "Copy QBRn to later quarters" and Ctrl/⌘+Shift+→, toast "Copied to QBR2–QBR4" with Undo; Ctrl/⌘+Z and header Undo. |
| AL-04 Project pivot | same | `?pivot=project`: projects grouped by tribe, FTE cells, staffed/demand with gap; read-only for Viewers. |
| AL-05 Provenance, lock, tentative | same + drawers | ProvenanceTag, Planview lock (read-only cell, sunken tint, tooltip text from AC2), Confirm/Decline in the row menu. |
| AL-06 Date-precise editor | `pages/plan/_parts/BookingDatesDialog.tsx` | Slices with add/remove, end ≥ start, outside-project warning, one batch. |
| DM-02 Demand | `pages/plan/demand` | By project (tribe groups, stage filter, chips solid = Confirmed / dashed = Forecast, staffed vs gap bar, "No demand captured" chip and header link) and By craft (gap QBR1–4 linking to Marketplace, supply/committed/demand/gap/bench/reach for the selected quarter). Cell editor: craft, FTE (0.1), status, owner, note, copy to later quarters. No intake-queue placeholder. |
| DM-03 Marketplace propose | `pages/plan/marketplace` | Open demand per quarter with "x proposed, y open", ranked matches with reasons, confirm dialog wording per AC2, tentative booking via `marketplace.propose`; hidden for Contributor/Viewer. |
| DM-04 Catalogue | same | Viewer-only view, per-craft cards (free above, reach below, people, offers), Copy link (`?view=catalogue&quarter=`), Export CSV. |
| DM-05 Under target + offers | same, My plan | Under target tab with Offer/Withdraw; contributors offer from My plan. |
| JI-02 Mapping UI | `pages/delivery/jira-planview/MappingTab.tsx` | Combobox-equivalent selects, match method, auto-match, proposed rows highlighted, Confirm selected in one call. |
| JI-03 People mapping UI | `PeopleMappingTab.tsx` | Suggested person, method, override, "Confirm all exact matches". |
| JI-04 Calibration UI | `CalibrationTab.tsx`, `_parts/CalibrationDialog.tsx` | Current/Default, suggested with basis text, Use suggested / Edit, note required. |
| JI-05 Sprints UI | `SprintsTab.tsx` | Tribe select, last 6 sprints, committed vs done bars, implied vs planned trend, table. |
| JI-06 Delivery signal | Outlook (tribe pivot toggle), Project drawer, Tribes, Delivery overview | Wording per AC1, "Signal, not a timesheet", empty state per AC3. |
| JI-07 Sync health UI | `HealthTab.tsx` + Home banner | Last success, last run pill (Succeeded/Failed/Partial/Running/Rate limited), duration, pages, issues, last 10 jobs, Stale > 48 h; Sync now with progress polling. |
| PV-01 Preview/apply UI | `PlanviewTab.tsx` | Sections with checkboxes (removed unselected by default), field diffs, unmatched people select, "Apply {n} changes", expired-preview message; tab hidden when Planview is not configured. |
| PV-02 sample test (Delivery side) | `PlanviewTab.tsx` | "Test with sample record": source JSON beside mapped values, missing required fields flagged. The field-map **editor** is Settings › Integrations (B1). |
| SH-05#AC2 (page) | `pages/delivery/sprints` | Flag-gated wrapper that lazy-loads the legacy QBR module. |
| SH-03 (per page) | every page | Breadcrumbs, H1, one-line truncating description, actions (≤ 1 primary, overflow for Export/Import), time-basis control on Home/People/Outlook/Tribe; write actions hidden (not locked) without permission. |

**Should done:** AL-07 paste a range from Excel (TSV paste into the grid, "{n} cells updated, {m} skipped", non-numeric aborts).

**Not done / partial:**

| Story | Status | Why / what remains |
|---|---|---|
| AL-01#AC6 virtualisation (> 200 rows) | Not done | Grid renders all rows. `@tanstack/react-virtual` is installed; swap the `<tbody>` map in `AllocationGrid.tsx` for a virtualiser once B1's DataTable lands. |
| AL-08 drag-and-drop | Not done (Could) | — |
| RP-04#AC4 audit events for exports | Not done | No client hook to record `export.pdf/csv`; needs a C method (e.g. `useMutations().audit.export(kind)`) or server-side recording (A). |
| RP-05 XLSX | Not done (Should) | No XLSX library installed. |
| IN-01/02 tribe requests & intake | Not done (Should) | No API. Tribe leads browse and share the catalogue; Marketplace "Proposals" tab covers responses to proposals. |
| PPL-01 people combobox / Combobox everywhere | Partial | Native `<select>` with optgroups stands in for the Combobox until B1 ships it. |
| ORG-03/04 | Not in B2 | Routed under `settings/` (B1). |

## 3. Data-layer notes and requests (for C and I)

1. **Delivery data seam (needed for JI-02…07, PV-01/02).** The frozen `state/index.ts` exposes only `snapshot.delivery`. Pages read `useDelivery(snapshot)` from `pages/delivery/_parts/deliverySource.tsx`, an interface with mappings, identities, calibrations, sprint/quarter `DeliveryRowDTO`s, sync jobs and Planview preview/apply/test. Resolution order: `<DeliverySourceProvider value={…}>` → demo sample (only when `useSession().mode === 'demo'`) → snapshot-only (other tabs show their "not set up" states). **Request to C:** implement an API-backed `DeliverySource` (routes already in `API`: `jiraMappings`, `jiraAutoMatch`, `jiraProjectMappings`, `jiraPeopleMappings`, `calibration`, `syncJira`, `syncStep`, `syncHealth`, `delivery`, `planviewPreview/Apply/TestMapping`) and either export it from `state/` (contract change via I) or have I wrap the delivery/home/org routes in `DeliverySourceProvider`. The demo sample is deterministic and in-memory; delete it when C's `DemoTransport` serves delivery data.
2. **Ranked matches.** No `suggestMatches` view-model in the contract; `pages/plan/marketplace/rankMatches.ts` ranks from `buildCatalogue`. Replace if C adds one.
3. **Per-craft staffed FTE** (Demand by craft, Outlook gap, Marketplace open lines, Reports) is derived from `buildAllocationGrid` booking rows (`craftId`, overlap-weighted cells). A `buildCraftBalance` view-model from C would remove the duplication.
4. **Batch edits across quarters.** `setQuarterCell` ops for different bookings are concatenated into one `allocations.batch` (bulk set / copy = one Undo, AL-03#AC2). Paste (AL-07) may touch several quarters of the same booking, which cannot be composed from one snapshot, so it calls `allocations.setQuarterCell` per cell and its toast Undo undoes each step. A `setQuarterCells([...])` mutation would make paste one batch.
5. **CSV/PDF builders.** BACKLOG names `utils/csvPeople.ts` and `utils/pdfExport.ts` (C). Interim page-local equivalents: `pages/org/people/_parts/peopleCsv.ts` (same column contract as PPL-04#AC1) and `pages/reports/_parts/{reportData,qbrPackPdf}.ts` (PDF colours are read from the design tokens at run time, so no hex lives in `pages/**`). Swap to C's builders when they land; each is a single call site.
6. **Conflicts.** Pages show `useConflict()` as a warning banner with Reload/Dismiss (in `PageBody`), and every mutation's 409 shows a toast with Reload (`useAction`). Bulk people 409 shows the AC wording in the dialog.
7. **Undo** uses `useUndo()`; success toasts for reversible changes carry "Undo".
8. **Legacy QBR module token.** `SprintsPage` passes `token=""` to `QBRPlanner`; with cookie sessions (AC-03) the legacy `Authorization: Bearer` header is empty. A/I must confirm `qbr.ts` accepts the cookie session, or C exposes a token getter.

## 4. Kit-swap notes (B1 → `components/ui`)

All interim primitives live in `pages/plan/_kit/` (barrel `index.ts`, styles `kit.css`, classes prefixed `b2-` so they never collide with B1's `pcp-`). Names and props mirror DESIGN_SYSTEM §8, so the swap is an import change per page, then delete `pages/plan/_kit/`:

| Kit export | components/ui equivalent | Notes |
|---|---|---|
| `Button`, `IconButton` (`variant`, `size`, `icon`, `loading`) | Button, IconButton | `variant: primary/secondary/subtle/danger/link` |
| `PageHeader` (`crumbs`, `title`, `description`, `actions`, `basis`, `tabs`) + `BasisControl` | PageHeader + time-basis SegmentedControl | basis reads/writes `?basis=` via `useBasis()` |
| `PageBody` (loading skeleton / error banner + Retry / conflict banner / toast viewport) | Skeleton + Banner + shell Toast host | remove `ToastViewport` from `PageBody` once the shell hosts toasts |
| `Tabs`, `TabPanel`, `SegmentedControl` | Tabs, SegmentedControl | |
| `StatusPill`, `BandPill`, `BandCell`, `CraftChip`, `ProvenanceTag`, `BookingStatePill`, `Tag`, `Kbd`, `CountBadge`, `Avatar`, `PersonLabel` | StatusPill, BandPill, band cell tint, CraftChip, ProvenanceTag, Tag, Kbd, Badge, Avatar | |
| `KpiTile`, `Card`, `Banner`, `EmptyState`, `Skeleton` | same names | |
| `Drawer`, `Dialog`, `useConfirm` (`{ confirm, dialog }`), `Menu`, `Tooltip`, `toast()` | Drawer, Dialog, ConfirmDialog (promise API), Menu, Tooltip, useToast | `useConfirm` returns the element to render; B1's promise API may not need it |
| `FormField`, `TextField`, `NumberField`, `Select`, `Checkbox` | same names; `Select` → Combobox for people/projects/crafts | |
| `QuarterLoadBar`, `Legend`, `ChartFrame`, `StackedBarChart`, `GroupedBarChart`, `TrendChart` | QuarterLoadBar, charts kit (StackedCapacityChart, grouped bars, TrendLine) | charts are HTML/SVG drawn to scale with `--chart-*` classes; tooltips on hover and focus; every chart has a table view |
| `useSort` + `SortTh`, `.b2-table*` classes | DataTable | tables are semantic `<table>` with sticky header, sticky first column, `aria-sort` |
| `useWsPath`, `useQueryParam`, `useBasis`, `usePageTitle`, `useElementWidth`, `useAction`, `fmt.*` | keep (move to `components/ui/hooks` or `utils/format` as I prefers) | not UI primitives |

Page-specific CSS files (`home.css`, `people.css`, `allocations.css`, …) use only `var(--…)` tokens and stay with their pages.

## 5. Legacy components: deleted and still to delete

**Deleted in B2** (nothing imported them): `components/Slider.tsx`, `components/TimeSelector.tsx`, `components/ZodValidation.ts`. I: drop them from `LEGACY_FILES` in `eslint.config.js` and from `.prettierignore`.

**Delete after the router swap** (today only `App.tsx` (B1) or other legacy files import them; every one is replaced by a B2 page):

| File | Replaced by |
|---|---|
| `components/Dashboard.tsx`, `StatCard.tsx`, `CapacityChart.tsx`, `Heatmap.tsx`, `RiskScanner.tsx` | Home |
| `components/AllocationMatrix.tsx`, `AllocationModal.tsx`, `TeamView.tsx`, `WhatIfPanel.tsx` (unless SC ships) | Allocations (+ BookingDatesDialog) |
| `components/ResourceView.tsx`, `SkillsView.tsx`, `TimeForecastGrid.tsx`, `DirectoryProfile.tsx`, `ImportCSVModal.tsx` | People, person drawer, ImportPeopleDialog |
| `components/ProjectView.tsx` | Projects |
| `components/TribeView.tsx` | Tribes |
| `components/crafts/CraftProfilesView.tsx`, `DemandRoadmapView.tsx`, `SquadMarketplaceView.tsx`, `UtilisationView.tsx`, `shared.tsx` | People, Demand, Marketplace, Capacity Outlook |
| `components/integrations/IntegrationsHub.tsx` | Delivery (and Settings › Integrations, B1) |
| `components/Modals.tsx` (ResourceModal, ProjectModal) | person and project drawers (ConfirmModal → kit/B1 ConfirmDialog) |
| `components/qbr/**` | **Move**, do not delete: `git mv components/qbr pages/delivery/sprints/legacy`, update the one import in `pages/delivery/sprints/SprintsPage.tsx`, and keep `pages/delivery/sprints/legacy/**` in `LEGACY_FILES` until EP-21. |

Also legacy-only utilities that become unused once the above go (C owns `utils/**`): `utils/timeGrid.ts`, `utils/dateFilteredUtil.ts`, the old `utils/pdfExport.ts` `exportExecSummaryPDF`.

## 6. Verification done

- Every page rendered against the stubs in Chromium (Playwright) at 1440×900 and 1280×800 with a temporary dev harness (deleted) and reviewed visually; roles ORG_ADMIN, VIEWER and CONTRIBUTOR checked for gated actions; no page scrolls horizontally (tables scroll inside their cards; People shows QBR1–QBR4 at 1280 px).
- Interactions exercised: grid edit (type, Enter/Tab, Escape), copy forward shortcut, project pivot, demand editor, propose, offer, accept/decline, craft change suggestion and approval, bulk dialog, Planview preview and field test, Sync now polling, all six report downloads (PDF rendered and checked).

## 7. Open issues

1. Pages are not routed yet (B1/I). Until then `npm run build` does not bundle them; type-checking and lint cover them.
2. Grid virtualisation (AL-01#AC6) and Combobox are pending B1's DataTable/Combobox.
3. `TrendChart` points are hover/focus targets via screen-reader-only buttons; the visible SVG hit areas are mouse-only (keyboard users get the same values through the hidden buttons and the table view).
4. The Delivery "Overview" defaults to the latest closed quarter; real snapshots may need a quarter selector if tribes sync partially.
5. Home "Recent activity" is derived from entity `updatedAt/updatedBy`, proposals and offers in the snapshot; it becomes richer when AU-01 audit events are exposed to the client.
6. Owner pickers (demand line owner, project owner) only list the current user and existing owners, because members are not in the snapshot (`admin.members()` is admin-only).
