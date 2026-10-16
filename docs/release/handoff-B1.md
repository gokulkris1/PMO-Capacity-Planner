# Hand-off: B1 "Design system, shell, auth/settings/admin/system pages" (Release 2.0)

| | |
|---|---|
| Package | B1 (optional fourth package, BACKLOG §4.1) |
| Branch | `b1-design-system-shell` (worktree), based on `claude/resource-allocation-pmo-visibility-oi2g5f` @ `0b29f20` |
| Checkpoint 1 (kit + shell + router) | `f521fc0` |
| Gate (all green) | `npm run typecheck`, `npm run lint`, `npm run check:guardrails`, `npm test` (51/51), `npm run build`, `npm run format:check`; B1 files also lint-clean with `eslint --no-ignore` and 0 guardrail hits with `--all` |
| Screenshots | `/tmp/claude-0/-home-user-PMO-Capacity-Planner/30300e26-6330-58c3-8326-070765d23fff/scratchpad/b1/*.png` (list in §7) |

## 1. What B1 delivers

- **Tokens and base** (DS-01): `styles/tokens.css` (DESIGN_SYSTEM §15: light, dark, `--ds-*` mapping; values verified identical to the spec, Prettier only normalised `0.60`→`0.6`), `styles/base.css` (reset, Inter, type, focus ring, skip link, scrollbars, reduced motion), `styles/utilities.css` (`pcp-` layout/typography utilities), `styles/legacy-aliases.css` (temporary: maps `--brand-*`, `--n-*`, `--over` … onto tokens for the not-yet-migrated `components/qbr|crafts|integrations`). `index.css` only imports the three style files. Inter is self-hosted (`@fontsource-variable/inter`); no Google Fonts anywhere. `index.html`: new title, description, `lang="en-GB"`, favicon `public/favicon.svg` (DESIGN_SYSTEM §9).
- **Kit** `components/ui/**` (DS-02…DS-05): every component in DS-02#AC1 plus DataTable, overlays, FilterBar, CodeInput, PasswordField and the chart kit. API: `components/ui/README.md`. Living reference (dev only): `/o/demo/w/demo/kit`.
- **Shell** `components/shell/**` (SH-02/03/05/06/07/09): navy collapsible sidebar (grouped IA, rail with tooltips, per-user collapse pref, overlay drawer < 768 px), top bar (workspace switcher, ⌘K search, LIVE context, help menu with glossary/shortcuts/what's new/assistant, notifications bell, user menu), embedded mode (`?embedded=1` / `VITE_EMBEDDED`), page error boundary, Suspense skeletons, global conflict dialog, toasts and confirm providers, time-basis hook/control, guards.
- **Router** `App.tsx` (SH-01, SH-08): full §4.3 route map, `/demo/*`, old-URL redirects, `?next=` deep links (same-origin only), hash router via `VITE_ROUTER=hash`, every page lazy; `vite.config.ts` with `manualChunks` (`vendor-react`, `vendor-icons`, `vendor-table`, `vendor-charts`, `vendor-pdf`) and `build.manifest: true`. Entry + static imports = **114.5 KB gzip** (budget 350 KB). The legacy `process.env.GEMINI_API_KEY` defines are gone (HS-15).
- **Pages** `pages/auth|settings|admin|system/**`: see §2.
- **Guardrails** `scripts/check-ui-guardrails.mjs` (`npm run check:guardrails`): emoji, hex colours (TS/TSX/CSS), inline colour styles, native dialogs, non-lucide icon libraries; prints `file:line`; skips files still in `LEGACY_FILES` (use `-- --all` to include them: today 1,316 hits, all in legacy files scheduled for deletion; 0 in B1 files).

## 2. Stories

| Story | Status | Notes |
|---|---|---|
| DS-01 | Done | AC1–AC5. Legacy alias file to delete once B2/SH-04 removes the last `var(--n-…)` consumer. |
| DS-02 | Done | All AC1 components; FormField wiring (AC2), focus ring + keyboard (AC3), BandPill (AC4), CraftChip takes `craft={CraftDTO}` (AC5), loading Button (AC6), lint-clean (AC7). |
| DS-03 | Done (B1 part) | Dialog, ConfirmDialog + `useConfirm()`, Drawer (+ `useUrlParam` for `?person=`), Toast with Undo, `errorToastText(requestId)`. AC1 grep is zero in B1 files; the 26/11 legacy call sites disappear when the legacy components are deleted (§4). |
| DS-04 | Done | Sticky header/first column, tri-state sort + `aria-sort`, density persisted per table, selection + bulk bar, grouping, virtualisation > 200 rows, loading/error/empty, `<caption>`. AC7 CSV: `toCsvMatrix(columns, rows)` + `applySort` give the current view; pages pass it to C's `utils/csv.ts toCsv()`. |
| DS-05 | Done | `components/ui/charts`: `StackedCapacityChart`, `TrendLine`, `ChartFrame` (Chart \| Table), `useChartColors()` (CSS variables only). `HeatStrip` lives in the main kit. |
| DS-06 | Done (B1 files) | Lucide only, favicon, 0 emoji in B1 files. Legacy emoji go with the legacy files. |
| DS-07 | Done | Script written and wired to the reserved name. |
| DS-08 | Partly | axe (wcag2a/aa) on all B1 routes: 0 violations (login, reset, invite, 404, every settings section, cockpit, kit, embedded). Lighthouse not run; I's Playwright axe suite still to run on every route. |
| SH-01 | Done (B part) | AC1 titles via `PageHeader`/`useDocumentTitle`; AC2 redirects; AC3 403 page for unknown/foreign workspace and for `useWorkspaceData().error.status === 403`; AC4 switcher keeps the sub-path; AC5 `?next=`; AC6 title "Settings"; AC7 hash router. |
| SH-02 | Done | 11 items (+ My plan for linked people/squad members, + Sprint planning only with `qbrSprintModule`); gating by `can()`/`useFeature()` only. |
| SH-03 | Done | `PageHeader` (breadcrumbs, H1, one-line description with tooltip, actions + "More actions" overflow, tabs) and `TimeBasisControl` (`?basis=`, quarter tooltip "QBR1 = Q4 2026"). |
| SH-04 | Not done | Deletions are outside B1 ownership; list for I in §4. |
| SH-05 | Done (B part) | Nav item + `RequireFeature` 404 for `/delivery/sprints`. |
| SH-06 | Done | ⌘K / Ctrl K, grouped results (max 5), ↑/↓/Enter; person → `org/people?person=`, project → `org/projects?project=`, tribe → `org/tribes/:id`, craft → `org/people?craft=` (B2: please honour `?craft=`). |
| SH-07 | Done | Page-area error boundary with reference, 404, 403 (workspace/page + role), maintenance (503 `migration_pending`). |
| SH-08 | Done (B part) | Lazy routes, vendor chunks, manifest. A's `check-bundle-size.mjs` reads `dist/.vite/manifest.json` (entry key `index.html`). |
| SH-09 | Done (shell) | Rail below 1280, overlay below 768, tables scroll in cards. Hiding edit controls below 768 is per page (`pcp-hide-below-md` utility). |
| SH-10 | Done (B part) | UI, `index.html`, favicon. Help shows `v2.0.0` (vite maps `0.0.0` → `2.0.0` until I bumps `package.json`). |
| ST-01 | Done (UI) | Sub-nav per permission; Organisation (name, https logo URL, read-only slug, visibility, workspaces add/rename/delete with typed-name confirm); Profile (name, password ≥ 10, 2FA, sign out everywhere). |
| ST-02 | Done (UI) | Members table with org/workspace role selects, linked person, last sign-in, pending invitations (resend/revoke/copy link), invite dialog with links + note, PMO-Admin scope, "About roles" with the five labels. |
| ST-03 | Done | Fiscal month (1/4/7/10) with "QBR1 = FY27 Q1 (Oct–Dec 2026)" preview, band thresholds with `validateThresholds()` and live preview, target, sprint length, Planview rule; read-only for non-Org-Admins; sticky save bar. |
| ST-04 | Done (UI) | Jira and Planview cards, write-only secrets ("Saved"), test connection with detected story-point field, read-only for Planners. |
| ST-05 | Done | AI (ConfirmDialog with the HS-11#AC2 egress text), sprint module, daily Jira sync. Scheduled Planview import / Scenarios are hidden until PV-04/SC ship. |
| ST-06 | Done | Only when `me.appMode === 'public'` and `org.billing`; plan, usage, plan picker → checkout. |
| ST-07 | Done | Sign in (uses `useSession().login(email, password, otp?)`, i.e. the unchanged `/api/auth/login` contract; 2FA 6-box step, resend after 30 s), reset (never shows a code, no enumeration), verify email, invitation page, "Create account" only when sign-up is enabled; no tour, no narration; signed-in users are redirected to their last workspace (platform admins without an org to `/cockpit`). |
| ST-08 | Done (UI) | `/create`; already-in-org users are redirected. |
| ST-09 | Done (UI) | `/cockpit` 404 unless `platform.admin`; stats, organisations, platform audit, "Open org" with audit notice. |
| ST-10 | Done (B part) | `/demo` → `/demo/w/demo/home` with the full shell; banner on every page in demo mode; `/demo` 404 in internal mode unless `VITE_ENABLE_DEMO=true`. |
| ORG-03 / ORG-04 | Done (UI) | Structure (tribes/chapters/teams, counts, rename, archive/restore, "Create chapters from crafts") and craft catalogue (code chip, holders above/below, add/edit, move up/down, archive); read-only without `structure.write`. |
| AC-05/07/08/09, HS-14 (B parts) | Done | Invite dialog, accept page, verify page, create-org form, visibility setting, 2FA re-auth dialog. |
| HS-11 (B part) | Partly | Help › "Ask the assistant" appears only when `aiAssistant` is on and opens a 480 px drawer; the question/answer UI needs C's `api.ai.ask()` (not in `state/` yet). |
| OB-02 (Should) | Done | Glossary drawer from Help. |
| NT-01 (Should) | Partly | Bell count + popover (pending proposals to me, pending craft approvals). No persistent inbox. |
| AU-01 (Should) | Not done | Section hidden. |

## 3. Integrating B2 pages (one line per route)

`components/shell/pages.manifest.ts` maps every B2 route to a placeholder. For each entry replace the
`placeholder({...})` call with the import shown in its `// INTEGRATE:` comment. B2 pages **default-export**
their component. No other router change is needed.

| Key | Route (below `/o/:org/w/:ws` and `/demo/w/:ws`) | Point at |
|---|---|---|
| `home` | `home` | `pages/home/HomePage` |
| `myPlan` | `me` | `pages/me/MyPlanPage` |
| `capacity` | `plan/capacity` | `pages/plan/CapacityOutlookPage` |
| `demand` | `plan/demand` | `pages/plan/DemandPage` |
| `allocations` | `plan/allocations` | `pages/plan/AllocationsPage` |
| `marketplace` | `plan/marketplace` | `pages/plan/MarketplacePage` |
| `people` | `org/people` (`?person=`, `?craft=`, `?tab=requests`) | `pages/org/PeoplePage` |
| `projects` | `org/projects` (`?project=`) | `pages/org/ProjectsPage` |
| `tribes` | `org/tribes` | `pages/org/TribesPage` |
| `tribe` | `org/tribes/:tribeId` | `pages/org/TribePage` |
| `delivery` | `delivery/jira-planview` (`?tab=`) | `pages/delivery/DeliveryPage` |
| `sprints` | `delivery/sprints` (wrapped in `RequireFeature qbrSprintModule`) | `pages/delivery/sprints/SprintPlanningPage` |
| `reports` | `reports` (wrapped in `RequirePermission export`) | `pages/reports/ReportsPage` |

If B2 chose other file names, change only the path in that line. Pages render inside the shell's error
boundary and Suspense; they should start with `<PageHeader>` and wrap content in `<div className="pcp-page">`.

## 4. Requests to other packages (I applies)

**I (integration / tooling)**
1. Remove `App.tsx`, `index.tsx`, `vite.config.ts` from `LEGACY_FILES` (eslint.config.js) and `.prettierignore`: all three are rewritten and pass `eslint --no-ignore` and Prettier.
2. Delete v1.1 UI files replaced by B1 (SH-04#AC2, ST-01#AC5, ST-09#AC3) and drop them from `LEGACY_FILES`: `components/Login.tsx`, `components/SettingsHub.tsx`, `components/SuperuserCockpit.tsx`, `components/SuperAdminPanel.tsx`, `components/AdminPanel.tsx`, `components/MemberManagement.tsx`, `components/PricingPage.tsx`, `components/WorkspaceSwitcher.tsx`, `components/TourOverlay.tsx`, `components/Modals.tsx`, `components/ZodValidation.ts`, `components/Slider.tsx`, `components/StatCard.tsx`, `components/TimeSelector.tsx`, `components/RiskScanner.tsx`, `components/WhatIfPanel.tsx`. None is imported by the new router any more; the rest of `components/*.tsx` go with B2's pages (SH-04 list). After that, `npm run check:guardrails -- --all` should be clean and `styles/legacy-aliases.css` (+ its import in `index.tsx`) can be deleted once `components/qbr|crafts|integrations` are rewritten.
3. Set `package.json` `version` to `2.0.0` (SH-10#AC3); `vite.config.ts` then shows it unchanged.
4. Consider a `tests/ui/**` jsdom project for kit tests (B1 owns no test directory).

**C (client data layer)** — add to `state/` (same shapes as `components/shell/clientGaps.ts`, then I swaps the import in the pages listed below):
1. `useClientGaps()` → `auth.{register, requestPasswordReset, confirmPasswordReset, sendVerification, checkVerification, lookupInvitation, acceptInvitation}`, `account.{createOrg, updateProfile, changePassword, setTwoFactor}`, `org.{createWorkspace, renameWorkspace, deleteWorkspace, listInvitations, resendInvitation, revokeInvitation, startCheckout}`, `integrations.{get, saveJira, testJira, savePlanview, testPlanview}`, `platform.overview()`. Until then demo mode simulates them and live mode shows an error state (501). Pages importing it: `pages/auth/{Register,ResetPassword,VerifyEmail,AcceptInvite,CreateOrg}Page.tsx`, `pages/settings/{Profile,Organisation,Members,Integrations,Billing}Settings.tsx`, `pages/admin/CockpitPage.tsx`.
2. `useSession().login()` must keep mapping to `POST /api/auth/login { email, password, otp? }` and resolve `{ require2FA: true }` for 2FA users (LoginPage relies on it); on 401 reject with `ApiRequestError(401)`.
3. `useWorkspaceData().error` should carry `status`/`code` so the shell can show 403 and `migration_pending` (503) pages; `WorkspaceLayout` already handles both.
4. `useWorkspace()` should select the workspace from the URL `:ws` (the shell also calls `switchWorkspace(ws)` while the stub needs it).
5. AI usage this month (Billing) and `api.ai.ask()` (assistant drawer) are not in the contract yet.

**A (backend) / contract change via I**
1. `InvitationResponse` has no "email sent" flag; the invite dialog therefore shows the "send this link yourself" note conditionally worded in live mode. Suggest adding `emailSent: boolean`.
2. `scripts/check-bundle-size.mjs`: the entry is `index.html` in `dist/.vite/manifest.json`; today the entry and its static imports are 114.5 KB gzip.

**B2**
- Use `components/ui` + `components/shell` (README). Honour `?craft=` on People (search target), `?tab=requests` (bell link), `?person=` / `?project=` drawers via `useUrlParam`.
- Time basis: `const basis = useTimeBasis('qbr1')`; `<PageHeader timeBasis={<TimeBasisControl state={basis} />} />`; KPI `caption={basis.caption}`.

## 5. Environment variables read by the UI (all optional, none secret)

`VITE_APP_MODE` (`public` default \| `internal`), `VITE_ALLOW_PUBLIC_SIGNUP`, `VITE_ENABLE_DEMO`, `VITE_EMBEDDED`, `VITE_ROUTER=hash`, `VITE_APP_VERSION` (injected). Billing visibility uses `me.appMode` at runtime.

## 6. Open issues / known limits

- The WP-0 stub is always `mode: 'demo'`, so the demo banner shows on `/o/demo/...` too; with C's real session it shows only in demo mode.
- Native date inputs render in the browser's locale (e.g. `10/01/2026` in an en-US browser); read-only dates use `formatDate` ("1 Oct 2026").
- Edit controls are not yet hidden below 768 px on settings pages (SH-09#AC2 is read-only mobile; settings forms still work).
- Members table: the stub returns only the demo user, so role selects are only visible for other members in live data.
- Lighthouse (DS-08#AC5) not run here; axe shows 0 violations on B1 routes.

## 7. Screenshots (scratchpad `…/scratchpad/b1/`)

`01-shell-home`, `02-shell-rail` (1180 px rail), `03-notfound`, `04-kit` / `04-kit-tall` (component gallery incl. DataTable, KPI, chart), `10-login`, `11-reset`, `12-invite`, `20…27-settings-*` (profile, organisation, members, structure, crafts, planning with save bar, integrations, features), `28-invite-dialog`, `30-search`, `31-cockpit`, `32-help-menu`, `33-user-menu`, `34-ws-switcher`, `40-mobile`, `41-mobile-nav` (390 px), `42-tablet` (1024 px), `43-embedded`, `44-forbidden`, `45-viewer-settings` (403 for Viewer), `46-contributor-nav` (Settings shows only Profile), `50-confirm`, `51-toast-drawer`.
