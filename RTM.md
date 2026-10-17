# PMO Capacity Planner: requirements traceability (v2.0)

Release 2.0.0. Every story in [`docs/product/BACKLOG.md`](docs/product/BACKLOG.md), with its status, where it is built and the tests that cover it. The v1.1 matrix is in git history (`RTM.md` before 2.0).

Test locations: Jest files are under `tests/backend`, `tests/state`, `tests/utils` and `tests/shared`; Playwright specs are under `tests/e2e` (`live/` is the full-stack v1.1 upgrade run). All of them run in CI on every push.

## Summary

- Must: 106 of 107 done (AL-01 partly: no virtualisation above 200 rows). AC-03 has one recorded deviation, and the PL-14 production-copy rehearsal is a customer step.
- Should: 3 of 18 done (AL-07, OB-02, PL-16; NT-01 partly).
- Could: AL-08 not done.

Release-level evidence: `npm run ci` (lint, strict typecheck, format, 455 Jest tests, build), `npm run check:guardrails -- --all`, `npm run check:bundle`, and `npm run test:e2e` (73 Playwright tests, demo plus live).


## DS: Corporate design system

Built in: `components/ui/**`, `styles/**`. Tests: e2e `a11y.spec`, `demo-routes.spec`; `check:guardrails --all`.

| ID | Story | Priority | Status | Notes |
|---|---|---|---|---|
| DS-01 | Design tokens, base styles and self-hosted Inter | Must | Done |  |
| DS-02 | Core UI primitives library | Must | Done |  |
| DS-03 | Overlays: dialog, confirm, drawer, toast; no native alert/confirm | Must | Done |  |
| DS-04 | Data table | Must | Done |  |
| DS-05 | Chart kit | Must | Done |  |
| DS-06 | Icon system and emoji purge | Must | Done |  |
| DS-07 | Design guardrails in lint | Must | Done |  |
| DS-08 | Accessibility baseline | Must | Done | axe WCAG 2.0/2.1 A+AA: 0 serious/critical on all 20 routes, the sign-in page and a drawer. Lighthouse not run. |

## SH: App shell, IA and routes

Built in: `components/shell/**`, `App.tsx`. Tests: e2e `demo-routes.spec`, `demo-roles.spec`; `check:bundle`.

| ID | Story | Priority | Status | Notes |
|---|---|---|---|---|
| SH-01 | Route map, deep links and redirects | Must | Done |  |
| SH-02 | App shell: navy sidebar, top bar, embedded mode | Must | Done |  |
| SH-03 | Page header and time-basis selector | Must | Done |  |
| SH-04 | Retire duplicate and legacy views | Must | Done | v1.1 views deleted; `LEGACY_FILES` is empty; guardrails clean with `--all`. |
| SH-05 | Feature flags; QBR sprint module hidden | Must | Done | `qbrSprintModule` off for migrated orgs (D-5); API answers 403 `feature_disabled`. Org Admins switch it on (CA-14). |
| SH-06 | Global search (⌘K) | Must | Done |  |
| SH-07 | Error boundary, 404, 403 and maintenance pages | Must | Done |  |
| SH-08 | Route-level code splitting and bundle budget | Must | Done | Lazy routes and vendor chunks; Home 164 KB gzip of the 350 KB budget. |
| SH-09 | Responsive layout | Must | Done |  |
| SH-10 | One product name everywhere | Must | Done |  |

## HS: Security hardening

Built in: `netlify/functions/**`, `netlify.toml`. Tests: `auth.test`, `authz.matrix.test`, `integrations.test`, `ai.billing.test`, `scripts.test`; e2e `security.spec`.

| ID | Story | Priority | Status | Notes |
|---|---|---|---|---|
| HS-01 | Reset code no longer returned (SEC-01) | Must | Done | Before the backlog (`466e1e0`); regression in `auth.test`. Forensics are CA-9. |
| HS-02 | Unauthenticated debug endpoint removed (SEC-06) | Must | Done | Before the backlog (`debug_db` removed); `check-function-names` in CI. |
| HS-03 | Committed DB credentials removed from scripts (SEC-05) | Must | Done | Credentials removed from scripts; rotation is CA-1; gitleaks in CI. |
| HS-04 | QBR endpoint tenant isolation | Must | Done |  |
| HS-05 | OTP hardening and rate limiting | Must | Done |  |
| HS-06 | Stripe webhook fails closed; subscription lifecycle | Must | Done |  |
| HS-07 | Remove the open email relay | Must | Done |  |
| HS-08 | Integration credentials cannot be exfiltrated; SSRF closed | Must | Done |  |
| HS-09 | Dedicated, versioned integration encryption key | Must | Done |  |
| HS-10 | Remove the logo-scraping endpoint | Must | Done |  |
| HS-11 | AI assistant: off by default, opt-in, server-built prompt | Must | Done | Server-side `/api/ai` with egress notice; Help › Ask the assistant drawer (I) when `aiAssistant` is on. |
| HS-12 | Security headers and CSP | Must | Done | Headers in `netlify.toml`; CSP **enforced** (I), proven by the e2e suite under the enforced policy. |
| HS-13 | Password policy and account enumeration | Must | Done |  |
| HS-14 | Re-authentication to disable 2FA | Must | Done |  |
| HS-15 | No keys in the browser bundle; committed logs removed | Must | Done |  |
| HS-16 | Script guards and JWT fallback check | Must | Done |  |

## AC: Access control, identity, sessions

Built in: `netlify/functions/_lib/{auth,authz,session}.ts`, `state/runtime.ts`. Tests: `auth.test`, `authz.matrix.test`, `v2.org.test`, `upgrade.test`; `tests/state`.

| ID | Story | Priority | Status | Notes |
|---|---|---|---|---|
| AC-01 | Target role model: schema and backfill | Must | Done |  |
| AC-02 | One authentication and authorization library, applied everywhere | Must | Done |  |
| AC-03 | Cookie session, CSRF, refresh, logout; existing sessions preserved | Must | Done | Cookie session + CSRF + v1.1 token exchange. The login body is `{ user }` only; the session lives in the HttpOnly cookie (QA-001). |
| AC-04 | `GET /api/v2/me` and permission-driven UI | Must | Done |  |
| AC-05 | Invitations replace temp passwords and role overwrites | Must | Done |  |
| AC-06 | Tenant-scoped member management | Must | Done |  |
| AC-07 | Platform admin by flag only; email verification | Must | Done |  |
| AC-08 | Workspace and org creation authorization | Must | Done |  |
| AC-09 | Workspace read visibility setting | Must | Done |  |
| AC-10 | Audit events for every write | Must | Done |  |
| AC-11 | Short-lived access token with rotating refresh token | Should | Not done | Should. Sessions revocable via `token_version` (`/logout-all`). |
| AC-12 | Time-boxed support grants for platform admins | Should | Not done | Should. Platform-admin tenant access is read-only and audited. |

## PL: Platform, data API, migrations, gates

Built in: `netlify/functions/v2.ts`, `migrations/**`, `services/api/**`, `state/**`, CI. Tests: `v2.data.test`, `migrations.test`, `upgrade.test`, `tests/state/**`, `legacy.test`.

| ID | Story | Priority | Status | Notes |
|---|---|---|---|---|
| PL-01 | Shared function library (`_lib`) and fail-closed configuration | Must | Done |  |
| PL-02 | Migration runner, baseline and no runtime DDL | Must | Done |  |
| PL-03 | Retire the legacy full save; fix workspace selection | Must | Done |  |
| PL-04 | Per-entity API with optimistic concurrency (`/api/v2`) | Must | Done |  |
| PL-05 | Client API layer with a transport interface | Must | Done |  |
| PL-06 | Client store and hooks; App.tsx without data state | Must | Done |  |
| PL-07 | Entitlements service | Must | Done |  |
| PL-08 | One CI pipeline with security gates | Must | Done |  |
| PL-09 | Repository hygiene and legacy server removal | Must | Done | `server/`, Render, Vercel config removed; history docs under `docs/history`; `NETLIFY_SETUP.md` merged into README (I). |
| PL-10 | Dependency clean-up and upgrades | Must | Done | Unused deps removed (I: `papaparse`, `uuid`); `npm audit --omit=dev`: 0 vulnerabilities. |
| PL-11 | Lint, format and type-check tooling | Must | Done |  |
| PL-12 | Authorization matrix and regression tests | Must | Done |  |
| PL-13 | Health endpoint and structured logs | Must | Done |  |
| PL-14 | Release runbook, rehearsal and data-parity check | Must | Done (rehearsal pending) | `db:parity`, `db:migrate --dry-run`, upgrade proof on PGlite + PostgreSQL 16, live e2e, `RUNBOOK.md`. Rehearsal on a Neon branch of production needs CA-5/CA-12. |
| PL-15 | Composite tenant keys, `app_rw` role and row-level security | Should | Not done | Should. Needs a customer-created DB role. |
| PL-16 | TypeScript strict mode everywhere | Should | Done | `tsconfig.json` strict for the whole code base (I). |
| PL-17 | Error tracking (Sentry) | Should | Not done | Should. Structured JSON logs with request ids are in place. |

## ORG: Org structure and crafts

Built in: `pages/settings`, `pages/org/tribes`, migration 0004. Tests: `v2.org.test`, `viewModels.test`, `sameNumber.test`.

| ID | Story | Priority | Status | Notes |
|---|---|---|---|---|
| ORG-01 | Tribes, chapters, teams and crafts as tenant data (schema and migration) | Must | Done |  |
| ORG-02 | Org-structure and craft-catalogue API | Must | Done |  |
| ORG-03 | Settings › Structure (tribes, chapters, teams) | Must | Done |  |
| ORG-04 | Craft catalogue admin | Must | Done |  |
| ORG-05 | Tribes pages | Must | Done |  |
| ORG-06 | Client domain switches to entity ids | Must | Done |  |

## PPL: People, crafts, My plan, Projects

Built in: `pages/org/people`, `pages/org/projects`, `pages/me`. Tests: `v2.data.test`, `v2.extras.test`, `csv.test`, `viewModels.test`; e2e `demo-flows.spec`.

| ID | Story | Priority | Status | Notes |
|---|---|---|---|---|
| PPL-01 | People page | Must | Done |  |
| PPL-02 | Person drawer | Must | Done |  |
| PPL-03 | Bulk edit people | Must | Done |  |
| PPL-04 | CSV import and export of people and crafts | Must | Done |  |
| PPL-05 | My Plan (squad member) | Must | Done |  |
| PPL-06 | Craft-change approval | Must | Done |  |
| PPL-07 | Projects page and project drawer | Must | Done |  |

## AL: Allocation grid

Built in: `pages/plan/allocations`, `utils/allocationOps.ts`. Tests: `allocationOps.test`, `v2.data.test`, `tests/state`; e2e `demo-flows.spec`, live `upgrade-live.spec`.

| ID | Story | Priority | Status | Notes |
|---|---|---|---|---|
| AL-01 | Quarter-first allocation grid | Must | Partly | All ACs except AC6 (virtualisation above 200 rows). |
| AL-02 | Inline editing with craft selector and keyboard navigation | Must | Done |  |
| AL-03 | Copy forward and undo | Must | Done |  |
| AL-04 | Project-centric pivot | Must | Done |  |
| AL-05 | Provenance, Planview lock and tentative/confirmed state | Must | Done |  |
| AL-06 | Date-precise booking editor | Must | Done |  |
| AL-07 | Paste a range from Excel | Should | Done | Should, done: paste a range from Excel, one batch, one undo step. |
| AL-08 | Drag-and-drop rebalancing | Could | Not done | Could. |

## DM: Demand and Marketplace

Built in: `pages/plan/demand`, `pages/plan/marketplace`, migration 0005. Tests: `v2.extras.test`, `craftEngine.test`, `b2Extras.test`; e2e `demo-flows.spec`.

| ID | Story | Priority | Status | Notes |
|---|---|---|---|---|
| DM-01 | Demand lines as entities | Must | Done |  |
| DM-02 | Demand page | Must | Done |  |
| DM-03 | Marketplace: propose → tentative → accept | Must | Done |  |
| DM-04 | Squad catalogue for tribe leads | Must | Done |  |
| DM-05 | Under-target list and "Offer to marketplace" | Must | Done |  |

## JI: Jira sync

Built in: `pages/delivery/jira-planview`, `netlify/functions/jira-sync-*`, migration 0006. Tests: `jira.sync.test`, `jira.aggregate.test`, `integrations.test`.

| ID | Story | Priority | Status | Notes |
|---|---|---|---|---|
| JI-01 | Scheduled, chunked Jira sync into delivery snapshots | Must | Done |  |
| JI-02 | Jira project ↔ planner project and tribe mapping | Must | Done |  |
| JI-03 | Assignee ↔ person identity mapping | Must | Done |  |
| JI-04 | Per-tribe calibration with suggested value | Must | Done |  |
| JI-05 | Sprint and velocity view per tribe | Must | Done |  |
| JI-06 | Delivery signal in Capacity Outlook, Projects and Tribes | Must | Done |  |
| JI-07 | Sync health | Must | Done |  |
| JI-08 | Portable Jira aggregation module | Must | Done |  |
| JI-09 | Jira OAuth 2.0 (3LO) | Should | Not done | Should. Needs an Atlassian developer app; API-token mode works. |

## PV: Planview sync

Built in: `pages/delivery/jira-planview/PlanviewTab.tsx`, `_lib` planview. Tests: `planview.test`.

| ID | Story | Priority | Status | Notes |
|---|---|---|---|---|
| PV-01 | Preview diff before apply; idempotent import | Must | Done |  |
| PV-02 | Field-map editor with sample test | Must | Done |  |
| PV-03 | Persisted Planview mappings | Must | Done |  |
| PV-04 | Scheduled Planview import | Should | Not done | Should. |

## RP: Home, Outlook, reporting

Built in: `pages/home`, `pages/plan/capacity`, `pages/reports`, `utils/viewModels`. Tests: `reports.test`, `sameNumber.test`, `viewModels.test`, `performance.test`; e2e `demo-flows.spec`.

| ID | Story | Priority | Status | Notes |
|---|---|---|---|---|
| RP-01 | Home | Must | Done |  |
| RP-02 | Capacity Outlook | Must | Done |  |
| RP-03 | Target-band semantics and the same-number guarantee | Must | Done |  |
| RP-04 | Reports: CSV exports and QBR pack | Must | Done | QBR pack PDF + CSVs; export audit events wired via `useRecordExport` (I). |
| RP-05 | XLSX export | Should | Not done | Should (XLSX). |

## ST: Settings, auth pages, demo

Built in: `pages/settings`, `pages/auth`, `pages/admin`, `services/api/demo`. Tests: `v2.org.test`, `auth.test`, `ai.billing.test`; e2e `demo-roles.spec`, `a11y.spec`, live `upgrade-live.spec`.

| ID | Story | Priority | Status | Notes |
|---|---|---|---|---|
| ST-01 | Settings shell, organisation and workspace sections | Must | Done |  |
| ST-02 | Members and roles | Must | Done |  |
| ST-03 | Planning settings: fiscal calendar, thresholds, sprint length, Planview rule | Must | Done |  |
| ST-04 | Integrations settings (connections moved from the hub) | Must | Done |  |
| ST-05 | Features settings (AI opt-in, sprint module) | Must | Done |  |
| ST-06 | Billing (public mode only) | Must | Done |  |
| ST-07 | Sign-in, reset, verification and invitation pages | Must | Done |  |
| ST-08 | Create organisation flow | Must | Done |  |
| ST-09 | Platform admin cockpit | Must | Done |  |
| ST-10 | Demo mode on the new architecture | Must | Done | `/demo` with `?demoRole=`; e2e runs on it. |

## SC: Scenarios

Built in: —. Tests: —.

| ID | Story | Priority | Status | Notes |
|---|---|---|---|---|
| SC-01 | Named scenarios stored server-side | Should | Not done | Should. |
| SC-02 | Scenario context in the top bar with compare view | Should | Not done | Should. |

## NT: Notifications

Built in: —. Tests: —.

| ID | Story | Priority | Status | Notes |
|---|---|---|---|---|
| NT-01 | In-app notification inbox | Should | Partly | Should. Bell with pending proposals and approvals; no persistent inbox. |
| NT-02 | Email digest | Should | Not done | Should. |

## AU: Audit UI

Built in: —. Tests: —.

| ID | Story | Priority | Status | Notes |
|---|---|---|---|---|
| AU-01 | Audit log in Settings | Should | Not done | Should. |

## OB: Onboarding and help

Built in: —. Tests: —.

| ID | Story | Priority | Status | Notes |
|---|---|---|---|---|
| OB-01 | First-run setup checklist | Should | Not done | Should. |
| OB-02 | Glossary and contextual help | Should | Done | Should, done: glossary drawer in Help. |

## IN: Intake

Built in: —. Tests: —.

| ID | Story | Priority | Status | Notes |
|---|---|---|---|---|
| IN-01 | Request PMO help (tribe lead) | Should | Not done | Should. |
| IN-02 | Intake queue with SLA | Should | Not done | Should. |
