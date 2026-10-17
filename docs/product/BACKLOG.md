# PMO Capacity Planner: Release 2.0 "Corporate" Backlog

| | |
|---|---|
| Owner | Business Analyst, PMO Capacity Planner |
| Date | 16 October 2026 (QBR1 = Q4 2026 … QBR4 = Q3 2027) |
| Baseline | v1.1.0 on `claude/resource-allocation-pmo-visibility-oi2g5f` @ `466e1e0` |
| Inputs | `docs/product/PRODUCT_BRIEF.md` (PO brief, EP-01…EP-27), `docs/review/ENGINEERING_REVIEW.md` (58 findings, target access model §3) |
| Companion | `docs/product/DESIGN_SYSTEM.md`: the single source of truth for every visual decision referenced here |
| Audience | AI dev agents (packages A, B, C, I), QA, PO, PMO lead (customer) |
| Status | Ready for build. Decisions recorded in §1.3 are the customer-adopted defaults. |

**How to read this document.** Story IDs (e.g. `AC-05`) never reuse review finding IDs (e.g. `SEC-02`). Findings are cited in each story's header. Acceptance criteria (ACs) are numbered `AC1, AC2…` inside each story and are what QA executes; the final acceptance checklist in §6 references them as `STORY#ACn` (e.g. `AC-05#AC3`). "Package" names the work package in §4 that owns the code.

---

## 1. Summary

### 1.1 Release goal

Turn v1.1 into a **corporate-grade capacity tracker** that the PMO lead can run the QBR from and show to IT security without embarrassment:

1. One **"Corporate Blue" design system** and one information architecture, where every view is a bookmarkable URL.
2. **All Critical and High review findings closed**, with server-side tenant isolation and the review's target role model.
3. **Org structure and crafts as real data** (tribes, chapters, teams, editable craft catalogue), **quarter-first allocation editing**, demand with status, and a Marketplace with tentative → confirmed bookings.
4. **Scheduled Jira sync** with story points per tribe/quarter/sprint mapped to capacity, and a **Planview preview-and-apply** import.
5. An architecture that makes the **Release 3.0 Jira Marketplace (Forge) port a change of transport, not a rewrite**.

### 1.2 Scope

**In scope (Release 2.0):** the 13 Must epics in §2 (PO EP-01…EP-12 plus a platform/access-control epic carved out of EP-03/EP-04), every Critical and High review finding, every Medium/Low finding rated effort S plus the Medium ones the Must epics already touch, and the Should epics as stretch goals.

**Out of scope (Release 2.0):**
- Building the Forge app, the Marketplace listing, Forge storage or `@forge/bridge` (Release 3.0, §7). Release 2.0 only builds the enablers listed in §1.5.
- Mobile editing (EP-25 Won't). Read-only responsive at ≥ 768 px only.
- Slack/Teams notifications, Confluence macro (EP-27 Won't).
- Dark theme as a user-facing option (EP-19 Could). Tokens for it are defined now; the toggle stays hidden.
- Unifying the QBR sprint module with the core model (EP-21 Could). The module is hidden behind a feature flag but its endpoint is still secured (HS-04).
- Changing the password hash, rotating `JWT_SECRET`, or changing the login identifier.

### 1.3 Assumptions and decisions

Customer decisions (the PO's recommendations, adopted as defaults):

| # | Decision | Consequence in this backlog |
|---|---|---|
| D-1 | Product name is **"PMO Capacity Planner"** everywhere. "Orbit Space", "Orbit", "Tom's team capacity tool" and "PMO Planner v1.1.0" are retired. | SH-10 sweeps UI, emails, PDF, `index.html` title, favicon, `package.json` name, AI prompt and temp strings. Wordmark spec in DESIGN_SYSTEM §9. |
| D-2 | Utilisation bands: **On target 90–105 %, Under target 50–89 %, Available (bench) < 50 %, Over capacity > 105 %**, configurable per org. | `shared/utilisation.ts` `bandFor()` replaces `types.ts getAllocationStatus` (RP-03). Bands compare load against the person's `targetUtil` (see A-4). |
| D-3 | Roles follow the review's target model (§3), mapped to the PO's five roles and personas. Squad members may edit their own below-the-table crafts, subject to approval. | Table below. AC-01, AC-02, PPL-06. |
| D-4 | **Planview stays an optional connector** that an admin enables explicitly. | Planview UI hidden until configured; PV-01…PV-03. Release 3.0 declares egress only when enabled. |
| D-5 | **Legacy QBR sprint module hidden behind a feature flag** (`qbrSprintModule`, default off). | SH-05; HS-04 still secures `qbr.ts`. |
| D-6 | **AI assistant off by default**, admin opt-in with a data-egress notice. | HS-11, ST-05. Floating AI button retired. |

Role mapping (D-3):

| PO role (UI label) | Review role (stored value) | Scope | Personas | Notes |
|---|---|---|---|---|
| Org Admin | `ORG_ADMIN` | org (`org_memberships.role`) | Org admin (IT / tool owner) | Implies PMO Admin on every workspace of the org. |
| PMO Admin | `WORKSPACE_ADMIN` | workspace | PMO lead | Members, integrations config and secrets, structure, all data. |
| Planner | `PLANNER` | workspace | PMO analyst, **chapter lead** | Edits people, projects, demand, allocations; runs syncs, imports, calibration. A chapter lead is a Planner who is set as `chapters.lead_person_id`; craft-change approvals for that chapter are routed to them first. |
| Squad member | `CONTRIBUTOR` | workspace | PMO squad member | Reads everything; submits changes to their own below-the-table crafts (approval required); accepts/declines bookings proposed to them; offers themselves to the Marketplace. |
| Viewer | `VIEWER` | workspace | Tribe lead / sponsor, stakeholders | Read-only, Marketplace catalogue, exports, AI (if enabled). |
| (platform staff) | `users.is_platform_admin = true` | platform | Product operator | Replaces `SUPERUSER`. Granted only by an ops script (AC-07). |

Org-level `MEMBER` is everyone in the org who is not `ORG_ADMIN`; it carries no workspace rights by itself (subject to the org's `default_workspace_visibility`, AC-09).

BA assumptions (flagged for PO confirmation, build proceeds on them):

| # | Assumption | Rationale |
|---|---|---|
| A-1 | Quarters stay calendar quarters, keyed `YYYY-Qn`. The fiscal-year setting accepts only start months **1, 4, 7 or 10**, and changes **labels only** (e.g. "FY27 Q1"); keys and QBR1 = current quarter are unchanged. | Stored demand is keyed by calendar quarter; non-aligned fiscal years would require re-keying data. |
| A-2 | One above-the-table craft per person; dual roles are an L3 below-the-table craft with a high cap. | PO A-2. |
| A-3 | Existing text ids (`r1`, `a-<uuid>`, …) are kept unchanged. All **new** rows get UUIDv4 ids. Changing primary keys to composite tenant keys is deferred (PL-15, Should). | A primary-key rewrite on the live DB is not additive. Sample-data installs remap ids to UUIDs so tenants never collide (PL-04). |
| A-4 | Bands are computed on **load as a percentage of the person's target** (`round(100 × load / (targetUtil ?? 100))`). For the default target of 100 this equals load %. Squad and group figures use Σload ÷ Σtarget. | A part-time person with a 60 % target at 60 % load is on target. |
| A-5 | Plan limits are unified at the more generous of today's client and server values: BASIC 5 people / 5 projects; PRO 20 people / 10 projects; MAX and ENTERPRISE unlimited. Limits only block **creating** beyond the limit, never reading or editing existing data. `APP_MODE=internal` resolves every org to ENTERPRISE and hides billing. | Today the client and server disagree (UAM-03); no existing tenant may be locked out. |
| A-6 | In `APP_MODE=internal`, public self-registration is **disabled** (`ALLOW_PUBLIC_SIGNUP=false` by default); new users join by invitation. In public mode registration stays open but requires email verification. | Corporate deployment; SEC-08. Existing users are unaffected. |
| A-7 | Org `primary_color` theming is **ignored** in 2.0 (column kept). Org logo stays (HTTPS URL only). `theme_extract` (logo scraping) is removed. | A custom primary colour can break AA contrast; scraping is an SSRF (SEC-15). |
| A-8 | The legacy full-workspace save `POST /api/workspace` returns **410 Gone** in 2.0. | Old cached bundles must not delete-and-reinsert rows and wipe the new columns (ARC-01/02). |
| A-9 | The What-If page is **removed** in 2.0 unless the Should epic SC (server-side scenarios) lands; the `pcp_scenario_*` localStorage keys are purged on load. | Hard constraint: no critical state only in `localStorage`; PO EP-14 note. |
| A-10 | Jira auth stays an API token (stored encrypted) in 2.0; OAuth 3LO is Should (JI-09). | PO EP-18 Should. |
| A-11 | Netlify Scheduled Functions run only on published (production) deploys; deploy previews use manual "Sync now". | Netlify platform behaviour. |
| A-12 | The 2.0 cut-over takes a **short maintenance window** (target ≤ 15 min): deploy, migrate, verify. During it the API answers 503 `migration_pending`. | Lets migrations be additive without dual-running two app versions against a half-migrated schema (PL-14). |

### 1.4 Hard constraints (apply to every story)

1. **Logins unchanged.** Existing users keep signing in with the same email and password (and 2FA). No `JWT_SECRET` rotation. No change to `users.password_hash` or `users.email`. The `users` table only gains columns.
2. **Sessions.** Existing 7-day bearer tokens stay valid until they expire: a token without a `tv` claim is treated as `tv = 0`. The 2.0 client exchanges a stored legacy token for the new cookie session once (AC-03). If anything forces a re-login, no data is lost.
3. **Netlify + Neon.** Every function call finishes within **8 s** (Netlify kills at 10 s). Long work is chunked (JI-01). Schema changes are **additive and idempotent** SQL files applied by the migration runner (PL-02) with a dry-run first. No `DROP` of a column or table that v1.1 code reads, in this release. Legacy columns that v1.1 reads are **dual-written** so a rollback to v1.1 code still works.
4. **Marketplace-ready, not Marketplace-built.** See §1.5.
5. **Design system.** Every UI story uses only `components/ui` and tokens from `styles/tokens.css`: no emoji, no hard-coded hex in components, no `window.alert`/`confirm`/`prompt`, no inline style objects for theme colours (DS-07 lints this).

### 1.5 Release 3.0 enablers built in 2.0

| Enabler | Story |
|---|---|
| Transport-agnostic API client (`services/api/transport.ts`: `HttpTransport`, `DemoTransport`; `ForgeBridgeTransport` later) with typed DTOs shared with the server (`shared/contracts`). | PL-05 |
| Pure domain core (`utils/craftEngine.ts`, `utils/quarters.ts`, `shared/*`, `netlify/functions/_lib/jira/aggregate.ts`): no DOM, Node or Netlify imports. | PL-06, JI-08 |
| No business state in `localStorage` (only UI preferences). | PL-06, A-9 |
| Tenant-scoped rows and an `external_identities` table (person ↔ Atlassian `accountId` / email / Planview id). | ORG-01, JI-03 |
| Routable views and an **embedded shell mode**. | SH-01, SH-02 |
| Design tokens mappable to Atlassian `--ds-*` tokens; self-hosted font; 14 px body. | DS-01, DESIGN_SYSTEM §2.6 |
| Entitlements abstraction instead of `PLAN_LIMITS` checks in the UI. | PL-07 |
| No request over ~8 s; chunked sync jobs. | JI-01 |
| Portable SQL (no Neon-only features in core queries). | PL-02, PL-04 |
| `requireUser` as an adapter boundary (`OrbitJwtAuth` now; `ForgeContextAuth` later). | AC-02 |

### 1.6 Customer actions (outside the codebase)

| ID | Action | When | Linked |
|---|---|---|---|
| CA-1 | **Rotate the Neon `neondb_owner` password** (it is in git history) and update `NETLIFY_DATABASE_URL`, `NETLIFY_DATABASE_URL_UNPOOLED` and `NEON_DATABASE_URL` in Netlify. User logins are unaffected. | Now | SEC-05, HS-03 |
| CA-2 | Confirm whether the Render service `pmo-capacity-planner-api.onrender.com` and any Vercel project are live; **delete them**. | Now | SEC-14, PL-09 |
| CA-3 | Set Netlify environment variables (production and branch contexts): keep `JWT_SECRET` **unchanged**; add `INTEGRATIONS_ENC_KEY` (`openssl rand -base64 32`); `ALLOWED_ORIGINS` (e.g. `https://pmocapacityplanner.netlify.app`); `APP_MODE` and `VITE_APP_MODE` (`internal` for the corporate deployment); `ALLOW_PUBLIC_SIGNUP` (default `false` in internal mode); `OPENAI_API_KEY` only if the AI opt-in will be used. Remove `VITE_OPENAI_API_KEY`, `GEMINI_API_KEY`, `API_KEY`, `VITE_GEMINI_API_KEY`, `SUPER_ADMIN_EMAIL`, `INTERNAL_API_SECRET` after 2.0 is live. Full inventory: `.env.example` (PL-01). | Before 2.0 deploy | PL-01, HS-09, SEC-29 |
| CA-4 | **Configure `RESEND_API_KEY` and `FROM_EMAIL`** and verify the sending domain in Resend. Without it, invitations show a copyable link and OTP emails cannot be sent. | Before 2.0 deploy | AC-05, HS-05, DM-03 |
| CA-5 | **Enable branch deploys / deploy previews** in Netlify, and add `NETLIFY_AUTH_TOKEN` and `NETLIFY_SITE_ID` as GitHub repository secrets for `preview-netlify.yml`. Create a **Neon branch `preview`** and scope the database variables for the Deploy Preview and Branch deploy contexts to it, so previews never touch production data. | Before build starts | PL-08, PL-14 |
| CA-6 | Run `node scripts/check_jwt_fallback.mjs` with the production `JWT_SECRET` loaded locally and report "match" or "no match" (the script never prints the secret). | Before 2.0 deploy | SEC-28, HS-16 |
| CA-7 | Check production for the account `testuser@test.com` and delete it if present. | Now | SEC-26 |
| CA-8 | Name the account(s) that should be **platform admin** (replaces `SUPER_ADMIN_EMAIL` auto-promotion). The migration backfills current `SUPERUSER` rows; anything else is granted with `scripts/grant_platform_admin.mjs`. | Before 2.0 deploy | SEC-08, AC-07 |
| CA-9 | Review the SEC-01 exposure: run the BA-supplied query in PL-14 against `audit_logs` (logins to admin accounts from unknown IPs since the reset endpoint shipped) and decide whether to force password resets for affected admins. | Now | SEC-01 |
| CA-10 | Stripe (public mode only): add webhook events `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed` to the endpoint, and confirm `STRIPE_WEBHOOK_SECRET` is set. | Before 2.0 deploy | SEC-09, HS-06 |
| CA-11 | Provide a Jira Cloud test site with real boards (D-1), the Planview product name, a sandbox and field names (D-2), and named UAT users per persona (D-3). | Sprint 1 | JI-*, PV-*, §6 |
| CA-12 | Agree a **maintenance window**, take a Neon backup branch immediately before it, and approve the migration dry-run report. | Go-live | PL-14 |
| CA-13 | (Optional) Add an uptime check on `GET /api/health`. | Go-live | PL-13 |

---

## 2. Epics

Priority is the epic's headline priority; individual stories may be Should/Could. "PO epic" refers to `PRODUCT_BRIEF.md` §4; "Review IDs" to `ENGINEERING_REVIEW.md` §2.

| ID | Prefix | Epic | Goal | Priority | PO epic | Review IDs |
|---|---|---|---|---|---|---|
| E01 | DS | Corporate design system | Tokens, Inter, `components/ui` kit, overlays, data table, charts, icons; lint guardrails. | Must | EP-01 | A11Y-01…05, ARC-10 |
| E02 | SH | App shell, IA and routable views | Navy sidebar + top bar, ≤ 12 nav items, every view a URL with redirects, retire duplicate views, flags, lazy routes. | Must | EP-01, EP-02 | ARC-07 (flag), ARC-08, ARC-10 |
| E03 | HS | Security hardening | Close every remaining Critical/High security finding and the cheap Medium/Low ones. | Must | EP-03 | SEC-01, 04, 05, 06, 07, 09, 10, 11, 12, 15, 16, 19, 23, 24, 26, 28, 29, UAM-07 |
| E04 | AC | Access control, identity and sessions | Target role model, one authorization library, revocable cookie sessions, invitations, audit events. | Must | EP-03, EP-12 | SEC-02, 03, 08, 13, 17, 18, 21, UAM-01, 02, 04, 05, 06 |
| E05 | PL | Platform: data API, migrations, quality gates | Per-entity API with optimistic concurrency, migration runner, client transport and store, entitlements, CI, hygiene. | Must | EP-04 | ARC-01…06, 09, UAM-03, STD-01…04, OPS-01…03, SEC-14, 20, 22, 25, 27 |
| E06 | ORG | Org structure and craft catalogue | Tribes, chapters, teams, crafts as tenant data with admin UI and idempotent migration. | Must | EP-05 | — |
| E07 | PPL | People, craft profiles and My Plan | One People page, person drawer, bulk edit, CSV, My Plan, craft-change approval, Projects page. | Must | EP-06 | — |
| E08 | AL | Allocation grid | Quarter-first editable grid with keyboard, copy-forward, undo, provenance, tentative/confirmed. | Must | EP-07 | — |
| E09 | DM | Demand and Marketplace v2 | Demand lines with status/owner, propose → tentative → accept, viewer catalogue, under-target offers. | Must | EP-08 | — |
| E10 | JI | Jira sync v2 | Scheduled, chunked sync to snapshots; project and people mapping; per-tribe calibration; sprint view; delivery signal. | Must | EP-09 | (SEC-11/12 via HS) |
| E11 | PV | Planview sync v2 | Preview diff before apply, field-map editor, persisted mappings, idempotent re-import. | Must | EP-10 | — |
| E12 | RP | Home, Capacity Outlook and reporting | Target-band semantics, Home, four-quarter Outlook, same-number guarantee, CSV and QBR pack. | Must | EP-11, EP-02 | — |
| E13 | ST | Settings, admin and first run | Real Settings (org, workspace, members, planning, integrations, features, billing), restyled auth pages, demo mode. | Must | EP-12 | SEC-01 (client), SEC-21 (UI) |
| E14 | SC | Server-side scenarios | Named scenarios stored server-side, compare vs live, apply/discard from the top bar. | Should | EP-14 | — |
| E15 | NT | Notifications | In-app inbox and email for proposals, approvals, over-capacity, sync failure; digest. | Should | EP-15 | — |
| E16 | AU | Audit trail UI | Filterable, exportable audit log in Settings. | Should | EP-16 | UAM-05 (viewer) |
| E17 | OB | Onboarding and help | First-run wizard and glossary. | Should | EP-17 | — |
| E18 | IN | Demand intake and tribe requests | Request form and approval flow. | Should | EP-13 | — |
| E19 | XT | Extensions | Jira OAuth, dark theme, drag-and-drop, actuals, QBR unification, SSO. | Should/Could | EP-18…EP-23 | ARC-07 |

Done on the branch before this backlog (not re-planned): **HS-01** (SEC-01 reset-code leak), **HS-02** (SEC-06 `debug_db` removed), **HS-03** (SEC-05 credentials removed from scripts; rotation is CA-1).

---

## 3. Stories

Story format: **Story**, **Priority / Size / Package / Depends on / Findings**, **Acceptance criteria** (numbered, Given/When/Then), **Technical notes**. Sizes: S ≤ 1 dev-day equivalent for an agent, M 2–4, L 5+. "Package" refers to §4: **A** backend, **B** UI, **C** domain and data layer, **I** integration. A story owned by two packages is split into sub-tasks `/A`, `/B`, `/C` with the contract in §4.3.

Common UI copy used in many ACs (exact strings; DESIGN_SYSTEM §8 defines the components):
- Conflict dialog title **"This record changed"**, body **"{name} changed it at {time}. Reload to see the latest version, or keep your edits and try again."**, buttons **"Reload"** (primary) and **"Keep editing"**.
- Permission-denied control state: disabled control with tooltip **"You need the {Role} role to do this."**
- Plan-limit message: **"Your {Plan} plan allows up to {n} {things}. Ask your Org Admin to upgrade."** (public mode) or not shown at all (internal mode, unlimited).
- Generic error toast: **"Something went wrong. Try again, or quote reference {requestId}."**

### E01 · Corporate design system (DS)

#### DS-01 · Design tokens, base styles and self-hosted Inter
**Story:** As a PMO lead, I want the whole product to use one corporate-blue palette, type scale and spacing, so that it looks like a single, trustworthy enterprise tool.
**Priority:** Must · **Size:** M · **Package:** B · **Depends on:** WP-0 · **Findings:** A11Y-05, SEC-19 (fonts)

**Acceptance criteria**
1. Given the built app, when I search `dist/` and `index.html` for `fonts.googleapis.com` or `fonts.gstatic.com`, then there are no matches, and Inter is served from the app's own origin (`@fontsource-variable/inter`).
2. Given `styles/tokens.css`, when I compare it with DESIGN_SYSTEM §2–§6, then every token listed there exists with the same name and value, for `:root` and for `:root[data-theme="dark"]`.
3. Given any page, when I inspect `body`, then font-family resolves to Inter, size 14 px, line-height 20 px, colour `--color-text`, background `--color-bg`, and numeric cells and KPI values use `font-variant-numeric: tabular-nums`.
4. Given the old `index.css`, when the story is done, then it contains no token definitions and only imports `styles/tokens.css`, `styles/base.css` and `styles/utilities.css` (or is deleted and `index.tsx` imports those directly); the classes `.orb`, `.glass-panel`, `.orbit-hero-title` and every gradient are gone.
5. Given `prefers-reduced-motion: reduce`, when any transition runs, then its duration is 0 ms (DESIGN_SYSTEM §7).

**Technical notes:** Create `styles/tokens.css`, `styles/base.css`, `styles/utilities.css`. Remove the `@import url('https://fonts.googleapis.com…')` from `index.css:5` and the `<link>` in `index.html:14-15`. Import `@fontsource-variable/inter` in `index.tsx`. Keep legacy variable names (`--brand-500`, `--n-600`, …) as aliases to new tokens **only until** SH-04 removes the last consumer, then delete them (I verifies). `data-theme` attribute on `<html>` is set to `light` in 2.0.

#### DS-02 · Core UI primitives library
**Story:** As a developer, I want one accessible primitives kit in `components/ui`, so that every page is built from the same crisp parts with no inline styling.
**Priority:** Must · **Size:** L · **Package:** B · **Depends on:** DS-01 · **Findings:** A11Y-03, A11Y-04, A11Y-05

**Acceptance criteria**
1. Given `components/ui/index.ts`, when I import from it, then these components exist with the props and states in DESIGN_SYSTEM §8: `Button`, `IconButton`, `ButtonGroup`, `TextField`, `NumberField` (unit suffix `%`/`FTE`), `Select`, `Combobox`, `DateField`, `QuarterPicker`, `Checkbox`, `Switch`, `RadioGroup`, `FormField` (label, help, error), `Tabs`, `SegmentedControl`, `Badge`, `StatusPill`, `BandPill`, `CraftChip`, `ProvenanceTag`, `Avatar`, `Tooltip`, `Card`, `KpiTile`, `PageHeader`, `Breadcrumbs`, `EmptyState`, `Skeleton`, `Spinner`, `Banner`, `Menu` (dropdown/overflow), `QuarterLoadBar`, `HeatStrip`, `Kbd`.
2. Given a `TextField`, `NumberField`, `Select` or `DateField` rendered through `FormField label="Target"`, when I inspect the DOM, then the `<label for>` matches the control `id`, and an error renders as text with `aria-describedby` linking it.
3. Given any interactive primitive, when I tab to it, then a 2 px `--color-focus` ring with 2 px offset is visible (`:focus-visible`), and it is operable with Enter/Space (and arrow keys for Tabs, SegmentedControl, RadioGroup, Menu).
4. Given `BandPill band="over"`, when rendered, then it shows the text "Over capacity" plus the `TriangleAlert` icon with danger colours; `on-target` shows "On target" + `CircleCheck`; `under` shows "Under target" + `CircleArrowDown`; `bench` shows "Available" + `Circle` (colour is never the only signal).
5. Given `CraftChip craftId="project-mgmt" via="primary"`, when rendered, then it is a neutral filled chip "PM"; with `via="secondary" proficiency={2}`, then it is an outlined chip "PM·L2"; craft chips never use status or series colours.
6. Given a `Button` with `loading`, when clicked again, then no second `onClick` fires and the label is kept with a spinner (`aria-busy="true"`).
7. Given the primitives' source, when DS-07 lint runs, then there are zero violations (no hex literal, no inline colour style, no emoji).

**Technical notes:** One folder per component under `components/ui/` with a co-located `*.css` using tokens only (or CSS modules; pick one and use it everywhere: **plain CSS files with BEM-style `pcp-` class prefixes** is the default). Icons from `lucide-react` per DESIGN_SYSTEM §10. `Combobox` is used for people/projects pickers (type-ahead, `role="combobox"`, `aria-expanded`, listbox). `QuarterPicker` lists the 4 rolling quarters plus "Window" (from `useQuarters()`, §4.3).

#### DS-03 · Overlays: dialog, confirm, drawer, toast; no native alert/confirm
**Story:** As any user, I want confirmations, errors and details to appear in consistent in-app overlays, so that I never get a raw browser pop-up or lose my place.
**Priority:** Must · **Size:** M · **Package:** B · **Depends on:** DS-02 · **Findings:** A11Y-02, ARC-10

**Acceptance criteria**
1. Given the repository after this story and SH-04, when I grep `App.tsx`, `components/`, `pages/` for `alert(`, `confirm(`, `prompt(` (including `window.`), then there are zero matches.
2. Given an open `Dialog`, when I press Tab repeatedly, then focus stays inside the dialog; when I press Escape or click the scrim (non-destructive dialogs only), then it closes and focus returns to the element that opened it; the dialog has `role="dialog"`, `aria-modal="true"` and `aria-labelledby` pointing at its title.
3. Given a destructive action (delete a person), when I trigger it, then a `ConfirmDialog` titled "Delete {name}?" appears with body text naming the consequence ("Their 3 bookings will also be deleted."), a danger button "Delete" and a secondary "Cancel"; nothing is deleted until I confirm.
4. Given a successful destructive or bulk action, when it completes, then a toast "{n} item(s) deleted" with an **Undo** action appears for 8 s (DS spec), and Undo restores the data via `useUndo()` (§4.3).
5. Given a `Drawer` (480 px or 720 px), when it opens, then it slides from the right in 200 ms, has a header with title and close button (`aria-label="Close"`), traps focus like a dialog, and the URL reflects it (e.g. `?person=<id>`), so Back closes it.
6. Given an API error with `requestId`, when it is shown, then the toast reads "Something went wrong. Try again, or quote reference {requestId}." and never shows raw server text.

**Technical notes:** `components/ui/Dialog`, `ConfirmDialog` + `useConfirm(): (opts) => Promise<boolean>`, `Drawer`, `ToastProvider` + `useToast()`. Mount providers in `App.tsx`. Replace each of the 26 `alert(` and 11 `confirm(` call sites (list: `grep -rn "alert(\|confirm(" App.tsx components`) as the owning page is restyled; I verifies zero remain.

#### DS-04 · Data table
**Story:** As a PMO analyst, I want dense, sortable tables with sticky headers that never overflow the page, so that I can scan 200 people across four quarters.
**Priority:** Must · **Size:** L · **Package:** B · **Depends on:** DS-02

**Acceptance criteria**
1. Given a `DataTable` with more columns than fit, when I scroll horizontally, then only the table card scrolls (the page has no horizontal scrollbar), the header row stays visible on vertical scroll, and the first column stays visible on horizontal scroll.
2. Given a sortable column header, when I click it or press Enter on it, then rows sort ascending, then descending, then unsorted, and the header exposes `aria-sort="ascending|descending|none"`.
3. Given the density control, when I switch between "Compact" (32 px rows) and "Comfortable" (40 px rows), then row height changes and the choice is remembered per table per browser (`localStorage`, UI preference only).
4. Given row selection is enabled, when I select rows, then a bulk-action bar appears above the table reading "{n} selected" with the page's bulk actions and "Clear".
5. Given more than 200 rows, when the table renders, then rows are virtualised (DOM row count ≤ visible rows + 20 overscan) and scrolling stays smooth.
6. Given `status="loading"`, `"error"` or an empty data set, when rendered, then the table shows skeleton rows, an inline error with "Retry", or the page-provided `EmptyState` respectively.
7. Given "Export CSV" in the page's overflow menu, when I click it, then a CSV of the **current view** (visible columns, current sort and filters) downloads as `{page}-{yyyy-mm-dd}.csv`.
8. Given a screen reader, when it reads the table, then it is a semantic `<table>` with `<th scope="col">` headers and a `<caption>` (visually hidden if needed).

**Technical notes:** `components/ui/DataTable` with column defs `{ id, header, cell, sortValue?, align?: 'left'|'right', width?, sticky?: boolean, hideable?: boolean }`. Use `@tanstack/react-virtual` for virtualisation. CSV via `utils/csv.ts` `toCsv()` (C, §4.3).

#### DS-05 · Chart kit
**Story:** As a PMO lead, I want capacity charts that use the corporate series colours and always offer a table view, so that I can present them and anyone can read them.
**Priority:** Must · **Size:** M · **Package:** B · **Depends on:** DS-01

**Acceptance criteria**
1. Given `StackedCapacityChart` with four quarters, when rendered, then segments use series tokens in fixed order (above-the-table `--chart-1`, below-the-table `--chart-2`, undeclared `--chart-3`, bench hatch `--chart-bench`), demand is a `--chart-4` marker, the target line is dashed `--chart-target`, and stacked segments are separated by a 2 px surface gap.
2. Given any chart, when I toggle "Table view" (SegmentedControl "Chart | Table"), then a `DataTable` with the same numbers replaces the chart.
3. Given a chart with ≥ 2 series, when rendered, then a legend is present, and hovering (or focusing) a mark shows a tooltip with the series name, value and time basis.
4. Given the chart source, when I check colours, then they come only from CSS variables `--chart-*` read via `getComputedStyle`, never hex literals.

**Technical notes:** `components/ui/charts/`: `StackedCapacityChart`, `HeatStrip` (person × quarter), `TrendLine` (planned vs Jira-implied), `ChartFrame` (title, time-basis caption, Chart/Table toggle). Recharts stays. Rules in DESIGN_SYSTEM §11.

#### DS-06 · Icon system and emoji purge
**Story:** As a PMO lead, I want proper icons instead of emoji, so that the tool renders the same on every OS and looks corporate.
**Priority:** Must · **Size:** M · **Package:** B · **Depends on:** DS-02 · **Findings:** A11Y-01

**Acceptance criteria**
1. Given `App.tsx`, `components/**`, `pages/**`, `index.html`, when the emoji check (`npm run check:guardrails`) runs, then it reports 0 emoji characters (Unicode Extended_Pictographic, excluding none).
2. Given every navigation item and common action, when rendered, then it uses the `lucide-react` icon named in DESIGN_SYSTEM §10, 16 px in nav and tables, 20 px in page headers, stroke 1.75, `aria-hidden="true"` when a text label is present, and `aria-label` when icon-only.
3. Given the browser tab, when the app loads, then the favicon is the PMO Capacity Planner mark (SVG in `public/favicon.svg`, per DESIGN_SYSTEM §9), not a planet emoji.

**Technical notes:** Replace `NAV_ITEMS` emoji in `App.tsx:66-81`, theme toggle `App.tsx:972`, favicon `index.html:6-7`, and every emoji in the 29 component files (most are deleted or rewritten by SH-04 and page stories).

#### DS-07 · Design guardrails in lint
**Story:** As the tech lead, I want lint to fail on hex colours, emoji, native dialogs and inline theme styles in UI code, so that the design system stays the single source of truth.
**Priority:** Must · **Size:** S · **Package:** B (rules), WP-0 (config scaffold) · **Depends on:** WP-0 · **Findings:** A11Y-05, STD-03

**Acceptance criteria**
1. Given a component under `components/` or `pages/` containing a string literal matching `/#[0-9a-fA-F]{3,8}\b/`, when `npm run lint` runs, then it fails with "Use a design token (var(--…)) instead of a hex colour."; files under `styles/` and `utils/pdfExport.ts` are exempt.
2. Given a JSX `style={{ color: … }}` (or `background`, `backgroundColor`, `borderColor`, `fill`, `stroke`) in `components/` or `pages/`, when lint runs, then it fails with "Theme colours belong in CSS classes, not inline styles."; inline `width`, `height`, `transform`, `gridTemplateColumns` are allowed.
3. Given `alert(`, `confirm(` or `prompt(`, when lint runs, then `no-alert` fails.
4. Given an emoji in a `.tsx` file, when `npm run check:guardrails` runs, then it fails and prints file:line.
5. Given the final codebase, when CI runs `npm run lint` and `npm run check:guardrails`, then both pass.

**Technical notes:** `eslint.config.js` (created in WP-0) gains `no-restricted-syntax` selectors scoped to `components/**` and `pages/**`; `scripts/check-ui-guardrails.mjs` (B) scans for emoji and hex. Add `jsx-a11y/recommended`.

#### DS-08 · Accessibility baseline
**Story:** As a keyboard or screen-reader user, I want every page to be operable and readable, so that the tool passes WCAG 2.1 AA and corporate accessibility review.
**Priority:** Must · **Size:** M · **Package:** B (fixes), I (axe tests) · **Depends on:** DS-02…DS-05 · **Findings:** A11Y-03, A11Y-04

**Acceptance criteria**
1. Given each route in §4.3 route map, when the Playwright axe scan runs (`@axe-core/playwright`, tags `wcag2a`, `wcag2aa`), then there are 0 serious or critical violations.
2. Given any element with an `onClick`, when I inspect it, then it is a `<button>`, `<a>` or has `role` + `tabIndex=0` + key handler; `jsx-a11y/click-events-have-key-events` and `no-static-element-interactions` pass.
3. Given any text on any surface, when measured, then contrast is ≥ 4.5:1 (≥ 3:1 for ≥ 18.66 px bold/24 px); no `#94a3b8`-style light grey text remains.
4. Given a page load, when I press Tab first, then a "Skip to content" link appears and moves focus to `<main id="main">`.
5. Given Lighthouse accessibility on Home, Allocations, People and Settings › Members, when run at 1440×900, then each scores ≥ 95.

**Technical notes:** Rules in DESIGN_SYSTEM §12. Landmarks: `<nav aria-label="Primary">`, `<header>`, `<main>`.

---

### E02 · App shell, information architecture and routable views (SH)

#### SH-01 · Route map, deep links and redirects
**Story:** As a PMO lead, I want every view to have its own URL, so that I can bookmark, share and later embed any screen.
**Priority:** Must · **Size:** M · **Package:** B (router), C (route params → store) · **Depends on:** WP-0

**Acceptance criteria**
1. Given the route map in §4.3, when I open each URL directly in a new tab while signed in, then that view renders (no redirect to Home), and the document title is "{Page title} · PMO Capacity Planner".
2. Given an old URL `/o/:org`, when I open it, then I am redirected (replace) to `/o/:org/w/:ws/home` for my default workspace (last used, else first). `/o/:org/settings` redirects to `/o/:org/w/:ws/settings/organisation`, `/o/:org/directory` to `/o/:org/w/:ws/org/people`.
3. Given a URL for a workspace I am not a member of (and without org-wide visibility), when I open it, then I see the "You don't have access to this workspace" page (SH-07) with a link to my default workspace; the API returned 403.
4. Given I switch workspace in the top bar, when the switch completes, then the URL changes to the same area/view in the new workspace (`/o/:org/w/:newWs/<same path>`), and data for the new workspace loads.
5. Given I am signed out and open a deep link, when I sign in, then I land on that deep link (`/login?next=` preserved, only same-origin relative paths accepted).
6. Given the settings route, when it renders, then the title is "Settings", never "Dashboard".
7. Given `VITE_ROUTER=hash`, when I build, then the same routes work under `#/` (preview workflow).

**Technical notes:** `App.tsx` becomes a router (`createBrowserRouter`/`<Routes>`) with lazy route modules under `pages/**` (SH-08). Remove `activeTab` state. Route params are read by C's `useWorkspace()` (§4.3) to select the workspace. `:ws` is the workspace UUID.

#### SH-02 · App shell: navy sidebar, top bar, embedded mode
**Story:** As any user, I want a quiet, consistent frame with a short grouped navigation, so that I always know where I am and the data gets the attention.
**Priority:** Must · **Size:** L · **Package:** B · **Depends on:** DS-02, SH-01

**Acceptance criteria**
1. Given a signed-in Planner, when the shell renders at 1440×900, then the sidebar is navy (`--color-nav-bg`), 248 px wide, and lists exactly: Home; **Plan**: Capacity Outlook, Demand, Allocations, Marketplace; **Organisation**: People, Projects, Tribes; **Delivery**: Jira & Planview; **Reports**: Reports; bottom: Settings. That is 11 items; Squad members also get "My plan" (12). With default flags no role sees more than 12 items (Sprint planning adds one only when an Org Admin enables the `qbrSprintModule` flag). Icons are lucide per DESIGN_SYSTEM §10, and every item is visible without scrolling at 900 px height.
2. Given a Squad member (CONTRIBUTOR), when the shell renders, then "My plan" appears directly under Home (and Settings shows only "Profile").
3. Given the collapse button (`PanelLeftClose`, `aria-label="Collapse sidebar"`), when clicked, then the sidebar becomes a 64 px icon rail with tooltips on hover/focus, and the state persists per user per browser.
4. Given the top bar (56 px, white, bottom border), when rendered, then it contains, left to right: workspace switcher ("{Org} › {Workspace}" with a menu of my workspaces), global search field "Search people, projects, crafts" with `⌘K`/`Ctrl K` hint, a Plan context indicator "Live" (and the Scenario switcher only when SC ships), help button (`CircleQuestionMark`, menu: Glossary, Keyboard shortcuts, What's new), notifications bell (`Bell`, badge = my pending proposals + approvals count), and user menu (avatar, name, items: Profile, Sign out).
5. Given the current route, when rendered, then the matching nav item shows the active state (navy-700 background, 3 px `--color-nav-accent` indicator, `aria-current="page"`).
6. Given `?embedded=1` in the URL (or `VITE_EMBEDDED=true`), when the app renders, then the sidebar and top bar are hidden, the page header shows the area's views as underline tabs, and the flag persists for the session while navigating.
7. Given no "Log In / Sign Up" button, "Pricing" button, theme toggle, "Take a tour", "Data" group or floating AI button exists anywhere in the shell.

**Technical notes:** `components/shell/AppShell.tsx`, `Sidebar.tsx`, `TopBar.tsx`, `WorkspaceSwitcher.tsx` (rewrite of `components/WorkspaceSwitcher.tsx`), `UserMenu.tsx`, `HelpMenu.tsx`, `NotificationsBell.tsx`. Visibility of items uses `useWorkspace().can()` and `useFeature()` (§4.3), never role-name strings.

#### SH-03 · Page header and time-basis selector
**Story:** As a PMO lead, I want each page to state its title, scope and time basis with its actions in one tidy row, so that numbers are never ambiguous and actions never wrap.
**Priority:** Must · **Size:** S · **Package:** B · **Depends on:** DS-02

**Acceptance criteria**
1. Given any page, when rendered at 1280 px, then the header shows breadcrumbs ("{Area} / {Page}"), H1 title, a one-line description that truncates with an ellipsis (full text in a tooltip), and a right-aligned action group with at most one primary button, then secondary buttons, then an overflow menu (`Ellipsis`, `aria-label="More actions"`) holding Export/Import.
2. Given a page with metrics (Home, Capacity Outlook, People, Allocations, Tribes), when rendered, then a time-basis SegmentedControl shows "Today · QBR1 · QBR2 · QBR3 · QBR4 · Window" (quarter labels include the calendar/fiscal label in a tooltip, e.g. "QBR1 = Q4 2026"), the selection is reflected in the URL (`?basis=qbr1`), and every KPI caption repeats the basis (e.g. "QBR1 · Q4 2026").
3. Given actions that do not apply to the page, when rendered, then they are absent (no global "+ Resource / + Project / What-If" on every page).
4. Given a viewer without write permission, when rendered, then write actions are hidden (not shown with a lock icon).

**Technical notes:** `components/ui/PageHeader`; basis values `today | qbr1 | qbr2 | qbr3 | qbr4 | window` map to `TimeBasis` (§4.3).

#### SH-04 · Retire duplicate and legacy views
**Story:** As a PMO lead, I want duplicate and day-level views removed, so that there is one place for each job and numbers stop disagreeing.
**Priority:** Must · **Size:** M · **Package:** B · **Depends on:** pages that replace them (PPL-01, PPL-07, AL-01, ORG-05, RP-01)

**Acceptance criteria**
1. Given the app, when I navigate everywhere, then By Skills, By Team, By Individual, By Tribe and By Project (day calendars), Manage Resources/Projects, What-If page (unless SC ships), Pricing button, Tour and the floating AI button no longer exist.
2. Given the repository, when I list files, then these are deleted: `components/SkillsView.tsx`, `TeamView.tsx`, `TribeView.tsx`, `ResourceView.tsx`, `ProjectView.tsx`, `TimeForecastGrid.tsx`, `Heatmap.tsx`, `WhatIfPanel.tsx` (unless SC), `TourOverlay.tsx`, `StatCard.tsx`, `Slider.tsx`, `TimeSelector.tsx`, `MemberManagement.tsx`, `ZodValidation.ts`, `RiskScanner.tsx`, `CapacityChart.tsx`, `AllocationMatrix.tsx`, `AllocationModal.tsx`, `Dashboard.tsx`, `DirectoryProfile.tsx`, `AdminPanel.tsx`, `SuperAdminPanel.tsx` (merged into ST-09), and `components/crafts/*` once their content lives in `pages/**`.
3. Given a person's skills tags, when I open the person drawer, then they appear as searchable tags (People filter "Skill"), not as a separate view.
4. Given a user with any old bookmark, when they open `/o/:org` (the only old URL), then SH-01#AC2 applies.

**Technical notes:** Keep `utils/timeGrid.ts` only if still imported (else C deletes it). Deletion of `components/**` files is B's; `utils/**` is C's.

#### SH-05 · Feature flags; QBR sprint module hidden
**Story:** As an Org Admin, I want optional modules controlled by flags, so that unfinished or legacy features stay out of my users' way.
**Priority:** Must · **Size:** S · **Package:** A (storage, `/me`), C (`useFeature`), B (nav/routes) · **Depends on:** AC-04 · **Findings:** ARC-07 (containment)

**Acceptance criteria**
1. Given a new or migrated org, when `/api/v2/me` returns, then `org.features` equals `{ qbrSprintModule: false, aiAssistant: false, scenarios: false, planviewScheduledImport: false, jiraScheduledSync: true }` unless changed in Settings › Features (ST-05).
2. Given `qbrSprintModule=false`, when I open `/o/:org/w/:ws/delivery/sprints`, then I get the 404 page and the nav has no "Sprint planning"; when it is `true`, the existing QBR planner renders inside the new shell.
3. Given a flag is off, when a client calls the related API (e.g. `POST /api/ai`), then the server returns 403 `{ code: "feature_disabled" }`.

**Technical notes:** `organizations.features JSONB` (A, ORG-01 migration); `shared/features.ts` (WP-0).

#### SH-06 · Global search (⌘K)
**Story:** As a PMO lead, I want to jump to any person, project, tribe or craft by typing, so that I don't hunt through menus.
**Priority:** Must · **Size:** S · **Package:** B (UI), C (`searchIndex`) · **Depends on:** PL-06

**Acceptance criteria**
1. Given any page, when I press ⌘K (macOS) or Ctrl K, or click the search field, then a search dialog opens with focus in the input.
2. Given I type "neb", when results appear, then "Nebula Analytics" is listed under "Projects"; results are grouped People, Projects, Tribes, Crafts (max 5 each), navigable with ↑/↓ and opened with Enter.
3. Given I choose a person, when it opens, then I land on People with the person drawer open (`/org/people?person=<id>`).

**Technical notes:** Client-side over the snapshot; `utils/search.ts` `buildSearchIndex(snapshot)` (C).

#### SH-07 · Error boundary, 404, 403 and maintenance pages
**Story:** As any user, I want a clear page when something fails or is missing, so that one error doesn't blank the app.
**Priority:** Must · **Size:** S · **Package:** B · **Depends on:** DS-02 · **Findings:** ARC-10

**Acceptance criteria**
1. Given a render error inside a page, when it throws, then only the page area shows "This page hit a problem" with "Reload page" and the request/error reference; the shell stays usable.
2. Given an unknown route, when opened, then a 404 page "Page not found" with a "Go to Home" button renders.
3. Given an API 403 on page load, when rendered, then "You don't have access to this {workspace|page}" with the role required (when known).
4. Given the API returns 503 `migration_pending`, when any page loads, then a full-page notice "PMO Capacity Planner is being updated. This usually takes a few minutes." with "Try again" renders.

**Technical notes:** `components/shell/ErrorBoundary.tsx`, `pages/system/*`.

#### SH-08 · Route-level code splitting and bundle budget
**Story:** As a user on a corporate network, I want the first page to load fast, so that the planner feels instant (and fits inside Jira later).
**Priority:** Must · **Size:** S · **Package:** B (lazy routes, `vite.config.ts`), A (CI budget step) · **Depends on:** SH-01 · **Findings:** ARC-08

**Acceptance criteria**
1. Given `npm run build`, when CI measures the JS loaded by `/o/:org/w/:ws/home` (entry chunk plus its static imports), then it is ≤ 350 KB gzip, and the step fails the build above that.
2. Given the Reports page, when I click "Download QBR pack", then `jspdf`/`html2canvas` load on demand (separate chunk), not on first load.
3. Given Settings, Delivery, Sprint planning and the platform cockpit, when built, then each is its own lazy chunk; Recharts is in its own vendor chunk.

**Technical notes:** `React.lazy` + `Suspense` with `Skeleton` fallbacks; `build.rollupOptions.output.manualChunks` for `recharts`. CI script `scripts/check-bundle-size.mjs` (A owns CI; script input is `dist/.vite/manifest.json`, enable `build.manifest: true` in `vite.config.ts`, B).

#### SH-09 · Responsive layout
**Story:** As a tribe lead on a tablet, I want to read the plan without the layout breaking, so that I can check staffing in meetings.
**Priority:** Must · **Size:** S · **Package:** B · **Depends on:** SH-02

**Acceptance criteria**
1. Given a viewport of 768–1279 px, when rendered, then the sidebar starts collapsed (64 px rail) and tables scroll inside their cards.
2. Given a viewport < 768 px (e.g. 390×844), when rendered, then the sidebar is hidden behind a menu button (`Menu`, opens an overlay drawer), the top bar shows the menu button, title and user menu only, nothing overlaps, and edit controls are hidden (read-only).
3. Given 1280 px width, when People renders, then QBR1–QBR4 are all visible without horizontal scroll (PPL-01#AC2).

**Technical notes:** Breakpoints in DESIGN_SYSTEM §13.

#### SH-10 · One product name everywhere
**Story:** As the PMO lead, I want one product name, so that the tool reads as a single corporate product.
**Priority:** Must · **Size:** S · **Package:** B (UI, `index.html`), A (emails, AI prompt, function strings), C (PDF text, constants), I (docs, `package.json` name) · **Depends on:** —

**Acceptance criteria**
1. Given the repository excluding `docs/history/` and `docs/review/`, when I grep case-insensitively for `orbit`, then there are no matches in UI text, emails, PDFs, page titles or the AI system prompt (code identifiers such as `localStorage` key `orbitTheme` are removed too).
2. Given the browser tab, emails (OTP, invitation, receipt) and the QBR pack cover, when shown, then they say "PMO Capacity Planner".
3. Given `package.json`, when read, then `name` is `pmo-capacity-planner` and `version` is `2.0.0`.

**Technical notes:** OTP/invite email templates live in `netlify/functions/_lib/email.ts` (A). Version shown in Help › What's new, from `import.meta.env.VITE_APP_VERSION` (set in `vite.config.ts` from `package.json`).

### E03 · Security hardening (HS)

All HS stories are Package **A** unless stated. Every new or changed handler goes through `withApi` (PL-01) and `requireUser`/`can()` (AC-02), and gets a test in `tests/backend/` (PL-12).

#### HS-01 · Reset code no longer returned (SEC-01) · **Done**
Fixed in `466e1e0`: `/api/auth/reset/send-otp` always returns `{ sent: true }`; `verify.ts` echoes a code only when `ALLOW_DEV_OTP=true` and `CONTEXT !== 'production'`.
**Remaining sub-tasks (Must, tracked elsewhere):** remove the "(Demo Mode) Code" branches in `components/Login.tsx:253-257, 271, 313-316` (ST-07, B); regression test "response has no `otp` key" for `/reset/send-otp` and `/verify/send` (PL-12, A); customer forensics (CA-9).

#### HS-02 · Unauthenticated debug endpoint removed (SEC-06) · **Done**
`netlify/functions/debug_db.ts` deleted in `466e1e0`. **Remaining (Must, PL-08):** CI fails if any file in `netlify/functions/` matches `debug_*` or `test_*`.

#### HS-03 · Committed DB credentials removed from scripts (SEC-05) · **Done**
Literals replaced with `NEON_DATABASE_URL` in `466e1e0`. **Remaining:** password rotation is customer action CA-1; `gitleaks` in CI (PL-08).

#### HS-04 · QBR endpoint tenant isolation
**Story:** As an Org Admin, I want the sprint-planning API to enforce workspace membership, so that no other tenant can read, change or wipe our QBR data.
**Priority:** Must · **Size:** M · **Package:** A · **Depends on:** AC-02 · **Findings:** SEC-04 (Critical)

**Acceptance criteria**
1. Given user U with no membership in workspace W (and not Org Admin of W's org), when U calls any `GET /api/qbr/*?wsId=W`, then the response is 403 `{ code: "forbidden" }` and no data is returned.
2. Given a VIEWER of W, when they call `POST /api/qbr/booking` or `DELETE /api/qbr/*`, then 403; a PLANNER gets 200/201; scenario commit (`POST /api/qbr/scenario` with commit) needs WORKSPACE_ADMIN.
3. Given a request with `orgId` in the query, when processed, then the server ignores it and derives the org from `workspaces.org_id`.
4. Given `/api/qbr/quarter/:id`, `/scenario/:id`, `/booking/:id` with an id belonging to another workspace, when called with `wsId=W`, then 404.
5. Given a booking upsert whose `memberId`, `projectId` or `sprintId` does not belong to W, when posted, then 400 `{ code: "bad_request", fields: { memberId: "Not in this workspace" } }`.
6. Given `CONTEXT=production` and a non-platform-admin, when `POST /api/qbr/seed` is called, then 403.
7. Given the scenario commit, when any statement fails, then nothing is changed (single transaction, `withTx`).

**Technical notes:** `netlify/functions/qbr.ts`: wrap in `withApi`; call `requireWorkspaceAccess(ctx, wsId, 'read'|'write'|'admin')`; add `AND workspace_id = $wsId` to id-addressed queries (join through `qbr_quarters` for sprints/bookings); add the missing `JWT_SECRET` guard by using `_lib/env`. Tests: `tests/backend/qbr.authz.test.ts`.

#### HS-05 · OTP hardening and rate limiting
**Story:** As an Org Admin, I want login, reset and verification codes protected against guessing, so that accounts cannot be brute-forced.
**Priority:** Must · **Size:** M · **Package:** A · **Depends on:** PL-01, PL-02 · **Findings:** SEC-07 (High)

**Acceptance criteria**
1. Given any OTP is generated (2FA, reset, verify), when stored, then it is created with `crypto.randomInt(0, 1_000_000)` (zero-padded to 6 digits), stored as `sha256(otp + email)` in `otps.otp_hash`, never in plaintext, and compared with `timingSafeEqual`.
2. Given 5 wrong attempts for the same OTP, when a 6th is submitted (even correct), then the response is 400 "This code has expired. Request a new one." and the OTP row is deleted.
3. Given more than 10 `POST /api/auth/login` requests for the same email, or 30 from the same IP, within 15 minutes, when the next one arrives, then the response is 429 `{ code: "rate_limited" }` with a `Retry-After` header, and the UI shows "Too many attempts. Try again in {n} minutes."
4. Given `/api/auth/reset/*`, `/api/verify/*`, `/api/auth/register` and invitation accept, when abused (5 per email / 20 per IP per 15 min), then 429 likewise.
5. Given temporary passwords, when the code is searched, then `Math.random()` is no longer used anywhere in `netlify/functions/` (temp passwords are removed by AC-05).
6. Given an existing user with 2FA enabled, when they log in after deployment, then the 2FA flow still works end-to-end.

**Technical notes:** `_lib/otp.ts` (`createOtp`, `verifyOtp`), `_lib/rateLimit.ts` `rateLimit(sql, key, max, windowSec)` over table `rate_limits(key TEXT, window_start TIMESTAMPTZ, count INT, PRIMARY KEY(key, window_start))` (migration). Column `otps.otp_hash` added; the legacy `otps.otp` column is written as `NULL` from now on (old rows expire in 15 min). IP from `x-nf-client-connection-ip`, then `x-forwarded-for`.

#### HS-06 · Stripe webhook fails closed; subscription lifecycle
**Story:** As the product operator, I want billing events verified and complete, so that nobody can forge an upgrade and cancellations take effect.
**Priority:** Must · **Size:** M · **Package:** A · **Depends on:** PL-01, PL-07 · **Findings:** SEC-09 (High)

**Acceptance criteria**
1. Given `STRIPE_WEBHOOK_SECRET` or `STRIPE_SECRET_KEY` is unset and `APP_MODE=public`, when `webhook.ts` or `checkout.ts` is invoked, then it returns 503 `{ code: "server_error" }` and logs "Stripe not configured"; no dummy secret exists in the code.
2. Given `APP_MODE=internal`, when `checkout.ts` is called, then 404.
3. Given an event signed with a wrong secret, when posted, then 400 and no DB change.
4. Given `checkout.session.completed`, when processed, then `organizations.plan`, `stripe_customer_id`, `stripe_subscription_id` are set for the org in the session metadata, and **no** `users.plan` rows are written except the legacy dual-write for the org's admins (rollback safety).
5. Given `customer.subscription.deleted` or `invoice.payment_failed` (final), when processed, then the org's plan becomes BASIC; `customer.subscription.updated` maps the price id to the plan.
6. Given the same `event.id` delivered twice, when processed, then the second is acknowledged 200 and skipped (`stripe_events(id PRIMARY KEY)`).

**Technical notes:** `webhook.ts`, `checkout.ts`; price → plan map from env `STRIPE_PRICE_PRO`, `STRIPE_PRICE_MAX`.

#### HS-07 · Remove the open email relay
**Story:** As the product operator, I want no public endpoint that sends arbitrary emails, so that our domain can't be used for phishing.
**Priority:** Must · **Size:** S · **Package:** A · **Depends on:** PL-01 · **Findings:** SEC-10 (High)

**Acceptance criteria**
1. Given `POST /api/email_receipt`, when called, then 404 (function deleted).
2. Given an org is created or a checkout completes, when the receipt/welcome email is sent, then it is sent by calling `_lib/email.ts` directly, and every interpolated value is HTML-escaped (a name `<script>` renders as `&lt;script&gt;`).
3. Given `RESEND_API_KEY` is unset, when an email would be sent, then the call is skipped with a structured log `{ event: "email.skipped" }` and the business action still succeeds.

**Technical notes:** `_lib/email.ts` exports `sendEmail({ to, subject, html, text })`, `escapeHtml`, and templates `otpEmail`, `invitationEmail`, `receiptEmail`, `proposalEmail` with the product name (SH-10).

#### HS-08 · Integration credentials cannot be exfiltrated; SSRF closed
**Story:** As a PMO Admin, I want stored Jira and Planview tokens tied to the host they were entered for, so that nobody can redirect them to a server they control.
**Priority:** Must · **Size:** S · **Package:** A · **Depends on:** AC-02 · **Findings:** SEC-11 (High), UAM-07

**Acceptance criteria**
1. Given a stored Jira token, when a request changes `jira.domain` or `jira.email` without supplying a new token in the same request, then the stored secret is cleared (`hasSecret: false`) and the response says `secretCleared: true`; same for Planview `baseUrl`, `flavour`, `username`, `generic.authHeaderName`.
2. Given `jira.domain` not matching `^[a-z0-9-]+\.(atlassian\.net|jira\.com)$`, when saved, then 400 `fields.domain = "Enter your Jira Cloud site, e.g. acme.atlassian.net"`.
3. Given a Planview `baseUrl` that is not `https:`, has a port, is an IP literal, or resolves to a private/loopback/link-local range, when saved or used, then 400 "Planview URL must be a public HTTPS address".
4. Given any outbound integration call, when the remote responds with a redirect, then it is not followed (`redirect: 'manual'`) and the call fails with "Unexpected redirect from {host}".
5. Given a PLANNER, when they call `POST /api/integrations/config`, `/jira/test`, `GET /jira/projects`, `/jira/boards` or `/planview/test`, then 403; a WORKSPACE_ADMIN gets 200. `POST /jira/usage` (and v2 sync) is allowed to PLANNER and returns only the configured `projectKeys`.
6. Given a VIEWER, when they call any `/api/integrations/*`, then 403 except `GET /config`, which returns no secrets and is allowed to PLANNER+ only.

**Technical notes:** `integrations.ts` `saveConfig`, `normaliseDomain` (`:428-433`), `fetchWithTimeout` (`:241`). DNS check via `dns.promises.lookup` + private-range test in `_lib/net.ts`.

#### HS-09 · Dedicated, versioned integration encryption key
**Story:** As the product operator, I want integration secrets encrypted with their own key, so that rotating the session secret never breaks integrations and a token-secret leak isn't a credential leak.
**Priority:** Must · **Size:** S · **Package:** A · **Depends on:** PL-01 · **Findings:** SEC-12 (High)

**Acceptance criteria**
1. Given `INTEGRATIONS_ENC_KEY` is set (32 bytes base64), when a secret is saved, then it is stored as `v2:iv:tag:ct` encrypted with that key.
2. Given a legacy 3-part secret, when read, then it decrypts with the legacy `sha256(JWT_SECRET + ':integrations')` key, and the stored Jira test still passes.
3. Given `node scripts/reencrypt_integrations.mjs --dry-run`, when run, then it reports the count of legacy secrets; without `--dry-run` it re-encrypts them to `v2:` in one transaction and is idempotent (second run: "0 to re-encrypt").
4. Given `INTEGRATIONS_ENC_KEY` is missing in production, when `integrations.ts` loads, then new secret writes fail with 503 and a log line, while reads of legacy secrets still work.

**Technical notes:** `_lib/crypto.ts` `encryptSecret`, `decryptSecret`. `JWT_SECRET` is **not** rotated.

#### HS-10 · Remove the logo-scraping endpoint
**Story:** As an Org Admin, I want no server endpoint that fetches arbitrary URLs, so that the platform can't be used to probe internal networks.
**Priority:** Must · **Size:** S · **Package:** A (delete function), B (remove call in create-org UI) · **Depends on:** — · **Findings:** SEC-15

**Acceptance criteria**
1. Given `POST /api/theme_extract`, when called, then 404 (function deleted).
2. Given the create-organisation flow (ST-08), when I create an org, then no theme extraction runs; the logo can be set later in Settings › Organisation as an `https://` URL (validated server-side; `http:` and `data:` rejected with 400).

**Technical notes:** Delete `netlify/functions/theme_extract.ts`; remove `App.tsx:1439` call.

#### HS-11 · AI assistant: off by default, opt-in, server-built prompt
**Story:** As an Org Admin, I want the AI assistant off unless I opt in, and when on, to send only what the server decides, so that workspace data doesn't leave the company by default and the endpoint isn't a free GPT proxy.
**Priority:** Must · **Size:** M · **Package:** A (endpoint), B (drawer UI), C (client call) · **Depends on:** SH-05, AC-02, PL-07 · **Findings:** SEC-16, SEC-29 (part)

**Acceptance criteria**
1. Given `features.aiAssistant=false` (default), when anyone calls `POST /api/ai`, then 403 `{ code: "feature_disabled" }`, and the UI shows no AI entry point.
2. Given the Org Admin turns it on in Settings › Features, when they toggle it, then a ConfirmDialog states "Questions and a summary of this workspace's people, projects and allocations will be sent to OpenAI for processing." and the change is recorded as an audit event `org.feature_change`.
3. Given AI is on, when a user with `ai.use` posts `{ wsId, question }` (question ≤ 2,000 chars), then the server checks workspace read access, builds the system prompt itself in `_lib/aiPrompt.ts` from DB data (respecting the caller's role), and returns `{ answer }`; any `systemPrompt` field in the body is ignored; a question > 2,000 chars returns 400.
4. Given the org's monthly quota (from entitlements) is used up, when another question is asked, then 429 `{ code: "rate_limited" }` "Your organisation has used this month's {n} AI questions."; the quota check-and-increment is a single atomic `UPDATE … WHERE count < limit RETURNING`, counted per org.
5. Given an upstream OpenAI error, when it occurs, then the client gets 502 "The AI service is unavailable. Try again later." with no upstream text.
6. Given `ai.ts`, when read, then only `OPENAI_API_KEY` is read (no `VITE_*`, `GEMINI_*`, `API_KEY` fallbacks).
7. Given AI is on, when a user opens Help › "Ask the assistant", then a right-hand drawer (480 px) opens with the egress notice on first use; there is no floating button.

**Technical notes:** Move `buildSystemPrompt` from `services/geminiService.ts` to `netlify/functions/_lib/aiPrompt.ts`; delete `services/geminiService.ts` (C). Add `organizations.ai_queries_month`, `ai_quota_reset_at` (migration).

#### HS-12 · Security headers and CSP
**Story:** As IT security, I want standard security headers on every response, so that XSS, clickjacking and sniffing risks are reduced.
**Priority:** Must · **Size:** S · **Package:** A · **Depends on:** DS-01 (no external fonts) · **Findings:** SEC-19

**Acceptance criteria**
1. Given any page or asset response, when inspected, then it has `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, `Strict-Transport-Security: max-age=31536000; includeSubDomains`.
2. Given deploy previews, when the header ships, then it is first deployed as `Content-Security-Policy-Report-Only` on branch deploys, and enforced on production only after the full e2e suite passes on a preview without CSP violations in the console (I).
3. Given the app at runtime with CSP enforced, when every route in the route map is opened, then the browser console shows no CSP violations.

**Technical notes:** `netlify.toml` `[[headers]] for = "/*"`. Document the Release 3.0 change (`frame-ancestors https://*.atlassian.net` for embedded routes) as a comment.

#### HS-13 · Password policy and account enumeration
**Story:** As an Org Admin, I want new passwords to be strong and the login not to reveal which emails exist, so that accounts are harder to attack.
**Priority:** Must · **Size:** S · **Package:** A (API), B (form hints) · **Depends on:** PL-01 · **Findings:** SEC-23

**Acceptance criteria**
1. Given registration, reset-confirm, invitation accept or an admin-set password, when the new password is shorter than 10 characters, then 400 `fields.password = "Use at least 10 characters."`; existing users with shorter passwords can still sign in unchanged.
2. Given an unknown email, when `POST /api/auth/login` is called, then the response is 401 "Invalid email or password" and bcrypt still runs against a fixed dummy hash (response time within ±50 ms of a wrong-password attempt on a known email in a test with mocked timing).
3. Given registration with an already registered email (public mode), when submitted, then the response is the same 201 `{ emailVerificationRequired: true }` as a new registration and the existing owner receives an "Someone tried to register with your email" message.
4. Given a successful login of a user whose hash has cost < 12, when it completes, then the password may be rehashed at cost 12 in the same `$2b$` format (optional; must not change the login outcome).

#### HS-14 · Re-authentication to disable 2FA
**Story:** As a user, I want disabling 2FA to require my password, so that a stolen session cannot remove it.
**Priority:** Must · **Size:** S · **Package:** A, B (Profile UI) · **Depends on:** AC-03 · **Findings:** SEC-24

**Acceptance criteria**
1. Given 2FA is on, when I call `POST /api/auth/2fa { enabled: false }` without `password`, then 400; with a wrong password, 401; with the right one, 200 and an audit event `auth.2fa_change`.
2. Given Settings › Profile, when I switch 2FA off, then a dialog asks for my password.

#### HS-15 · No keys in the browser bundle; committed logs removed
**Story:** As IT security, I want the build to never embed server keys, so that a mis-set variable cannot publish them.
**Priority:** Must · **Size:** S · **Package:** B (`vite.config.ts`), A (CI grep), C (`services/`) · **Depends on:** — · **Findings:** SEC-29, SEC-27

**Acceptance criteria**
1. Given `vite.config.ts`, when read, then there is no `define` block for `process.env.API_KEY`/`GEMINI_API_KEY`, and no source file references `import.meta.env.VITE_OPENAI_API_KEY`.
2. Given CI, when the build finishes, then a step fails if `dist/` contains `sk-`, `npg_`, `whsec_`, `sk_live_` or `-----BEGIN`.
3. Given the repository, when listed, then `.system_logs.txt`, `netlify_logs.txt`, `test_payload.json` are gone and `.gitignore` contains `*.log`, `*_logs.txt`, `*_payload.json`.

#### HS-16 · Script guards and JWT fallback check
**Story:** As the product operator, I want dangerous scripts guarded and a way to prove production never used a fallback JWT secret, so that a mistake can't wipe or compromise production.
**Priority:** Must · **Size:** S · **Package:** A · **Depends on:** — · **Findings:** SEC-26, SEC-28

**Acceptance criteria**
1. Given `scripts/seed_super_admin.ts`, when listed, then it is deleted; `scripts/grant_platform_admin.mjs --email x@y` sets `is_platform_admin = true` and writes an `audit_events` row (`actor_type='system'`, action `platform.admin_grant`).
2. Given `scripts/wipe_all.ts` (or any script with `TRUNCATE`/`DROP`), when run without `ALLOW_DESTRUCTIVE=yes`, or with a URL containing the production host recorded in `PROD_DB_HOST`, then it exits 1 before connecting.
3. Given `node scripts/check_jwt_fallback.mjs` with `JWT_SECRET` in the environment, when run, then it prints only "match: <which>" or "no match" by comparing SHA-256 hashes of the two historical fallback strings; it never prints the secret (CA-6).

---

### E04 · Access control, identity and sessions (AC)

#### AC-01 · Target role model: schema and backfill
**Story:** As an Org Admin, I want roles split into platform, org and workspace scopes, so that someone can be Planner in one workspace and Viewer in another without changing their org role.
**Priority:** Must · **Size:** M · **Package:** A · **Depends on:** PL-02 · **Findings:** UAM-01 (High)

**Acceptance criteria**
1. Given the migration, when run with `--dry-run`, then it prints, per org, the planned counts: users → `is_platform_admin`, `org_memberships` (ORG_ADMIN / MEMBER), and `workspace_members.access_role` mapped values, with zero changes applied.
2. Given the migration is applied, when I query, then: `users.is_platform_admin` is true exactly for former `SUPERUSER` rows; `org_memberships(org_id, user_id, role)` has ORG_ADMIN for `users.role IN ('ORG_ADMIN','ADMIN')` and MEMBER for every other user with an `org_id`; `workspace_members.access_role` = `WORKSPACE_ADMIN` for legacy `PMO_ADMIN`, `PLANNER` for `WORKSPACE_OWNER`, `VIEWER` for `USER`.
3. Given the migration is run twice, when the second run completes, then no row changes (idempotent).
4. Given `users.password_hash`, `users.email`, `users.role`, `workspace_members.role`, when compared before and after, then they are byte-identical (row-count and checksum report from PL-14).
5. Given 2.0 code changes a workspace role, when it writes, then it writes `access_role` **and** the legacy `role` (`WORKSPACE_ADMIN→PMO_ADMIN`, `PLANNER→WORKSPACE_OWNER`, `CONTRIBUTOR→USER`, `VIEWER→USER`), so v1.1 code still works on rollback. It never writes `users.role` except to keep `ORG_ADMIN` in sync with `org_memberships` for rollback.

**Technical notes:** New columns: `users.is_platform_admin BOOL DEFAULT false`, `users.token_version INT DEFAULT 0`, `users.email_verified_at TIMESTAMPTZ`, `users.password_changed_at TIMESTAMPTZ`; table `org_memberships`; `workspace_members.access_role TEXT CHECK (access_role IN ('WORKSPACE_ADMIN','PLANNER','CONTRIBUTOR','VIEWER'))`; `organizations.plan`, `features JSONB`, `planning JSONB`, `default_workspace_visibility TEXT DEFAULT 'org'`. Mapping functions in `shared/permissions.ts` (WP-0).

#### AC-02 · One authentication and authorization library, applied everywhere
**Story:** As IT security, I want every function to authenticate from the database and authorize through one permission table, so that no endpoint reinvents (or forgets) the rules.
**Priority:** Must · **Size:** L · **Package:** A · **Depends on:** PL-01, AC-01 · **Findings:** UAM-02 (High), SEC-13 (High, part), SEC-03/04/17 (root cause)

**Acceptance criteria**
1. Given any function in `netlify/functions/` (except `auth.ts` login/register/reset/session routes, `invitations` lookup, `health.ts` and the Stripe webhook), when called without a valid session cookie or bearer token, then 401 `{ code: "unauthorized" }`.
2. Given a token signed with an algorithm other than HS256 or with `alg: none`, when presented, then 401.
3. Given a valid token whose `tv` claim differs from `users.token_version` (missing `tv` = 0), when presented, then 401 "Your session has ended. Sign in again."
4. Given a user whose role changed, was removed from the org, or reset their password, when their next request arrives, then it is authorized from the DB row (role and org from `org_memberships`/`workspace_members`, never from JWT claims), and for removal/reset the token is rejected because `token_version` was bumped.
5. Given the permission matrix (DESIGN_SYSTEM-independent; `shared/permissions.ts`), when the matrix test runs (PL-12), then for every (endpoint, role, same-tenant/other-tenant) the expected status is returned; other-tenant access is always 403 or 404.
6. Given an org-scoped request with `orgId` in body or query, when processed, then the org is resolved from the resource (`workspaces.org_id`), and a mismatching `orgId` returns 403.
7. Given `GET /api/my_workspaces` and `GET /api/workspace_lookup`, when called, then they use the same library (and are kept for compat; the 2.0 client uses `/api/v2/me`).

**Technical notes:** `_lib/auth.ts`: `requireUser(ctx): Actor` with `Actor = { userId, email, isPlatformAdmin, tokenVersion, authMethod: 'cookie'|'bearer' }`, behind an `AuthAdapter` interface (`OrbitJwtAuth`; Release 3.0 adds `ForgeContextAuth`). `_lib/authz.ts`: `loadMemberships(sql, userId)`, `requireOrgRole(ctx, orgId, 'ORG_ADMIN'|'MEMBER')`, `requireWorkspaceAccess(ctx, wsId, 'read'|'write'|'admin')`, `can(actor, permission, { orgId, workspaceId, ownerPersonId? }): boolean`, `assert(...)`. Legacy role values are mapped in code for one release (dual-read).

#### AC-03 · Cookie session, CSRF, refresh, logout; existing sessions preserved
**Story:** As an existing user, I want to stay signed in through the upgrade and have my session protected from script theft, so that nothing changes for me except better security.
**Priority:** Must · **Size:** M · **Package:** A (server), C (client session) · **Depends on:** AC-02 · **Findings:** SEC-13 (High), SEC-25

**Acceptance criteria**
1. Given an existing user with email, password (and 2FA), when they sign in on 2.0, then they succeed with the same credentials; the response sets `pcp_session` (HttpOnly; Secure; SameSite=Lax; Path=/api; Max-Age=604800; HS256 JWT `{ sub, tv, iat, exp }` signed with the unchanged `JWT_SECRET`) and `pcp_csrf` (not HttpOnly; Secure; SameSite=Lax; Path=/; random 32 bytes), and the JSON body contains `{ user }` but **no token**.
2. Given a browser that still holds a v1.1 token in `localStorage.pcp_token`, when the 2.0 app loads, then the client calls `POST /api/auth/session` with `Authorization: Bearer <token>` once; on 200 it removes `pcp_token` and `pcp_user` from `localStorage` and continues signed in; on 401 it removes them and shows the sign-in page with "Please sign in again." (no data loss: all data is server-side).
3. Given a cookie-authenticated `POST`, `PUT`, `PATCH` or `DELETE`, when the `X-CSRF-Token` header is missing or differs from the `pcp_csrf` cookie, then 403 `{ code: "forbidden", error: "CSRF check failed" }`; requests authenticated by bearer header are exempt (legacy compat and tests).
4. Given a request whose `Origin` header is present and not in `ALLOWED_ORIGINS` (or the site `URL`), when received, then 403; CORS responses never use `*`, include `Vary: Origin` and `Access-Control-Allow-Credentials: true` only for allowed origins.
5. Given a session older than 24 h, when the client calls `POST /api/auth/refresh`, then a new `pcp_session` with a fresh 7-day expiry is set (sliding); with an invalid or revoked session it returns 401 and clears cookies. The client calls refresh at most once per page load and retries the failed request once after a 401.
6. Given "Sign out", when clicked, then `POST /api/auth/logout` clears both cookies (204), and "Sign out of all devices" in Profile also increments `users.token_version`.
7. Given `GET /api/auth?refresh=true` (the v1.1 client path), when called, then it is answered by the refresh handler (no more 404).

**Technical notes:** `auth.ts` routes `/session`, `/refresh`, `/logout`; `_lib/cookies.ts`. Short-lived access + rotating refresh tokens is AC-11 (Should).

#### AC-04 · `GET /api/v2/me` and permission-driven UI
**Story:** As a user, I want the app to reflect my current role and plan immediately, so that I never see buttons I can't use or miss ones I can.
**Priority:** Must · **Size:** S · **Package:** A (endpoint), C (`useSession`, `useWorkspace`), B (gating) · **Depends on:** AC-02 · **Findings:** UAM-06

**Acceptance criteria**
1. Given a signed-in user, when `GET /api/v2/me` is called, then it returns `MeResponse` (§4.3) with, for each workspace, `role` and the full `permissions` array computed by `permissionsFor()`.
2. Given the app loads or I switch workspace, when the shell renders, then controls are shown/hidden from `can(permission)` only; grep shows no comparisons against role strings (`'SUPERUSER'`, `'ORG_ADMIN'`, `'PMO_ADMIN'`, `'ADMIN'`, `'WORKSPACE_OWNER'`) in `App.tsx`, `components/`, `pages/`, `state/`.
3. Given an admin changes my role from Planner to Viewer, when I next load or switch pages (the client refetches `/me` on focus after 60 s), then edit controls disappear; any write I attempt meanwhile returns 403 and shows "Your permissions changed. The page has been refreshed."
4. Given `localStorage`, when inspected after sign-in, then `pcp_user` and `pcp_token` are absent.

#### AC-05 · Invitations replace temp passwords and role overwrites
**Story:** As an Org Admin, I want to invite people by a single-use link with a workspace role, so that nobody gets a password in a log and invites can't hijack accounts or roles.
**Priority:** Must · **Size:** M · **Package:** A (API), B (Members UI, accept page), C (client) · **Depends on:** AC-02, HS-07 · **Findings:** SEC-02 (Critical), SEC-21

**Acceptance criteria**
1. Given an ORG_ADMIN, when they `POST /api/v2/orgs/:orgId/invitations { email, orgRole: "MEMBER"|"ORG_ADMIN", workspaces: [{ workspaceId, role }] }`, then 201 returns `{ invitation: { id, email, expiresAt }, inviteUrl }`, an `invitations` row stores `sha256(token)` with 7-day expiry, and an email is sent via Resend (if configured).
2. Given a WORKSPACE_ADMIN (not org admin), when they invite, then they may only add workspaces they administer with roles ≤ WORKSPACE_ADMIN, and `orgRole` is forced to MEMBER; violating either returns 403.
3. Given any request body containing `role: "SUPERUSER"` or `isPlatformAdmin`, or an `orgId` different from the path, when received, then 400/403 and no change; no API path can grant platform admin.
4. Given the email belongs to an existing user in **another** org, when invited, then 409 `{ code: "conflict", error: "This person belongs to another organisation." }` and their account is untouched.
5. Given the email belongs to an existing user in the **same** org, when invited, then only `workspace_members` rows are added/updated; `users.role`, `users.org_id` and their password are untouched.
6. Given a new user opens `/invite/:token`, when the token is valid, then the page shows "Join {Org} on PMO Capacity Planner", their email (read-only), name and password fields (≥ 10 chars); on submit, `POST /api/v2/invitations/:token/accept` creates the user with `email_verified_at = now()`, adds memberships, marks the invitation accepted, signs them in (cookies) and redirects to their workspace Home.
7. Given an expired, used or unknown token, when opened, then "This invitation link has expired or was already used. Ask your admin for a new one."
8. Given `auth.ts` `/users/invite` (legacy), when called, then 410 Gone. No temp password is generated or logged anywhere (grep `tempPassword` returns nothing).

**Technical notes:** Table `invitations(id, org_id, email, org_role, workspaces JSONB, token_hash, invited_by, expires_at, accepted_at, revoked_at)`. `DELETE /api/v2/orgs/:orgId/invitations/:id` revokes. Audit `member.invite`, `member.invite_accept`.

#### AC-06 · Tenant-scoped member management
**Story:** As an Org Admin, I want to change roles and remove members only within my org, so that no admin elsewhere can touch my users and nobody can self-upgrade their plan.
**Priority:** Must · **Size:** S · **Package:** A · **Depends on:** AC-02 · **Findings:** SEC-03 (Critical)

**Acceptance criteria**
1. Given an ORG_ADMIN of org X, when they `PATCH /api/v2/orgs/X/members/:userId` for a user in org Y, then 404 and no change.
2. Given a valid same-org target, when patched with `{ orgRole?, workspaces?: [{ workspaceId, role | null }] }`, then memberships update (null removes), the target's `token_version` increments, and an audit event `role.change` records before/after.
3. Given any member endpoint, when the body contains `plan`, then 400 `fields.plan = "Plan is managed by billing."`; legacy `PUT /api/auth/users/:id` returns 410.
4. Given `DELETE /api/v2/orgs/:orgId/members/:userId`, when the target is the last ORG_ADMIN, then 409 "An organisation needs at least one Org Admin."; otherwise memberships are removed, `token_version` bumped, the user row kept (they can be re-invited), and audit `member.remove`.
5. Given a WORKSPACE_ADMIN, when they `PATCH /api/v2/workspaces/:wsId/members/:userId { role }`, then allowed for roles ≤ WORKSPACE_ADMIN in a workspace they administer; else 403. Legacy `/api/auth/remove-member` returns 410.

#### AC-07 · Platform admin by flag only; email verification
**Story:** As the product operator, I want platform admin granted only deliberately and new accounts verified, so that registering a magic email address can't grant superuser.
**Priority:** Must · **Size:** S · **Package:** A (API), B (verify page) · **Depends on:** AC-01 · **Findings:** SEC-08 (High)

**Acceptance criteria**
1. Given `SUPER_ADMIN_EMAIL` (or `gokulkris1@gmail.com`) registers or logs in, when processed, then no role or plan change happens; grep of `netlify/functions` for `SUPER_ADMIN_EMAIL` and the hard-coded address returns nothing.
2. Given the migration, when applied, then every existing user has `email_verified_at` set (backfilled to `now()`), so all current logins work.
3. Given a new public-mode registration, when the user signs in before verifying, then they can sign in but `POST /api/v2/orgs` and invitation accept return 403 "Verify your email first", and the UI shows a "Verify your email" banner with "Resend code".
4. Given `APP_MODE=internal` and `ALLOW_PUBLIC_SIGNUP` not `true`, when `POST /api/auth/register` is called, then 403 "Sign-up is by invitation only." and the sign-in page has no "Create account" link.
5. Given a platform admin, when they view another org via the cockpit, then each view writes an audit event `support.access` with the org id.

#### AC-08 · Workspace and org creation authorization
**Story:** As an Org Admin, I want only org admins to create workspaces in my org and users to belong to one org, so that nobody can plant a workspace in my tenant.
**Priority:** Must · **Size:** S · **Package:** A, B (create-org flow uses new endpoint) · **Depends on:** AC-02 · **Findings:** SEC-17, SEC-18

**Acceptance criteria**
1. Given a user who is not ORG_ADMIN of org X (including admins of other orgs), when they `POST /api/v2/orgs/X/workspaces`, then 403.
2. Given an ORG_ADMIN of X, when they create workspace "Delivery PMO", then 201 and they are recorded as WORKSPACE_ADMIN of it; plan limit `maxWorkspaces` applies (403 `entitlement` when exceeded).
3. Given a user already in an org, when they `POST /api/v2/orgs`, then 409 "You already belong to an organisation."; a verified user with no org gets 201, becomes ORG_ADMIN, and the org, membership and first workspace are created in one transaction.
4. Given `POST /api/org_create`, when called, then 404 (function deleted); `org_manage.ts` POST is replaced by the v2 route (legacy path returns 410).

#### AC-09 · Workspace read visibility setting
**Story:** As an Org Admin, I want to choose whether org members can read every workspace or only those they're added to, so that confidential portfolios stay private.
**Priority:** Must · **Size:** S · **Package:** A, B (setting) · **Depends on:** AC-02 · **Findings:** UAM-04

**Acceptance criteria**
1. Given `default_workspace_visibility = 'org'` (default for migrated orgs), when an org MEMBER without a `workspace_members` row opens workspace W, then they get VIEWER-level read access, and `/me` lists W with role `VIEWER` and `implicit: true`.
2. Given it is set to `'members'`, when the same MEMBER requests W, then 403, and W is absent from `/me`.
3. Given Settings › Organisation, when an Org Admin changes "Workspace visibility" between "Everyone in the organisation can view every workspace" and "Only invited members can view a workspace", then it saves (audit `org.update`).

#### AC-10 · Audit events for every write
**Story:** As an Org Admin, I want every sign-in and change recorded with who, what and when, so that we have accountability and can investigate incidents.
**Priority:** Must · **Size:** M · **Package:** A · **Depends on:** PL-01, PL-02 · **Findings:** UAM-05

**Acceptance criteria**
1. Given the `audit_events` table (review §3.4), when any v2 write, member/role change, invitation, org/workspace create/delete, integration config or secret change, sync run, Planview apply, export of the QBR pack (client reports it via `POST /api/v2/workspaces/:wsId/audit/export`), AI query, login, failed login, password reset or 2FA change happens, then exactly one row is inserted with `action` from the review list, `actor_user_id`, `org_id`, `workspace_id`, `target_type`, `target_id`, redacted `before`/`after`, IP, user agent and `request_id`.
2. Given a data write, when it fails and rolls back, then no audit row remains (written inside the same `withTx`); failed logins are written outside a transaction.
3. Given `before`/`after` JSON, when inspected, then it never contains `password_hash`, OTPs, tokens, `secret_enc` or API tokens (unit test on the redactor).
4. Given an ORG_ADMIN, when they call `GET /api/v2/orgs/:orgId/audit?from&to&workspaceId&action&format=csv`, then they receive their org's events only (paged JSON, or CSV); WORKSPACE_ADMIN gets only their workspace's events; others 403.
5. Given legacy `audit_logs` LOGIN rows, when the migration runs, then they are copied into `audit_events` (`action = 'auth.login'`) idempotently; `audit_logs` is not dropped in 2.0.

**Technical notes:** `_lib/audit.ts` `audit(tx, ctx, { action, target, before, after })`. `audit.ts` (superuser global view) is restricted to platform admins and reads `audit_events`.

#### AC-11 · Short-lived access token with rotating refresh token
**Priority:** **Should** · **Size:** M · **Package:** A, C · **Findings:** SEC-13 (rest)
**Story:** As IT security, I want 1-hour access tokens with rotating, hashed refresh tokens, so that a leaked session cookie is useful for minutes, not days.
**Acceptance criteria:** (1) `pcp_session` lifetime 1 h; `pcp_refresh` (HttpOnly, SameSite=Strict, Path=/api/auth) 30 days, stored as `sha256` in `refresh_tokens`, rotated on each use; reuse of a rotated token revokes the family (401 and audit `auth.refresh_reuse`). (2) Existing 7-day sessions issued by AC-03 remain valid until expiry.
**Rationale for Should:** AC-03 already removes the token from `localStorage` and makes sessions revocable through `token_version`; this is defence in depth.

#### AC-12 · Time-boxed support grants for platform admins
**Priority:** **Should** · **Size:** S · **Package:** A, B · **Findings:** review §3.1
**Story:** As an Org Admin, I want platform staff to see my data only when I grant time-boxed access, so that support access is consented.
**Acceptance criteria:** (1) Settings › Organisation › "Support access": grant for 24 h / 7 days, revoke; table `support_grants`. (2) Without an active grant, a platform admin's tenant data requests return 403; platform-level stats still work.
**Rationale for Should:** 2.0 already audits every platform-admin access (AC-07#AC5); consent gating changes support processes and can follow.

### E05 · Platform: data API, migrations and quality gates (PL)

#### PL-01 · Shared function library (`_lib`) and fail-closed configuration
**Story:** As a backend developer, I want one wrapper for CORS, auth, validation, errors, logging, DB and transactions, so that every security fix is made once and applies to every function.
**Priority:** Must · **Size:** M · **Package:** A · **Depends on:** WP-0 · **Findings:** ARC-05, ARC-06, ARC-09, SEC-20, SEC-25, OPS-02

**Acceptance criteria**
1. Given any function, when it handles a request, then it is exported as `handler = withApi(options, async (ctx) => …)`; grep for `'Access-Control-Allow-Origin': process.env.URL || '*'` and for per-file `getDb()` definitions returns nothing.
2. Given an unhandled exception, when it occurs, then the client gets 500 `{ error: "Server error", code: "server_error", requestId }` and the log line is JSON `{ level: "error", requestId, fn, route, userId?, err: { message, stack } }`; no SQL, constraint or upstream text reaches the client.
3. Given a route with a zod schema, when the body or query is invalid, then 400 `{ code: "bad_request", fields: { "<path>": "<message>" } }` and the handler is not called.
4. Given every response, when inspected, then it carries `x-request-id` (taken from `x-nf-request-id` or generated).
5. Given the database URL, when resolved, then all functions use the same order: `DATABASE_URL`, `NETLIFY_DATABASE_URL_UNPOOLED`, `NETLIFY_DATABASE_URL`, `NEON_DATABASE_URL`; if none is set, the function returns 503 and logs "DATABASE_URL missing".
6. Given `JWT_SECRET` is unset, when any function loads, then it refuses to serve (503) rather than using a default.
7. Given a multi-statement write (org delete cascade, scenario commit, invitations accept, batch allocations), when any statement fails, then all are rolled back (`withTx`).
8. Given `.env.example`, when read, then it lists every variable the code reads, each with a one-line comment and "required/optional, which mode", and contains no real values.

**Technical notes:** `netlify/functions/_lib/{env,db,http,api,schemas,errors,log,cookies,crypto,net,email,audit,auth,authz,otp,rateLimit}.ts`. `withApi({ methods, auth: 'required'|'optional'|'none', csrf?: boolean, schema? })`. `db.ts` exports `getSql()` (HTTP driver, reads) and `withTx(fn)` (Pool, writes). `netlify.toml` `[functions] node_bundler = "esbuild"` so `../../shared/**` imports bundle.

#### PL-02 · Migration runner, baseline and no runtime DDL
**Story:** As the release manager, I want versioned, idempotent migrations with a dry run, so that the live Neon database changes safely and predictably.
**Priority:** Must · **Size:** M · **Package:** A · **Depends on:** WP-0 · **Findings:** ARC-03 (High)

**Acceptance criteria**
1. Given `npm run db:migrate -- --dry-run`, when run against a database, then it lists pending migrations in order, executes each inside a transaction that is **rolled back**, and prints a report: per table, row counts before/after and the counts of rows each backfill would change; exit 0.
2. Given `npm run db:migrate`, when run, then each pending file in `migrations/` runs in its own transaction, is recorded in `schema_migrations(version, name, checksum, applied_at)`, and a second run reports "0 pending".
3. Given an already-applied migration whose file checksum changed, when the runner starts, then it exits 1 with "Migration {version} was modified after being applied".
4. Given every migration file, when reviewed, then it is additive and idempotent (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `INSERT … ON CONFLICT DO NOTHING`, backfill `UPDATE … WHERE new_col IS NULL`), contains no `DROP TABLE`/`DROP COLUMN`, and constraint widening is done by adding a new column (not altering a legacy CHECK).
5. Given `workspace.ts` and `integrations.ts`, when read, then the cold-start `ALTER TABLE`/`CREATE TABLE` blocks are gone; `0001_baseline.sql` contains every statement they ran plus `scripts/migrate_crafts.sql`, `migrate_integrations.sql`, `migrate_qbr.sql`, all as `IF NOT EXISTS`.
6. Given the deployed 2.0 functions start against a DB whose highest applied version is below `REQUIRED_SCHEMA_VERSION` (constant in `_lib/db.ts`), when any API is called, then 503 `{ code: "migration_pending" }` (SH-07#AC4); `GET /api/health` reports `schemaVersion` and `requiredSchemaVersion`.
7. Given the obsolete scripts, when listed, then `scripts/migrate*.{ts,js,mjs}`, `run_migration.mjs`, `fix_db.ts`, `emergency_fix_schema.ts`, `add_skills_column.ts`, `fix_qbr_types.js`, `test_query.mjs`, `test_save_*.ts`, `check_db.mjs`, `diagnose_db.mjs` are deleted; the old `.sql` files move to `migrations/legacy/` for reference.

**Technical notes:** `scripts/db-migrate.mjs` (Node 22, `@neondatabase/serverless` Pool). Migration files: `0001_baseline.sql`, `0002_access_model.sql` (AC-01), `0003_versioning_audit_ratelimit.sql` (PL-04, AC-10, HS-05), `0004_org_structure.sql` (ORG-01), `0005_demand_marketplace.sql` (DM-01, DM-03, DM-05, PPL-06), `0006_delivery_sync.sql` (JI-01…04, PV-03), `0007_invitations_billing.sql` (AC-05, HS-06, HS-11). Migrations run with the owner role by the operator (PL-14), never at function cold start.

#### PL-03 · Retire the legacy full save; fix workspace selection
**Story:** As a PMO lead, I want saving to never overwrite another workspace or wipe data, so that switching workspaces is safe.
**Priority:** Must · **Size:** S · **Package:** A · **Depends on:** PL-04 · **Findings:** ARC-01 (Critical)

**Acceptance criteria**
1. Given `POST /api/workspace` (v1.1 full delete-and-reinsert), when called by any client, then 410 `{ code: "gone", error: "PMO Capacity Planner was updated. Reload the page." }` and no row changes.
2. Given `GET /api/workspace?wsId=B`, when called by a member of B, then it returns B's data (not the org's first workspace); without `wsId` it resolves the user's default workspace deterministically (`ORDER BY created_at, id`); a non-member gets 403.
3. Given a regression test, when it simulates "load workspace A, switch to B, save", then B's rows are unchanged (PL-12).
4. Given the 2.0 client, when it loads, then it never calls `/api/workspace` (only `/api/v2/...`).

#### PL-04 · Per-entity API with optimistic concurrency (`/api/v2`)
**Story:** As a PMO analyst working alongside colleagues, I want each edit saved on its own with conflict detection, so that two people editing different people both persist and nobody silently undoes anyone.
**Priority:** Must · **Size:** L · **Package:** A · **Depends on:** PL-01, PL-02, AC-02 · **Findings:** ARC-02 (High)

**Acceptance criteria**
1. Given `GET /api/v2/workspaces/:wsId/snapshot`, when called by a reader, then it returns `WorkspaceSnapshot` (§4.3) in ≤ 2 s for 200 people × 100 projects × 2,000 allocations (measured on the preview DB with the seed script), using ≤ 6 queries.
2. Given two Planners editing different people, when both `PATCH /people/:id` with their own `version`, then both return 200 with `version + 1` and both changes persist.
3. Given two Planners editing the **same** row, when the second `PATCH` arrives with a stale `version`, then 409 `{ code: "conflict", current: <latest row>, changedBy: { id, name }, changedAt }` and the row is unchanged; the client shows the conflict dialog.
4. Given `POST /allocations/batch { ops, label }` with up to 500 ops, when any op fails validation or version check, then the whole batch is rejected (409 or 400 with the failing op index in `fields`) and nothing changes; on success it returns `{ upserted, deleted }` and writes one audit event with the label.
5. Given a create with a client-supplied `id`, when it is not a UUID, then 400; when omitted, the server generates a UUIDv4.
6. Given any write, when it succeeds, then `updated_at`, `updated_by` and `version` are set server-side, and `workspaces.data_version` increments (used by the client to detect staleness).
7. Given entitlements, when a create would exceed `maxPeople`/`maxProjects`, then 403 `{ code: "entitlement", error: "Your {Plan} plan allows up to {n} people." }`; edits to existing rows are never blocked by limits.
8. Given the legacy columns read by v1.1 (`projects.client_name`, `projects.craft_demand`, `resources.craft_profile`), when 2.0 writes a project, demand line or person, then those columns are kept in sync (dual-write) so a rollback to v1.1 shows the same data.
9. Given "Install sample data" for an empty workspace (`POST /api/v2/workspaces/:wsId/sample-data`, PLANNER+), when run, then the demo people/projects/allocations are inserted with **fresh UUIDs** (never `r1`, `p1`), and calling it on a non-empty workspace returns 409.
10. Given every v2 query, when reviewed, then it filters by `workspace_id` (and `org_id` for org entities) and uses only portable SQL (no Neon-specific functions); `jsonb` is allowed.

**Technical notes:** New function `netlify/functions/v2.ts` with an internal router (`_lib/router.ts`) for `/api/v2/*`; handlers per resource in `netlify/functions/_lib/handlers/*.ts`. Bulk insert via `unnest`. Migration `0003` adds `version INT NOT NULL DEFAULT 1`, `updated_at`, `updated_by`, `created_at` to `resources`, `projects`, `allocations`; `allocations.state`, `notes`, `external_ref`, `demand_line_id`, `proposed_at`, `proposed_by`, `responded_at`; `workspaces.data_version`.

#### PL-05 · Client API layer with a transport interface
**Story:** As a developer porting to Jira later, I want every server call to go through one typed client over a swappable transport, so that moving to `@forge/bridge` changes one file.
**Priority:** Must · **Size:** M · **Package:** C · **Depends on:** WP-0 · **Findings:** review §4 (Marketplace), ARC-04

**Acceptance criteria**
1. Given the codebase, when I grep `App.tsx`, `components/`, `pages/`, `context/`, `state/` for `fetch(`, then there are zero matches; all calls go through `services/api/client.ts`.
2. Given `HttpTransport`, when it sends a mutating request, then it includes `X-CSRF-Token` from the `pcp_csrf` cookie and `credentials: 'same-origin'`; on 401 it calls `POST /api/auth/refresh` once and retries; on a second 401 it emits `session-expired` and the app routes to `/login?next=…`.
3. Given an error response, when parsed, then the client throws `ApiRequestError { status, code, message, fields, requestId, body }` (never raw text).
4. Given `DemoTransport`, when the app runs in demo mode (ST-10), then every route in §4.3 used by the UI is served from in-memory data seeded from `constants.ts`, with the same response shapes, including 409 on a stale version.
5. Given `services/api/transport.ts`, when read, then it exports `interface Transport { request<T>(method, path, body?, init?): Promise<T> }` with no React or DOM imports other than `fetch`/`document.cookie` inside `HttpTransport`.

**Technical notes:** Files: `services/api/transport.ts`, `httpTransport.ts`, `demoTransport.ts`, `client.ts` (typed methods per resource), `errors.ts`. Delete `services/geminiService.ts`.

#### PL-06 · Client store and hooks; App.tsx without data state
**Story:** As a developer, I want workspace data in a small store with hooks, so that `App.tsx` is only a router and pages can be lazy-loaded and tested.
**Priority:** Must · **Size:** L · **Package:** C · **Depends on:** PL-05 · **Findings:** ARC-04, review §4 (no browser-only state)

**Acceptance criteria**
1. Given `App.tsx`, when read, then it contains no `useState` for resources/projects/allocations, no autosave effect, no `fetch`, and is ≤ 250 lines.
2. Given the hooks in §4.3 (`useSession`, `useWorkspace`, `useWorkspaceData`, `useQuarters`, `useMutations`, `useUndo`, `useConflict`, `useFeature`, `useEntitlements`), when used by pages, then they behave per the contract, including optimistic updates that roll back on error.
3. Given an edit, when the mutation succeeds, then the snapshot is updated in place from the server response (no full reload); when another user's change is detected (`data_version` advanced on refetch-on-focus), then the store reloads the snapshot and a toast says "Updated with the latest changes."
4. Given the last action or bulk action, when I press Ctrl/⌘ Z or click Undo in its toast, then the inverse operations are sent as one batch and the UI reflects the previous state; the undo stack holds the last 20 actions per session.
5. Given `localStorage` after a session, when inspected, then only UI-preference keys exist (`pcp.ui.*`: sidebar collapsed, table density, last workspace id); the keys `pcp_resources`, `pcp_projects`, `pcp_allocations`, `pcp_scenario_mode`, `pcp_scenario_allocations`, `orbitTheme`, `pcp_tour_done`, `pcp_active_workspace` are removed on first load.
6. Given every function in `utils/craftEngine.ts`, `utils/quarters.ts`, `utils/viewModels/*.ts` and `shared/*`, when checked by `scripts/check-pure.mjs` (A writes it; CI runs it), then none imports `react`, `react-dom`, DOM globals, Node built-ins or `@netlify/*`.

**Technical notes:** `state/store.ts` (tiny external store with `useSyncExternalStore`, no new dependency), `state/session.tsx` (replaces `context/AuthContext.tsx`, which is deleted), `state/hooks.ts`, `state/undo.ts`. WP-0 ships signature-compatible stubs (§4.2) so B can build pages before C finishes.

#### PL-07 · Entitlements service
**Story:** As an Org Admin, I want plan limits defined once and enforced by the server, so that the UI and server never disagree and nobody can bypass billing.
**Priority:** Must · **Size:** M · **Package:** A (enforcement, `organizations.plan`), C (`useEntitlements`), B (messages) · **Depends on:** WP-0, AC-01 · **Findings:** UAM-03 (High)

**Acceptance criteria**
1. Given the migration, when applied, then `organizations.plan` is backfilled with today's derivation (plan of the org's ORG_ADMIN/SUPERUSER user, highest wins, else BASIC), and the dry-run report lists each org's resulting plan.
2. Given `APP_MODE=internal`, when entitlements resolve, then every org gets ENTERPRISE (unlimited), and no billing/plan UI is shown.
3. Given `shared/entitlements.ts`, when the client and server compute limits, then both import it; `constants.ts PLAN_LIMITS` and the numeric checks at `App.tsx:479-507, 556, 577, 603, 1013, 1026` and `workspace.ts:257-265` are removed.
4. Given a BASIC org (public mode), when a Planner tries to create the 6th person, then the server returns 403 `entitlement` and the UI shows the plan-limit message (§3 common copy); existing over-limit data stays editable.
5. Given feature entitlements (`csvImport`, `csvExport`, `scenarios`), when not entitled, then the server rejects the related endpoint with 403 `entitlement`, and the UI hides the action (no lock icons).

#### PL-08 · One CI pipeline with security gates
**Story:** As the tech lead, I want one CI workflow that lints, type-checks, tests, audits and scans every push, so that green means safe to deploy.
**Priority:** Must · **Size:** S · **Package:** A · **Depends on:** WP-0 · **Findings:** OPS-01 (High), SEC-05/06 (prevention), SEC-22 (gate)

**Acceptance criteria**
1. Given a push or PR, when `.github/workflows/ci.yml` runs (Node 22), then it executes in order: `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm audit --omit=dev --audit-level=high`, gitleaks (action pinned to a commit SHA), `npm run build`, `node scripts/check-bundle-size.mjs`, dist secret grep (HS-15), function-name check (fails on `netlify/functions/(debug|test)_*`), `npm run check:guardrails`, and fails on the first error; no step uses `|| echo` or `continue-on-error`.
2. Given the repository, when listed, then `build.yml`, `deploy.yml` and `deploy-netlify.yml` are deleted; production deploys through Netlify's Git integration on `main`.
3. Given `preview-netlify.yml`, when read, then `netlify/actions/cli` is pinned to a SHA, Node is 22, it runs after `ci.yml` succeeds (`workflow_run`) or repeats its gates, and the secret check from `688ad40` is kept.
4. Given a Playwright job (`npm run test:e2e` against the preview URL), when previews deploy, then it runs the suite from I and uploads the HTML report as an artifact.

#### PL-09 · Repository hygiene and legacy server removal
**Story:** As a developer (human or agent), I want dead code and stale deploy configs removed, so that nobody edits the wrong copy and the attack surface shrinks.
**Priority:** Must · **Size:** S · **Package:** WP-0 (deletions), A (verification) · **Depends on:** — · **Findings:** SEC-14 (High), STD-01, SEC-27

**Acceptance criteria**
1. Given the repository, when listed, then these are gone: `server/`, `render.yaml`, `vercel.json`, `tsconfig.server.json`, `Claude files /`, `test-*.ts`, `test-date.js`, `test-ai.js`, `test_limits.sh`, `test_payload.json`, `fix_qbr.js`, `deno.lock`, `metadata.json`, `.system_logs.txt`, `netlify_logs.txt`, `README_API_KEY.md`, and `netlify/functions/jira.ts` stays as a 410 stub for this release only.
2. Given the nine historical audit markdown files in the root (`ACTUAL_CURRENT_STATE_AUDIT.md`, `BUG_ANALYSIS.md`, `CRITICAL_BUGS_FOUND.md`, `FINAL_AUDIT_REPORT.md`, `REAUDIT_3_REPORT.md`, `REAUDIT_REPORT.md`, `SESSION_FIXES_AUDIT.md`, `NETLIFY_SETUP.md` content merged into README, `RTM.md` stays), when listed, then they live under `docs/history/`.
3. Given `package.json`, when read, then the `server` and `dev:all` scripts are gone and `npm run dev` uses `netlify dev` (or `vite` for demo mode via `npm run dev:demo`).

#### PL-10 · Dependency clean-up and upgrades
**Story:** As IT security, I want no unused or vulnerable production dependencies, so that the audit is clean and real issues aren't hidden.
**Priority:** Must · **Size:** S · **Package:** WP-0 · **Depends on:** PL-09 · **Findings:** SEC-22

**Acceptance criteria**
1. Given `package.json`, when read, then `@google/genai`, `express`, `cors`, `helmet`, `express-rate-limit`, `swagger-jsdoc`, `swagger-ui-express`, `openai`, `uuid` and their `@types/*` are removed; `pg` and `dotenv` are devDependencies (or removed if unused).
2. Given `npm audit --omit=dev --audit-level=high`, when run, then exit 0 (jspdf and react-router-dom upgraded to patched versions; any residual advisory without a fix is documented in `docs/SECURITY_EXCEPTIONS.md` with justification).

#### PL-11 · Lint, format and type-check tooling
**Story:** As the tech lead, I want lint, formatting and type-checking enforced, so that hook bugs and accessibility mistakes are caught before review.
**Priority:** Must · **Size:** S · **Package:** WP-0 (config), each package (fixes in its own files) · **Depends on:** WP-0 · **Findings:** STD-03, STD-02 (part)

**Acceptance criteria**
1. Given `npm run lint`, when run, then ESLint (flat config) applies `typescript-eslint` recommended, `react-hooks` (error on `rules-of-hooks`, `exhaustive-deps`), `jsx-a11y` recommended, `security` recommended, the DS-07 rules, and `@typescript-eslint/no-explicit-any: warn`; exit 0 on the final codebase.
2. Given `npm run typecheck` (`tsc --noEmit -p tsconfig.json` covering `shared/`, `netlify/functions/`, `state/`, `services/`, `utils/`, `components/`, `pages/`), when run, then exit 0, and `strictNullChecks: true` is enabled for `shared/**`, `netlify/functions/_lib/**`, `services/**` and `state/**` via a dedicated `tsconfig.strict.json` that CI also runs.
3. Given `npm run format:check` (Prettier, 2-space indent, single quotes, 120 columns), when run, then exit 0.

#### PL-12 · Authorization matrix and regression tests
**Story:** As IT security, I want a test that walks every endpoint × role × tenant, so that a missing check fails CI instead of reaching production.
**Priority:** Must · **Size:** M · **Package:** A · **Depends on:** AC-02, PL-04 · **Findings:** STD-04 (High)

**Acceptance criteria**
1. Given `tests/backend/authz.matrix.test.ts`, when run, then for every route in the §4.3 route table and every role (anonymous, VIEWER, CONTRIBUTOR, PLANNER, WORKSPACE_ADMIN, ORG_ADMIN, other-tenant ORG_ADMIN, platform admin) it asserts the expected status from a table derived from `shared/permissions.ts`.
2. Given regression tests, when run, then they cover: SEC-01 (no `otp` key in reset/verify responses), SEC-02 (no SUPERUSER assignment; existing other-org user → 409), SEC-03 (cross-tenant PATCH → 404), SEC-04 (qbr cross-tenant → 403), ARC-01 (switch-then-save leaves B intact), SEC-11 (domain change clears secret), token `tv` revocation, CSRF rejection, legacy bearer exchange.
3. Given Jest coverage on `netlify/functions/**`, when CI runs, then line coverage ≥ 60 % or the build fails.

**Technical notes:** Mock `@neondatabase/serverless` as in `tests/backend/integrations.test.ts`, or run against a disposable Neon branch when `TEST_DATABASE_URL` is set.

#### PL-13 · Health endpoint and structured logs
**Story:** As the operator, I want a health check and request-correlated logs, so that a failed deploy or an incident is visible quickly.
**Priority:** Must · **Size:** S · **Package:** A · **Depends on:** PL-01 · **Findings:** OPS-02, OPS-03 (part)

**Acceptance criteria**
1. Given `GET /api/health` (no auth), when called, then 200 `{ ok, version, schemaVersion, requiredSchemaVersion, env: { DATABASE_URL: true, JWT_SECRET: true, INTEGRATIONS_ENC_KEY: false, RESEND_API_KEY: true, … } }` with booleans only (no values), and `ok=false` with 503 when the DB is unreachable or schema is behind.
2. Given any request, when logged, then the line is JSON with `requestId`, `fn`, `route`, `status`, `durationMs`, and no PII beyond user id (no emails, no bodies).

#### PL-14 · Release runbook, rehearsal and data-parity check
**Story:** As the PMO lead, I want the upgrade rehearsed on a copy of production with a parity report, so that I can approve go-live knowing no data is lost and everyone can still sign in.
**Priority:** Must · **Size:** M · **Package:** A (scripts), I (rehearsal, runbook) · **Depends on:** all migrations

**Acceptance criteria**
1. Given `npm run db:parity -- --before before.json` after migration, when run, then it compares per-table row counts and per-row checksums of `users(id,email,password_hash)`, `resources`, `projects`, `allocations`, `workspace_members`, `organizations`, `workspaces` and reports "0 rows lost, 0 credential changes" or lists differences (exit 1).
2. Given a Neon branch of production (CA-5/CA-12), when the full runbook is rehearsed (deploy 2.0 to a preview pointing at the branch, observe 503 `migration_pending`, run dry-run, apply, verify parity, run the e2e suite including "existing user signs in with 2FA"), then all steps pass and timings are recorded in `docs/release/2.0-runbook.md`.
3. Given the runbook, when read, then it includes the CA-9 forensics query, rollback steps (redeploy v1.1 build; additive schema stays; restore from the Neon backup branch only if data was corrupted), and the post-go-live checks (health, login, one edit, scheduled sync registered).

#### PL-15 · Composite tenant keys, `app_rw` role and row-level security
**Priority:** **Should** · **Size:** L · **Package:** A · **Findings:** ARC-03 (rest), review §3.3
**Story:** As IT security, I want tenant tables keyed by `(workspace_id, id)`, a least-privilege DB role for functions, and RLS, so that a missed filter can't leak data.
**Acceptance criteria:** (1) Migration adds `UNIQUE (workspace_id, id)` and `org_id NOT NULL` on tenant tables after verifying no violations (dry-run reports offenders). (2) Functions connect as `app_rw` (no DDL); migrations as owner. (3) RLS policies with `SET LOCAL app.org_id` inside `withTx`; matrix tests pass unchanged.
**Rationale for Should:** requires a customer-created DB role and touches primary keys on the live DB; 2.0 already filters every query by tenant and tests it (PL-12).

#### PL-16 · TypeScript strict mode everywhere
**Priority:** **Should** · **Size:** M · **Package:** I · **Findings:** STD-02 (rest)
**Acceptance criteria:** `"strict": true` in `tsconfig.json`; `tsc --noEmit` passes; `any` count ≤ 20 (reported in CI).
**Rationale for Should:** 147 `any` usages; PL-11 already enforces strictness on all new core modules.

#### PL-17 · Error tracking (Sentry)
**Priority:** **Should** · **Size:** S · **Package:** A, B · **Findings:** OPS-03 (rest)
**Acceptance criteria:** When `SENTRY_DSN` is set, browser and function errors are reported with PII scrubbed (no emails, no request bodies) and the `requestId` tag; when unset, nothing is sent and CSP is unchanged.
**Rationale for Should:** needs a customer-owned Sentry project and a CSP `connect-src` change.

### E06 · Org structure and craft catalogue (ORG)

#### ORG-01 · Tribes, chapters, teams and crafts as tenant data (schema and migration)
**Story:** As a PMO lead, I want tribes, chapters, teams and crafts to be real records, so that renaming one never changes historic numbers and tribes stop being free text.
**Priority:** Must · **Size:** M · **Package:** A · **Depends on:** PL-02 · **PO:** EP-05

**Acceptance criteria**
1. Given migration `0004`, when applied, then tables exist: `tribes(id, org_id, name, lead_name, archived, version, …)`, `chapters(id, org_id, name, craft_id, lead_person_id, archived, …)`, `teams(id, org_id, name, archived, …)`, `crafts(org_id, id TEXT, name, short, description, family, archived, sort_order, …, PRIMARY KEY (org_id, id))`; and columns `resources.chapter_id`, `resources.home_tribe_id`, `resources.linked_user_id`, `projects.tribe_id`, `projects.owner_user_id`.
2. Given each org, when backfilled, then `crafts` contains the 12 `PMO_CRAFTS` with their existing ids (`programme-mgmt`, …) unchanged; tribes are created from the distinct trimmed, case-insensitive `projects.client_name` values, `qbr_tribes.name` and `craft_profile.tribeAffinity` strings in that org; `projects.tribe_id` is set from `client_name`; tribe-affinity names are rewritten to tribe ids inside `craft_profile` (old names kept in `craft_profile.tribeAffinityNames` for rollback).
3. Given resources whose `team_id` is one of `t1…t5`, when backfilled, then `teams` rows exist for those ids with the `TEAMS` constant names, keeping the same ids.
4. Given `resources.email` matching a `users.email` of a member of the same org, when backfilled, then `resources.linked_user_id` is set (case-insensitive exact match only).
5. Given the dry-run, when run, then the report lists per org: tribes to create (with source), projects without a tribe after mapping, teams created, people linked to users, and no other changes.
6. Given the migration runs twice, when complete, then no duplicates (unique `(org_id, lower(name))` on tribes/teams/chapters).
7. Given calibration stored by tribe **name** in `workspace_integrations.settings.calibration`, when migrated, then a `tribe_calibrations` row is created per tribe id (JI-04) and the JSON is left in place for rollback.

#### ORG-02 · Org-structure and craft-catalogue API
**Story:** As a PMO Admin, I want to create, rename and archive tribes, chapters, teams and crafts, so that the structure matches our organisation.
**Priority:** Must · **Size:** S · **Package:** A · **Depends on:** ORG-01, PL-04

**Acceptance criteria**
1. Given `structure.write` (WORKSPACE_ADMIN in any workspace of the org, or ORG_ADMIN), when I `POST/PATCH /api/v2/orgs/:orgId/{tribes|chapters|teams|crafts}[/:id]` with `version`, then the entity is created/updated (409 on stale version, 409 `fields.name = "Already exists"` on a duplicate name).
2. Given a craft or tribe referenced by any person, project, demand line or allocation, when I `DELETE` it, then 409 `{ code: "conflict", error: "In use by {n} records. Archive it instead." }`; `PATCH { archived: true }` succeeds and archived items remain readable on old data but are hidden from pickers.
3. Given a craft rename, when saved, then its `id` is unchanged and all historic numbers are identical (unit test via snapshot).
4. Given a craft `short` code, when saved, then it is 2–4 uppercase letters/digits, unique per org (400 otherwise).
5. Given a Planner or lower, when calling these write routes, then 403.

#### ORG-03 · Settings › Structure (tribes, chapters, teams)
**Story:** As a PMO Admin, I want one settings page to manage tribes, chapters (with their lead) and teams, so that people and projects can be grouped correctly.
**Priority:** Must · **Size:** M · **Package:** B (UI), C (mutations) · **Depends on:** ORG-02, DS-04

**Acceptance criteria**
1. Given `/o/:org/w/:ws/settings/structure`, when opened by a PMO Admin, then three tabs "Tribes", "Chapters", "Teams" each show a DataTable (Name, Lead (chapters: person combobox; tribes: free-text lead name), People count, Projects count (tribes), Status) with "Add tribe/chapter/team" primary action, inline rename, and Archive/Restore in a row menu.
2. Given a Planner, when opening the page, then it is read-only (no add/rename/archive controls).
3. Given an empty chapters list, when shown, then the EmptyState offers "Create chapters from crafts", which creates one chapter per above-the-table craft in use and assigns people by primary craft after a ConfirmDialog listing the chapters to create.

#### ORG-04 · Craft catalogue admin
**Story:** As a PMO Admin, I want to edit our craft catalogue, so that the crafts match our chapters instead of a hard-coded list.
**Priority:** Must · **Size:** S · **Package:** B (UI), C (catalogue in store) · **Depends on:** ORG-02

**Acceptance criteria**
1. Given `/settings/crafts`, when opened, then a DataTable lists Name, Short code (rendered as a CraftChip), Family, Description, Holders (above / below counts), Status, with "Add craft", inline edit, reorder (Move up/down actions), Archive/Restore.
2. Given a new craft "Service Design" with short "SD", when saved, then it is selectable in person craft editors and demand grids immediately (store updated from the response).
3. Given the client code, when grepped, then no runtime logic reads `PMO_CRAFTS`; it is used only as demo seed data (`DemoTransport`) and in the migration.

#### ORG-05 · Tribes pages
**Story:** As a tribe lead or PMO lead, I want a page per tribe with its projects, demand, PMO staffing and calibration, so that I can discuss a tribe's service in one place.
**Priority:** Must · **Size:** M · **Package:** B (pages), C (`buildTribeView`) · **Depends on:** ORG-02, DM-01, JI-04

**Acceptance criteria**
1. Given `/org/tribes`, when opened, then a DataTable lists each tribe: Name, Projects, Demand QBR1–QBR4 (FTE), Staffed QBR1 (FTE), Gap QBR1 (FTE, BandPill-style signal: red "Gap" when > 0), PMO people serving, Delivery signal (from JI-06, or "No Jira mapping").
2. Given `/org/tribes/:tribeId`, when opened, then the page shows KPI tiles (Demand, Staffed, Gap for the selected basis), a projects table with stage and staffing, a craft demand vs staffed chart per quarter, the people serving the tribe with their load on it, and the calibration card (value, suggested value, last updated, "Edit" for Planners).
3. Given the PO's "same-number guarantee", when I compare the tribe's QBR1 staffed FTE with Capacity Outlook pivoted by tribe for QBR1, then they are equal (I test).

#### ORG-06 · Client domain switches to entity ids
**Story:** As a developer, I want the domain layer to use catalogue and tribe ids from the snapshot, so that every view groups and labels consistently.
**Priority:** Must · **Size:** M · **Package:** C · **Depends on:** WP-0, ORG-01 contract

**Acceptance criteria**
1. Given `utils/craftEngine.ts`, when it needs crafts or tribe names, then it receives them as arguments (catalogue from the snapshot), never importing `CRAFT_BY_ID`/`PMO_CRAFTS`; existing `tests/utils/craftEngine.test.ts` still pass (adapted for the new arguments).
2. Given `suggestMatches`, when ranking tribe familiarity, then it compares `tribeAffinity` ids with `project.tribeId` (falling back to the legacy name for un-migrated demo data).
3. Given `components/crafts/shared.tsx tribesFromProjects`, when the story is done, then it is replaced by `snapshot.tribes`.

---

### E07 · People, craft profiles and My Plan (PPL)

#### PPL-01 · People page
**Story:** As a chapter lead, I want one People table with crafts, targets and a four-quarter heat strip, so that I can see who is benched or over 100 % and keep profiles current.
**Priority:** Must · **Size:** M · **Package:** B (page), C (`buildPeopleRows`) · **Depends on:** DS-04, PL-06, ORG-06 · **PO:** EP-06

**Acceptance criteria**
1. Given `/o/:org/w/:ws/org/people`, when opened, then a DataTable shows: Person (Avatar + name + job title), Chapter, Team, Above the table (filled CraftChip), Below the table (outlined CraftChips with ·L and tooltip "Up to {maxPct}%"), Target (%), QBR1, QBR2, QBR3, QBR4 (each a cell with load % and BandPill colour tint, `tnum`, right-aligned), and a row menu.
2. Given a 1280 px wide window, when the table renders, then QBR4 is visible without horizontal scroll (columns Chapter and Team collapse into a secondary line under the name below 1440 px).
3. Given filter chips "Craft", "Chapter", "Tribe affinity", "Band", "Skill", and a search box, when I apply "Band: Over capacity" for QBR1, then only people whose QBR1 band is over remain, and the active filters are in the URL query.
4. Given "Group by" (None / Team / Chapter / Home tribe), when chosen, then rows group under collapsible headers with group totals (Σload ÷ Σtarget, banded).
5. Given a Planner, when the page renders, then the header shows primary "Add person" and overflow "Import CSV", "Export CSV"; a Viewer sees only "Export CSV".
6. Given a person with 0 % load, when shown, then their cells read "0%" with the "Available" band tint (never an empty cell).

#### PPL-02 · Person drawer
**Story:** As a chapter lead, I want to open a person and edit their profile, crafts and see their quarter load and bookings without leaving the list, so that 1:1 updates are quick.
**Priority:** Must · **Size:** M · **Package:** B, C · **Depends on:** PPL-01, DS-03

**Acceptance criteria**
1. Given I click a person row (or press Enter on it), when the drawer opens (720 px, URL `?person=<id>`), then it shows tabs "Profile", "Crafts", "Load", "Bookings", "Identity".
2. Given "Profile", when a Planner edits name, email, job title, type, location, chapter, team, home tribe, target utilisation (0–150 %), daily rate, skills tags, and clicks "Save", then `PATCH /people/:id` is sent with `version`; validation errors appear inline; success shows a toast "Saved".
3. Given "Crafts", when a Planner sets the above-the-table craft and adds below-the-table crafts with proficiency (L1 "Can assist", L2 "Can own with support", L3 "Can own independently") and cap (%, default 40), then it saves; selecting the same craft as both above and below is prevented with "Already their above-the-table craft".
4. Given "Load", when shown, then a QuarterLoadBar per QBR1–4 splits above / below / undeclared / free with exact % and FTE labels, and a table version of the same numbers.
5. Given "Bookings", when shown, then a DataTable lists project, craft, %, start–end, state (Tentative/Confirmed), ProvenanceTag, with "Edit" opening the date-precise editor (AL-06).
6. Given "Identity", when shown, then it lists linked login user (if any) and Jira/Planview identities (from JI-03) with "Change" for Planners.
7. Given unsaved changes, when I close the drawer, then a ConfirmDialog "Discard changes?" appears.

#### PPL-03 · Bulk edit people
**Story:** As a chapter lead, I want to update several people at once, so that I can update ten profiles in under five minutes.
**Priority:** Must · **Size:** S · **Package:** A (`/people/bulk`), B, C · **Depends on:** PPL-01, DS-04

**Acceptance criteria**
1. Given I select rows, when the bulk bar shows, then actions are "Set chapter", "Set team", "Set target", "Add below-the-table craft"; each opens a small dialog and applies to all selected in one `POST /people/bulk` call.
2. Given the bulk call, when one person has a stale version, then the call returns 409 with that person's id and the dialog says "1 person changed since you loaded the page. Reload and try again." with "Reload"; nothing is applied.
3. Given success, when done, then a toast "{n} people updated" with Undo appears.

#### PPL-04 · CSV import and export of people and crafts
**Story:** As a PMO analyst, I want to import and export people with their crafts as CSV, so that onboarding a whole squad is a file, not an afternoon.
**Priority:** Must · **Size:** M · **Package:** C (parse/validate), A (`/people/import`), B (dialog) · **Depends on:** PPL-01, PL-07

**Acceptance criteria**
1. Given "Download template" in the import dialog, when clicked, then a CSV with headers `name,email,job_title,type,location,chapter,team,home_tribe,target_pct,above_craft,below_crafts,skills` downloads, where `below_crafts` is `short:level:cap` separated by `|` (e.g. `SM:3:50|BA:2:30`).
2. Given a file with errors, when uploaded, then a preview table marks each invalid row with the reason ("Unknown craft 'XX'", "Target must be 0–150") and "Import {n} valid rows" is the only action; nothing is written before confirming.
3. Given valid rows, when imported, then people are matched by email (else name) and updated, or created; unknown chapters/teams/tribes are created only if I tick "Create missing chapters, teams and tribes"; the result dialog shows "{created} created, {updated} updated, {skipped} skipped".
4. Given Export CSV, when clicked, then the same columns are exported for the current filter.
5. Given an org without the `csvImport` entitlement, when the page renders, then "Import CSV" is hidden and the API returns 403 `entitlement`.

**Technical notes:** Replace `components/ImportCSVModal.tsx` (B deletes; new `pages/org/people/ImportPeopleDialog.tsx`). Parser in `utils/csvPeople.ts` (C) with unit tests.

#### PPL-05 · My Plan (squad member)
**Story:** As a PMO squad member, I want to see my bookings for QBR1–4 and what I'm being proposed for, so that I can accept or flag them and keep my crafts current.
**Priority:** Must · **Size:** M · **Package:** B, C · **Depends on:** DM-03, PPL-06, AC-04

**Acceptance criteria**
1. Given a signed-in user linked to a person (`linkedPersonId` in `/me`), when they open `/o/:org/w/:ws/me`, then they see: KPI tiles (my load QBR1…QBR4 vs target with BandPill), "Proposed to you" list (tentative bookings with project, craft, %, quarter/dates, proposed by, Accept / Decline), "My bookings" table, and "My crafts" card.
2. Given a proposal, when I click "Accept", then `POST /allocations/:id/respond { decision: "accept" }` sets state Confirmed and records `responded_at`; "Decline" opens a dialog with an optional reason and sets state Declined; both update the bell count.
3. Given "My crafts", when I click "Suggest changes" and edit my below-the-table crafts, then a craft change request is submitted (PPL-06) and the card shows "Pending approval by {chapter lead or 'a Planner'}".
4. Given a user not linked to a person, when they open My Plan, then an EmptyState says "Your login isn't linked to a person in this workspace. Ask a Planner to link you." 
5. Given "Offer my capacity", when I set a % for a quarter with an optional note, then it appears in the Marketplace catalogue (DM-05).

#### PPL-06 · Craft-change approval
**Story:** As a chapter lead, I want squad members' craft changes to come to me for approval, so that profiles stay credible while members keep them current.
**Priority:** Must · **Size:** S · **Package:** A (API), B, C · **Depends on:** ORG-01

**Acceptance criteria**
1. Given a CONTRIBUTOR linked to person P, when they `POST /people/P/craft-requests { secondaryCrafts }`, then 201 creates a `craft_change_requests` row (status `pending`); for any other person, 403; changing the above-the-table craft or target is not allowed (400).
2. Given a Planner, when they open People, then a Banner "3 craft changes waiting for approval" links to a "Requests" tab listing person, current vs proposed crafts (diff), submitted at; requests for chapters they lead are listed first and labelled "Your chapter".
3. Given "Approve", when clicked, then the person's crafts update (version-checked), the request becomes `approved` with approver and time, and an audit event `craft.approve` is written; "Reject" requires a reason.
4. Given the person later opens My Plan, when shown, then the outcome appears ("Approved by {name}" or "Rejected: {reason}").

#### PPL-07 · Projects page and project drawer
**Story:** As a PMO lead, I want a Projects table with a drawer showing demand, staffing and links, so that one place replaces the By Project view and Manage Projects.
**Priority:** Must · **Size:** M · **Package:** B, C · **Depends on:** DS-04, DM-01

**Acceptance criteria**
1. Given `/org/projects`, when opened, then a DataTable lists Name, Jira key, Tribe, Stage (StatusPill neutral), Status, Start–End, Demand QBR1 (FTE), Staffed QBR1 (FTE), Gap QBR1, Owner, Provenance (Manual/Planview); projects carry **no colour**.
2. Given a project row, when opened (`?project=<id>`, 720 px drawer), then tabs "Details" (edit name, tribe picker, stage, status, priority, dates, initiated on, owner, description, Jira key), "Demand" (quarter × craft grid for this project, DM-02 component), "Staffing" (people booked per quarter with state), "Delivery" (Jira signal JI-06), "Links" (Planview id, Jira project).
3. Given a Planview-sourced project and the org rule "Planview owns project existence and dates", when a Planner edits its dates, then the date fields are read-only with the hint "Managed in Planview".
4. Given "Add project", when saved without a tribe, then 400 `fields.tribeId = "Choose a tribe"`.

---

### E08 · Allocation grid (AL)

#### AL-01 · Quarter-first allocation grid
**Story:** As the PMO lead, I want to plan people across QBR1–4 in one grid grouped by team, chapter or tribe, so that I can rebalance the squad quarter by quarter.
**Priority:** Must · **Size:** L · **Package:** B (grid UI), C (`buildAllocationGrid`) · **Depends on:** DS-04, PL-06 · **PO:** EP-07

**Acceptance criteria**
1. Given `/o/:org/w/:ws/plan/allocations`, when opened, then rows are people (grouped per "Group by": Team / Chapter / Tribe / None), each expandable to project sub-rows; columns are QBR1, QBR2, QBR3, QBR4 (header shows "QBR1 · Q4 2026"); the person row shows total load % with BandPill tint; sub-rows show % per quarter with a CraftChip.
2. Given the grid, when scrolling, then the header row and the first (name) column are sticky, and only the grid card scrolls horizontally.
3. Given a booking that covers part of a quarter, when shown, then the cell shows the effective quarter % (overlap-weighted, from `allocationPctInQuarter`) with a `CalendarRange` icon and tooltip "Partial quarter: 1 Nov – 31 Dec at 50%".
4. Given the filter "Show tentative", when off, then tentative bookings are excluded from cells and totals; when on (default), tentative cells use a dashed outline and the legend explains it.
5. Given the same person and quarter, when I compare the grid's total with People (PPL-01) and Capacity Outlook (RP-02) for QBR1, then all three show the same number (I same-number test).
6. Given 200 people × 100 projects × 2,000 allocations, when the page renders, then first paint ≤ 2 s and scrolling is virtualised.

#### AL-02 · Inline editing with craft selector and keyboard navigation
**Story:** As the PMO lead, I want to type percentages straight into the grid and move with the keyboard, so that rebalancing an over-allocated person takes a few keystrokes.
**Priority:** Must · **Size:** L · **Package:** B, C (`setQuarterCell`) · **Depends on:** AL-01, PL-04

**Acceptance criteria**
1. Given a Planner focuses a project sub-row cell, when they type a number and press Enter or Tab, then `setQuarterCell` computes the operations (create, update or split the underlying allocation so only that quarter changes, clipped to the project window) and sends them as one batch; the cell, row total and band update optimistically and roll back with an error toast on failure.
2. Given arrow keys, when pressed on a focused cell, then focus moves between cells; Enter starts editing; Escape cancels; Tab moves right; Shift+Tab left; the grid uses `role="grid"` with `aria-rowindex`/`aria-colindex`.
3. Given "Add booking" on a person row, when chosen, then a combobox picks a project and a craft (default: their above-the-table craft; below-the-table crafts listed with ·L; other crafts listed under "Undeclared") and a quarter, creating a sub-row.
4. Given a value over the person's free capacity, when entered, then it is accepted, the total turns "Over capacity" and an inline warning icon with tooltip "Takes {name} to {n}% in QBR2" appears; values outside 0–200 are rejected with "Enter 0–200".
5. Given entering 0 in a cell, when committed, then that quarter's portion of the booking is removed (other quarters untouched).
6. Given the scenario: Noma Odigie is at 115 % in QBR1, when the PMO lead reduces her Phoenix booking from 35 % to 15 % in QBR1 and adds 20 % for another SM in QBR1, then each change takes ≤ 3 keystrokes/clicks per cell and both people show "On target" (acceptance demo script).

#### AL-03 · Copy forward and undo
**Story:** As the PMO lead, I want to copy a booking to later quarters and undo mistakes, so that planning four quarters is fast and safe.
**Priority:** Must · **Size:** S · **Package:** B, C (`copyForward`, undo) · **Depends on:** AL-02, PL-06

**Acceptance criteria**
1. Given a cell's menu (or Ctrl/⌘+Shift+→), when I choose "Copy to later quarters", then the % is applied to every later quarter in the window (clipped to project dates) in one batch, with toast "Copied to QBR2–QBR4" and Undo.
2. Given any grid edit or bulk action, when I press Ctrl/⌘ Z (focus in the grid) or click Undo, then the previous state is restored with one batch.

#### AL-04 · Project-centric pivot
**Story:** As a tribe lead, I want to see the grid by project with who is on it per quarter, so that I can check staffing for my projects.
**Priority:** Must · **Size:** S · **Package:** B, C · **Depends on:** AL-01

**Acceptance criteria**
1. Given the SegmentedControl "By person | By project", when "By project" is chosen (`?pivot=project`), then rows are projects (grouped by tribe) with people sub-rows, each quarter cell showing FTE (sum % ÷ 100) and, on the project row, "Staffed / Demand" FTE with a gap indicator.
2. Given a Viewer, when using the pivot, then cells are read-only.

#### AL-05 · Provenance, Planview lock and tentative/confirmed state
**Story:** As a PMO analyst, I want to see where each booking came from and whether it's confirmed, so that imported and proposed bookings are handled correctly.
**Priority:** Must · **Size:** S · **Package:** B, C, A (lock enforcement) · **Depends on:** AL-01, ST-03, DM-03

**Acceptance criteria**
1. Given a booking, when displayed in the grid, drawer or bookings list, then a ProvenanceTag shows Manual, Marketplace, Jira or Planview (icon + text).
2. Given the org rule "Planview bookings are locked" (ST-03), when a Planner edits a Planview-sourced cell, then the cell is read-only with tooltip "Imported from Planview. Change it in Planview or ask a PMO Admin to allow overrides.", and the API rejects the change with 409 `{ code: "conflict", error: "Locked: sourced from Planview" }`; with the rule "Overridable", the edit is allowed and the booking's source becomes `manual` with `external_ref` kept.
3. Given a tentative booking, when a Planner opens its menu, then "Confirm" and "Decline" are available (planner override), audited.

#### AL-06 · Date-precise booking editor
**Story:** As a Planner, I want to set exact start and end dates on a booking when a quarter isn't precise enough, so that mid-quarter starts are planned correctly.
**Priority:** Must · **Size:** S · **Package:** B, C · **Depends on:** DS-03

**Acceptance criteria**
1. Given "Edit dates" on a booking, when the dialog opens, then it shows person, project, craft, %, start date, end date, notes, state, with the project window shown as a hint ("Project runs 2 Nov 2026 – 30 Apr 2027").
2. Given an end date before the start date, when saving, then "End date must be on or after the start date"; dates outside the project window are allowed with the warning "Outside the project dates. It will only count while the project runs."
3. Given multiple slices for the same person/project (e.g. 30 % Oct–Dec, 50 % Jan–Mar), when edited, then the dialog lists slices with add/remove, and saves them in one batch.

**Technical notes:** Replaces `components/AllocationModal.tsx`.

#### AL-07 · Paste a range from Excel
**Priority:** **Should** · **Size:** M · **Package:** B, C
**Story:** As the PMO lead, I want to paste a block of percentages from Excel into the grid, so that I can move an offline plan in.
**Acceptance criteria:** (1) Selecting a cell and pasting tab-separated rows × columns fills the corresponding cells downward/rightward in one batch, skipping read-only cells and reporting "{n} cells updated, {m} skipped". (2) Non-numeric cells abort with a preview of errors.
**Rationale for Should:** PO descope order puts paste-range ahead of core rebalancing; keyboard editing and copy-forward cover the main job.

#### AL-08 · Drag-and-drop rebalancing
**Priority:** **Could** · **Package:** B · **PO:** EP-20 — drag a booking from one person to another in a quarter. Deferred: keyboard-first editing already meets the 3-step target; DnD needs extra accessibility work.

---

### E09 · Demand and Marketplace v2 (DM)

#### DM-01 · Demand lines as entities
**Story:** As a PMO lead, I want each craft demand to be its own record with status and owner, so that I can tell forecast from confirmed need and see who owns it.
**Priority:** Must · **Size:** M · **Package:** A (table, API, migration), C (store, domain) · **Depends on:** PL-04, ORG-01 · **PO:** EP-08

**Acceptance criteria**
1. Given migration `0005`, when applied, then `demand_lines(id, org_id, workspace_id, project_id, quarter_key, craft_id, fte, status, owner_user_id, note, version, created_at, updated_at, updated_by)` exists, and each element of every `projects.craft_demand` JSON becomes a row (`status` = "Confirmed" when the project stage is In Flight or Mobilising, else "Forecast"); re-running creates no duplicates (unique `(project_id, quarter_key, craft_id)`).
2. Given `POST/PATCH/DELETE /api/v2/workspaces/:wsId/demand[/:id]` and `POST /demand/batch`, when called by a Planner with valid data (`quarterKey` matches `^\d{4}-Q[1-4]$`, `fte` 0–50, craft exists and is not archived), then it persists, dual-writes `projects.craft_demand`, and is versioned; a Viewer gets 403.
3. Given the snapshot, when loaded, then `demand` contains the lines and `craftBalance`/`demandLines` in `utils/craftEngine.ts` consume them (not `project.craftDemand`).

#### DM-02 · Demand page
**Story:** As a PMO lead, I want a project × quarter demand grid with status, owner and supply vs demand by craft, so that I can see the gap for QBR1–4 and capture new projects' needs on initiation.
**Priority:** Must · **Size:** M · **Package:** B, C (`buildDemandGrid`) · **Depends on:** DM-01, DS-04

**Acceptance criteria**
1. Given `/plan/demand`, when opened, then tab "By project" shows projects (grouped by tribe, filter by stage) × QBR1–4, each cell listing craft lines as `PM 1.0` chips with status (solid = Confirmed, dashed = Forecast) and a staffed/gap indicator; tab "By craft" shows Supply, Committed, Demand, Gap, Bench, Below-the-table reach per craft per quarter (from `craftBalance`).
2. Given a Planner clicks a cell, when the popover opens, then they can add/edit/remove craft lines (craft picker, FTE NumberField step 0.1, status SegmentedControl "Forecast | Confirmed", owner combobox, note) and "Copy to later quarters".
3. Given a project in stage Initiated or Mobilising with no demand for QBR1–2, when listed, then a warning chip "No demand captured" appears, and the page header shows "Initiated projects without demand: {n}" linking to a filtered view.
4. Given "Intake queue" (EP-13), when not built, then it is absent (no placeholder).
5. Given the "By craft" gap for a craft in a quarter, when I click it, then I go to Marketplace filtered to that craft and quarter.

#### DM-03 · Marketplace: propose → tentative → accept
**Story:** As the PMO lead, I want proposing a person to create a tentative booking that the person and project owner are told about and can accept, so that staffing is agreed rather than imposed.
**Priority:** Must · **Size:** M · **Package:** A (API, email), B (page), C (domain) · **Depends on:** DM-01, PL-04, HS-07

**Acceptance criteria**
1. Given `/plan/marketplace`, when opened, then the left panel lists open demand (unstaffed FTE > 0) per quarter with project, tribe, craft, FTE gap, and ranked matches from `suggestMatches` showing score reasons ("Above the table", "L3 below the table", "{n}% free", "Knows the tribe").
2. Given a Planner clicks "Propose" on a match, when the confirm dialog ("Propose {name} at {pct}% on {project} for {quarter} as {craft}?") is accepted, then `POST /api/v2/workspaces/:wsId/marketplace/propose` creates an allocation with `state: "tentative"`, `source: "marketplace"`, `demand_line_id`, `proposed_at`, `proposed_by`, and returns 201; no native `confirm()` is used.
3. Given the proposal is created and Resend is configured, when it completes, then the linked user of the person and the project owner each get an email "You've been proposed for {project}" with a link to My Plan / the project, and the bell count increases for them.
4. Given the person accepts (PPL-05) or a Planner confirms (AL-05#AC3), when done, then the booking state is Confirmed, `responded_at` is set, and "time to staff" (`responded_at − demand line created_at` or `proposed_at`) is stored and shown in Reports (RP-04).
5. Given tentative bookings, when computing open demand, then they count as "Proposed" (shown separately) and are not double-proposed; the line shows "0.5 FTE proposed, 0.5 FTE open".
6. Given a Contributor or Viewer, when on Marketplace, then "Propose" is not shown.

#### DM-04 · Squad catalogue for tribe leads
**Story:** As a tribe lead with the Viewer role, I want to see what the PMO squad can offer my tribe this quarter by craft, so that I know what help is available without a hiring case.
**Priority:** Must · **Size:** S · **Package:** B, C (`buildCatalogue`) · **Depends on:** DM-01

**Acceptance criteria**
1. Given a Viewer opens `/plan/marketplace`, when the page renders, then they see only the "What the squad can offer" catalogue: per craft, free FTE above the table, reach below the table, people offering (name, via above/below, proficiency, free %, offer note), filtered by quarter (QBR1 default); no edit or propose controls.
2. Given the catalogue, when "Copy link" is clicked, then a deep link `/o/:org/w/:ws/plan/marketplace?view=catalogue&quarter=2027-Q1` is copied, which opens the same view for any workspace member.
3. Given "Export CSV", when clicked, then the catalogue table exports.

#### DM-05 · Under-target list and "Offer to marketplace"
**Story:** As the PMO lead, I want a list of people under target with one click to offer their spare capacity, so that nobody sits on the bench unnoticed.
**Priority:** Must · **Size:** S · **Package:** A (`marketplace_offers`), B, C · **Depends on:** DM-04

**Acceptance criteria**
1. Given Marketplace (Planner view), when the "Under target" tab is opened, then it lists people whose band is Under target or Available for the selected quarter, with free %, crafts and "Offer to marketplace".
2. Given "Offer to marketplace", when confirmed with %, crafts (default: all their crafts) and note, then `PUT /api/v2/workspaces/:wsId/offers/:personId/:quarterKey` stores it and the person appears highlighted in the catalogue with "Offered"; "Withdraw offer" deletes it.
3. Given a Contributor, when using "Offer my capacity" (PPL-05#AC5), then the same API accepts it only for their linked person (403 otherwise).

### E10 · Jira sync v2 (JI)

#### JI-01 · Scheduled, chunked Jira sync into delivery snapshots
**Story:** As a PMO analyst, I want Jira story points pulled daily (and on demand) into stored snapshots, so that per-tribe, per-quarter and per-sprint numbers are available without a manual pull and build a trend.
**Priority:** Must · **Size:** L · **Package:** A · **Depends on:** PL-01, PL-02, HS-08, HS-09 · **PO:** EP-09

**Acceptance criteria**
1. Given migration `0006`, when applied, then tables exist: `sync_jobs(id, org_id, workspace_id, provider, trigger ('schedule'|'manual'), status ('queued'|'running'|'succeeded'|'failed'|'partial'), cursor JSONB, pages_done, issues_seen, error, rate_limited_until, started_at, finished_at, requested_by)` and `delivery_snapshots(id, org_id, workspace_id, snapshot_date, jira_project_key, project_id, tribe_id, sprint_id, sprint_name, sprint_state, sprint_start, sprint_end, quarter_key, assignee_account_id, person_id, points_total, points_done, issues_total, issues_done, implied_fte)` with a unique key on `(workspace_id, snapshot_date, jira_project_key, coalesce(sprint_id,''), coalesce(assignee_account_id,''))`.
2. Given a published deploy, when the scheduled function `jira-sync-scheduler` runs at 05:00 UTC daily, then it enqueues one `schedule` job per workspace with a configured Jira connection and `features.jiraScheduledSync = true`; the worker `jira-sync-worker` (every 10 minutes) advances queued/running jobs.
3. Given a job step, when it runs, then it processes Jira pages until 7 s have elapsed, upserts snapshot rows idempotently, saves the cursor and returns; the next step continues from the cursor; a job finishes `succeeded` when all configured projects are paged.
4. Given a Planner clicks "Sync now", when `POST /api/v2/workspaces/:wsId/sync/jira` returns 202 `{ job }`, then the client calls `POST …/sync/jobs/:jobId/step` repeatedly (each ≤ 8 s) while the page is open, showing progress "{pagesDone} pages · {issuesSeen} issues"; if the tab closes, the worker finishes it. A second "Sync now" while a job runs returns the running job (no duplicate).
5. Given Jira returns 429, when it happens, then the job stores `rate_limited_until` from `Retry-After`, status stays `running`, and the next step waits; given 401/403 from Jira, the job fails with "Jira rejected the credentials" and the sync health shows it.
6. Given the snapshot, when computed, then `implied_fte = points_done ÷ (calibration.pointsPerSprintPerFte × sprints in range)` using the tribe calibration (JI-04) of the mapped project.

**Technical notes:** Netlify scheduled functions: `netlify/functions/jira-sync-scheduler.ts` and `jira-sync-worker.ts` with `export const config = { schedule: '0 5 * * *' }` / `'*/10 * * * *'`. Shared step logic in `_lib/jira/sync.ts`; pure aggregation in `_lib/jira/aggregate.ts` (JI-08). Scheduled functions do not run on previews (A-11).

#### JI-02 · Jira project ↔ planner project and tribe mapping
**Story:** As a PMO analyst, I want to map Jira projects and boards to planner projects and tribes with auto-match and bulk confirm, so that story points land on the right project and tribe.
**Priority:** Must · **Size:** M · **Package:** A (API), B (UI), C · **Depends on:** JI-01, ORG-01

**Acceptance criteria**
1. Given `/delivery/jira-planview` tab "Mapping", when opened by a Planner, then a DataTable lists each Jira project (key, name, boards) with columns Planner project (combobox), Tribe (combobox, defaulting to the project's tribe), Match (Exact key / Name / Manual / None), Confirmed (checkbox).
2. Given "Auto-match", when clicked, then `POST …/integrations/jira/mappings/auto-match` proposes matches: planner `project.jiraKey` equal to the Jira key first, then case-insensitive name equality, then none; proposals are unconfirmed and highlighted.
3. Given selected rows, when "Confirm selected" is clicked, then `PUT …/jira/mappings/projects` saves them in one call; unconfirmed mappings are ignored by sync aggregation.
4. Given existing `settings.mappings.jira` JSON from v1.1, when migrated, then it becomes confirmed rows in `integration_mappings(workspace_id, provider, external_key, project_id, tribe_id, match_method, confirmed)`.

#### JI-03 · Assignee ↔ person identity mapping
**Story:** As a PMO analyst, I want Jira assignees linked to squad members by account id, so that the squad's own Jira work reconciles with their allocations even when emails are hidden.
**Priority:** Must · **Size:** S · **Package:** A, B · **Depends on:** JI-01, ORG-01

**Acceptance criteria**
1. Given `external_identities(id, org_id, workspace_id, person_id, provider ('jira'|'planview'), external_id, display_name, email, match_method ('accountId'|'email'|'name'|'manual'), confirmed)`, when a sync sees an assignee, then it matches by existing `external_id` (accountId) first, then email, then exact name, storing unconfirmed suggestions.
2. Given tab "People mapping", when opened, then assignees seen in the last 90 days are listed with suggested person, method, and a combobox to override; "Confirm all exact matches" confirms email/accountId matches in one call.
3. Given a manual override, when saved, then later syncs keep it (manual wins).

#### JI-04 · Per-tribe calibration with suggested value
**Story:** As a PMO analyst, I want each tribe's points-per-FTE calibrated from its real sprints, so that story points convert into honest FTE per tribe.
**Priority:** Must · **Size:** M · **Package:** A (calc, API), B (UI) · **Depends on:** JI-01, ORG-01

**Acceptance criteria**
1. Given `tribe_calibrations(workspace_id, tribe_id, points_per_sprint_per_fte, sprint_length_days, suggested_value, suggested_basis JSONB, note, version, updated_by, updated_at)`, when a sync completes, then for each tribe with ≥ 1 closed sprint in its mapped boards, `suggested_value` = Σ completed points of the last 3 closed sprints ÷ (3 × mapped FTE on those projects in those sprints), rounded to 0.5, with the basis stored (sprints, points, FTE).
2. Given `/delivery/jira-planview` tab "Calibration" (and the tribe page card), when opened, then each tribe shows Current value, Suggested value with "Based on sprints 41–43: 96 pts, 3.2 FTE", Sprint length, Last changed by/at, and "Use suggested" / "Edit"; editing requires a note ("Why are you changing this?") and writes audit `calibration.change`.
3. Given a tribe with no calibration, when aggregating, then the workspace default (10 points / 14 days / FTE) is used and the UI labels it "Default".
4. Given a tribe rename, when viewed, then calibration is unchanged (keyed by `tribe_id`).

#### JI-05 · Sprint and velocity view per tribe
**Story:** As a PMO analyst, I want committed vs done points and implied FTE per sprint for each tribe, so that I can see delivery trend.
**Priority:** Must · **Size:** S · **Package:** B, C, A (`GET …/delivery`) · **Depends on:** JI-01

**Acceptance criteria**
1. Given tab "Sprints", when a tribe is selected, then a table and a bar chart show, per sprint (last 6), points committed, points done, issues done, implied FTE, and planned FTE (from allocations to the mapped projects in the sprint dates).
2. Given `GET /api/v2/workspaces/:wsId/delivery?groupBy=sprint&tribeId=…&from=&to=`, when called, then it returns `DeliveryRowDTO[]` from snapshots only (no live Jira call).

#### JI-06 · Delivery signal in Capacity Outlook, Projects and Tribes
**Story:** As the PMO lead, I want planned vs Jira-implied FTE shown next to the plan, so that I can spot plans that don't match delivery.
**Priority:** Must · **Size:** S · **Package:** B, C · **Depends on:** JI-01, RP-02, ORG-05, PPL-07

**Acceptance criteria**
1. Given a mapped project, when its drawer "Delivery" tab opens, then it shows planned FTE vs implied FTE for QBR1 and the last 3 sprints, with the signal "Jira shows more effort than planned" (implied > planned × 1.2), "Jira shows less effort than planned" (implied < planned × 0.8), or "In line".
2. Given Capacity Outlook pivoted by tribe, when the "Delivery signal" toggle is on, then a TrendLine shows planned vs implied FTE per tribe over the snapshot history (≥ 2 points), labelled "Signal, not a timesheet".
3. Given no snapshots, when shown, then "Connect Jira and run a sync to see delivery." with a link to Delivery (Planner) or nothing (Viewer).

#### JI-07 · Sync health
**Story:** As a PMO analyst, I want to see when the last sync ran and why it failed, so that I trust the numbers or fix the connection.
**Priority:** Must · **Size:** S · **Package:** A (`GET …/sync/health`), B · **Depends on:** JI-01

**Acceptance criteria**
1. Given `/delivery/jira-planview` tab "Health", when opened, then it shows last successful sync time, last run status (StatusPill: Succeeded / Failed / Partial / Running / Rate limited), duration, pages, issues, the last 10 jobs, and error text for failures.
2. Given the last scheduled run failed, when the PMO lead opens Home, then a warning card "Jira sync failed {time}: {reason}" appears within one run (RP-01#AC4).
3. Given no successful sync in 48 h, when shown, then the status is "Stale" (warning).

#### JI-08 · Portable Jira aggregation module
**Story:** As a developer preparing Release 3.0, I want Jira field detection and aggregation as pure TypeScript, so that a Forge resolver can reuse it unchanged.
**Priority:** Must · **Size:** S · **Package:** A · **Depends on:** — · **PO:** §5 "pure domain core"

**Acceptance criteria**
1. Given `netlify/functions/_lib/jira/aggregate.ts` and `fields.ts`, when checked by `scripts/check-pure.mjs`, then they import nothing from Node built-ins, `@netlify/*`, `@neondatabase/*` or `fetch` (they take parsed JSON and return data).
2. Given the existing `tests/backend/integrations.test.ts` aggregation cases, when moved to `tests/backend/jira.aggregate.test.ts`, then they pass against the new module.

#### JI-09 · Jira OAuth 2.0 (3LO)
**Priority:** **Should** · **Size:** M · **Package:** A, B · **PO:** EP-18
**Story:** As a PMO Admin, I want to connect Jira with OAuth instead of a personal API token, so that the connection doesn't depend on one person's token.
**Acceptance criteria:** (1) "Connect with Atlassian" runs the 3LO flow with scopes `read:jira-work read:jira-user read:board-scope:jira-software read:sprint:jira-software offline_access`; tokens stored encrypted (`v2:`); refresh handled in the sync worker. (2) API-token mode remains available.
**Rationale for Should:** needs an Atlassian developer app registered by the customer; Release 3.0 Forge auth supersedes it.

---

### E11 · Planview sync v2 (PV)

#### PV-01 · Preview diff before apply; idempotent import
**Story:** As a PMO analyst, I want to see exactly what a Planview import will change before applying it, so that re-imports never duplicate or overwrite manual bookings.
**Priority:** Must · **Size:** M · **Package:** A (preview/apply), B (review screen), C · **Depends on:** HS-08, PV-03, AL-05 · **PO:** EP-10

**Acceptance criteria**
1. Given a configured Planview connection, when a Planner clicks "Preview import", then `POST …/planview/preview` returns (within 8 s, paging capped; "Partial preview: narrow the date range" otherwise) `{ previewId, projects: { new, changed, removed }, assignments: { new, changed, removed, unmatchedPeople } }` stored for 30 minutes.
2. Given the review screen, when shown, then each section is a DataTable with checkboxes (all selected by default except "removed"), field-level diffs for changed rows ("End date 30 Apr → 31 May"), and unmatched people with a person combobox.
3. Given "Apply {n} changes", when clicked, then `POST …/planview/apply { previewId, accept }` applies in one transaction: projects matched by `planview_id` (create or update name/dates/status only, never craft demand); allocations matched by `external_ref` (Planview assignment id) and created/updated with `source: "planview"`; manual or marketplace bookings are never modified; returns `{ created, updated, skipped }` and audit `integration.import`.
4. Given the same Planview data imported twice, when the second preview runs, then it reports 0 new, 0 changed.
5. Given an expired `previewId`, when apply is called, then 409 "This preview expired. Run it again."

#### PV-02 · Field-map editor with sample test
**Story:** As a PMO Admin, I want to map Planview fields with a live sample, so that the generic adapter works with our real Planview product.
**Priority:** Must · **Size:** S · **Package:** A, B · **Depends on:** HS-08

**Acceptance criteria**
1. Given Settings › Integrations › Planview (generic adapter), when opened, then a form lists the target fields (project id, name, status, start, end, manager; assignment id, project id, person name, email, role, start, end, percent, hours) each with a dotted-path input.
2. Given "Test with sample record", when clicked, then `POST …/planview/test-mapping` fetches one project and one assignment and shows source JSON (secrets redacted) beside the mapped values, flagging missing required fields in red text with an icon.

#### PV-03 · Persisted Planview mappings
**Story:** As a PMO analyst, I want my person and project matches for Planview remembered, so that I don't redo them every import.
**Priority:** Must · **Size:** S · **Package:** A · **Depends on:** JI-03 (same tables)

**Acceptance criteria**
1. Given a manual person match chosen in preview, when applied, then an `external_identities` row (`provider: 'planview'`, `match_method: 'manual'`, confirmed) is stored and used by the next preview.
2. Given v1.1 `settings.mappings.planview` JSON, when migrated, then it becomes `integration_mappings`/`external_identities` rows.

#### PV-04 · Scheduled Planview import
**Priority:** **Should** · **Size:** S · **Package:** A · **PO:** EP-10 (behind flag)
**Acceptance criteria:** With `features.planviewScheduledImport = true`, a nightly job previews and auto-applies only "new" and "changed" items (never "removed"), recording a sync job and audit; failures show in sync health.
**Rationale for Should:** PO descope order puts it first; it must be validated on the customer's Planview instance (D-2) before enabling.

---

### E12 · Home, Capacity Outlook and reporting (RP)

#### RP-01 · Home
**Story:** As the PMO lead, I want one overview of squad utilisation, unstaffed demand, outliers, sync health and pending approvals, so that I start each day knowing what needs attention.
**Priority:** Must · **Size:** M · **Package:** B, C (`buildHome`) · **Depends on:** RP-03, DS-05 · **PO:** EP-11

**Acceptance criteria**
1. Given `/home`, when opened, then a row of 4 KPI tiles shows: "Squad utilisation" (QBR1 Σload ÷ Σtarget, band, delta vs QBR2 shown as "QBR2: 84%"), "Unstaffed demand" (QBR1 FTE), "Over capacity" (people count QBR1), "Available" (people count QBR1, bench band); each caption reads "QBR1 · Q4 2026" (or the chosen basis).
2. Given the KPI grid, when the window is 1024–1440 px, then tiles are 4 per row (2 × 2 below 1024 px), never leaving an orphan tile.
3. Given the body, when shown, then: the four-quarter StackedCapacityChart (squad), "Over capacity" and "Available" lists (top 5 each with links to the person drawer), "Initiated projects without demand", and "Pending approvals" (craft changes and my proposals).
4. Given a failed or stale Jira sync, when Home loads, then a warning Banner at the top reads "Jira sync failed {relative time}: {reason}" with "View sync health".
5. Given a Viewer, when opening Home, then the same numbers render without edit links; given a Contributor, Home also links to My Plan.

#### RP-02 · Capacity Outlook
**Story:** As the PMO lead, I want four-quarter supply vs demand pivoted by craft, chapter, tribe or person, so that I can rebalance, hire or push back before the quarter starts.
**Priority:** Must · **Size:** M · **Package:** B, C (`buildCapacityOutlook`) · **Depends on:** RP-03, DS-05

**Acceptance criteria**
1. Given `/plan/capacity`, when opened, then a StackedCapacityChart shows per quarter: above-the-table, below-the-table, undeclared, free (bench hatch) as FTE, demand as a marker, target as a dashed line; with the Chart/Table toggle.
2. Given the "Pivot" SegmentedControl (Craft / Chapter / Tribe / Person) and filters (craft, chapter, tribe), when changed, then a DataTable below lists each group × QBR1–4 with supply, committed, demand, gap, utilisation % and band; the URL holds pivot and filters.
3. Given "Under target" and "Over capacity" side lists, when shown, then they respect the pivot filters and the selected quarter.
4. Given any number shown for a person and quarter, when compared with People and Allocations, then it is identical (RP-03#AC3).

#### RP-03 · Target-band semantics and the same-number guarantee
**Story:** As the PMO lead, I want 100 % to show as "On target" everywhere and all views to agree, so that I can report one trusted utilisation number.
**Priority:** Must · **Size:** M · **Package:** C · **Depends on:** WP-0 (`shared/utilisation.ts`) · **PO:** EP-02, EP-11

**Acceptance criteria**
1. Given `bandFor()` with default thresholds, when called with 49, 50, 89, 90, 100, 105, 106, then it returns bench, under, under, on-target, on-target, on-target, over (values rounded to the nearest integer first), and the labels are "Available", "Under target", "On target", "Over capacity".
2. Given the codebase, when grepped, then `getAllocationStatus`, `getStatusColor`, `AllocationStatus` (and `utilColor` in `App.tsx`) no longer exist; everything uses `bandFor`/`bandForLoad` and `BAND_LABEL`.
3. Given `tests/utils/sameNumber.test.ts`, when run against the demo data, then for every person and every basis (today, QBR1–4), `utilisationFor()` used by People, the allocation grid totals and the outlook person pivot return identical values; "today" uses the single `today()` from `utils/clock.ts`.
4. Given org thresholds changed in Settings › Planning (ST-03), when saved, then all bands in all views update after reload.

#### RP-04 · Reports: CSV exports and QBR pack
**Story:** As a PMO analyst, I want a QBR pack PDF and CSV exports in one place, so that preparing the QBR takes under an hour.
**Priority:** Must · **Size:** M · **Package:** C (`utils/pdfExport.ts` builder), B (Reports page) · **Depends on:** RP-02, DM-03, JI-06

**Acceptance criteria**
1. Given `/reports`, when opened, then cards offer "QBR pack (PDF)", "Utilisation by person (CSV)", "Utilisation by tribe / chapter / craft (CSV)", "Open demand (CSV)", "Bookings (CSV)", "Time to staff (CSV)", each with a short description and "Download".
2. Given "QBR pack", when generated for the 200 × 100 × 2,000 data set, then a PDF downloads within 60 s containing: cover ("PMO Capacity Planner · QBR pack · {Org} · {Workspace} · generated {date}"), squad utilisation QBR1–4 vs target, supply vs demand by craft, open demand, over/under lists, delivery signal by tribe (if Jira mapped), and time to staff (median, last 90 days); colours follow DESIGN_SYSTEM §11 (hex values from the PDF palette table).
3. Given the PDF generator, when the page loads, then `jspdf` is not loaded until "Download" is clicked (SH-08#AC2).
4. Given an export, when it completes, then an audit event `export.pdf` / `export.csv` is recorded (AC-10).

#### RP-05 · XLSX export
**Priority:** **Should** · **Size:** S · **Package:** C, B · **PO:** EP-11
**Acceptance criteria:** Every CSV in RP-04 is also available as `.xlsx` with one sheet per table and header styling; library loaded on demand.
**Rationale for Should:** PO descope order; CSV opens in Excel.

---

### E13 · Settings, admin and first run (ST)

#### ST-01 · Settings shell, organisation and workspace sections
**Story:** As an Org Admin, I want real settings for the organisation and workspace, so that I can run the tool without asking a developer.
**Priority:** Must · **Size:** M · **Package:** B, A (`PATCH /orgs/:id`, `/workspaces/:id`), C · **Depends on:** AC-04, DS-02 · **PO:** EP-12

**Acceptance criteria**
1. Given `/o/:org/w/:ws/settings/:section`, when opened, then a left sub-navigation lists the sections the user may see: Profile (all), Organisation, Members and roles, Structure, Crafts, Planning, Integrations, Features, Billing (public mode only), Audit log (Should; hidden until AU-01); sections without permission are absent.
2. Given "Organisation", when an Org Admin edits name, logo URL (https only) and workspace visibility (AC-09) and saves, then `PATCH /api/v2/orgs/:orgId` persists with version check; the org slug and existing URLs are unchanged.
3. Given "Workspace" (inside Organisation as a "Workspaces" table), when an Org Admin adds, renames or deletes a workspace, then it works (delete requires typing the workspace name in a ConfirmDialog; cascades in a transaction; audit `workspace.delete`).
4. Given "Profile", when any user opens it, then they can change name, password (current + new ≥ 10), 2FA (HS-14), and "Sign out of all devices" (AC-03#AC6).
5. Given the old `SettingsHub` "Workspace Details" and "Billing & Quotas" placeholder cards, when the story is done, then they are gone (`components/SettingsHub.tsx` deleted).

#### ST-02 · Members and roles
**Story:** As an Org Admin or PMO Admin, I want to invite people, change roles and remove members in one table, so that access matches people's jobs.
**Priority:** Must · **Size:** M · **Package:** B, C · **Depends on:** AC-05, AC-06

**Acceptance criteria**
1. Given `/settings/members`, when opened by an Org Admin, then a DataTable lists members: Name, Email, Org role, Workspace roles (one Select per workspace column or a "Roles" cell opening an editor), Linked person, Last sign-in, and pending invitations (with "Resend" and "Revoke").
2. Given "Invite people", when submitted with one or more emails, org role and workspace roles, then invitations are created; if email isn't configured, the dialog shows each invite link with "Copy link" and the note "Email isn't set up. Send this link yourself; it works once and expires in 7 days."
3. Given a PMO Admin (not Org Admin), when on the page, then they see only their workspace's members, can set roles up to PMO Admin, and cannot change org roles.
4. Given role labels, when displayed, then they are exactly "Org Admin", "PMO Admin", "Planner", "Squad member", "Viewer", with a help tooltip per role summarising its permissions.
5. Given "Remove", when confirmed, then the member loses access immediately (next request 401/403).

#### ST-03 · Planning settings: fiscal calendar, thresholds, sprint length, Planview rule
**Story:** As an Org Admin, I want to set our fiscal labels, utilisation thresholds, default sprint length and Planview ownership rule, so that the numbers match how we run the PMO.
**Priority:** Must · **Size:** S · **Package:** B, A, C · **Depends on:** ST-01

**Acceptance criteria**
1. Given `/settings/planning`, when an Org Admin opens it, then fields are: "Fiscal year starts in" (January, April, July, October; preview "QBR1 = FY27 Q1 (Oct–Dec 2026)"), "Utilisation bands" (Available below [50]%, On target from [90]% to [105]%; preview of the four bands with labels), "Default target utilisation" ([100]%), "Default sprint length" ([14] days), "Planview bookings" ("Locked: change them in Planview" / "Overridable by Planners").
2. Given invalid thresholds (e.g. on-target from 110 to 100), when saved, then 400 with `validateThresholds()` message "On-target range must start below where it ends, and above the Available threshold."
3. Given a saved fiscal start month, when any page shows quarter labels, then tooltips and the QBR pack use fiscal labels while keys stay calendar quarters (A-1).

#### ST-04 · Integrations settings (connections moved from the hub)
**Story:** As a PMO Admin, I want Jira and Planview connection setup in Settings and day-to-day sync in Delivery, so that admins configure and analysts operate.
**Priority:** Must · **Size:** M · **Package:** B, C · **Depends on:** HS-08, PV-02

**Acceptance criteria**
1. Given `/settings/integrations`, when opened by a PMO Admin, then cards "Jira Cloud" and "Planview (optional)" show status (Not connected / Connected / Error), fields (Jira: site, email, API token (write-only, shows "Saved" when `hasSecret`), project keys, boards; Planview: adapter, base URL, username, secret, field map) and "Test connection" with the detected story-point field shown.
2. Given Planview is not enabled, when the Delivery page renders, then no Planview tab or action appears (D-4).
3. Given a Planner, when opening `/settings/integrations`, then it is read-only with secrets hidden; Viewers and Contributors do not see the section.
4. Given `components/integrations/IntegrationsHub.tsx`, when the story and JI-02…JI-07 are done, then its content lives in `pages/delivery/**` and `pages/settings/integrations/**` and the file is deleted; tables no longer overflow at 1440 px.

#### ST-05 · Features settings (AI opt-in, sprint module)
**Story:** As an Org Admin, I want to switch optional features on or off, so that the AI assistant and legacy modules are only there when we choose.
**Priority:** Must · **Size:** S · **Package:** B, A · **Depends on:** SH-05, HS-11

**Acceptance criteria**
1. Given `/settings/features`, when opened by an Org Admin, then Switches exist for "AI assistant" (with the egress text from HS-11#AC2), "Sprint planning (legacy QBR module)", "Daily Jira sync", and (if PV-04/SC ship) "Scheduled Planview import", "Scenarios"; each save writes audit `org.feature_change`.
2. Given a non-admin, when navigating there, then the section is absent.

#### ST-06 · Billing (public mode only)
**Story:** As an Org Admin of a SaaS org, I want plan and billing in Settings, so that pricing doesn't clutter the planner.
**Priority:** Must · **Size:** S · **Package:** B · **Depends on:** PL-07, HS-06

**Acceptance criteria**
1. Given `APP_MODE=public`, when an Org Admin opens `/settings/billing`, then it shows current plan, limits and usage (people x/y, projects x/y, AI questions this month), and "Change plan" opening the restyled pricing table that starts Stripe Checkout.
2. Given `APP_MODE=internal`, when anyone navigates to `/settings/billing`, then 404 and no plan text appears anywhere in the UI.

#### ST-07 · Sign-in, reset, verification and invitation pages
**Story:** As an existing user, I want a clean, branded sign-in that works exactly as before, so that the upgrade feels professional and nothing breaks.
**Priority:** Must · **Size:** M · **Package:** B, C · **Depends on:** AC-03, AC-05, AC-07, DS-02 · **Findings:** SEC-01 (client part)

**Acceptance criteria**
1. Given `/` or `/login` while signed out, when opened, then a centred card on `--color-bg` shows the PMO Capacity Planner wordmark, "Sign in to PMO Capacity Planner", Email, Password, "Sign in" (primary), "Forgot password?"; public mode also shows "Create account"; a one-line value proposition sits above the card ("Plan your PMO squad's crafts, demand and capacity across the next four quarters."). No hero planet, no gradient, no 56 px type.
2. Given a user with 2FA, when they sign in, then a "Enter the 6-digit code we emailed to {email}" step appears with a 6-box code input (auto-advance, paste supported), "Verify" and "Resend code" (disabled for 30 s).
3. Given the reset flow, when a code is requested, then the page always says "If an account exists for {email}, we've sent a code." and never displays a code (all "(Demo Mode) Code" branches removed from `components/Login.tsx`).
4. Given a signed-in user visiting `/` or `/login`, when it loads, then they are redirected to their last workspace Home (platform admins without an org to `/cockpit`).
5. Given first visit, when the app loads, then no tour starts automatically, and there is no voice narration anywhere.
6. Given `/invite/:token` and `/verify-email`, when opened, then they use the same card layout (AC-05#AC6, AC-07#AC3).

#### ST-08 · Create organisation flow
**Story:** As a newly verified user without an org (public mode), I want to create my organisation and first workspace in one short form, so that I can start planning.
**Priority:** Must · **Size:** S · **Package:** B, C · **Depends on:** AC-08, HS-10

**Acceptance criteria**
1. Given `/create`, when a verified user without an org opens it, then a card asks "Organisation name" and "First workspace name" (default "PMO"), with "Create"; on success they land on `/o/:slug/w/:ws/home` with an EmptyState offering "Add people", "Import CSV" and "Install sample data".
2. Given a user already in an org, when opening `/create`, then they are redirected to their workspace.

#### ST-09 · Platform admin cockpit
**Story:** As the product operator, I want the platform cockpit restyled and gated by the platform-admin flag, so that it is consistent and safe.
**Priority:** Must · **Size:** S · **Package:** B, A (`/api/v2/platform/*` or existing `audit.ts`/`auth.ts` admin routes behind `platform.admin`) · **Depends on:** AC-07

**Acceptance criteria**
1. Given `/cockpit`, when a non-platform-admin opens it, then 404; a platform admin sees orgs (name, plan, members, workspaces, last activity), platform stats and the platform audit view, built from `components/ui`.
2. Given "Open org", when used, then the org opens read-only unless a support grant exists (AC-12, if shipped) and each access is audited `support.access`.
3. Given `components/SuperuserCockpit.tsx` and `SuperAdminPanel.tsx`, when done, then they are replaced by `pages/admin/**` and deleted.

#### ST-10 · Demo mode on the new architecture
**Story:** As a prospective user or a tester, I want a demo workspace with sample data that needs no account, so that the product can be explored and tested without a backend.
**Priority:** Must · **Size:** S · **Package:** C (`DemoTransport`), B (route/banner) · **Depends on:** PL-05

**Acceptance criteria**
1. Given `/demo` (or `npm run dev:demo` with no backend), when opened, then the full shell renders `/demo/w/demo/home` with the demo data from `constants.ts`, all pages work, and edits persist only in this browser.
2. Given demo mode, when any page renders, then a Banner reads "Demo workspace. Changes stay in this browser. Sign in to use your organisation's data." with "Sign in".
3. Given `APP_MODE=internal`, when `/demo` is opened, then it is available only if `VITE_ENABLE_DEMO=true` (default false), else 404.

---

### E14 · Server-side scenarios (SC) · Should

#### SC-01 · Named scenarios stored server-side
**Priority:** Should · **Size:** L · **Package:** A, C · **PO:** EP-14
**Story:** As the PMO lead, I want named what-if scenarios stored on the server, so that I can prepare a rebalance, share it and apply it later.
**Acceptance criteria:** (1) Tables `scenarios(id, workspace_id, name, description, base_data_version, created_by, …)` and `scenario_ops(scenario_id, seq, op JSONB)`; API `GET/POST/PATCH/DELETE /api/v2/workspaces/:wsId/scenarios`, `POST …/scenarios/:id/ops`, `POST …/scenarios/:id/apply` (WORKSPACE_ADMIN; applies ops as one allocation batch; 409 if any target row changed since the base version, listing conflicts), `…/discard`. (2) Entitlement `scenarios` enforced server-side.
**Rationale for Should:** PO EP-14 Should; A-9 removes the localStorage What-If instead of shipping it broken.

#### SC-02 · Scenario context in the top bar with compare view
**Priority:** Should · **Size:** M · **Package:** B, C
**Acceptance criteria:** (1) Top bar "Live ▾" switches to a scenario; a page Banner reads "Viewing scenario '{name}'. Changes are not live." with one "Apply" and one "Discard". (2) Allocations and Capacity Outlook show delta vs live per person/quarter (+/− pills). (3) Leaving the scenario or reloading keeps the context only via the URL `?scenario=<id>`.

### E15 · Notifications (NT) · Should

#### NT-01 · In-app notification inbox
**Priority:** Should · **Size:** M · **Package:** A, B, C · **PO:** EP-15
**Acceptance criteria:** (1) `notifications(id, user_id, workspace_id, type, payload, read_at, created_at)`; events: proposal created/accepted/declined, craft change submitted/decided, person over capacity after an edit, sync failed. (2) Bell opens a popover list with "Mark all as read"; unread count badge.
**Rationale for Should:** 2.0 Must already covers proposals (bell count + email) and approvals (banner); a general inbox is additive.

#### NT-02 · Email digest
**Priority:** Should · **Size:** S · **Package:** A · **Acceptance criteria:** Weekly Monday 07:00 UTC digest per user (opt-out in Profile) summarising pending items; scheduled function; skipped when Resend is not configured.

### E16 · Audit trail UI (AU) · Should

#### AU-01 · Audit log in Settings
**Priority:** Should · **Size:** S · **Package:** B, C · **Findings:** UAM-05 (viewer) · **PO:** EP-16
**Acceptance criteria:** `/settings/audit` lists events (time, actor, action, target, workspace) with filters (date range, actor, action, workspace), the before/after diff in a drawer, and "Export CSV" (AC-10#AC4 API). Org Admin sees org events; PMO Admin their workspace.
**Rationale for Should:** events are captured from day one (AC-10, Must); the viewer can follow.

### E17 · Onboarding and help (OB) · Should

#### OB-01 · First-run setup checklist
**Priority:** Should · **Size:** M · **Package:** B, C · **PO:** EP-17
**Acceptance criteria:** A dismissible Home card "Set up your workspace" with steps and completion ticks: Add tribes, Add people (or import CSV), Review crafts, Capture demand for initiated projects, Connect Jira; each links to the page.

#### OB-02 · Glossary and contextual help
**Priority:** Should · **Size:** S · **Package:** B · **Acceptance criteria:** Help › Glossary drawer defines Above/below the table, Craft, Proficiency L1–L3, FTE, QBR1–4, Utilisation bands, Calibration, Delivery signal, Tentative/Confirmed; `?` tooltips on KPI tiles link to the entry.

### E18 · Demand intake and tribe requests (IN) · Should

#### IN-01 · Request PMO help (tribe lead)
**Priority:** Should · **Size:** M · **Package:** A, B, C · **PO:** EP-13
**Story:** As a tribe lead, I want to request "0.5 FTE Change in QBR2" with or without a project, so that I get cover without a hiring case.
**Acceptance criteria:** (1) New permission `request.create` granted to VIEWER and CONTRIBUTOR (change recorded in `shared/permissions.ts` and the matrix test). (2) Form: tribe, project (optional), craft, quarter(s), FTE, why; creates a request in status Submitted visible to Planners. (3) Request lifecycle Draft → Submitted → Approved/Rejected → Staffed; approval creates a demand line (Confirmed).
**Rationale for Should:** PO EP-13 Should; first increment of roadmap item 5.

#### IN-02 · Intake queue with SLA
**Priority:** Should · **Size:** S · **Package:** B, C · **Acceptance criteria:** Demand page tab "Intake" lists requests with age in working days, highlighting > 5 days; approve/reject with reason.

### E19 · Extensions (XT) · Could

| ID | Title | Priority | PO | Note |
|---|---|---|---|---|
| XT-01 | Dark theme via token swap (user menu "Theme: Light / Dark / System") | Could | EP-19 | Tokens for dark already defined in DESIGN_SYSTEM §2.5; needs a full visual pass. |
| XT-02 | Drag-and-drop rebalancing (= AL-08) | Could | EP-20 | Keyboard editing covers the need. |
| XT-03 | Actuals: person confirms quarter split; seed from Jira worklogs | Could | EP-22 | Needs JI snapshots history first. |
| XT-04 | Unify QBR sprint module with core people/projects | Could | EP-21 | Findings ARC-07; module is flagged off in 2.0. |
| XT-05 | Enterprise SSO (SAML/OIDC) for SaaS edition | Could | EP-23 | Forge edition uses Atlassian identity. |

Won't (2.0 and 3.0 per PO): mobile editing (EP-25), Slack/Teams and Confluence macro (EP-27).

---

## 4. Build plan for the dev agents

### 4.1 Packages, sequence and file ownership

```
WP-0 Contracts & scaffold (one agent, first, ~half a day)
        │
        ├──► A  Backend security, access control, data API, sync      ┐
        ├──► B  Design system, shell, routing, all pages              ├─ in parallel, disjoint files
        └──► C  Domain, data layer, client state, view-models         ┘
                                   │
                                   ▼
                    I  Integration, e2e, docs, release rehearsal
```

**Ownership rule.** A file or directory belongs to exactly one package. A package never edits another package's files; if it needs a change there, it writes the request in its hand-off note (`docs/release/handoff-<pkg>.md`) and **I** applies it. Contracts in `shared/**` are frozen after WP-0; a contract change is an I-approved change request that updates this section.

| Path | WP-0 | A | B | C | I |
|---|---|---|---|---|---|
| `shared/**` (contracts, permissions, entitlements, features, utilisation) | **creates** | read | read | read | change requests only |
| `package.json`, `package-lock.json`, `tsconfig*.json`, `eslint.config.js`, `.prettierrc`, `jest.config.ts`, `playwright.config.ts` | **creates** | read | read | read | owns after WP-0 |
| Deleting dead code: `server/`, `Claude files /`, root `test-*`, `fix_qbr.js`, `render.yaml`, `vercel.json`, `tsconfig.server.json`, `deno.lock`, `metadata.json`, logs, `README_API_KEY.md`; moving root audit `.md` to `docs/history/` | **does** | | | | |
| `netlify/functions/**` (incl. new `_lib/**`, `v2.ts`, scheduled functions) | | **owns** | | | |
| `migrations/**`, `scripts/**` (DB, guard, parity, bundle, purity scripts) — except `scripts/check-ui-guardrails.mjs` | | **owns** | | | |
| `scripts/check-ui-guardrails.mjs` | | | **owns** | | |
| `tests/backend/**` | | **owns** | | | |
| `netlify.toml`, `.github/workflows/**`, `.env.example`, `.gitignore` | | **owns** | | | |
| `index.html`, `index.tsx`, `index.css`, `styles/**`, `public/**`, `vite.config.ts` | | | **owns** | | |
| `App.tsx` (router only) | | | **owns** | | |
| `components/**` (existing files: restyle, move or delete), new `components/ui/**`, `components/shell/**` | | | **owns** | | |
| `pages/**` (new route components) | | | **owns** | | |
| `types.ts`, `constants.ts` | | | | **owns** | |
| `utils/**` (incl. new `utils/viewModels/**`, `utils/clock.ts`, `utils/csv*.ts`, `utils/search.ts`, `utils/pdfExport.ts`) | | | | **owns** | |
| `services/**` (new `services/api/**`; delete `geminiService.ts`) | | | | **owns** | |
| `state/**` (WP-0 creates stubs; C replaces) and `context/AuthContext.tsx` (C deletes) | stubs | | | **owns** | |
| `tests/utils/**`, `tests/state/**`, `tests/shared/**` | | | | **owns** | |
| `tests/e2e/**`, `docs/**` (except `docs/product/**`, BA-owned, and `docs/release/handoff-<pkg>.md`, which each package writes for itself), `README.md`, `RTM.md` | | | | | **owns** |

**Ordering constraints**

1. **WP-0 before everything.** It creates every file in §4.3 verbatim, installs dependencies, the lint/format/type configs, the `state/` stubs, deletes dead code, and runs `npm ci && npm run typecheck && npm test` green.
2. **A, B, C start together.** B builds against the `state/` stubs (which serve demo data through the same hook signatures), so B never waits for C. C builds against `DemoTransport` and a contract test suite, so C never waits for A.
3. **Inside A:** PL-01 → PL-02 (+ `0001`…`0003`) → AC-01/AC-02/AC-03 → HS-* and PL-04 in parallel → ORG-01/02, DM-01/03/05, PPL-03/04/06 endpoints → JI-*/PV-* → PL-12 matrix last (it enumerates every route).
4. **Inside B:** DS-01 → DS-02/03 → DS-04/05/06 → SH-01/02/03/07 → pages (any order) → SH-04 deletions → DS-07/08 cleanup.
5. **Inside C:** PL-05 → PL-06 (real hooks replacing the stubs, same signatures) → RP-03 + ORG-06 → view-models (`buildPeopleRows`, `buildAllocationGrid`, `setQuarterCell`, `copyForward`, `buildCapacityOutlook`, `buildDemandGrid`, `buildCatalogue`, `buildHome`, `buildTribeView`) → CSV/PDF/search.
6. **I starts when A, B and C each report "all Musts done"**: swap the stubs' demo fallback for `HttpTransport` by default, run the e2e suite on a preview with a Neon branch, fix integration defects (I may edit any file during integration, recording each cross-package fix in the hand-off notes), PL-14 rehearsal, docs.
7. **Should stories** are stretch work inside the owning package, started only after all of that package's Musts pass their ACs.
8. **Deployment order** (PL-14): Neon backup branch → deploy 2.0 (API answers 503 `migration_pending`, legacy save already 410) → `db:migrate --dry-run` → approve → `db:migrate` → `db:parity` → smoke tests → announce.

**Optional fourth parallel package.** If capacity allows a fourth developer, split B: **B1** owns `styles/**`, `components/ui/**`, `components/shell/**`, `App.tsx`, `index.*`, `vite.config.ts`, `pages/auth/**`, `pages/settings/**`, `pages/admin/**`, `pages/system/**`; **B2** owns `pages/home/**`, `pages/plan/**`, `pages/org/**`, `pages/delivery/**`, `pages/reports/**`, `pages/me/**` and the deletion of `components/crafts/**`, `components/integrations/**`, `components/qbr/**` (moved into `pages/delivery/sprints/`). B2 starts with layout and view-model wiring using plain semantic HTML and the token classes from DS-01, and switches to `components/ui` once B1 publishes DS-02…DS-05 (checkpoint 1).

### 4.2 Story-to-package split (sub-tasks)

| Story | A (backend) | B (UI) | C (domain/data) |
|---|---|---|---|
| SH-01 | — | router, redirects, titles | `useWorkspace()` reads `:org`/`:ws` params |
| SH-05 | `organizations.features`, `/me.org.features`, 403 `feature_disabled` | nav/route gating | `useFeature()` |
| SH-06 | — | dialog | `buildSearchIndex()` |
| SH-08 | CI bundle check script + step | lazy routes, `manualChunks`, manifest | — |
| SH-10 | email templates, AI prompt | UI strings, favicon, `index.html` | PDF strings |
| HS-10 | delete function | remove call | — |
| HS-11 | `ai.ts`, `_lib/aiPrompt.ts`, quota | assistant drawer | `api.ai.ask()`; delete `geminiService.ts` |
| HS-13/14 | API | form hints, 2FA dialog | — |
| HS-15 | CI dist grep, `.gitignore` | `vite.config.ts` `define` removal | no `VITE_OPENAI_API_KEY` reads |
| AC-03 | cookies, CSRF, refresh, logout, `/session` | — | `HttpTransport`, legacy-token exchange in `state/session.tsx` |
| AC-04 | `/api/v2/me` | gating via `can()` | `useSession`, `useWorkspace` |
| AC-05 | invitations API, email | Members invite dialog, `/invite/:token` page | client methods |
| AC-07 | API | `/verify-email` page, banner | client methods |
| AC-08/09 | API | Settings fields, `/create` | client methods |
| PL-07 | `organizations.plan`, enforcement | plan-limit messages | `useEntitlements()` |
| ORG-03/04/05 | (ORG-02 API) | pages | mutations, `buildTribeView` |
| PPL-01/02/05/07 | (PL-04 API) | pages, drawers | `buildPeopleRows`, mutations |
| PPL-03/04/06 | `/people/bulk`, `/people/import`, craft requests | dialogs, requests tab | CSV parser, mutations |
| AL-01…06 | lock enforcement (AL-05) | grid, dialogs | `buildAllocationGrid`, `setQuarterCell`, `copyForward`, undo |
| DM-01…05 | tables, APIs, emails | pages | `buildDemandGrid`, `buildCatalogue`, mutations |
| JI-02…07 | APIs, sync | Delivery pages | client methods, `buildDelivery…` |
| PV-01…03 | preview/apply/test | review screen, field map | client methods |
| RP-01/02/04 | export audit endpoint | pages | `buildHome`, `buildCapacityOutlook`, PDF/CSV builders |
| ST-01…09 | org/workspace/members/billing/platform routes | Settings, auth, cockpit pages | client methods |
| ST-10 | — | `/demo` route, banner | `DemoTransport` |

### 4.3 Interface contracts (created verbatim by WP-0)

All shared code is pure TypeScript: no imports from React, DOM, Node built-ins, `@netlify/*` or `@neondatabase/*`. Server code imports it with relative paths (`../../shared/...`; `netlify.toml` sets `node_bundler = "esbuild"`).

#### `shared/features.ts`

```ts
export const FEATURE_FLAGS = ['qbrSprintModule', 'aiAssistant', 'scenarios', 'planviewScheduledImport', 'jiraScheduledSync'] as const;
export type FeatureFlag = (typeof FEATURE_FLAGS)[number];
export type FeatureFlags = Record<FeatureFlag, boolean>;
export const DEFAULT_FEATURES: FeatureFlags = {
  qbrSprintModule: false, aiAssistant: false, scenarios: false, planviewScheduledImport: false, jiraScheduledSync: true,
};
export function resolveFeatures(stored: Partial<FeatureFlags> | null | undefined): FeatureFlags {
  return { ...DEFAULT_FEATURES, ...(stored ?? {}) };
}
```

#### `shared/utilisation.ts`

```ts
export type UtilBand = 'bench' | 'under' | 'on-target' | 'over';
export interface UtilisationThresholds { benchBelow: number; onTargetFrom: number; onTargetTo: number }
export const DEFAULT_THRESHOLDS: UtilisationThresholds = { benchBelow: 50, onTargetFrom: 90, onTargetTo: 105 };
export const BAND_LABEL: Record<UtilBand, string> = {
  bench: 'Available', under: 'Under target', 'on-target': 'On target', over: 'Over capacity',
};
/** pct is load as a percentage of target (100 = exactly on target). Rounded to an integer first. */
export function bandFor(pct: number, t: UtilisationThresholds = DEFAULT_THRESHOLDS): UtilBand {
  const p = Math.round(pct);
  if (p > t.onTargetTo) return 'over';
  if (p >= t.onTargetFrom) return 'on-target';
  if (p >= t.benchBelow) return 'under';
  return 'bench';
}
/** loadPct = summed allocation %; targetUtil defaults to 100. */
export function relativeLoad(loadPct: number, targetUtil?: number | null): number {
  const target = targetUtil && targetUtil > 0 ? targetUtil : 100;
  return (100 * loadPct) / target;
}
export function bandForLoad(loadPct: number, targetUtil?: number | null, t: UtilisationThresholds = DEFAULT_THRESHOLDS): UtilBand {
  return bandFor(relativeLoad(loadPct, targetUtil), t);
}
/** Returns null when valid, else a user-facing message. */
export function validateThresholds(t: UtilisationThresholds): string | null {
  const ok = t.benchBelow > 0 && t.benchBelow < t.onTargetFrom && t.onTargetFrom <= t.onTargetTo && t.onTargetTo <= 200;
  return ok ? null : 'On-target range must start below where it ends, and above the Available threshold.';
}
```

#### `shared/entitlements.ts`

```ts
export type Plan = 'BASIC' | 'PRO' | 'MAX' | 'ENTERPRISE';
export interface Entitlements {
  plan: Plan;
  maxPeople: number | null;        // null = unlimited
  maxProjects: number | null;
  maxWorkspaces: number | null;
  aiQueriesPerMonth: number | null;
  scenarios: boolean;
  csvImport: boolean;
  csvExport: boolean;
  pdfExport: boolean;
  integrations: boolean;
  billingVisible: boolean;
}
export type EntitlementFeature = 'scenarios' | 'csvImport' | 'csvExport' | 'pdfExport' | 'integrations';
export type EntitlementLimit = 'maxPeople' | 'maxProjects' | 'maxWorkspaces' | 'aiQueriesPerMonth';
export const PLAN_ENTITLEMENTS: Record<Plan, Entitlements> = {
  BASIC:      { plan: 'BASIC', maxPeople: 5,  maxProjects: 5,  maxWorkspaces: 1,    aiQueriesPerMonth: 25,  scenarios: false, csvImport: false, csvExport: false, pdfExport: true, integrations: true, billingVisible: true },
  PRO:        { plan: 'PRO',   maxPeople: 20, maxProjects: 10, maxWorkspaces: 3,    aiQueriesPerMonth: 50,  scenarios: true,  csvImport: true,  csvExport: true,  pdfExport: true, integrations: true, billingVisible: true },
  MAX:        { plan: 'MAX',   maxPeople: null, maxProjects: null, maxWorkspaces: null, aiQueriesPerMonth: 1000, scenarios: true, csvImport: true, csvExport: true, pdfExport: true, integrations: true, billingVisible: true },
  ENTERPRISE: { plan: 'ENTERPRISE', maxPeople: null, maxProjects: null, maxWorkspaces: null, aiQueriesPerMonth: null, scenarios: true, csvImport: true, csvExport: true, pdfExport: true, integrations: true, billingVisible: false },
};
export function entitlementsFor(plan: Plan, appMode: 'public' | 'internal'): Entitlements {
  return appMode === 'internal' ? PLAN_ENTITLEMENTS.ENTERPRISE : PLAN_ENTITLEMENTS[plan] ?? PLAN_ENTITLEMENTS.BASIC;
}
export function entitled(e: Entitlements, feature: EntitlementFeature): boolean { return e[feature]; }
/** True when creating one more item keeps the count within the limit. */
export function withinLimit(e: Entitlements, limit: EntitlementLimit, countAfterCreate: number): boolean {
  const max = e[limit];
  return max === null || countAfterCreate <= max;
}
```

#### `shared/permissions.ts`

```ts
import type { OrgRole, WorkspaceRole } from './contracts/dto';

export const PERMISSIONS = [
  'org.view', 'org.manage', 'org.billing', 'org.members.manage', 'org.audit.view', 'workspace.manage',
  'workspace.members.manage', 'workspace.audit.view', 'structure.write',
  'data.read', 'people.write', 'people.write.own', 'craftProfile.approve', 'projects.write', 'demand.write',
  'allocations.write', 'allocations.propose', 'allocations.respond.own', 'offers.write', 'offers.write.own',
  'scenario.write', 'qbr.write', 'qbr.commit',
  'integrations.view', 'integrations.manage', 'integrations.run',
  'import.csv', 'export', 'ai.use', 'platform.admin',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const VIEWER: Permission[] = ['org.view', 'data.read', 'export', 'ai.use'];
const CONTRIBUTOR: Permission[] = [...VIEWER, 'people.write.own', 'allocations.respond.own', 'offers.write.own'];
const PLANNER: Permission[] = [...CONTRIBUTOR, 'people.write', 'craftProfile.approve', 'projects.write', 'demand.write',
  'allocations.write', 'allocations.propose', 'offers.write', 'scenario.write', 'qbr.write',
  'integrations.view', 'integrations.run', 'import.csv'];
const WORKSPACE_ADMIN: Permission[] = [...PLANNER, 'workspace.members.manage', 'workspace.audit.view', 'structure.write',
  'qbr.commit', 'integrations.manage'];

export const WORKSPACE_ROLE_PERMISSIONS: Record<WorkspaceRole, readonly Permission[]> = { VIEWER, CONTRIBUTOR, PLANNER, WORKSPACE_ADMIN };
export const ORG_ADMIN_PERMISSIONS: readonly Permission[] = ['org.manage', 'org.billing', 'org.members.manage', 'org.audit.view', 'workspace.manage'];
export const WORKSPACE_ROLE_RANK: Record<WorkspaceRole, number> = { VIEWER: 1, CONTRIBUTOR: 2, PLANNER: 3, WORKSPACE_ADMIN: 4 };
export const ROLE_LABEL: Record<WorkspaceRole | 'ORG_ADMIN', string> = {
  ORG_ADMIN: 'Org Admin', WORKSPACE_ADMIN: 'PMO Admin', PLANNER: 'Planner', CONTRIBUTOR: 'Squad member', VIEWER: 'Viewer',
};

/** ORG_ADMIN implies WORKSPACE_ADMIN in every workspace of the org. Feature flags and entitlements are checked separately. */
export function permissionsFor(a: { isPlatformAdmin: boolean; orgRole: OrgRole | null; workspaceRole: WorkspaceRole | null }): Permission[] {
  const set = new Set<Permission>();
  const ws: WorkspaceRole | null = a.orgRole === 'ORG_ADMIN' ? 'WORKSPACE_ADMIN' : a.workspaceRole;
  if (ws) WORKSPACE_ROLE_PERMISSIONS[ws].forEach((p) => set.add(p));
  if (a.orgRole === 'ORG_ADMIN') ORG_ADMIN_PERMISSIONS.forEach((p) => set.add(p));
  if (a.orgRole) set.add('org.view');
  if (a.isPlatformAdmin) set.add('platform.admin');
  return PERMISSIONS.filter((p) => set.has(p));
}

/** Legacy dual-write/dual-read mapping (workspace_members.role CHECK IN ('PMO_ADMIN','WORKSPACE_OWNER','USER')). */
export type LegacyWorkspaceRole = 'PMO_ADMIN' | 'WORKSPACE_OWNER' | 'USER';
export function toLegacyWorkspaceRole(r: WorkspaceRole): LegacyWorkspaceRole {
  return r === 'WORKSPACE_ADMIN' ? 'PMO_ADMIN' : r === 'PLANNER' ? 'WORKSPACE_OWNER' : 'USER';
}
export function fromLegacyWorkspaceRole(r: string | null | undefined): WorkspaceRole {
  if (r === 'PMO_ADMIN' || r === 'WORKSPACE_ADMIN') return 'WORKSPACE_ADMIN';
  if (r === 'WORKSPACE_OWNER' || r === 'PLANNER') return 'PLANNER';
  if (r === 'CONTRIBUTOR') return 'CONTRIBUTOR';
  return 'VIEWER';
}
export function fromLegacyUserRole(r: string | null | undefined): { isPlatformAdmin: boolean; orgRole: OrgRole | null } {
  if (r === 'SUPERUSER') return { isPlatformAdmin: true, orgRole: null };
  if (r === 'ORG_ADMIN' || r === 'ADMIN') return { isPlatformAdmin: false, orgRole: 'ORG_ADMIN' };
  return { isPlatformAdmin: false, orgRole: 'MEMBER' };
}
```

#### `shared/contracts/dto.ts`

```ts
import type { FeatureFlags } from '../features';
import type { UtilisationThresholds } from '../utilisation';
import type { Plan, Entitlements } from '../entitlements';
import type { Permission } from '../permissions';

export type ID = string;            // UUIDv4 for new rows; legacy text ids (e.g. 'r1') kept unchanged
export type ISODate = string;       // 'YYYY-MM-DD'
export type ISODateTime = string;   // RFC 3339, UTC
export type QuarterKey = string;    // calendar quarter 'YYYY-Qn'
export const QUARTER_KEY_RE = /^\d{4}-Q[1-4]$/;
export type OrgRole = 'ORG_ADMIN' | 'MEMBER';
export type WorkspaceRole = 'WORKSPACE_ADMIN' | 'PLANNER' | 'CONTRIBUTOR' | 'VIEWER';
export type { Plan, Entitlements, Permission, FeatureFlags, UtilisationThresholds };

export interface UserRef { id: ID; name: string }
export interface Versioned { version: number; updatedAt: ISODateTime; updatedBy: UserRef | null }

export interface CraftDTO { id: ID; name: string; short: string; description: string | null; family: string | null; archived: boolean; sortOrder: number }
export interface TribeDTO extends Versioned { id: ID; name: string; leadName: string | null; archived: boolean }
export interface ChapterDTO extends Versioned { id: ID; name: string; craftId: ID | null; leadPersonId: ID | null; archived: boolean }
export interface TeamDTO extends Versioned { id: ID; name: string; archived: boolean }

export type PersonType = 'Permanent' | 'Contractor' | 'Part-Time';
export type Proficiency = 1 | 2 | 3;
export interface SecondaryCraftDTO { craftId: ID; proficiency: Proficiency; maxPct: number }
export interface PersonDTO extends Versioned {
  id: ID; name: string; email: string | null; role: string /* job title */; type: PersonType; department: string;
  location: string | null; totalCapacity: number; dailyRate: number | null;
  teamId: ID | null; chapterId: ID | null; homeTribeId: ID | null; linkedUserId: ID | null;
  primaryCraft: ID | null; secondaryCrafts: SecondaryCraftDTO[]; tribeAffinity: ID[]; skills: string[];
  targetUtil: number; // default 100
}

export type ProjectStatus = 'Active' | 'On Hold' | 'Planning' | 'Completed';
export type ProjectStage = 'Pipeline' | 'Initiated' | 'Mobilising' | 'In Flight' | 'Closing';
export type Priority = 'Critical' | 'High' | 'Medium' | 'Low';
export interface ProjectDTO extends Versioned {
  id: ID; name: string; status: ProjectStatus; priority: Priority; description: string;
  startDate: ISODate | null; endDate: ISODate | null; budget: number | null;
  tribeId: ID | null; stage: ProjectStage | null; initiatedOn: ISODate | null; ownerUserId: ID | null;
  jiraKey: string | null; planviewId: string | null; source: 'manual' | 'planview';
}

export type DemandStatus = 'Forecast' | 'Confirmed';
export interface DemandLineDTO extends Versioned {
  id: ID; projectId: ID; quarterKey: QuarterKey; craftId: ID; fte: number; status: DemandStatus;
  ownerUserId: ID | null; note: string | null; createdAt: ISODateTime;
}

export type AllocationSource = 'manual' | 'marketplace' | 'planview' | 'jira';
export type AllocationState = 'tentative' | 'confirmed' | 'declined';
export interface AllocationDTO extends Versioned {
  id: ID; resourceId: ID; projectId: ID; percentage: number; startDate: ISODate | null; endDate: ISODate | null;
  craftId: ID | null; source: AllocationSource; state: AllocationState; notes: string | null;
  externalRef: string | null; demandLineId: ID | null;
  proposedAt: ISODateTime | null; proposedBy: UserRef | null; respondedAt: ISODateTime | null;
}

export interface MarketplaceOfferDTO { personId: ID; quarterKey: QuarterKey; pct: number; craftIds: ID[]; note: string | null; createdBy: UserRef; createdAt: ISODateTime }
export interface CraftChangeRequestDTO {
  id: ID; personId: ID; current: SecondaryCraftDTO[]; proposed: SecondaryCraftDTO[];
  status: 'pending' | 'approved' | 'rejected'; submittedBy: UserRef; submittedAt: ISODateTime;
  decidedBy: UserRef | null; decidedAt: ISODateTime | null; reason: string | null;
}

export interface PlanningSettings {
  fiscalYearStartMonth: 1 | 4 | 7 | 10; thresholds: UtilisationThresholds; defaultTargetUtil: number;
  sprintLengthDays: number; planviewOwnership: 'locked' | 'overridable';
}
export interface OrgDTO extends Versioned {
  id: ID; name: string; slug: string; logoUrl: string | null; plan: Plan; features: FeatureFlags;
  planning: PlanningSettings; defaultWorkspaceVisibility: 'org' | 'members';
}
export interface WorkspaceDTO { id: ID; orgId: ID; name: string; dataVersion: number; createdAt: ISODateTime }

export type SyncStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'partial';
export interface SyncJobDTO {
  id: ID; provider: 'jira' | 'planview'; trigger: 'schedule' | 'manual'; status: SyncStatus;
  pagesDone: number; issuesSeen: number; error: string | null; rateLimitedUntil: ISODateTime | null;
  startedAt: ISODateTime | null; finishedAt: ISODateTime | null; requestedBy: UserRef | null;
}
export interface SyncHealthDTO {
  provider: 'jira'; configured: boolean; state: 'ok' | 'failed' | 'stale' | 'running' | 'never';
  lastSuccessAt: ISODateTime | null; lastJob: SyncJobDTO | null; recentJobs: SyncJobDTO[];
}
export interface DeliverySummaryDTO {
  health: SyncHealthDTO;
  byProjectQbr1: Array<{ projectId: ID; plannedFte: number; impliedFte: number }>;
}
export interface JiraProjectMappingDTO {
  jiraKey: string; jiraName: string; boardIds: number[]; projectId: ID | null; tribeId: ID | null;
  matchMethod: 'key' | 'name' | 'manual' | 'none'; confirmed: boolean;
}
export interface IdentityMappingDTO {
  provider: 'jira' | 'planview'; externalId: string; displayName: string; email: string | null; personId: ID | null;
  matchMethod: 'accountId' | 'email' | 'name' | 'manual' | 'none'; confirmed: boolean; lastSeenAt: ISODateTime | null;
}
export interface TribeCalibrationDTO extends Versioned {
  tribeId: ID; pointsPerSprintPerFte: number; sprintLengthDays: number; isDefault: boolean;
  suggestedValue: number | null; suggestedBasis: { sprintNames: string[]; points: number; fte: number } | null; note: string | null;
}
export interface DeliveryRowDTO {
  key: string; label: string; tribeId: ID | null; projectId: ID | null; sprintId: string | null; sprintName: string | null;
  quarterKey: QuarterKey | null; from: ISODate; to: ISODate;
  pointsTotal: number; pointsDone: number; issuesDone: number; impliedFte: number; plannedFte: number;
}
export interface FieldChange { field: string; from: string | null; to: string | null }
export interface PlanviewProjectChange { externalId: string; name: string; projectId: ID | null; changes: FieldChange[] }
export interface PlanviewAssignmentChange {
  externalId: string; projectExternalId: string; personExternalId: string; personName: string;
  projectId: ID | null; personId: ID | null; changes: FieldChange[];
}
export interface PlanviewPreviewDTO {
  previewId: ID; expiresAt: ISODateTime; partial: boolean;
  projects: { new: PlanviewProjectChange[]; changed: PlanviewProjectChange[]; removed: PlanviewProjectChange[] };
  assignments: {
    new: PlanviewAssignmentChange[]; changed: PlanviewAssignmentChange[]; removed: PlanviewAssignmentChange[];
    unmatchedPeople: Array<{ externalId: string; name: string; email: string | null; suggestedPersonId: ID | null }>;
  };
}

export interface WorkspaceSnapshot {
  org: OrgDTO; workspace: WorkspaceDTO;
  people: PersonDTO[]; projects: ProjectDTO[]; allocations: AllocationDTO[]; demand: DemandLineDTO[];
  tribes: TribeDTO[]; chapters: ChapterDTO[]; teams: TeamDTO[]; crafts: CraftDTO[];
  offers: MarketplaceOfferDTO[];
  craftRequests: CraftChangeRequestDTO[];   // pending: all for Planner+, own for Contributor, none for Viewer
  delivery: DeliverySummaryDTO | null;
  serverTime: ISODateTime;
}

export interface SessionUser { id: ID; email: string; name: string; isPlatformAdmin: boolean; emailVerified: boolean; twoFactorEnabled: boolean }
export interface MeWorkspace { id: ID; name: string; role: WorkspaceRole; implicit: boolean; permissions: Permission[]; linkedPersonId: ID | null }
export interface MeResponse {
  user: SessionUser;
  org: { id: ID; name: string; slug: string; logoUrl: string | null; role: OrgRole; plan: Plan; features: FeatureFlags; planning: PlanningSettings } | null;
  workspaces: MeWorkspace[];
  entitlements: Entitlements;
  appMode: 'public' | 'internal';
}
```

#### `shared/contracts/api.ts`

```ts
import type * as D from './dto';

export type ApiErrorCode = 'bad_request' | 'unauthorized' | 'forbidden' | 'not_found' | 'conflict' | 'gone'
  | 'payload_too_large' | 'rate_limited' | 'entitlement' | 'feature_disabled' | 'migration_pending' | 'server_error';
/** Every non-2xx JSON body. HTTP status: 400 bad_request, 401 unauthorized, 403 forbidden|entitlement|feature_disabled,
 *  404 not_found, 409 conflict, 410 gone, 413 payload_too_large, 429 rate_limited (+Retry-After), 500 server_error,
 *  502 upstream (code server_error), 503 migration_pending|server_error. */
export interface ApiError {
  error: string; code: ApiErrorCode; requestId?: string;
  fields?: Record<string, string>;                // 400: field path -> message
  current?: unknown; changedBy?: D.UserRef; changedAt?: D.ISODateTime;   // 409 version conflict
}

type Mutable<T> = Omit<T, 'id' | 'version' | 'updatedAt' | 'updatedBy'>;
export type NewPerson = Partial<Mutable<D.PersonDTO>> & { name: string; id?: D.ID };
export type NewProject = Partial<Mutable<D.ProjectDTO>> & { name: string; id?: D.ID };
export type NewDemandLine = Omit<Mutable<D.DemandLineDTO>, 'createdAt'> & { id?: D.ID };
export type NewAllocation = Partial<Mutable<D.AllocationDTO>> & { resourceId: D.ID; projectId: D.ID; percentage: number; id?: D.ID };
/** PATCH body for any versioned entity. */
export interface PatchBody<T> { version: number; patch: Partial<Mutable<T>> }

export type AllocationOp =
  | { op: 'create'; allocation: NewAllocation }
  | { op: 'update'; id: D.ID; version: number; patch: Partial<Mutable<D.AllocationDTO>> }
  | { op: 'delete'; id: D.ID; version: number };
export interface AllocationBatchRequest { ops: AllocationOp[]; label?: string }   // max 500 ops, atomic
export interface AllocationBatchResponse { upserted: D.AllocationDTO[]; deleted: D.ID[]; dataVersion: number }
export type DemandOp =
  | { op: 'create'; line: NewDemandLine }
  | { op: 'update'; id: D.ID; version: number; patch: Partial<Mutable<D.DemandLineDTO>> }
  | { op: 'delete'; id: D.ID; version: number };

export interface LoginRequest { email: string; password: string; otp?: string }
export type LoginResponse = { user: D.SessionUser } | { require2FA: true; email: string };
export interface PeopleBulkRequest { ids: D.ID[]; versions: Record<D.ID, number>; patch: { chapterId?: D.ID | null; teamId?: D.ID | null; targetUtil?: number; addSecondaryCraft?: D.SecondaryCraftDTO } }
export interface PeopleImportRow { name: string; email?: string; jobTitle?: string; type?: D.PersonType; location?: string; chapter?: string; team?: string; homeTribe?: string; targetPct?: number; aboveCraft?: string; belowCrafts?: D.SecondaryCraftDTO[]; skills?: string[] }
export interface PeopleImportRequest { rows: PeopleImportRow[]; createMissingStructure: boolean }
export interface PeopleImportResponse { created: number; updated: number; skipped: number; errors: Array<{ row: number; message: string }> }
export interface ProposeRequest { demandLineId: D.ID | null; projectId: D.ID; resourceId: D.ID; craftId: D.ID; quarterKey: D.QuarterKey; percentage: number; startDate: D.ISODate; endDate: D.ISODate }
export interface RespondRequest { decision: 'accept' | 'decline'; reason?: string }
export interface InvitationRequest { email: string; orgRole: D.OrgRole; workspaces: Array<{ workspaceId: D.ID; role: D.WorkspaceRole }> }
export interface InvitationResponse { invitation: { id: D.ID; email: string; expiresAt: D.ISODateTime }; inviteUrl: string }
export interface InvitationLookup { email: string; orgName: string; workspaces: Array<{ id: D.ID; name: string; role: D.WorkspaceRole }>; expiresAt: D.ISODateTime; existingUser: boolean }
export interface MemberDTO { userId: D.ID; name: string; email: string; orgRole: D.OrgRole; workspaces: Array<{ workspaceId: D.ID; role: D.WorkspaceRole }>; linkedPersonIds: D.ID[]; lastSignInAt: D.ISODateTime | null }
export interface MemberPatch { orgRole?: D.OrgRole; workspaces?: Array<{ workspaceId: D.ID; role: D.WorkspaceRole | null }> }
export interface AuditEventDTO { id: string; occurredAt: D.ISODateTime; actor: D.UserRef | null; actorType: string; action: string; workspaceId: D.ID | null; targetType: string | null; targetId: string | null; before: unknown; after: unknown; requestId: string | null }

const v2 = '/api/v2';
const ws = (w: string) => `${v2}/workspaces/${w}`;
const org = (o: string) => `${v2}/orgs/${o}`;
export const API = {
  // auth (existing function auth.ts)
  login: '/api/auth/login', register: '/api/auth/register', logout: '/api/auth/logout', refresh: '/api/auth/refresh',
  sessionExchange: '/api/auth/session', resetSend: '/api/auth/reset/send-otp', resetConfirm: '/api/auth/reset/confirm',
  twoFactor: '/api/auth/2fa', changePassword: '/api/auth/password', verifySend: '/api/verify/send', verifyCheck: '/api/verify/check',
  health: '/api/health', ai: '/api/ai',
  me: `${v2}/me`,
  createOrg: `${v2}/orgs`,
  org: (o: string) => org(o),
  orgWorkspaces: (o: string) => `${org(o)}/workspaces`,
  orgEntity: (o: string, kind: 'tribes' | 'chapters' | 'teams' | 'crafts', id?: string) => `${org(o)}/${kind}${id ? `/${id}` : ''}`,
  members: (o: string, userId?: string) => `${org(o)}/members${userId ? `/${userId}` : ''}`,
  invitations: (o: string, id?: string) => `${org(o)}/invitations${id ? `/${id}` : ''}`,
  invitationByToken: (token: string) => `${v2}/invitations/${token}`,
  invitationAccept: (token: string) => `${v2}/invitations/${token}/accept`,
  orgAudit: (o: string) => `${org(o)}/audit`,
  workspace: (w: string) => ws(w),
  workspaceMembers: (w: string, userId?: string) => `${ws(w)}/members${userId ? `/${userId}` : ''}`,
  snapshot: (w: string) => `${ws(w)}/snapshot`,
  sampleData: (w: string) => `${ws(w)}/sample-data`,
  people: (w: string, id?: string) => `${ws(w)}/people${id ? `/${id}` : ''}`,
  peopleBulk: (w: string) => `${ws(w)}/people/bulk`,
  peopleImport: (w: string) => `${ws(w)}/people/import`,
  craftRequestsFor: (w: string, personId: string) => `${ws(w)}/people/${personId}/craft-requests`,
  craftRequests: (w: string) => `${ws(w)}/craft-requests`,
  craftRequestDecision: (w: string, id: string, d: 'approve' | 'reject') => `${ws(w)}/craft-requests/${id}/${d}`,
  projects: (w: string, id?: string) => `${ws(w)}/projects${id ? `/${id}` : ''}`,
  demand: (w: string, id?: string) => `${ws(w)}/demand${id ? `/${id}` : ''}`,
  demandBatch: (w: string) => `${ws(w)}/demand/batch`,
  allocations: (w: string, id?: string) => `${ws(w)}/allocations${id ? `/${id}` : ''}`,
  allocationsBatch: (w: string) => `${ws(w)}/allocations/batch`,
  allocationRespond: (w: string, id: string) => `${ws(w)}/allocations/${id}/respond`,
  propose: (w: string) => `${ws(w)}/marketplace/propose`,
  offer: (w: string, personId: string, quarterKey: string) => `${ws(w)}/offers/${personId}/${quarterKey}`,
  exportAudit: (w: string) => `${ws(w)}/audit/export`,
  jiraMappings: (w: string) => `${ws(w)}/integrations/jira/mappings`,
  jiraAutoMatch: (w: string) => `${ws(w)}/integrations/jira/mappings/auto-match`,
  jiraProjectMappings: (w: string) => `${ws(w)}/integrations/jira/mappings/projects`,
  jiraPeopleMappings: (w: string) => `${ws(w)}/integrations/jira/mappings/people`,
  calibration: (w: string, tribeId?: string) => `${ws(w)}/calibration${tribeId ? `/${tribeId}` : ''}`,
  syncJira: (w: string) => `${ws(w)}/sync/jira`,
  syncJobs: (w: string) => `${ws(w)}/sync/jobs`,
  syncStep: (w: string, jobId: string) => `${ws(w)}/sync/jobs/${jobId}/step`,
  syncHealth: (w: string) => `${ws(w)}/sync/health`,
  delivery: (w: string) => `${ws(w)}/delivery`,
  planviewPreview: (w: string) => `${ws(w)}/planview/preview`,
  planviewApply: (w: string) => `${ws(w)}/planview/apply`,
  planviewTestMapping: (w: string) => `${ws(w)}/planview/test-mapping`,
  // legacy integrations config routes stay at /api/integrations/* (config, jira/test, jira/projects, jira/boards, planview/test) with HS-08 rules
} as const;
```

#### API route table (A implements; C's client calls; PL-12 matrix enumerates)

Permission column uses `shared/permissions.ts`; "own" means the caller's `linkedPersonId`. All write routes need CSRF when cookie-authenticated, `version` where the entity is versioned, and write one audit event.

| Method & path | Permission | Request → Response | Notable statuses |
|---|---|---|---|
| `POST /api/auth/login` | none | `LoginRequest` → `LoginResponse` + cookies | 401, 429 |
| `POST /api/auth/register` | none (public mode, `ALLOW_PUBLIC_SIGNUP`) | `{email,password,name}` → 201 `{ emailVerificationRequired: true }` | 400, 403, 429 |
| `POST /api/auth/session` | bearer (legacy token) | — → `{ user }` + cookies | 401 |
| `POST /api/auth/refresh` · `GET /api/auth?refresh=true` | session | — → `{ ok: true }` + cookie | 401 |
| `POST /api/auth/logout` | session | — → 204 | |
| `POST /api/auth/reset/send-otp` · `/reset/confirm` | none | `{email}` → `{sent:true}` · `{email,otp,newPassword}` → `{success:true}` | 400, 429 |
| `POST /api/auth/2fa` · `POST /api/auth/password` | session | `{enabled,password}` · `{currentPassword,newPassword}` → 200 | 400, 401 |
| `GET /api/health` | none | → health JSON | 503 |
| `POST /api/ai` | `ai.use` + feature `aiAssistant` | `{wsId, question}` → `{answer}` | 400, 403, 429, 502 |
| `GET /api/v2/me` | session | → `MeResponse` | 401 |
| `POST /api/v2/orgs` | verified user without org | `{name, workspaceName}` → 201 `{ org, workspace }` | 403, 409 |
| `GET·PATCH /api/v2/orgs/:orgId` | `org.view` · `org.manage` | → `OrgDTO` · `PatchBody<OrgDTO>` → `OrgDTO` | 409 |
| `POST /api/v2/orgs/:orgId/workspaces` | `workspace.manage` | `{name}` → 201 `WorkspaceDTO` | 403 entitlement |
| `PATCH·DELETE /api/v2/workspaces/:wsId` | `workspace.manage` | `{name}` → `WorkspaceDTO` · `?confirmName=` → 204 | 400 |
| `GET·POST /api/v2/orgs/:orgId/{tribes,chapters,teams,crafts}`; `PATCH·DELETE …/:id` | `org.view` · `structure.write` | DTO lists / create / `PatchBody` | 409 duplicate, 409 in use |
| `GET /api/v2/orgs/:orgId/members`; `PATCH·DELETE …/:userId` | `org.members.manage` (or `workspace.members.manage`, filtered) | → `MemberDTO[]` · `MemberPatch` | 404 other tenant, 409 last admin |
| `PATCH·DELETE /api/v2/workspaces/:wsId/members/:userId` | `workspace.members.manage` | `{role}` | 403 above own role |
| `POST·GET /api/v2/orgs/:orgId/invitations`; `DELETE …/:id` | `org.members.manage` or `workspace.members.manage` (own workspaces) | `InvitationRequest` → 201 `InvitationResponse` | 400, 403, 409 other org |
| `GET /api/v2/invitations/:token` · `POST …/accept` | none | → `InvitationLookup` · `{name?,password?}` → `{ user }` + cookies | 404/410 expired, 429 |
| `GET /api/v2/orgs/:orgId/audit` | `org.audit.view` (`workspace.audit.view` with `workspaceId`) | `?from&to&workspaceId&action&cursor&format=csv` → `{ events: AuditEventDTO[], next }` or CSV | 403 |
| `GET /api/v2/workspaces/:wsId/snapshot` | `data.read` | → `WorkspaceSnapshot` | 403, 404 |
| `POST /api/v2/workspaces/:wsId/sample-data` | `people.write` | — → 201 snapshot | 409 not empty |
| `POST /people` · `PATCH·DELETE /people/:id` | `people.write` | `NewPerson` · `PatchBody<PersonDTO>` · `?version=` | 403 entitlement, 409 |
| `POST /people/bulk` · `POST /people/import` | `people.write` · `import.csv` + entitlement | `PeopleBulkRequest` → `{ people }` · `PeopleImportRequest` → `PeopleImportResponse` | 409, 403 |
| `POST /people/:id/craft-requests` | `people.write.own` (own) or `people.write` | `{ secondaryCrafts }` → 201 `CraftChangeRequestDTO` | 400, 403 |
| `GET /craft-requests` · `POST /craft-requests/:id/{approve,reject}` | `data.read` (filtered) · `craftProfile.approve` | → list · `{reason?}` → DTO | 409 |
| `POST /projects` · `PATCH·DELETE /projects/:id` | `projects.write` | `NewProject` · `PatchBody<ProjectDTO>` | 400 tribe, 409 |
| `POST /demand` · `PATCH·DELETE /demand/:id` · `POST /demand/batch` | `demand.write` | `NewDemandLine` · `PatchBody` · `{ ops: DemandOp[] }` | 400, 409 |
| `POST /allocations` · `PATCH·DELETE /allocations/:id` · `POST /allocations/batch` | `allocations.write` | `NewAllocation` · `PatchBody` · `AllocationBatchRequest` → `AllocationBatchResponse` | 409 conflict/locked |
| `POST /allocations/:id/respond` | `allocations.respond.own` (own) or `allocations.write` | `RespondRequest` → `AllocationDTO` | 403, 409 |
| `POST /marketplace/propose` | `allocations.propose` | `ProposeRequest` → 201 `AllocationDTO` | 400, 409 |
| `PUT·DELETE /offers/:personId/:quarterKey` | `offers.write` or `offers.write.own` (own) | `{pct, craftIds, note}` → `MarketplaceOfferDTO` | 403 |
| `POST /audit/export` | `export` | `{ kind: 'pdf'\|'csv', report: string }` → 204 | |
| `GET /integrations/jira/mappings` · `POST …/auto-match` · `PUT …/projects` · `PUT …/people` | `integrations.view` · `integrations.run` | → `{ projects: JiraProjectMappingDTO[], people: IdentityMappingDTO[] }` | 409 |
| `GET /calibration` · `PUT /calibration/:tribeId` | `integrations.view` · `integrations.run` | → `TribeCalibrationDTO[]` · `{ pointsPerSprintPerFte, sprintLengthDays, note, version }` | 400 note required |
| `POST /sync/jira` · `POST /sync/jobs/:id/step` · `GET /sync/jobs` · `GET /sync/health` | `integrations.run` · `integrations.run` · `integrations.view` · `data.read` | → 202 `{ job: SyncJobDTO }` · `{ job }` · `SyncJobDTO[]` · `SyncHealthDTO` | 409 not configured |
| `GET /delivery` | `data.read` | `?groupBy=tribe\|project\|sprint\|person&tribeId&projectId&from&to` → `DeliveryRowDTO[]` | |
| `POST /planview/preview` · `POST /planview/apply` · `POST /planview/test-mapping` | `integrations.run` · `integrations.run` · `integrations.manage` | → `PlanviewPreviewDTO` · `{ previewId, accept: { projects: string[], assignments: string[] }, personMatches: Record<string, ID> }` → `{ created, updated, skipped }` · → `{ source, mapped, missing: string[] }` | 409 expired |
| Legacy `/api/integrations/*` | per HS-08 | unchanged shapes, secrets never returned | 403 |
| Legacy `POST /api/workspace`, `/api/auth/users/invite`, `PUT /api/auth/users/:id`, `/api/auth/remove-member`, `POST /api/org_manage` | — | → 410 `gone` | 410 |
| Legacy `GET /api/workspace?wsId=` · `/api/my_workspaces` · `/api/workspace_lookup` | `data.read` / session | unchanged shapes (compat only) | 403 |

(Rows without a prefix are under `/api/v2/workspaces/:wsId`.)

#### UI route map (B implements; SH-01)

| Path | Page | Who sees it (permission / flag) |
|---|---|---|
| `/`, `/login` | Sign in (ST-07) | signed-out |
| `/reset` | Reset password | signed-out |
| `/register` | Create account | public mode with sign-up enabled |
| `/verify-email` | Verify email | signed-in, unverified |
| `/invite/:token` | Accept invitation | anyone |
| `/create` | Create organisation | verified user without org (public mode) |
| `/demo/*` | Demo workspace (ST-10) | anyone (public mode; internal only with `VITE_ENABLE_DEMO`) |
| `/cockpit` | Platform admin | `platform.admin` |
| `/o/:org` | → redirect to `/o/:org/w/:ws/home` | member |
| `/o/:org/settings`, `/o/:org/directory` | → redirects (SH-01#AC2) | member |
| `/o/:org/w/:ws/home` | Home (RP-01) | `data.read` |
| `/o/:org/w/:ws/me` | My plan (PPL-05) | linked person or CONTRIBUTOR |
| `/o/:org/w/:ws/plan/capacity` | Capacity Outlook (RP-02) | `data.read` |
| `/o/:org/w/:ws/plan/demand` | Demand (DM-02) | `data.read` |
| `/o/:org/w/:ws/plan/allocations` | Allocations (AL-01) | `data.read` |
| `/o/:org/w/:ws/plan/marketplace` | Marketplace / catalogue (DM-03/04) | `data.read` |
| `/o/:org/w/:ws/org/people` (`?person=`) | People (PPL-01/02) | `data.read` |
| `/o/:org/w/:ws/org/projects` (`?project=`) | Projects (PPL-07) | `data.read` |
| `/o/:org/w/:ws/org/tribes`, `…/org/tribes/:tribeId` | Tribes (ORG-05) | `data.read` |
| `/o/:org/w/:ws/delivery/jira-planview` (`?tab=health\|mapping\|people\|calibration\|sprints\|planview`) | Delivery (JI-*, PV-01) | `data.read` (tabs: `integrations.view`) |
| `/o/:org/w/:ws/delivery/sprints` | Sprint planning (legacy QBR) | flag `qbrSprintModule` |
| `/o/:org/w/:ws/reports` | Reports (RP-04) | `export` |
| `/o/:org/w/:ws/settings/profile` | Profile | all |
| `/o/:org/w/:ws/settings/organisation` | Organisation + workspaces | `org.manage` |
| `/o/:org/w/:ws/settings/members` | Members and roles | `org.members.manage` or `workspace.members.manage` |
| `/o/:org/w/:ws/settings/structure` · `/crafts` | Structure · Crafts | `data.read` (edit: `structure.write`) |
| `/o/:org/w/:ws/settings/planning` | Planning | `org.manage` (others read-only) |
| `/o/:org/w/:ws/settings/integrations` | Integrations | `integrations.view` |
| `/o/:org/w/:ws/settings/features` | Features | `org.manage` |
| `/o/:org/w/:ws/settings/billing` | Billing | `org.billing` and public mode |
| `/o/:org/w/:ws/settings/audit` | Audit log (Should, AU-01) | `org.audit.view` or `workspace.audit.view` |
| any + `?embedded=1` | Embedded shell mode (SH-02#AC6) | — |

#### Client hooks and view-models (C implements; WP-0 ships stubs with these exact signatures; B consumes)

```ts
// state/index.ts — public surface of the client data layer
import type * as D from '../shared/contracts/dto';
import type { Permission } from '../shared/permissions';
import type { FeatureFlag } from '../shared/features';
import type { Entitlements, EntitlementFeature } from '../shared/entitlements';
import type { UtilBand, UtilisationThresholds } from '../shared/utilisation';
import type { AllocationOp, NewPerson, NewProject, NewDemandLine, PeopleBulkRequest, PeopleImportRequest,
  PeopleImportResponse, ProposeRequest, RespondRequest, InvitationRequest, InvitationResponse, MemberDTO, MemberPatch } from '../shared/contracts/api';

export class ApiRequestError extends Error { status!: number; code!: string; fields?: Record<string, string>; requestId?: string; body?: unknown }

export type TimeBasis = { kind: 'today' } | { kind: 'quarter'; key: D.QuarterKey } | { kind: 'window' };
export interface QuarterView { key: D.QuarterKey; index: 0 | 1 | 2 | 3; label: 'QBR1' | 'QBR2' | 'QBR3' | 'QBR4'; calendarLabel: string; fiscalLabel: string; start: D.ISODate; end: D.ISODate }

export function useSession(): {
  status: 'loading' | 'anonymous' | 'authenticated'; me: D.MeResponse | null; mode: 'live' | 'demo';
  login(email: string, password: string, otp?: string): Promise<{ require2FA: boolean }>;
  logout(opts?: { everywhere?: boolean }): Promise<void>;
  refreshMe(): Promise<void>;
};
export function useWorkspace(): {
  org: D.MeResponse['org']; workspace: D.MeWorkspace | null; workspaces: D.MeWorkspace[];
  can(p: Permission): boolean; isOwnPerson(personId: D.ID): boolean;
  thresholds: UtilisationThresholds; switchWorkspace(wsId: D.ID): void;
};
export function useFeature(flag: FeatureFlag): boolean;
export function useEntitlements(): Entitlements & { has(f: EntitlementFeature): boolean };
export function useQuarters(): QuarterView[];   // 4 rolling quarters, fiscal labels applied
export function useWorkspaceData(): { status: 'loading' | 'ready' | 'error'; error: ApiRequestError | null; snapshot: D.WorkspaceSnapshot | null; reload(): Promise<void> };
export function useConflict(): { conflict: null | { entity: string; name: string; changedBy: string; changedAt: string }; resolve(action: 'reload' | 'dismiss'): void };
export function useUndo(): { canUndo: boolean; label: string | null; undo(): Promise<void> };
export function useMutations(): {
  people: { create(p: NewPerson): Promise<D.PersonDTO>; update(id: D.ID, patch: Partial<D.PersonDTO>): Promise<D.PersonDTO>; remove(id: D.ID): Promise<void>;
            bulk(req: Omit<PeopleBulkRequest, 'versions'>): Promise<D.PersonDTO[]>; importRows(req: PeopleImportRequest): Promise<PeopleImportResponse>;
            requestCraftChange(personId: D.ID, crafts: D.SecondaryCraftDTO[]): Promise<D.CraftChangeRequestDTO>;
            decideCraftChange(id: D.ID, d: 'approve' | 'reject', reason?: string): Promise<D.CraftChangeRequestDTO> };
  projects: { create(p: NewProject): Promise<D.ProjectDTO>; update(id: D.ID, patch: Partial<D.ProjectDTO>): Promise<D.ProjectDTO>; remove(id: D.ID): Promise<void> };
  demand: { create(l: NewDemandLine): Promise<D.DemandLineDTO>; update(id: D.ID, patch: Partial<D.DemandLineDTO>): Promise<D.DemandLineDTO>; remove(id: D.ID): Promise<void>;
            copyForward(id: D.ID, toQuarterKeys: D.QuarterKey[]): Promise<void> };
  allocations: { batch(ops: AllocationOp[], label: string): Promise<void>;
                 setQuarterCell(a: { resourceId: D.ID; projectId: D.ID; craftId: D.ID | null; quarterKey: D.QuarterKey; pct: number }): Promise<void>;
                 copyForward(a: { resourceId: D.ID; projectId: D.ID; craftId: D.ID | null; fromQuarterKey: D.QuarterKey }): Promise<void>;
                 respond(id: D.ID, r: RespondRequest): Promise<void> };
  marketplace: { propose(r: ProposeRequest): Promise<D.AllocationDTO>; setOffer(o: Omit<D.MarketplaceOfferDTO, 'createdBy' | 'createdAt'>): Promise<void>; withdrawOffer(personId: D.ID, quarterKey: D.QuarterKey): Promise<void> };
  structure: { save(kind: 'tribes' | 'chapters' | 'teams' | 'crafts', entity: { id?: D.ID; version?: number } & Record<string, unknown>): Promise<void>; archive(kind: 'tribes' | 'chapters' | 'teams' | 'crafts', id: D.ID, archived: boolean): Promise<void> };
  admin: { invite(r: InvitationRequest): Promise<InvitationResponse>; members(): Promise<MemberDTO[]>; updateMember(userId: D.ID, p: MemberPatch): Promise<void>; removeMember(userId: D.ID): Promise<void>;
           updateOrg(patch: Partial<D.OrgDTO>): Promise<void> };
};

// utils/viewModels/index.ts — pure functions (no React); B renders their output
export interface PersonRow { person: D.PersonDTO; chapter: D.ChapterDTO | null; team: D.TeamDTO | null; primary: D.CraftDTO | null;
  secondary: Array<{ craft: D.CraftDTO; proficiency: D.Proficiency; maxPct: number }>;
  quarters: Array<{ key: D.QuarterKey; loadPct: number; relativePct: number; band: UtilBand; above: number; below: number; undeclared: number; free: number }> }
export interface GridCell { quarterKey: D.QuarterKey; pct: number; band: UtilBand | null; partial: boolean; state: D.AllocationState | 'mixed' | null;
  source: D.AllocationSource | 'mixed' | null; locked: boolean; allocationIds: D.ID[] }
export interface GridRow { key: string; kind: 'person' | 'project' | 'booking'; depth: 0 | 1; personId: D.ID | null; projectId: D.ID | null; craftId: D.ID | null; label: string; cells: GridCell[] }
export interface GridModel { quarters: QuarterView[]; groups: Array<{ id: string; label: string; totals: GridCell[]; rows: GridRow[] }> }
export interface OutlookPoint { quarterKey: D.QuarterKey; supplyFte: number; aboveFte: number; belowFte: number; undeclaredFte: number; freeFte: number; demandFte: number; utilisationPct: number; band: UtilBand }
export interface OutlookModel { squad: OutlookPoint[]; rows: Array<{ id: string; label: string; points: OutlookPoint[] }> }
export interface CatalogueEntry { craft: D.CraftDTO; freeAboveFte: number; reachBelowFte: number;
  people: Array<{ person: D.PersonDTO; via: 'above' | 'below'; proficiency: D.Proficiency | null; freePct: number; offer: D.MarketplaceOfferDTO | null }> }
export interface HomeModel { kpis: { utilisationPct: number; band: UtilBand; nextQuarterPct: number; unstaffedFte: number; overCount: number; availableCount: number };
  outlook: OutlookPoint[]; over: PersonRow[]; available: PersonRow[]; projectsWithoutDemand: D.ProjectDTO[]; pendingApprovals: number; myPendingProposals: number }

export declare function utilisationFor(s: D.WorkspaceSnapshot, personId: D.ID, basis: TimeBasis, quarters: QuarterView[]): number;
export declare function buildPeopleRows(s: D.WorkspaceSnapshot, quarters: QuarterView[], t: UtilisationThresholds): PersonRow[];
export declare function buildAllocationGrid(s: D.WorkspaceSnapshot, quarters: QuarterView[], o: { groupBy: 'team' | 'chapter' | 'tribe' | 'none'; pivot: 'person' | 'project'; includeTentative: boolean; thresholds: UtilisationThresholds }): GridModel;
export declare function setQuarterCell(s: D.WorkspaceSnapshot, quarters: QuarterView[], a: { resourceId: D.ID; projectId: D.ID; craftId: D.ID | null; quarterKey: D.QuarterKey; pct: number }): AllocationOp[];
export declare function copyForward(s: D.WorkspaceSnapshot, quarters: QuarterView[], a: { resourceId: D.ID; projectId: D.ID; craftId: D.ID | null; fromQuarterKey: D.QuarterKey }): AllocationOp[];
export declare function buildCapacityOutlook(s: D.WorkspaceSnapshot, quarters: QuarterView[], o: { pivot: 'craft' | 'chapter' | 'tribe' | 'person'; craftId?: D.ID; chapterId?: D.ID; tribeId?: D.ID; thresholds: UtilisationThresholds }): OutlookModel;
export declare function buildDemandGrid(s: D.WorkspaceSnapshot, quarters: QuarterView[]): Array<{ project: D.ProjectDTO; tribe: D.TribeDTO | null; cells: Array<{ quarterKey: D.QuarterKey; lines: D.DemandLineDTO[]; demandFte: number; staffedFte: number; proposedFte: number; gapFte: number }> }>;
export declare function buildCatalogue(s: D.WorkspaceSnapshot, quarters: QuarterView[], quarterKey: D.QuarterKey): CatalogueEntry[];
export declare function buildHome(s: D.WorkspaceSnapshot, quarters: QuarterView[], basis: TimeBasis, t: UtilisationThresholds, me: D.MeWorkspace | null): HomeModel;
export declare function buildTribeView(s: D.WorkspaceSnapshot, quarters: QuarterView[], tribeId: D.ID): { tribe: D.TribeDTO; projects: D.ProjectDTO[]; demandFte: number[]; staffedFte: number[]; gapFte: number[]; people: Array<{ person: D.PersonDTO; pctByQuarter: number[] }> };
export declare function buildSearchIndex(s: D.WorkspaceSnapshot): (q: string) => Array<{ kind: 'person' | 'project' | 'tribe' | 'craft'; id: D.ID; label: string; sublabel: string }>;
```

**WP-0 stub behaviour.** `state/index.ts` stubs implement every hook against an in-memory copy of `constants.ts` demo data converted to DTOs (`version: 1`, legacy ids), with mutations applied locally and resolved; `utils/viewModels/index.ts` stubs return empty-but-typed structures. C replaces both without changing exports. B must not import anything from `state/` or `utils/viewModels/` other than the names above.

### 4.4 Package checklists (definition of "package done")

**A done when:** every A-owned Must AC passes in `tests/backend/**`; `npm run typecheck`, `lint`, `test` green; `migrations/0001…0007` apply cleanly to an empty DB **and** to a Neon branch of production with a clean dry-run and parity report; no function file contains its own CORS/JWT/DB boilerplate; `docs/release/handoff-A.md` lists env vars, migrations and any cross-package requests.

**B done when:** every route in §4.3 renders against the stubs and against `HttpTransport` on a preview; zero lint/guardrail violations; every listed legacy component deleted; Lighthouse a11y ≥ 95 on the four key pages; `handoff-B.md` lists open UI defects.

**C done when:** stubs replaced; `tests/utils/**`, `tests/state/**`, `tests/shared/**` green (including same-number, `setQuarterCell` split cases, CSV parser, DemoTransport contract tests that run the same assertions against a recorded API fixture); no `fetch(` outside `services/api/httpTransport.ts`; purity check passes; `handoff-C.md`.

**I done when:** §6 acceptance checklist executed with evidence (Playwright report, screenshots, parity report), docs updated, runbook rehearsed.

---

## 5. Traceability matrix

### 5.1 Customer ask → epics and stories

| # | Customer ask (PO brief §2) | PO rating today | Epics | Stories |
|---|---|---|---|---|
| 1 | Above/below-the-table crafts per individual; allocation over QBR1–QBR4 | Partially met | E06, E07, E08 | ORG-01…04, ORG-06, PPL-01…06, AL-01…06 |
| 2 | Project requirement roadmap; anticipate craft requirements of initiated projects | Partially met | E09, E06, (E18 Should) | DM-01, DM-02, ORG-01 (tribes), PPL-07, IN-01/02 |
| 3 | Below-the-table crafts showcased; engage squad across projects and tribes; maximum efficiency | Partially met | E09, E07 | DM-03, DM-04, DM-05, PPL-05, (NT-01 Should) |
| 4 | Pan out the current state; show how to improve | Met (docs) / Partially (product) | E12, E10 | RP-01, RP-02, RP-04, JI-01 (snapshots → trend), JI-06; this backlog and §7 |
| 5 | Jira and Planview integration; story points per tribe/quarter/sprint mapped to capacity per tribe | Partially met | E10, E11 | JI-01…08, PV-01…03, ST-04, (JI-09, PV-04 Should) |
| 6 | Ultimate goal: PMO teams 100 % used | Partially met | E12, E09 | RP-03 (bands: 100 % = On target), RP-01, RP-02, DM-05, PPL-05 |
| 7a | Corporate UX/UI, crisp elements, corporate blues | Not met | E01, E02 | DS-01…08, SH-01…10, DESIGN_SYSTEM.md |
| 7b | Fully functional capacity tracker with Jira and Planview | Partially met | E05…E13 | PL-04…07 plus rows 1–6 |
| 7c | Next phase Jira Marketplace app; keep in mind now | Not met | E05, E02, E01, E10 | §1.5 enablers: PL-05, PL-06, SH-01, SH-02#AC6, DS-01, PL-07, JI-01, JI-08, AC-02; §7 |
| 7d | Existing users keep the same logins | Met (constraint) | E04, E05 | AC-01#AC4, AC-03#AC1–2, AC-07#AC2, HS-13#AC1, PL-14 |
| — | Product name decision (D-1) | — | E02 | SH-10 |
| — | Security review (engineering) | — | E03, E04, E05 | §5.2 |

### 5.2 Review finding → story

Status: **Done** (fixed on branch), **Must**, **Should**, **Could**. Every Critical (7) and High (15) finding maps to at least one Must story or is Done.

| Finding | Sev. | Story (priority) |
|---|---|---|
| SEC-01 | Critical | HS-01 (Done); client clean-up ST-07#AC3 (Must); regression PL-12#AC2 (Must); forensics CA-9 |
| SEC-02 | Critical | AC-05 (Must) |
| SEC-03 | Critical | AC-06 (Must) |
| SEC-04 | Critical | HS-04 (Must) |
| SEC-05 | Critical | HS-03 (Done); rotation CA-1; gitleaks PL-08 (Must) |
| SEC-06 | Critical | HS-02 (Done); CI name check PL-08 (Must) |
| ARC-01 | Critical | PL-03 (Must), PL-04 (Must), PL-12#AC2 (Must) |
| SEC-07 | High | HS-05 (Must) |
| SEC-08 | High | AC-07 (Must); CA-8 |
| SEC-09 | High | HS-06 (Must); CA-10 |
| SEC-10 | High | HS-07 (Must) |
| SEC-11 | High | HS-08 (Must) |
| SEC-12 | High | HS-09 (Must) |
| SEC-13 | High | AC-02, AC-03 (Must); AC-11 (Should) |
| SEC-14 | High | PL-09 (Must); CA-2 |
| UAM-01 | High | AC-01 (Must) |
| UAM-02 | High | AC-02 (Must), PL-12 (Must) |
| UAM-03 | High | PL-07 (Must) |
| ARC-02 | High | PL-04 (Must), PL-06 (Must) |
| ARC-03 | High | PL-02 (Must); PL-15 (Should) |
| STD-04 | High | PL-12 (Must) |
| OPS-01 | High | PL-08 (Must) |
| SEC-15 | Medium | HS-10 (Must) |
| SEC-16 | Medium | HS-11 (Must) |
| SEC-17 | Medium | AC-08 (Must) |
| SEC-18 | Medium | AC-08 (Must) |
| SEC-19 | Medium | HS-12 (Must), DS-01#AC1 (Must) |
| SEC-20 | Medium | PL-01#AC2 (Must) |
| SEC-21 | Medium | AC-05 (Must) |
| SEC-22 | Medium | PL-10 (Must), PL-08#AC1 (Must) |
| SEC-23 | Medium | HS-13 (Must) |
| SEC-28 | Medium | HS-16 (Must); CA-6 |
| SEC-29 | Medium | HS-15 (Must), HS-11#AC6 (Must) |
| UAM-04 | Medium | AC-09 (Must) |
| UAM-05 | Medium | AC-10 (Must); AU-01 viewer (Should) |
| UAM-06 | Medium | AC-04 (Must) |
| ARC-04 | Medium | PL-06 (Must), PL-05 (Must) |
| ARC-05 | Medium | PL-01 (Must) |
| ARC-06 | Medium | PL-01#AC3 (Must) |
| ARC-07 | Medium | SH-05 containment (Must); XT-04 unification (Could) |
| ARC-08 | Medium | SH-08 (Must) |
| ARC-09 | Medium | PL-01#AC7 (Must), HS-04#AC7 (Must) |
| STD-01 | Medium | PL-09 (Must), SH-04 (Must) |
| STD-02 | Medium | PL-11#AC2 partial (Must); PL-16 full strict (Should) |
| STD-03 | Medium | PL-11 (Must), DS-07 (Must) |
| OPS-02 | Medium | PL-01#AC5–6, AC8 (Must), PL-13 (Must) |
| OPS-03 | Medium | PL-13 (Must); PL-17 Sentry (Should) |
| A11Y-01 | Medium | DS-06 (Must) |
| A11Y-02 | Medium | DS-03 (Must) |
| A11Y-03 | Medium | DS-02#AC3, DS-08 (Must) |
| A11Y-04 | Medium | DS-08#AC3, DS-02#AC2 (Must) |
| SEC-24 | Low | HS-14 (Must) |
| SEC-25 | Low | PL-01 (Must), AC-03#AC4 (Must) |
| SEC-26 | Low | HS-16 (Must); CA-7 |
| SEC-27 | Low | HS-15#AC3, PL-09 (Must) |
| UAM-07 | Low | HS-08#AC5–6 (Must) |
| ARC-10 | Low | DS-03 (Must), SH-07 (Must) |
| A11Y-05 | Low | DS-01, DS-07 (Must) |

58 findings: 3 Done (plus their Must follow-ups), 55 covered by Must stories; Should/Could stories only extend findings already closed at Must level (SEC-13, ARC-03, STD-02, OPS-03, UAM-05, ARC-07).

### 5.3 Story count

| Priority | Count | Stories |
|---|---|---|
| Done | 3 | HS-01, HS-02, HS-03 |
| Must | 104 | DS-01…08 (8), SH-01…10 (10), HS-04…16 (13), AC-01…10 (10), PL-01…14 (14), ORG-01…06 (6), PPL-01…07 (7), AL-01…06 (6), DM-01…05 (5), JI-01…08 (8), PV-01…03 (3), RP-01…04 (4), ST-01…10 (10) |
| Should | 18 | AC-11, AC-12, PL-15, PL-16, PL-17, AL-07, JI-09, PV-04, RP-05, SC-01, SC-02, NT-01, NT-02, AU-01, OB-01, OB-02, IN-01, IN-02 |
| Could | 5 | AL-08 (= XT-02), XT-01, XT-03, XT-04, XT-05 |
| **Total** | **130** | |

---

## 6. Definition of Done and acceptance testing

### 6.1 Definition of Done: per story

1. Every AC passes and is demoed on a Netlify deploy preview backed by the Neon `preview` branch.
2. UI uses only `components/ui` and `styles/tokens.css`: no hex in components, no emoji, no `alert`/`confirm`/`prompt`, no inline theme-colour styles (`npm run lint` and `npm run check:guardrails` green).
3. Keyboard operable, visible focus, labelled controls, colour never the only signal; axe 0 serious/critical on the touched routes.
4. Every new or changed endpoint goes through `withApi` + `requireUser` + `can()`, validates input with zod, writes its audit event, and has a same-tenant and a cross-tenant test.
5. Domain logic has unit tests; the whole Jest suite is green; `npm run typecheck` green.
6. Loading, empty and error states exist for every data view.
7. Copy matches this backlog and the glossary; every metric names its time basis.
8. No business state written to `localStorage`.
9. Schema changes are in a numbered, idempotent migration that passed `--dry-run` on the preview branch.

### 6.2 Definition of Done: Release 2.0

1. All Must stories Done; Should stories either Done or explicitly moved to 3.0 in `RTM.md`.
2. CI (`ci.yml`) green on `main`: lint, typecheck, tests (≥ 60 % coverage on `netlify/functions`), audit (no high/critical), gitleaks, build, bundle ≤ 350 KB gzip for Home, dist secret grep, guardrails.
3. Playwright e2e suite green on the release-candidate preview, covering the PO journeys: sign in (existing user with 2FA); edit a person's crafts; capture demand for a new project; propose → accept in Marketplace; rebalance in the Allocation grid; run a Jira sync and view per-tribe sprint points; Planview preview and apply; export the QBR pack.
4. Visual baseline screenshots (`toHaveScreenshot`) committed for every route at 1280 and 1440 px.
5. OWASP ZAP baseline scan of the preview: no high findings. CSP enforced with no console violations.
6. Migration rehearsal on a Neon branch of production: dry-run approved by the PMO lead, parity report "0 rows lost, 0 credential changes", rollback rehearsed (PL-14).
7. Docs updated: `README.md` (run, env, deploy), `RTM.md` (REQ ids → story ids), `docs/CURRENT_STATE_AND_ROADMAP.md`, admin guide (`docs/admin-guide.md`: roles, Jira/Planview setup, calibration, migrations), glossary, release notes (`docs/release/2.0-release-notes.md`), runbook.
8. Customer actions CA-1…CA-12 confirmed done or explicitly accepted as open by the PMO lead.
9. UAT sign-off by the PMO lead with named users per persona (CA-11) on a production-like copy.

### 6.3 Acceptance-test checklist (run by PO/BA at the end)

Each line references the ACs it verifies. Run on the release-candidate preview against the Neon rehearsal branch unless stated.

**Continuity and security**
1. An existing user (password only) signs in with unchanged credentials; an existing user with 2FA signs in with the emailed code (AC-03#AC1, ST-07#AC2, HS-05#AC6).
2. A browser holding a v1.1 `pcp_token` opens 2.0 and stays signed in; `localStorage` no longer holds `pcp_token`/`pcp_user` (AC-03#AC2, AC-04#AC4).
3. Parity report shows 0 rows lost and 0 credential changes; migration re-run reports 0 pending (PL-14#AC1, PL-02#AC2, AC-01#AC3–4).
4. Reset-password and verify responses contain no code; the reset page never shows one (HS-01, ST-07#AC3, PL-12#AC2).
5. Cross-tenant attempts return 403/404: QBR read and seed, member PATCH, invite into another org, workspace creation in another org (HS-04#AC1, #AC6, AC-06#AC1, AC-05#AC3–4, AC-08#AC1).
6. Demoting a Planner to Viewer takes effect on their next request; a removed member is signed out (AC-02#AC4, AC-04#AC3, ST-02#AC5).
7. CSRF: a cookie-authenticated PATCH without `X-CSRF-Token` returns 403 (AC-03#AC3).
8. Brute force: the 11th login for one email in 15 minutes returns 429 with a friendly message (HS-05#AC3).
9. Changing the Jira site clears the stored token; a Planner cannot test the connection (HS-08#AC1, #AC5).
10. Response headers include CSP, HSTS, nosniff; no console CSP violations on every route (HS-12).
11. `/api/debug_db`, `/api/theme_extract`, `/api/email_receipt`, `/api/org_create` return 404; `POST /api/workspace` returns 410 (HS-02, HS-10, HS-07, AC-08#AC4, PL-03#AC1).
12. AI is off by default and the API answers 403; after opt-in with the egress notice, a question returns an answer and an audit event exists (HS-11#AC1–3).
13. The audit log API returns the sign-ins, role change, invitation, edits and export from this session, with no secrets in before/after (AC-10#AC1, #AC3–4).

**Design system and shell**
14. Sidebar shows the 11 grouped items at 1440×900 without scrolling; collapse persists; no emoji anywhere; favicon is the PMO Capacity Planner mark (SH-02#AC1, #AC3, DS-06#AC1, #AC3).
15. Every route opens by direct URL with the right title; `/o/:org`, `/o/:org/settings`, `/o/:org/directory` redirect (SH-01#AC1–2, #AC6).
16. Grep finds 0 `alert(`/`confirm(`/`prompt(`, 0 hex literals in `components/`/`pages/`, 0 "Orbit" strings (DS-03#AC1, DS-07#AC5, SH-10#AC1).
17. axe: 0 serious/critical on every route; Lighthouse a11y ≥ 95 on Home, Allocations, People, Settings › Members (DS-08#AC1, #AC5).
18. A delete shows the in-app confirm dialog and the Undo toast restores the item (DS-03#AC3–4).
19. Home JS ≤ 350 KB gzip; QBR pack library loads only on click (SH-08#AC1–2).
20. At 390 px nothing overlaps and editing is hidden; at 1280 px People shows QBR4 without horizontal scroll (SH-09#AC2–3, PPL-01#AC2).

**Planning features**
21. Settings › Crafts: add "Service Design (SD)"; it appears in the person crafts editor and the demand grid; renaming a craft changes no number (ORG-04#AC2, ORG-02#AC3).
22. Settings › Structure: create a chapter with a lead; assign 10 people via bulk edit in under 5 minutes; undo works (ORG-03#AC1, PPL-03#AC1, #AC3).
23. People: filter "Band: Over capacity" for QBR1 lists Maria Kelly and Noma Odigie (demo data, while QBR1 = Q4 2026); 100 % shows "On target" (PPL-01#AC3, RP-03#AC1).
24. Same-number check: Tom Hayes's QBR1 load is identical on People, Allocations and Capacity Outlook (person pivot) (RP-03#AC3, AL-01#AC5, ORG-05#AC3).
25. Allocations: rebalance Noma Odigie to On target in QBR1 within 3 keystrokes per cell, copy a booking forward to QBR2–4, then undo (AL-02#AC6, AL-03).
26. A Planview-sourced cell is locked under the default rule and editable after switching the rule to Overridable (AL-05#AC2, ST-03#AC1).
27. Demand: capture 1.0 FTE BA (Confirmed) in QBR2 for a new Initiated project; the "Initiated projects without demand" count drops (DM-02#AC2–3).
28. Marketplace: propose 0.5 FTE BA for Nebula in QBR2 as a tentative booking in ≤ 2 minutes without help; the person sees it in My Plan and accepts; time to staff is recorded (DM-03#AC2, #AC4, PPL-05#AC2; PO UX metric).
29. A tribe lead (Viewer) sees only the catalogue, can copy its link and export it, and has no edit controls anywhere (DM-04#AC1–3, SH-03#AC4).
30. A squad member submits a below-the-table craft change; the chapter lead approves it; the member sees "Approved by {name}" (PPL-06#AC1–4, PPL-05#AC3).
31. CSV: import the template with one bad row; the preview flags it; import creates/updates the rest (PPL-04#AC2–3).

**Integrations and reporting**
32. Jira (customer test site, CA-11): connect, auto-match projects, confirm, run "Sync now"; progress shows; per-tribe sprint points and implied FTE appear in Delivery › Sprints without a manual pull (ST-04#AC1, JI-02#AC2–3, JI-01#AC4, JI-05#AC1).
33. Calibration shows a suggested value with its basis; changing it requires a note and is audited (JI-04#AC1–2).
34. Delivery signal shows on the project drawer and Capacity Outlook (tribe pivot) (JI-06#AC1–2).
35. A forced Jira failure (revoked token) shows on Home within one run and in Sync health (JI-07#AC1–2, RP-01#AC4).
36. Production only: the 05:00 UTC scheduled sync runs and creates snapshot rows (JI-01#AC2).
37. Planview (customer sandbox, CA-11): preview shows new/changed/removed with field diffs; apply; a second preview shows 0 changes; manual bookings untouched (PV-01#AC1–4).
38. Reports: QBR pack PDF for the 200 × 100 × 2,000 data set downloads in under 60 s with all sections and the correct product name (RP-04#AC2, SH-10#AC2).
39. Home KPIs show 4 tiles, each with its time basis caption, no orphan tile (RP-01#AC1–2).

**Admin and first run**
40. Invite a new user by email (and, with Resend unset, by copied link); they accept, set a password and land in the workspace with the invited role (AC-05#AC1, #AC6, ST-02#AC2).
41. An expired invitation shows the expiry message (AC-05#AC7).
42. Internal mode: no Create account link, no billing or plan text, `/settings/billing` 404 (AC-07#AC4, ST-06#AC2, PL-07#AC2).
43. Feature flags: Sprint planning appears only after enabling it in Settings › Features (SH-05#AC2, ST-05#AC1).
44. Demo mode at `/demo` works without a backend and shows the demo banner (ST-10#AC1–2).
45. `GET /api/health` reports schema version and env presence booleans only (PL-13#AC1).

---

## 7. Release 3.0 "Marketplace" backlog outline (not built in 2.0)

Platform: **Forge** with **Custom UI** (the 2.0 React app in embedded mode) talking to resolvers through `@forge/bridge`. Confirm Forge limits, Connect status and revenue share on developer.atlassian.com at kick-off.

| Epic | Goal | Key stories (outline) | 2.0 enablers it relies on |
|---|---|---|---|
| R3-01 Forge app skeleton and transport | Run the planner inside Jira | `manifest.yml` with `jira:globalPage`; `ForgeBridgeTransport` implementing `Transport` via `invoke()`; resolvers that wrap the `_lib/handlers/*` logic; `view.theme.enable()` and `--ds-*` token mapping; embedded shell mode by default | PL-05, SH-02#AC6, DS-01 / DESIGN_SYSTEM §2.6, PL-04 |
| R3-02 Tenant and identity | Installation = org | Provision org on install from `cloudId`; `organizations.tenant_type`, `atlassian_cloud_id`; uninstall retention; `ForgeContextAuth` adapter returning `Actor`; `user_identities` by `accountId`; roles from app admin + Jira group rules | AC-02 adapter boundary, JI-03 `external_identities` |
| R3-03 Storage | Data on Atlassian (for "Runs on Atlassian") | Port migrations to Forge SQL (portable SQL from PL-04); KVS for settings; paginated queries; SaaS→Forge migration tool linking by email where visible, else manual | PL-02, PL-04#AC10 |
| R3-04 Jira-native data access | Drop API tokens | `requestJira` asApp/asUser with minimal scopes; reuse `_lib/jira/aggregate.ts`; `scheduledTrigger` + async events for sync | JI-01, JI-08 |
| R3-05 Modules | Meet users where they work | `jira:projectPage` (project demand, staffing, delivery signal); `jira:issuePanel` on epics ("PMO support": crafts needed/allocated, request button); `jira:adminPage` (settings, crafts, calibration, mappings); `jira:dashboardGadget` (utilisation, open demand) | SH-01 routable views, IN-01 |
| R3-06 Licensing | Marketplace billing | `context.license` → `entitlementsFor()` for `tenant_type = atlassian`; read-only when unlicensed; Stripe disabled in Forge edition | PL-07 |
| R3-07 Planview as optional egress connector | Keep Planview for customers who need it | Declare `permissions.external.fetch.backend` only when enabled; Forge secret storage; host lock-down | HS-08, HS-09, D-4 |
| R3-08 Trust and listing | Pass Marketplace review | Security self-assessment, privacy/security tab, DPA, EU data residency statement, bug bounty, app review; accountId personal-data reporting | HS-*, AC-10 audit `actor_ext_id` |
| R3-09 Must-promoted 2.0 Shoulds | Complete the product | Server-side scenarios (SC), notifications via Jira (NT), audit UI (AU), onboarding (OB), demand intake (IN) | E14–E18 |
| R3-10 Rovo agent (Could) | Optional AI inside Atlassian | Replace OpenAI egress with a Rovo agent over read-only resolvers | HS-11 |
