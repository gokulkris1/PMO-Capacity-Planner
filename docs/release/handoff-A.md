# Hand-off — Package A (backend, data, CI) · Release 2.0

Branch `release2-backend-A` (based on `0b29f20`, WP-0). Not pushed, not merged.

Gates on this branch: `npm run typecheck` ✔ · `npm run lint` ✔ · `npm run format:check` ✔ · `npm test` ✔ (16 suites,
174 tests; backend 13 suites / 159 tests, backend line coverage 87 %) · `npm run build` ✔.
`node scripts/check-bundle-size.mjs` currently **fails** (405 KB gzip vs 350 KB; needs B's SH-08 code splitting and
`build.manifest: true`), and `npm run check:guardrails` needs `scripts/check-ui-guardrails.mjs` (B/I) — both are CI
steps, see §7.

---

## 1. Production constraints (override the backlog where they conflict)

| Constraint | How it is met | Backlog text it overrides |
|---|---|---|
| **Same logins** | `POST /api/auth/login` keeps path, request and response (`{ token, user }`, `user` in v1.1 shape) and *adds* the `pcp_session` / `pcp_csrf` cookies. `JWT_SECRET` and HS256 unchanged; bcrypt `$2a/$2b` verified as before, new hashes cost 12. No user column dropped or renamed (`users.role`, `users.plan`, `users.org_id` still written). v1.1 bearer tokens without `tv` are accepted as `tv = 0` and can be exchanged for a cookie session (`POST /api/auth/session`). Short legacy passwords still sign in. | AC-03 (token removed from login response) — the token is still returned; C ignores it. |
| **No maintenance window, nobody runs migrations** | Migrations auto-apply at cold start (§3). Additive and idempotent; v1.1 columns stay populated (dual write) so rolling back to v1.1 works. 503 `migration_pending` only when applying failed. | PL-02 technical note "never at function cold start"; PL-14 "deploy → 503 → operator runs db:migrate". `db:migrate` still exists for dry runs / manual runs. |
| **Legacy `POST /api/workspace`** | 410 `gone` "PMO Capacity Planner was updated. Reload the page." — the 2.0 client never calls it. Legacy `GET /api/workspace` stays read-only (by `wsId`, fallback `orgSlug`) for one release. | — |
| **Netlify 10 s limit** | Every outbound call ≤ 8 s (Jira/Planview 7 s default, AI 7 s, email 5 s, Stripe 7 s); Jira sync is chunked (≤ 7 s per step, worker every 10 min); allocation batch ≤ 500 ops; migration lock wait ≤ 7 s. | — |

Other deliberate deviations:

- **AC-01#AC2**: a v1.1 `SUPERUSER` who belongs to an org becomes `is_platform_admin = true` **and** `ORG_ADMIN` of that org (they administered it in v1.1; removing that would lock the org out). `users.role` is never rewritten.
- **SH-05**: `/api/qbr/*` now answers 403 `feature_disabled` while `features.qbrSprintModule` is off — which is the default for migrated orgs. **Orgs that use Sprint planning today must switch it on in Settings › Features** after go-live (I: add to the release notes/runbook).
- **SH-10**: the `FROM_EMAIL` fallback is still the v1.1 sender `noreply@orbitspace.io` so 2FA/reset mail keeps flowing until the customer sets `FROM_EMAIL` (CA-4). Set `FROM_EMAIL` and this fallback can be deleted.
- **HS-12#AC2**: one `netlify.toml` cannot vary headers per deploy context, so the CSP ships as `Content-Security-Policy-Report-Only` everywhere; I renames the header to enforce it after the e2e run (one-line change in `netlify.toml`). API responses carry their own strict CSP (`default-src 'none'`), HSTS, nosniff and `no-store`.
- **AC-09**: org-wide visibility gives org MEMBERs without a membership VIEWER access (as specified); this applies to `/api/qbr` and legacy `GET /api/workspace` too.

## 2. Stories

### Musts done (package A part)

SH-05 (storage, `/me`, API enforcement) · SH-08 (CI budget script) · SH-10 (emails, AI prompt, function strings; see deviation) ·
HS-01 · HS-05 · HS-06 · HS-07 · HS-08 · HS-09 · HS-10 · HS-11 · HS-12 (report-only, see above) · HS-13 · HS-14 · HS-15 (CI grep) · HS-16 ·
AC-01 · AC-02 · AC-03 · AC-04 · AC-05 · AC-06 · AC-07 · AC-08 · AC-09 · AC-10 ·
PL-02 · PL-03 · PL-04 · PL-07 · PL-08 · PL-09 (verified: `server/`, `render.yaml`, `vercel.json` gone; `jira.ts` is a 410 stub) · PL-12 · PL-13 · PL-14 (scripts; rehearsal is I) ·
ORG-02 · PPL-03 · PPL-04 (`/people/import`) · PPL-06 · AL-05 (Planview lock, tentative/confirmed) · DM-01 · DM-03 (incl. proposal email) · DM-05 ·
JI-01 · JI-02 · JI-03 · JI-04 · JI-05 (`GET …/delivery`) · JI-07 · JI-08 · PV-01 · PV-02 · PV-03 ·
RP-05 / ST-01 / ST-03 / ST-05 (`PATCH /orgs/:id`, `/workspaces/:id`) · ST-09 (`GET /api/v2/platform/overview` + platform-only legacy cockpit routes).

### Not done

| Story | Priority | Reason |
|---|---|---|
| AC-11 rotating refresh tokens | Should | Shoulds were not started; AC-03 sessions are revocable via `token_version` (`/logout-all`). |
| AC-12 support grants | Should | Not started. Platform-admin tenant access is read-only and audited (`support.access`). |
| PL-15 composite keys / `app_rw` / RLS | Should | Needs a customer-created DB role; every query is tenant-filtered and PL-12 tests it. |
| JI-09 Jira OAuth 3LO | Should | Needs an Atlassian developer app from the customer. API-token mode works. |
| SC-01, NT-01, NT-02, IN-01, AL-07 (A part) | Should | Not started. AL-07 paste-range can use `POST …/allocations/batch` (≤ 500 ops, atomic) as is. |
| PL-17 Sentry | Should | Not started; structured JSON logs with `requestId` are in place (PL-13). |

## 3. Migrations and auto-migrate design

| File | Contents |
|---|---|
| `0001_baseline.sql` | Every v1.1 table/column (including what `workspace.ts`/`integrations.ts` used to create at runtime and the old `scripts/*.sql`, now in `migrations/legacy/`), all `IF NOT EXISTS`; `migration_markers`. |
| `0002_access_model.sql` | `users.is_platform_admin / token_version / email_verified_at / password_changed_at / last_sign_in_at`; `org_memberships` (one org per user); `workspace_members.access_role`; `organizations.plan / features / planning / default_workspace_visibility / version / updated_*`; backfills (existing users verified, SUPERUSER → platform admin, roles mapped, plan from admins' `users.plan`). |
| `0003_versioning_audit_ratelimit.sql` | `version`/`updated_*` on entities, allocation `state/notes/external_ref/demand_line_id/proposed_*/responded_at`, `workspaces.data_version`, `audit_events` (+ copy of v1.1 `audit_logs` LOGIN rows), `rate_limits`, `otps.otp_hash/context`. |
| `0004_org_structure.sql` | `crafts`, `tribes`, `chapters`, `org_teams`; people/project links (`chapter_id`, `home_tribe_id`, `linked_user_id`, `tribe_affinity_ids`, `tribe_id`, `owner_user_id`, `source`); backfill from `craft_profile` JSONB, v1.1 teams and names. |
| `0005_demand_marketplace.sql` | `demand_lines` (backfilled from `projects.craft_demand`, duplicates summed), `marketplace_offers`, `craft_change_requests`, `allocations.time_to_staff_days`. |
| `0006_delivery_sync.sql` | `sync_jobs`, `delivery_snapshots`, `integration_mappings`, `external_identities`, `tribe_calibrations`, `planview_previews`; backfill of mappings/calibration from integration settings. |
| `0007_invitations_billing.sql` | `invitations`, `stripe_events`, `organizations.stripe_customer_id / stripe_subscription_id / ai_queries_month / ai_quota_reset_at`. |

**Auto-migrate.** SQL files are embedded at build time into `netlify/functions/_lib/migrations.generated.ts`
(`node scripts/db/embed-migrations.mjs`; CI runs `--check`). On the first request of a cold instance `withApi` calls
`ensureSchema()`: it reads `schema_migrations`; if anything is pending it opens one dedicated connection, takes
`pg_try_advisory_lock(7283110020)` (polling up to 7 s), re-reads, applies each pending file in its own transaction
together with its `schema_migrations(version, name, checksum)` row, and releases the lock. Concurrent cold starts wait
on the lock and then find nothing to apply. The result is memoised per instance; a failure resets the memo (the next
request retries) and that request gets 503 `migration_pending`. An edited, already-applied file is logged
(`migration.modified`) and refused by `db:migrate`. Health (`GET /api/health`) reports `schemaVersion` and
`requiredSchemaVersion` (7). Scheduled functions call `ensureSchema()` too.

Operator tools: `npm run db:migrate -- --dry-run` (applies all pending in one rolled-back transaction, prints row counts
before/after and the per-org role summary) · `npm run db:migrate` (same runner, 60 s lock wait) ·
`npm run db:parity -- --snapshot before.json` then `-- --before before.json` ("0 rows lost, 0 credential changes") ·
`node scripts/check_jwt_fallback.mjs` (CA-6) · `node scripts/grant_platform_admin.mjs --email … [--revoke]` (CA-8) ·
`npx tsx scripts/reencrypt_integrations.ts [--dry-run]` (moves legacy JWT-derived integration secrets to `INTEGRATIONS_ENC_KEY`) ·
`scripts/wipe_all.ts` is guarded (`ALLOW_DESTRUCTIVE=yes`, `PROD_DB_HOST`).

## 4. Environment variables

| Name | Purpose | Required? |
|---|---|---|
| `JWT_SECRET` | Session signing (HS256). **Keep the current production value.** 503 when missing. | **Yes** |
| `DATABASE_URL` (or `NETLIFY_DATABASE_URL_UNPOOLED` / `NETLIFY_DATABASE_URL` / `NEON_DATABASE_URL`) | Postgres; first set wins. The existing `NEON_DATABASE_URL` keeps working. Prefer the unpooled URL (advisory lock). | **Yes** |
| `INTEGRATIONS_ENC_KEY` | 32 bytes base64, AES-256-GCM for Jira/Planview secrets. Without it legacy secrets still decrypt, new ones can't be saved (503). | **Yes** (if integrations are used) |
| `APP_MODE` / `VITE_APP_MODE` | `internal` (all orgs ENTERPRISE, no billing, sign-up closed) or `public`. Default `public`. | Yes for internal deployments |
| `ALLOWED_ORIGINS` | Extra CORS origins (comma separated); the site's own `URL`/`DEPLOY_PRIME_URL`/`DEPLOY_URL` are always allowed. | No |
| `ALLOW_PUBLIC_SIGNUP` | Self-registration; default false internal / true public. | No |
| `RESEND_API_KEY` | Email (codes, invitations, receipts, proposals). Without it invitations return `emailSent: false` and links must be copied. | Strongly recommended (2FA/reset need it) |
| `FROM_EMAIL` | Sender, e.g. `PMO Capacity Planner <noreply@company.com>` (verified in Resend). | Recommended (see SH-10 deviation) |
| `APP_URL` | Base URL in emails/Stripe redirects; defaults to Netlify `URL`. | No |
| `JWT_SECRET_NEXT` | Secret rotation (accepted for verification). | No |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | AI assistant (only if an org opts in). | No |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_MAX` | Billing, public mode only; 503 when missing (no dummy fallback). | Public mode only |
| `LOG_LEVEL`, `INTEGRATIONS_FETCH_TIMEOUT_MS` | Logging; outbound timeout (capped at 8 s). | No |
| `NODE_VERSION=22`, `AWS_LAMBDA_JS_RUNTIME=nodejs22.x` | Set in `netlify.toml` (Neon Pool needs Node 22's global WebSocket). | Set by repo |
| `ALLOW_DESTRUCTIVE`, `PROD_DB_HOST` | Scripts only, never on Netlify. | No |
| `GITLEAKS_LICENSE` (GitHub secret) | Only if the repository is organisation-owned. | Conditional |
| `NETLIFY_AUTH_TOKEN`, `NETLIFY_SITE_ID` (GitHub secrets) | Branch previews; the workflow fails loudly without them. | For previews |

Removed: `SUPER_ADMIN_EMAIL` (no auto-promotion; use `grant_platform_admin.mjs`), `INTERNAL_API_SECRET` (email relay deleted), `VITE_OPENAI_API_KEY`/`GEMINI_*`/`API_KEY`.

## 5. Routes

Every v2 route needs a session (cookie + `X-CSRF-Token` on writes, or bearer) unless marked public; workspace routes
resolve the org from the workspace (unknown → 404, no access → 403). The authoritative table is `TABLE` in
`tests/backend/authz.matrix.test.ts`, which fails CI if a registered route has no row. All §4.3 routes are
implemented as specified. **Added beyond §4.3** (requested by C / the shell):

| Route | Permission | Notes |
|---|---|---|
| `PATCH /api/v2/me` | session | `{ name }` (strict; only user-editable field) → `MeResponse`; audit `user.profile_update`. |
| `POST /api/v2/orgs/:orgId/invitations/:id/resend` | `org.members.manage`, or `workspace.members.manage` for invitations only to workspaces the caller administers (same rule as revoke) | New link (old one stops working), expiry restarts → `InvitationResponse & { emailSent }`; audit `member.invite_resend`. Revoke (`DELETE …/invitations/:id`) already existed. |
| `GET /api/v2/platform/overview` | `users.is_platform_admin` | `{ orgs, workspaces, users, platformAdmins, activeSessions, signInsLast24h, unverifiedUsers, syncHealth: { queued, running, stuck, succeeded24h, failed24h, partial24h, lastFailureAt, workspacesWithJira }, generatedAt }`. `activeSessions` = users signed in within the 7-day session lifetime (sessions are stateless). Audited `support.access`. |
| `POST /api/auth/logout-all` | session (+ CSRF for cookie) | Bumps `token_version`: every cookie session and every v1.1 bearer token stops working; clears cookies; 204; audit `auth.logout_all`. `POST /logout { allDevices: true }` does the same. |
| `POST …/invitations` response | — | Now includes `emailSent: boolean`. |

**Legacy `/api/qbr/*` with cookie sessions: confirmed.** `withApi` reads `pcp_session` (Path=/api) exactly like the
v2 router; GETs need only the cookie, writes need `X-CSRF-Token` (C's `HttpTransport` sends it). Covered by
`tests/backend/v2.extras.test.ts`. Remember the `qbrSprintModule` flag (§1).

Other legacy endpoints: `/api/auth/*` (login, register, session, refresh + `GET ?refresh=true`, logout, logout-all,
reset/send-otp, reset/confirm, 2fa, 2fa/toggle, password, GET users (tenant-scoped), admin/stats and DELETE
admin/users/:id (platform only); 410 for users/invite, PUT users/:id, remove-member, POST admin/users) · `/api/verify/send|check` ·
`/api/health` (public) · `/api/ai` (HS-11) · `/api/checkout`, `/api/webhook` (HS-06) · `/api/integrations/*` (HS-08:
config read Planner+, writes/remote listing PMO Admin, usage Planner+) · `GET /api/workspace`, `/api/my_workspaces`,
`/api/workspace_lookup` (compat, DB-derived) · `/api/org_manage` (platform only; POST 410) · `/api/audit` (platform only) ·
`/api/jira` (410). Deleted: `org_create`, `email_receipt`, `theme_extract`. Scheduled: `jira-sync-scheduler`
(05:00 UTC daily) and `jira-sync-worker` (every 10 min).

## 6. Change requests for frozen contracts (`shared/**`)

1. `InvitationResponse` gains `emailSent: boolean` (returned by create and resend; typed locally as an intersection).
2. Add the four routes in §5 to the §4.3 table, plus `PlatformOverview` (shape above) and `PATCH /me` body `{ name: string }`.
3. BACKLOG names the adapter `OrbitJwtAuth`; the code calls it `SessionJwtAuth` (SH-10). Doc-only.

## 7. Cross-package requests

**I (integration / tooling)**
- Remove from `LEGACY_FILES` (eslint.config.js) **and** `.prettierignore` — rewritten by A, now lint- and Prettier-clean:
  `netlify/functions/{ai,audit,auth,checkout,integrations,jira,my_workspaces,org_manage,qbr,verify,webhook,workspace,workspace_lookup}.ts`,
  `scripts/wipe_all.ts`, `tests/backend/auth.test.ts`, `tests/backend/integrations.test.ts`.
- Remove (files deleted by A): `netlify/functions/{email_receipt,org_create,theme_extract}.ts`, `scripts/{add_skills_column.ts,check_db.mjs,diagnose_db.mjs,emergency_fix_schema.ts,fix_db.ts,fix_qbr_types.js,generateData.ts,migrate.ts,migrate_audit_logs.js,migrate_audit_logs.ts,migrate_rbac.ts,migrate_v1_2_theming.ts,migrate_v2_rbac.mjs,run_migration.mjs,seed_super_admin.ts,test_query.mjs,test_save_payload.ts,test_save_robustness.ts}`; `.prettierignore` `scripts/*.sql` (moved to `migrations/legacy/`).
- `.prettierignore` may drop `.github/` (workflows are Prettier-clean); keep `netlify.toml`/`.env.example` (no parser).
- `package.json`: `uuid` is now unused by A (PL-10#AC1 lists it for removal); add `"check:dist": "node scripts/check-dist-secrets.mjs"` if you want a script alias (CI calls the file directly).
- README lines 21–22 still say to run `scripts/migrate_*.sql` by hand — replace with "migrations apply automatically; see handoff-A §3".
- Enforce the CSP after the e2e run: rename `Content-Security-Policy-Report-Only` to `Content-Security-Policy` in `netlify.toml`.
- Runbook (PL-14): order is snapshot (`db:parity --snapshot`) → deploy (auto-migrates) → `db:parity --before` → smoke tests; `db:migrate --dry-run` against a Neon branch beforehand. Note the `qbrSprintModule` switch for orgs using Sprints.
- Coverage gate: CI passes `--coverageThreshold` on the command line; move it into `jest.config.ts` if preferred.

**B (UI)**
- `vite.config.ts`: `build.manifest: true` and route-level splitting — the Home bundle is 405 KB gzip today; CI fails above 350 KB.
- `scripts/check-ui-guardrails.mjs` must exist (CI step `npm run check:guardrails`).
- Invitation dialog: use `emailSent` to show "Copy this link — email isn't set up".
- Settings › Features copy for the QBR module: turning it off makes `/api/qbr` answer 403 `feature_disabled`.

**C (client)**
- Ignore `token` in the login response (cookie session is set); never call `POST /api/workspace` (410).
- Resend returns a **new** `inviteUrl`; replace any cached link.

## 8. Risks

- **Cold-start migration on the live DB.** The first request after deploy applies 0001–0007 under the lock; on a large DB the backfills could approach the 10 s limit. If one fails, that instance answers 503 and the next request retries (each file is its own transaction, so progress is kept). Mitigation: run `db:migrate --dry-run` on a Neon branch of production first and time it; `db:migrate` can be run beforehand to pre-apply.
- **Rollback to v1.1** works because v1.1 columns are dual-written, but rows created only in 2.0 tables (demand lines, offers, invitations…) are invisible to v1.1.
- **QBR flag defaults off** — Sprint planning users lose access until an Org Admin enables it (deliberate per SH-05).
- **Report-only CSP** until I enforces it.
- **FROM_EMAIL fallback** depends on the old verified sender domain; set `FROM_EMAIL`.
- **Scheduled functions** only run on published deploys; their URLs are not meant to be called directly (Netlify blocks direct invocation in production), and they only enqueue/advance existing jobs.
- **gitleaks-action** needs `GITLEAKS_LICENSE` if the repository moves to an organisation.
- `activeSessions` is an approximation (stateless JWT sessions).
