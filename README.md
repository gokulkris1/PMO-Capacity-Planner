# PMO Capacity Planner 2.0

Capacity, craft and demand planning for a PMO squad. It shows who holds which craft above and below the table,
what each project needs per quarter (QBR1–QBR4), where the gaps and the spare capacity are, and how the plan
compares with Jira delivery and Planview.

React 19 + Vite SPA, Netlify Functions (`/api/*`) and Neon PostgreSQL. Version 2.0.0; see
[`docs/release/RELEASE_NOTES_2.0.md`](docs/release/RELEASE_NOTES_2.0.md).

## Run it locally

Node 22 and `npm ci`.

| Command | What you get |
|---|---|
| `npm run dev:demo` | The app with the in-browser demo workspace on http://localhost:3000 (no backend, no database). |
| `npm run dev:api` + `npm run dev:vite` | The full stack: the real function handlers on an in-memory PostgreSQL (PGlite) at :8888, with Vite proxying `/api` to them. Sign up, or use `LOCAL_API_DB=v11 npm run dev:api` to start from a v1.1 production-shaped database (it prints the sign-in accounts) and watch the first request upgrade it. `DATABASE_URL=postgres://… npm run dev:api` uses a real PostgreSQL. |
| `npm run dev` | `netlify dev` (needs the Netlify CLI and a `DATABASE_URL`/`JWT_SECRET` in `.env`). |

The demo workspace is also at `/demo` on any build (`?demoRole=VIEWER|CONTRIBUTOR|PLANNER|WORKSPACE_ADMIN` switches
the role). In internal mode it is off unless `VITE_ENABLE_DEMO=true`.

## Quality gates

| Command | Checks |
|---|---|
| `npm run ci` | ESLint, `tsc` (strict, whole code base), Prettier, Jest (engine, data layer, every API handler, the v1.1 upgrade), production build |
| `npm run check:guardrails -- --all` | No emoji, hex colours, inline colour styles, native dialogs or non-lucide icons in the UI |
| `npm run check:bundle` | JS for Home (entry + Home chunk) ≤ 350 KB gzip (run after `npm run build`) |
| `npm run test:e2e` | Playwright on the production build: every route, flows, roles, axe (WCAG 2.1 AA) and no horizontal scroll at 1280 px on the demo workspace; then the live full stack, where an existing v1.1 user signs in through the real login page on a v1.1 database that the first request upgrades. Both run under the production CSP, enforced. |
| `npm run e2e:screenshots` | Review screenshots at 1440×900 and 1280×800 (light, plus dark for key pages); needs `npx vite preview` running |

`tests/backend/upgrade.test.ts` is the upgrade proof. It rebuilds the v1.1 production schema and data from the
historical migration scripts, deploys 2.0 onto it and checks that nothing is lost and everyone can still sign in.
It runs on PGlite and on a real PostgreSQL 16 (a temporary cluster from `initdb`, or `UPGRADE_TEST_PG_URL`).
CI runs all of the above on every push (`.github/workflows/ci.yml`).

## Deploy (Netlify)

Production deploys from `main` through Netlify's Git integration. Branches deploy previews from
`.github/workflows/preview-netlify.yml` after CI passes; this needs the repository secrets `NETLIFY_AUTH_TOKEN` and
`NETLIFY_SITE_ID`. That workflow never uses `--prod`. Everything else comes from `netlify.toml`:

- build `npm run build`, publish `dist`, functions `netlify/functions` (esbuild), Node 22 for the build and the
  functions (the Neon pool needs Node 22's WebSocket);
- `/api/*` → `/.netlify/functions/:splat`, then the SPA fallback `/*` → `/index.html`;
- security headers on every page: **enforced** Content-Security-Policy (`'self'` only, no inline script),
  HSTS, `nosniff`, `SAMEORIGIN`, a referrer policy and a permissions policy. Hashed assets are cached as immutable;
- scheduled functions `jira-sync-scheduler` (05:00 UTC daily) and `jira-sync-worker` (every 10 minutes), on
  published deploys only.

Going live, rolling back and the checks after deploy are in [`docs/release/RUNBOOK.md`](docs/release/RUNBOOK.md).

## Environment variables

Set these in Netlify → Project configuration → Environment variables. `.env.example` lists every name.
`GET /api/health` reports which ones are set, as booleans only.

| Variable | Needed | Without it |
|---|---|---|
| `NETLIFY_DATABASE_URL_UNPOOLED` / `NETLIFY_DATABASE_URL` / `DATABASE_URL` / `NEON_DATABASE_URL` | **Yes** (first one set wins) | API answers 503 |
| `JWT_SECRET` | **Yes. Keep the value production already uses** | API answers 503. A new value signs everyone out (no data lost) |
| `INTEGRATIONS_ENC_KEY` (32 bytes base64: `openssl rand -base64 32`) | Recommended | Existing Jira/Planview credentials keep working; saving new ones answers 503 |
| `APP_MODE` + `VITE_APP_MODE` | Recommended (`internal` for a single-company deployment) | `public`: plans apply as in v1.1 (BASIC 5 people / 5 projects, CSV and scenarios from PRO); sign-up and `/demo` open |
| `ALLOW_PUBLIC_SIGNUP` / `VITE_ALLOW_PUBLIC_SIGNUP` | Optional | Sign-up follows the mode (open in public, closed in internal) |
| `ALLOWED_ORIGINS` | Optional | Only the site's own Netlify URLs may call the API from a browser |
| `RESEND_API_KEY`, `FROM_EMAIL` | Recommended | No email: invitation links are copied by hand, 2FA and reset codes cannot be sent. Without `FROM_EMAIL` the v1.1 sender is used |
| `OPENAI_API_KEY` (`OPENAI_MODEL`) | Optional | The assistant (off per organisation by default) answers 503 |
| `STRIPE_*` | Public mode billing only | Checkout answers 503 |
| `APP_URL`, `LOG_LEVEL`, `INTEGRATIONS_FETCH_TIMEOUT_MS`, `JWT_SECRET_NEXT` | Optional | Netlify `URL`, `info`, 7000 ms, no key rotation |

Nothing falls back to a built-in secret. No server key is ever exposed to the browser bundle (CI checks `dist/`).

## Database and migrations

- The schema lives in `migrations/0001…0008_*.sql`. The files are additive and idempotent: they never drop or
  rename a v1.1 column, and v1.1 role and plan columns are still written. `scripts/db/embed-migrations.mjs` embeds
  them into the functions bundle (`netlify/functions/_lib/migrations.generated.ts`; CI fails when it is stale).
- **Nobody runs SQL by hand, and `db:migrate` is optional.** The first API requests after a deploy apply pending
  migrations under a PostgreSQL advisory lock, one transaction per file, recorded in `schema_migrations` as each
  commits. Each invocation spends at most about 4 s on migrations (always at least one file, each under a
  `statement_timeout`), so it stays inside Netlify's 10 s limit; files left over are applied by the next requests.
  Until the schema is current, requests get 503 `migration_pending` and the app shows "PMO Capacity Planner is
  being updated", retries every 3 s on its own and opens the workspace as soon as the API is ready.
  `GET /api/health` shows `schemaVersion` and `requiredSchemaVersion`.
- `npm run db:migrate -- --dry-run` applies everything inside one transaction against a copy (a Neon branch),
  prints row counts and the role mapping, then rolls back. `npm run db:migrate` applies for real.
- `npm run db:parity -- --snapshot before.json` before the deploy, then `npm run db:parity -- --before before.json`
  after it, prints "0 rows lost, 0 credential changes" or the differences (ids only).
- New migration: add `migrations/0009_<name>.sql` (additive, idempotent), run `node scripts/db/embed-migrations.mjs`
  and extend `tests/backend/migrations.test.ts`.

Operations scripts (each prints counts or ids only, never secrets):
`scripts/grant_platform_admin.mjs --email … [--revoke]`, `scripts/check_jwt_fallback.mjs`,
`npx tsx scripts/reencrypt_integrations.ts [--dry-run]` (after setting `INTEGRATIONS_ENC_KEY`), and
`scripts/wipe_all.ts` (development databases only; it refuses production).

## Code map

| Path | What |
|---|---|
| `shared/` | Contracts shared by client and server: DTOs, API routes, permissions, entitlements, features, utilisation maths |
| `netlify/functions/` | API: `v2.ts` (per-entity `/api/v2`), `auth.ts`, `verify.ts`, `integrations.ts`, `qbr.ts`, `ai.ts`, `checkout.ts`/`webhook.ts`, Jira sync scheduler and worker, `health.ts`; `_lib/` holds the handlers, auth, authz, migrations and email |
| `services/api/` | Typed API client over one transport: `HttpTransport` (cookie session + CSRF) or `DemoTransport` (in-browser demo) |
| `state/` | Client data runtime and hooks (optimistic edits, undo, conflict handling) |
| `utils/` | Pure planning engine and view-models (quarters, crafts, loads, CSV, reports) |
| `components/ui/`, `components/shell/` | Design system (`pcp-` components, tokens in `styles/`) and app shell (sidebar, top bar, search, help) |
| `pages/` | Home, My plan, Plan (Capacity Outlook, Demand, Allocations, Marketplace), Organisation (People, Projects, Tribes), Delivery (Jira & Planview, Sprint planning), Reports, Settings, sign-in pages, platform cockpit |
| `tests/` | Jest (`backend/`, `state/`, `utils/`, `shared/`) and Playwright (`e2e/`) |
| `scripts/` | Gates, DB tools, `local-api.ts` (dev-only API host) |

Product and design: `docs/product/` (backlog with acceptance criteria, design system, product brief).
Release 2.0: `docs/release/` (release notes, runbook, package hand-offs). Traceability: [`RTM.md`](RTM.md).
