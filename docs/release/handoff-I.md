# Hand-off: package I "Integration, upgrade proof, e2e, release" (Release 2.0)

Branch `claude/resource-allocation-pmo-visibility-oi2g5f`; version **2.0.0**. Package I commits are prefixed
"I:" up to `9ca4b9c`. The later ones (live e2e, CSP, polish, docs) follow it in `git log`.

## 1. Integration (step 1)

- `index.tsx` mounts C's `<DataProvider>` (demo build mode forces demo). The B2 pages are routed through
  `components/shell/pages.manifest.ts`; `RoutePlaceholder` is deleted.
- The interim imports moved to `state/` and `utils/`; the C/B2 interim modules are deleted. The paste handler
  uses `allocations.setQuarterCells` (one batch, one undo). Reports, People, Projects and the Marketplace
  catalogue call `useRecordExport` (RP-04#AC4).
- Contract change requests applied in `shared/contracts/api.ts`: `InvitationResponse.emailSent`, `MePatchRequest`,
  `PlatformOverview` (with `organisations[]` and `events[]`), and the routes `logoutAll`, `platformOverview` and
  `invitationResend`. Server, client, demo server and Cockpit follow them. "Sign out everywhere" calls
  `/api/auth/logout-all`.
- Every v1.1 UI file is deleted: `components/*` legacy, `crafts/`, `integrations/`, `context/AuthContext.tsx`,
  `services/geminiService.ts`, `utils/timeGrid.ts`, `utils/dateFilteredUtil.ts` and `styles/legacy-aliases.css`.
  `LEGACY_FILES = []`. Guardrails pass with `--all`.
- B2's interim `pages/plan/_kit` is replaced by the B1 kit: `components/ui/format.ts`, `hooks.ts`
  (`useQueryParam`, `useElementWidth`, `chainParams()` against React Router's stale functional
  `setSearchParams`), `Table`, `charts/lite`, and extended StatusPill, CraftChip, KpiTile, Select, Tabs and Menu.
  Sprint planning is rebuilt on the kit (`pages/delivery/sprints/*`).
- The Help › "Ask the assistant" drawer calls `api.ai.ask` (HS-11), gated by the `aiAssistant` flag.
- Bundle: the Vite preload helper and the CommonJS helpers go to a `runtime` chunk, because otherwise jsPDF
  landed in the entry chunk. Home is 164 KB gzip (budget 350).
- `package.json` is 2.0.0 and Help shows the version from `package.json`. The unused `papaparse`, `@types/papaparse`
  and `uuid` are removed.
- `tsconfig.json` is strict for the whole code base (PL-16), and `.claude/` is excluded.

## 2. Upgrade proof (step 2): `tests/backend/upgrade.test.ts`

- `tests/backend/helpers/v11Production.ts` replays the v1.1 production history from the historical SQL
  (`tests/backend/fixtures/v1.1/*`, from git `bf70a40` and `e418d85`), with users created in the era they joined.
  There are two variants: `replayed`, and `drifted` (the known drift: a re-run `migrate_workspace_members`, a
  hand-set `ADMIN` role, and NOT NULL legacy columns).
- It runs on {PGlite, PostgreSQL 16} × {replayed, drifted}: **49 tests, all pass.** They cover:
  - the first-request migration with sign-in;
  - parity: 0 rows lost, 0 credential changes;
  - every user signs in, including 2FA and mixed-case stored emails; a wrong password gives 401;
  - a v1.1 bearer token is accepted and exchanged, and a forged one is refused;
  - roles in `/me`; the snapshot data (people, projects, allocation %, demand sums, crafts);
  - the legacy GET `/api/workspace`, while its POST answers 410;
  - QBR answers 403 until the flag is on and 200 after;
  - writes, with v1.1 columns dual-written; the user without an org;
  - migrations re-run as a no-op; six concurrent cold starts on real PostgreSQL.
- Real PostgreSQL comes from a temporary `initdb` cluster (as root through `runuser -u postgres`) or
  `UPGRADE_TEST_PG_URL`. Without either it is skipped with a warning; PGlite always runs.
- **Bugs it found, now fixed:**
  - A stored mixed-case email could not sign in. Fix: `lower(email)` matching in `_lib/auth.ts` and `verify.ts`.
  - Concurrent cold starts gave 503 on 4 of 6 instances (a `pg_type` unique violation). Fix: `migrate.ts` takes
    the advisory lock before `CREATE TABLE IF NOT EXISTS schema_migrations`.

## 3. End-to-end (step 3): Playwright, 73 tests, all pass

- `playwright.config.ts` defines two projects:
  - **demo**: the production build served by `vite preview` on :4173.
  - **live**: the same build on :4174, proxied to `scripts/local-api.ts` on :8899. That is the real function
    handlers on a PGlite database built as the v1.1 replay, run with the current production environment
    (`CONTEXT=production`; no `INTEGRATIONS_ENC_KEY`, `ALLOWED_ORIGINS`, `APP_MODE`, `FROM_EMAIL` or OpenAI/Resend keys).
- Specs:

  | Spec | Tests | Covers |
  |---|---|---|
  | `demo-routes.spec` | 26 | every route renders its H1, with no horizontal scroll at 1280 |
  | `a11y.spec` | 22 | axe WCAG 2.0/2.1 A+AA, 0 serious or critical |
  | `demo-flows.spec` | 8 | edit a cell + undo, add demand, propose and accept, bulk edit, CSV and PDF downloads, settings |
  | `demo-roles.spec` | 7 | Viewer, Contributor and Planner write-gating |
  | `security.spec` | 3 | enforced CSP header, inline script refused, stale-chunk reload |
  | `live/upgrade-live.spec` | 7 | below |

- **The live full-stack run ran and passes (7 tests).** An existing v1.1 user signs in through the real login page
  with their old password, and the first request migrates the database. A wrong password is refused. The main pages
  and every settings page show the migrated data with no 5xx. An allocation edit survives a reload. Sign out works.
  A browser holding a v1.1 localStorage token stays signed in and the token is removed. An Org Admin switches
  Sprint planning on and sees the v1.1 QBR data.
- Every test fails on any console error or page error (`tests/e2e/fixtures.ts`).
- CI: `ci.yml` has a new `e2e` job (demo + live) on every push. `preview-netlify.yml` runs the demo project against
  the deploy preview.
- Supporting fixes made for the e2e:
  - The signed-out boot no longer calls `/api/v2/me` without the `pcp_csrf` cookie (no 401 noise).
  - Dialog close: two `setSearchParams` calls in the same tick no longer overwrite each other.
  - axe name mismatches fixed.
  - Invitations use `emailSent`.
- Dev tools: `npm run dev:api` (local API host) and `npm run e2e:screenshots`.

## 4. Visual polish (step 4)

Screenshots are at 1440×900 and 1280×800, light, with dark for login, Home, Allocations, Capacity and People, in
`/tmp/claude-0/-home-user-PMO-Capacity-Planner/30300e26-6330-58c3-8326-070765d23fff/scratchpad/integration/`.
Fixes:
- The top bar showed a hard-coded "Live" pill in the demo; it now shows "Demo" (info) or "Live".
- Allocations and Demand used a 16 px gutter, so their actions overhung the banner. They now use the shell gutter.
- Sign-in has a navy brand rule, a primary-blue card edge and a slightly larger value line. That stays within
  ST-07#AC1 (no gradient or hero image).
- The grouped bar chart widens its bars when there are few categories.

## 5. Production safety review (step 5)

- `netlify.toml`:
  - build, `dist`, functions dir with esbuild, Node 22 for the build and the functions;
  - `/api/*` → functions (force), then the SPA fallback;
  - headers and the immutable assets cache are all correct.
- **CSP is now enforced** (`Content-Security-Policy`). `vite preview` serves the same policy, enforced and read
  from `netlify.toml`, so all 73 e2e tests run under it. The client only connects to `'self'`. Rollback: rename
  the header to `-Report-Only`.
- **The current production environment boots.** It needs only `JWT_SECRET` and `NETLIFY_DATABASE_URL*`; with no
  `INTEGRATIONS_ENC_KEY`, `ALLOWED_ORIGINS` or `APP_MODE`, nothing answers 5xx. This is proven by the live e2e
  (every page and every settings page) and by the upgrade test.
- `APP_MODE` unset means public mode. Plan limits then match v1.1 (BASIC 5 people / 5 projects, CSV from PRO), so
  nothing tightens for existing orgs.
- `npm ci && npm run build` was run in a clean `git archive` of HEAD and passes. Every function bundles with
  esbuild and loads, and `health` answers without a database (503 with the env booleans).
- **No manual step is needed for logins.** Same `JWT_SECRET`, bcrypt, case-insensitive email, v1.1 token exchange,
  and existing users count as verified.
- Added a one-time reload on `vite:preloadError`, because Netlify serves `index.html` for a missing hashed chunk
  after a redeploy.
- The HTTP contract fixture was re-recorded against the real handlers, and its token is redacted.
- CI checks pass locally: `embed-migrations --check`, `check:pure`, `check-dist-secrets`, `check-function-names`,
  and `npm audit --omit=dev` (0 vulnerabilities). Gitleaks itself only runs in GitHub.

## 6. Docs (step 6)

- `README.md` covers running, gates, deploy, environment variables, migrations and the code map;
  `NETLIFY_SETUP.md` is merged into it and deleted.
- `RTM.md` is v2.0, one row per backlog story.
- `docs/release/RELEASE_NOTES_2.0.md`, `docs/release/RUNBOOK.md` (go-live, checks, rollback, troubleshooting,
  CA-9 queries, rehearsal record) and this file.

## 7. Open issues

1. ~~AC-03#AC1 deviation: the login body still returns the v1.1 `token`.~~ Resolved by QA-001: the login body is
   `{ user }`; the session is only in the HttpOnly cookie. v1.1 tokens already in a browser are still exchanged.
2. **AL-01#AC6:** the Allocations grid is not virtualised above 200 rows.
3. **PL-14#AC2:** the rehearsal on a Neon branch of production has not been done (it needs CA-5/CA-12). The
   evidence so far is the replay on PGlite and PostgreSQL 16, plus the live e2e.
4. Shoulds not started: AC-11, AC-12, PL-15, PL-17, JI-09, SC-01/02, NT-02, IN-01/02, AU-01, OB-01, PV-04,
   RP-05. NT-01 is partly done. The Could AL-08 is not done.
5. Lighthouse has not been run (axe passes everywhere). The dark theme has no switch yet (tokens exist).
6. The SEC-01 reset-code leak is still live on the current production (v1.1) until 2.0 is deployed. CA-9
   forensics and an early go-live are recommended.
7. Owner pickers in Demand and Projects list only the current user and existing owners (B2 open issue 6).
8. Native `<select>` is still used in some B2 filters instead of the kit Combobox (works and is accessible).

## 8. Customer actions

CA-1 to CA-13 as in BACKLOG §2 and RELEASE_NOTES_2.0.md. These matter most for the release:
- **CA-4: set `FROM_EMAIL`** (and `RESEND_API_KEY`).
- **CA-3: keep `JWT_SECRET`**, add `INTEGRATIONS_ENC_KEY` and decide `APP_MODE`.
- **CA-14: Org Admins switch on Sprint planning** where it is used.
- **CA-15: review mapped roles.**
- CA-12: maintenance window and Neon backup branch.
- CA-9: run the forensics queries in RUNBOOK §6.
