# Release 2.0 runbook: go-live and rollback

Audience: whoever deploys 2.0 to the production Netlify site, with a second person checking the steps (PL-14).
Each step lists who does it, the exact command and what "good" looks like. Record times in §7.

`<site>` is the production URL (for example `https://pmocapacityplanner.netlify.app`). `PROD_URL` is the
**unpooled** production Neon URL (Netlify `NETLIFY_DATABASE_URL_UNPOOLED`). Run commands from a checkout of the
release commit, after `npm ci`.

## 0. What happens at deploy

- Netlify builds `main` and publishes the SPA and the functions together. Nobody runs SQL, and nobody has to run
  `db:migrate`: the deploy brings the schema up by itself.
- The first API requests after the publish apply the pending migrations (0001–0012) under a PostgreSQL advisory
  lock. Each file is its own transaction and is recorded in `schema_migrations` as soon as it commits, so progress
  survives from one request to the next. One function invocation applies files for at most about 4 s (the first
  file always runs), and each file runs under a `statement_timeout` that keeps the invocation inside Netlify's
  10 s limit. If files are left, that request answers 503 `migration_pending` and the next request carries on.
  The lock is released in a `finally`, and Postgres drops it anyway if an invocation dies, so it is never left held.
- While requests answer 503, users see "PMO Capacity Planner is being updated" with "Try again". They do not have
  to click: the app checks again every 3 s (every 30 s after 2 minutes) and opens the workspace as soon as the API
  is ready. On the test data the whole upgrade takes seconds. The production time per file comes from the dry run
  (step 1.4). Browsers that still hold a v1.1 token wait in the same state with the token kept, and are signed in
  by the automatic retry; someone signing in on the login page during the migration sees "being updated, retrying"
  and is signed in without a second click (QA-039). Nobody is sent to the sign-in page by the migration.
- The one case auto-migration cannot handle is a single file that by itself takes longer than about 8 s on
  production data: it is rolled back each time and logged as `migration.too_slow`. Step 1.4 catches it; then run
  step 2.4, which has no time limit.
- Users stay signed in: v1.1 sessions are exchanged for cookie sessions, and the same passwords and 2FA work.

## 1. Before go-live (T-7 to T-1 days)

| # | Step | Good |
|---|---|---|
| 1.1 | Customer actions done or explicitly accepted as open: CA-1…CA-10, CA-12 (see RELEASE_NOTES_2.0.md). At minimum: `JWT_SECRET` unchanged, `RESEND_API_KEY` + `FROM_EMAIL` set, the mode decided (`APP_MODE`), and platform admins named. | Signed off by the PMO lead |
| 1.2 | CI green on the release commit: `npm run ci`, `npm run check:guardrails -- --all`, `npm run check:bundle`, `npm run test:e2e`. | All green (GitHub Actions "CI", both jobs) |
| 1.3 | Rehearsal branch: in Neon create branch `rehearsal-2-0` from production (now). Point a deploy preview at it (Netlify → Environment variables → Deploy Previews context → database variables = the branch URL), or run the API locally: `DATABASE_URL=<branch url> npm run dev:api` with `npm run dev:vite`. | Branch exists |
| 1.4 | Dry run on the branch: `DATABASE_URL=<branch url> npm run db:migrate -- --dry-run`. | Exit 0; row counts before = after for every v1.1 table; role summary matches who should be admin; note the duration. If any single file takes more than about 8 s, step 2.4 becomes required |
| 1.5 | Full rehearsal on the branch: `npm run db:parity -- --snapshot before.json` (with `DATABASE_URL=<branch url>`), then open the preview: the first request shows the update notice or nothing, then sign-in works. Then `npm run db:parity -- --before before.json`. | "0 rows lost, 0 credential changes" |
| 1.6 | On the preview: sign in as a real user with 2FA, open every page, make one allocation edit and reload, sign out. Run `E2E_BASE_URL=<preview url> npm run test:e2e` (demo suite against the preview). | All pass |
| 1.7 | Delete the rehearsal branch, or keep it until go-live for comparison. | |

## 2. Go-live (maintenance window, CA-12)

| # | Who | Step | Good |
|---|---|---|---|
| 2.1 | PMO lead | Tell users: "2.0 goes live at HH:MM. Save your work. After the update, reload the page. Your login does not change." | |
| 2.2 | Operator | Neon → Branches → create **`pre-2-0-<yyyymmdd>`** from production at the current time (instant backup). | Branch listed |
| 2.3 | Operator | `DATABASE_URL=$PROD_URL npm run db:parity -- --snapshot before-prod.json` | File written; counts printed |
| 2.4 | Operator | **Recommended, not required.** Takes the migration off the first user requests, so nobody sees the update notice: `DATABASE_URL=$PROD_URL npm run db:migrate`. If it is skipped (or forgotten), the first requests after the publish migrate the database by themselves (§0), and v1.1 sessions wait for it instead of being signed out (QA-039). Required only when step 1.4 showed a single file slower than about 8 s. | "Applied 1, …, 12" or "0 pending" |
| 2.5 | Operator | Merge the release PR into `main`. Netlify builds and publishes (Deploys tab). | Deploy "Published" |
| 2.6 | Operator | `curl -s <site>/api/health` (repeat until 200) | `{"ok":true,"schemaVersion":12,"requiredSchemaVersion":12,…}`; `env.JWT_SECRET` and the database true |
| 2.7 | Operator | `DATABASE_URL=$PROD_URL npm run db:parity -- --before before-prod.json` | "0 rows lost, 0 credential changes" |
| 2.8 | Two testers | Smoke test (§3) | All pass |
| 2.9 | Org Admins | The first-day checklist in `docs/admin-guide.md`: CA-14 switch on Sprint planning where it is used (Settings › Features), CA-15 review roles, review the crafts flagged "Imported — review", tribe leads. | |
| 2.10 | Operator | If `INTEGRATIONS_ENC_KEY` is now set: `DATABASE_URL=$PROD_URL JWT_SECRET=… INTEGRATIONS_ENC_KEY=… npx tsx scripts/reencrypt_integrations.ts --dry-run`, then without `--dry-run`. | Counts only; "Test connection" still succeeds in Settings › Integrations |
| 2.11 | PMO lead | Announce that 2.0 is live and link the release notes. | |

## 3. Checks after go-live

1. `GET <site>/api/health` returns 200 with `schemaVersion` 12. Add it to the uptime monitor (CA-13).
2. Sign in with a v1.1 account (password and, for one account, 2FA). Home loads with the organisation's data, and
   there is no demo banner.
3. Open a browser that was signed in to v1.1 before the deploy: it is still signed in, with no new sign-in prompt.
4. People, Projects, Allocations, Demand, Capacity Outlook, Tribes, Reports, Jira & Planview and Settings all load
   without "couldn't load".
5. Make one edit (an allocation cell), reload, and check that it is still there. Undo it.
6. Download the QBR pack PDF and one CSV.
7. Netlify → Functions: `jira-sync-scheduler` and `jira-sync-worker` show a schedule. Netlify → Logs: no 5xx bursts,
   and no `migration.failed` or `crypto.bad_key` events.
8. Response headers on `<site>/`: `content-security-policy` present (enforced) and `strict-transport-security`.
   The browser console on Home shows no CSP errors.

## 4. Rollback

**Decide within the window.** Roll back only if sign-in is broken for many users, or data looks wrong and cannot
be explained. For a single broken page, prefer switching the feature off or a fix forward.

### 4.1 Application rollback (minutes, no data change)

1. Netlify → Deploys → the last v1.1 production deploy → **Publish deploy**. This restores the SPA and the functions
   together.
2. Nothing to do in the database. The 2.0 schema is additive, v1.1 ignores the new tables and columns, and every
   v1.1 column (roles, plan, org) was kept up to date by 2.0.
3. Users must sign in again (v1.1 keeps its token in the browser; 2.0 removed it). Passwords are unchanged.
4. Data entered only in 2.0 (demand lines, offers, proposals, invitations, mappings, calibration) stays in the
   database but is invisible to v1.1. Allocation and people edits made in 2.0 are visible in v1.1.
5. Rolling forward again later: publish the 2.0 deploy. Migrations are already recorded, so nothing re-runs. To give
   users and memberships created while v1.1 was live their 2.0 roles (the API already falls back to the v1.1
   columns), run this once in the Neon SQL editor:

   ```sql
   INSERT INTO org_memberships (org_id, user_id, role)
   SELECT u.org_id, u.id, CASE WHEN u.role IN ('ORG_ADMIN','ADMIN','SUPERUSER') THEN 'ORG_ADMIN' ELSE 'MEMBER' END
   FROM users u JOIN organizations o ON o.id = u.org_id
   WHERE u.org_id IS NOT NULL
   ON CONFLICT DO NOTHING;
   UPDATE workspace_members SET access_role = CASE role WHEN 'PMO_ADMIN' THEN 'WORKSPACE_ADMIN'
     WHEN 'WORKSPACE_OWNER' THEN 'PLANNER' ELSE 'VIEWER' END
   WHERE access_role IS NULL;
   UPDATE users SET email_verified_at = now() WHERE email_verified_at IS NULL AND created_at < '<roll-forward time>';
   ```

### 4.2 Data restore (only if data was corrupted)

1. Put the site into the v1.1 deploy (4.1) so nothing writes.
2. Neon → restore production from branch `pre-2-0-<yyyymmdd>` (or repoint the Netlify database variables to that
   branch and redeploy).
3. Run `npm run db:parity -- --before before-prod.json` against the restored database: it reports
   "0 rows lost, 0 credential changes" for the state at step 2.3.
4. Anything saved between step 2.2 and the restore is lost. List those users from the function logs and tell them.

### 4.3 Narrow rollbacks

| Problem | Switch |
|---|---|
| A CSP violation blocks something in production | Rename the header in `netlify.toml` to `Content-Security-Policy-Report-Only`, merge and let Netlify redeploy, then fix the cause |
| The Jira sync misbehaves | Settings › Features → "Daily Jira sync" off (per organisation) |
| The assistant | Settings › Features → AI assistant off, or remove `OPENAI_API_KEY` |
| Email | Remove `RESEND_API_KEY`: invitations fall back to copyable links |

## 5. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| 503 "is being updated" for more than 2 minutes | Normal progress is logged as `migration.applied` and `migration.deferred` (one or more files per request). `migration.too_slow` means one file needs more than one function invocation: run `DATABASE_URL=$PROD_URL npm run db:migrate`; the app picks it up within seconds. Otherwise a migration failed: Netlify → Logs → `migration.failed` shows the error. Run `DATABASE_URL=$PROD_URL npm run db:migrate` locally to see it in full. Every migration is idempotent, so re-running is safe. If the lock is stuck: `SELECT pid FROM pg_locks WHERE locktype = 'advisory' AND objid::text::bigint = 7283110020 % 4294967296;` then `SELECT pg_terminate_backend(<pid>);` |
| 503 "Service is not configured" | A required variable is missing. `/api/health` shows which (`env.JWT_SECRET`, database). |
| Everyone has to sign in again | `JWT_SECRET` changed. Restore the old value; sessions work again immediately. |
| 2FA or reset codes do not arrive | `RESEND_API_KEY` or `FROM_EMAIL` is not set, or the sender domain is not verified in Resend (log `otp.not_sent`). |
| Saving Jira/Planview credentials answers 503 `not_configured` ("Credentials cannot be saved yet …") | `INTEGRATIONS_ENC_KEY` is missing or is not 32 bytes base64 (log `crypto.bad_key`). Settings › Integrations shows the same warning before anyone types a token. |
| Sprint planning shows "Page not found" | The organisation's feature switch is off (CA-14). |
| A user sees "You don't have access" | Their role was mapped from v1.1 (`USER` → Viewer). Change it in Settings › Members and roles. |
| An old v1.1 tab cannot save ("PMO Capacity Planner was updated. Reload the page.") | Reload the page. |

## 6. CA-9: SEC-01 forensics (reset-code leak)

From 23 Feb 2026 (commit `1d55f3b`) until 2.0 is live, v1.1's `/api/auth/reset/send-otp` returned the reset code in
its response, so anyone who knew an email address could reset that account's password. v1.1 logged sign-ins
(`audit_logs.action = 'LOGIN'`) but not resets. Run these in the Neon SQL editor against production **before** the
deploy, and against the `pre-2-0` branch afterwards:

```sql
-- Sign-ins to privileged accounts since the leak shipped, per account and IP. Look for IPs nobody recognises.
SELECT u.email, u.role, l.ip_address, count(*) AS sign_ins, min(l.created_at) AS first_seen, max(l.created_at) AS last_seen
FROM audit_logs l JOIN users u ON u.id = l.user_id
WHERE l.action = 'LOGIN' AND l.created_at >= '2026-02-23'
  AND u.role IN ('SUPERUSER', 'ORG_ADMIN', 'ADMIN')
GROUP BY u.email, u.role, l.ip_address
ORDER BY u.email, first_seen;

-- Accounts whose row changed since then (a password reset updates users.updated_at), privileged first.
SELECT email, role, updated_at FROM users
WHERE updated_at >= '2026-02-23'
ORDER BY (role IN ('SUPERUSER', 'ORG_ADMIN', 'ADMIN')) DESC, updated_at DESC;
```

If an unknown IP or an unexpected change shows up, sign that account out everywhere after go-live (Settings ›
Profile › "Sign out everywhere", or bump `users.token_version`) and ask the owner to reset their password.

## 7. Rehearsal and go-live record

| Step | Date / time | Duration | Result | Initials |
|---|---|---|---|---|
| 1.4 dry run on the branch | | | | |
| 1.5 parity on the branch | | | | |
| 1.6 preview smoke + e2e | | | | |
| 2.4 / first request migration in production | | | | |
| 2.7 parity in production | | | | |
| 3 checks | | | | |

Pre-release evidence (package I):
- `tests/backend/upgrade.test.ts`: the v1.1 production history replayed in two variants (as migrated, and with
  the historical drift), on PGlite and on PostgreSQL 16. It checks the first-request migration, 0 rows lost and
  0 credential changes, that every user signs in (including 2FA and mixed-case emails), v1.1 token exchange,
  roles, the snapshot data, legacy read endpoints, the QBR switch, writes, re-running migrations as a no-op, and six
  concurrent cold starts.
- `tests/e2e/live/upgrade-live.spec.ts`: the production build against the real function handlers on that v1.1
  database, under the current production environment (no `INTEGRATIONS_ENC_KEY`, `ALLOWED_ORIGINS`,
  `APP_MODE`). It signs in through the login page, walks every page, saves an edit, exchanges a v1.1 token and
  switches Sprint planning on.
