# PMO Capacity Planner 2.0: release notes

Version 2.0.0 replaces the v1.1 app on the same Netlify site and the same Neon database. Everyone keeps their
account, password, 2FA, roles and data. The database upgrades itself on the first request after the deploy;
nobody runs SQL by hand.

## What stays the same

- **Sign-in.** Same email and password (any letter case), same 2FA codes, same `JWT_SECRET`. A browser that was
  signed in to v1.1 stays signed in: its stored v1.1 session is exchanged once for the new secure cookie session.
  While the first requests after the deploy are still upgrading the database, that browser shows "PMO Capacity
  Planner is being updated", keeps its v1.1 session and signs in by itself a few seconds later; signing in on the
  login page in that moment says it is being updated and finishes on its own. Nobody needs to run `db:migrate`
  first.
- **Data.** Every person, project, allocation, workspace, organisation, membership and the QBR sprint data is kept
  byte for byte. The upgrade test checks this on a replica of the v1.1 production history, on PGlite and on
  PostgreSQL 16: 0 rows lost, 0 credential changes. Three things are read from v1.1 data into new 2.0 columns,
  without changing any v1.1 value:
  - a part-timer with capacity below 100 % and no target gets that capacity as their target (80 % capacity → 80 %
    target), so supply and utilisation are the same figure everywhere, including Reports and the QBR pack;
  - a craft id that v1.1 used but the catalogue did not know becomes a craft named in words with a code from the
    name ("delivery-lead" → "DL · Delivery Lead"), flagged "Imported — review" in Settings › Crafts;
  - tribes keep the v1.1 QBR tribe's spelling and lead, otherwise the most common client-name spelling.
- **Roles.** v1.1 roles map to the new five roles. Org admins and former `ADMIN` users become Org Admin.
  `SUPERUSER` becomes Platform admin, and keeps Org Admin in their own organisation. Workspace `PMO_ADMIN` becomes
  PMO Admin (Workspace Admin), `WORKSPACE_OWNER` becomes Planner, and everyone else becomes Viewer. Rights can be
  adjusted in Settings › Members and roles.
- **Plans** (public mode) behave as in v1.1: BASIC allows 5 people and 5 projects; CSV import/export and scenarios
  need PRO or above. Set `APP_MODE=internal` to give every organisation the unlimited Enterprise entitlements.
- **Links.** Old `/o/<org>` bookmarks open the organisation's workspace Home.

## What's new

**Planning**
- **Home**: squad utilisation against target, unstaffed demand, over capacity and available people, a
  four-quarter capacity vs demand chart, and what needs a decision.
- **Capacity Outlook**: supply against demand by craft, chapter, tribe or person for QBR1–QBR4, with chart and
  table views and filters kept in the URL.
- **Demand**: craft demand per project and quarter (Forecast or Confirmed), what is staffed and the gap.
- **Allocations**: a spreadsheet-style grid by person or by project. Type into a cell and press Enter or Tab to
  save. You can copy a quarter forward, paste a range from Excel, undo with Ctrl+Z, set precise booking dates,
  confirm or decline tentative bookings, and see a lock on dates managed in Planview.
- **Marketplace**: open demand ranked against people with matching crafts, proposals that people accept or
  decline in **My plan**, and a squad catalogue for tribes.

**Organisation**
- **People** with above- and below-the-table crafts, bands and four-quarter load; a person drawer; bulk edit; CSV
  import and export; and craft-change requests approved by chapter leads.
- **Projects** with stage, tribe, demand, staffing and delivery signal.
- **Tribes**, plus tribe pages with demand, staffing, people serving and calibration.
- Tribes, chapters, teams and the craft catalogue are managed in Settings.

**Delivery**
- **Jira & Planview**: project and people mapping, story-point calibration per tribe, sprints, sync health,
  "Sync now", a daily scheduled Jira sync, and a Planview import with a preview before anything is applied.
- **Sprint planning** (the v1.1 QBR module) is unchanged inside, now behind an organisation feature switch.

**Reports**: the QBR pack PDF and CSV exports (utilisation by person and by tribe, open demand, bookings, time to
staff). Every export is recorded in the audit log.

**Platform**
- New design system: corporate blue, Inter, accessible components (WCAG 2.1 AA, checked with axe on every page),
  a navy sidebar and global search (Ctrl K).
- Settings: profile, organisation, members and roles with invitations by email, structure, crafts, planning
  rules (fiscal year, band thresholds, sprint length), integrations, feature switches and billing (public mode).
- Edits save one by one, so two people can work in the same workspace. If both change the same record, the
  second person is told and nothing is silently overwritten.
- The demo workspace at `/demo` (public mode) runs entirely in the browser.

## Security changes

- Sessions are HttpOnly cookies with CSRF protection, so a session token is no longer kept where page scripts can
  read it. "Sign out everywhere" ends every session, including v1.1 ones.
- Integration credentials are encrypted with their own key (`INTEGRATIONS_ENC_KEY`), are write-only in the UI,
  and are never returned by the API.
- Every API route checks the organisation and workspace on the server. A permission matrix test covers each route
  and role.
- Rate limits apply to sign-in, codes and password reset. Reset and verification codes are never shown in the UI.
- The Content-Security-Policy is **enforced** (only the site's own scripts can run), alongside HSTS and the other
  security headers. No server key reaches the browser bundle; CI scans the build.
- Platform-admin access to an organisation is read-only and written to the audit log.

## What users will notice

- **Sprint planning is off** until an Org Admin switches it on in Settings › Features ("Sprint planning (legacy QBR
  module)"). Its data is kept, and it reappears as soon as the switch is on.
- A tab left open on v1.1 during the deploy can still read, but it can no longer save (the old bulk save is
  retired). Reloading the page loads 2.0. A tab left open across a later 2.0 deploy reloads itself once when it
  needs a newer page.
- The assistant is off per organisation until an Org Admin enables it, and it needs `OPENAI_API_KEY`.
- New accounts must verify their email. Existing accounts count as verified.

## Customer actions

| # | Action | When |
|---|---|---|
| CA-1 | Rotate the Neon `neondb_owner` password (it is in git history) and update the database variables in Netlify. Logins are unaffected. | Now |
| CA-2 | Delete the Render service and any Vercel project if they still exist. | Now |
| CA-3 | Keep `JWT_SECRET` **unchanged**. Add `INTEGRATIONS_ENC_KEY` (`openssl rand -base64 32`), then run `scripts/reencrypt_integrations.ts`. Decide the mode: `APP_MODE=internal` + `VITE_APP_MODE=internal` for a single-company deployment (unlimited entitlements; closes self-sign-up and `/demo` unless `ALLOW_PUBLIC_SIGNUP` / `VITE_ENABLE_DEMO` are set). Optional: `ALLOWED_ORIGINS`, `OPENAI_API_KEY`. After go-live, remove `VITE_OPENAI_API_KEY`, `GEMINI_API_KEY`, `API_KEY`, `VITE_GEMINI_API_KEY`, `SUPER_ADMIN_EMAIL` and `INTERNAL_API_SECRET`. | Before or right after the deploy (2.0 boots without them) |
| CA-4 | Set `RESEND_API_KEY` and **`FROM_EMAIL`** (a sender on a domain verified in Resend). Until `FROM_EMAIL` is set, mail goes from the v1.1 sender. | Before the deploy |
| CA-5 | Enable deploy previews, add `NETLIFY_AUTH_TOKEN` and `NETLIFY_SITE_ID` as GitHub secrets, and point previews at a Neon `preview` branch. | Before the rehearsal |
| CA-6 | Run `JWT_SECRET=… node scripts/check_jwt_fallback.mjs` and report "match" or "no match". | Before the deploy |
| CA-7 | Delete `testuser@test.com` from production if it exists. | Now |
| CA-8 | Name the platform admins; grant with `scripts/grant_platform_admin.mjs`. | Before the deploy |
| CA-9 | Run the SEC-01 forensics query (RUNBOOK §6) and decide on forced password resets. | Now |
| CA-10 | Stripe (public mode only): add the subscription and invoice webhook events; set `STRIPE_WEBHOOK_SECRET`. | Before the deploy |
| CA-11 | Provide a Jira Cloud test site, the Planview sandbox and field names, and named UAT users. | UAT |
| CA-12 | Agree a maintenance window, take a Neon backup branch, approve the dry-run report. | Go-live |
| CA-13 | (Optional) An uptime check on `GET /api/health`. | Go-live |
| CA-14 | **Org Admins of organisations that use Sprint planning: switch it on** in Settings › Features. | Right after go-live |
| CA-15 | Org Admins: work through the first-day checklist in [`docs/admin-guide.md`](../admin-guide.md): roles (v1.1 `USER` members become Viewers), crafts flagged "Imported — review", tribe leads, Jira and calibration, invitations. | First week |
| CA-16 | Add `GITLEAKS_LICENSE` as a GitHub secret if the repository moves to an organisation. | When needed |

## Known limitations

- A browser tab left open on the v1.1 bundle across the deploy cannot sign in again from that tab: `POST
  /api/auth/login` returns `{ user }` only and the session lives in the HttpOnly cookie (AC-03#AC1, QA-001). Reloading
  the tab loads 2.0, which signs in normally. Browsers that already hold a v1.1 token stay signed in (it is exchanged
  for a cookie session).
- The Allocations grid renders every row (no virtualisation). It is fine for a squad of a few hundred bookings
  (AL-01#AC6).
- Rollback to v1.1 is possible because v1.1 columns are still written, but data that exists only in 2.0 (demand
  lines, offers, proposals, invitations, mappings) is invisible to v1.1, and users have to sign in again.
- Should items not in 2.0: rotating refresh tokens (AC-11), support-access grants (AC-12), database roles and RLS
  (PL-15), Sentry (PL-17), Jira OAuth (JI-09), scenarios (SC-01/02), notifications inbox and email digests
  (NT-01 partly, NT-02), tribe intake (IN-01/02), audit log page (AU-01), setup checklist (OB-01), scheduled
  Planview import (PV-04), XLSX export (RP-05), and drag-and-drop in the grid (AL-08, Could).
- The dark theme tokens exist, but there is no theme switch yet. Lighthouse has not been run; axe runs on every page.
- QA items deferred to 2.0.x (docs/qa/QA_REPORT.md §4, "Resolution"): Today/Window on the quarter-shaped pages,
  and a time-basis control on Allocations (QA-020, PO decision), the v1.1 email sender fallback until `FROM_EMAIL`
  is set (QA-024), and table virtualisation (QA-017). UAT-13 (the below-the-table craft editor layout) is open.
- Linking a person in the plan to a login has no screen yet: the upgrade linked everyone whose email matched; links
  for people added later are set through the API (see the admin guide).

## Final fix round (before go-live)

After QA round 2 and user acceptance (`docs/qa/QA_REPORT.md` §0a, `docs/product/ACCEPTANCE_REPORT.md`):

- **Go-live without `db:migrate`** (QA-039): browsers holding a v1.1 session, and sign-ins typed while the database
  upgrades, wait in "being updated" and finish on their own. An exchanged v1.1 token stops working 10 minutes later.
- **One supply figure for part-timers** (QA-022, must-fix): migration 0010.
- **Readable imported crafts** (QA-014) and **tribe names and leads from v1.1** (QA-015): migrations 0011 and 0012.
  The schema is at version 12; all three are additive and idempotent and run on the first request like the others.
- **Jira settings** (UAT-01…03): a clear message when `INTEGRATIONS_ENC_KEY` is missing, "Test connection" tests
  the form, and `acme.atlassian.net` is accepted without `https://`.
- **Layout and copy** (QA-032, QA-033, QA-036, UAT-04…11): People filters on one row at 1280 px with the full band
  label and no stray "·"; Available totals banded in Allocations group rows; Capacity Outlook lists Under target
  and Available separately; "No QBR1–2 demand"; Sprint planning uses the app's quarter names; aligned Marketplace
  rows, My plan proposal line and Home side lists.
- **Admin guide**: [`docs/admin-guide.md`](../admin-guide.md) (first-day checklist for Org Admins).

Gates on the final commit: `npm run ci` (exit 0: 573 Jest tests in 41 suites, all passing, none skipped), `npm run check:guardrails -- --all` (158 files clean),
`npm run build && npm run check:bundle` (Home JS 167.5 KB gzip of 350 KB), `npm run test:e2e` (108 passed: demo and live full stack).
