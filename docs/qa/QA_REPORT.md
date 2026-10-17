# PMO Capacity Planner 2.0: independent QA report

| | |
|---|---|
| Release | 2.0.0 (branch `claude/resource-allocation-pmo-visibility-oi2g5f`, round 1 tested at `ec7415c`, round 2 re-tested at `0844ca5`) |
| Test dates | 17 Oct 2026 |
| Tester | Independent adversarial QA (Claude), on behalf of gokulkris1 |
| Scope | `docs/product/BACKLOG.md` Must stories (104), §6.3 acceptance checklist (45 items), `PRODUCT_BRIEF.md`, `RELEASE_NOTES_2.0.md`, `RUNBOOK.md` |
| Product code changed | None. QA added only this report, `tests/qa/**` (Jest) and `tests/e2e/qa/**` (Playwright). |

## 0. Fix round (17 Oct 2026, after this report)

Every Critical and Major defect is fixed, re-tested and guarded by a test that names it; 31 of the 38 defects are
fixed and 7 Minor or Cosmetic ones are deferred with a reason (the "Resolution" column of §4). All skipped QA Jest
tests and all `fixme` QA Playwright tests are now plain tests and pass, with regression tests added where QA had
none (QA-009/010 in `tests/qa/integrations.qa.test.ts`, QA-011 in `tests/backend/deployRecovery.test.ts` and
`tests/e2e/live/maintenance.spec.ts`, QA-013 in the live e2e, QA-004 and QA-002 same-number tests in
`tests/utils/sameNumber.test.ts`). The go-live conditions in §1 are met: QA-011 no longer needs an operator step
(RUNBOOK §0, §2.4: `db:migrate` before publish is recommended, not required), QA-006/QA-007 are fixed rather than
waived, and QA-001 is fixed rather than accepted.

Gates on the fix round: `npm run ci` (547 Jest tests, 39 suites), `npm run check:guardrails -- --all`,
`npm run build && npm run check:bundle` and `npm run test:e2e` (demo and live full stack) all green. The schema is
now at version 9 (0008 revoked sessions for QA-019, 0009 craft short codes for QA-034).

## Re-test (round 2)

Independent re-test of the fix round at `0844ca5`, 17 Oct 2026. QA re-ran every gate. Each defect marked Fixed was
checked again with its original repro steps on the live local full stack (`LOCAL_API_DB=v11`, plus PostgreSQL 16
for the deploy scenarios). A regression sweep was run around each change, and the 7 deferrals were reviewed. Round-2
evidence is under `$QA/r2/`, and gate logs are under `$QA/logs/r2/`. No product code was changed by QA.

### R2.1 Verdict

**Go with conditions.** The conditions are operational only; go-live needs no further code change.

- **Fixes hold.** All 11 Critical and Major defects are verified fixed. No Critical or Major defect was reopened or
  newly found.
- **Gates are green.** `npm run ci` passes with 549 tests in 40 suites (548 passed, 1 skipped: QA-039). The e2e suite passes with 92 of 92 tests, demo and live full stack. Guardrails are clean
  (158 files), Home JS is 167.0 KB gzip against a 350 KB budget, and `npm audit --omit=dev` reports 0.
- **Security and same-number checks hold.** The authorisation matrix is still 621 of 621. axe now reports
  **0 findings in 180 scans**, down from 28 pages with serious findings. The same-number guarantee holds across
  every view checked on live data.
- **Open items.** 29 of the 31 claimed fixes are verified; 2 Cosmetic fixes are reopened (QA-032, QA-036). One new
  Minor defect was found (QA-039), and one deferral reason is not accepted (QA-033).

Conditions for go-live:

1. **Run RUNBOOK step 2.4 (`db:migrate`) before publishing, despite "recommended, not required".** Without it, every
   v1.1 user who opens the app while the first requests migrate lands on the sign-in page (QA-039). Users with a 2.0
   cookie session are fine, but on go-live day every user is a v1.1 user.
2. **Set `FROM_EMAIL` (CA-4) before go-live.** Until then, invitation, reset and 2FA emails come from the v1.1
   `noreply@orbitspace.io` sender (QA-024, deferred).
3. **PO sign-off on the data-mapping deferrals QA-014, QA-015 and QA-022.** QA-014 is visible on the standard v1.1
   replay: a craft named `delivery-lead` with code `X7AC` appears in the craft pickers, in Demand › By craft, in the
   Marketplace filter and in Tom Hayes's My plan.
4. **Run the checks this sandbox cannot.** These are unchanged from §10: the Neon dry run (RUNBOOK 1.4, which also
   decides whether step 2.4 is required), the customer Jira site and Planview sandbox (§6.3-32/34/37), Netlify headers
   on the deploy preview, and Lighthouse.

### R2.2 Gates

| Gate | Round 2 result | Log |
|---|---|---|
| `npm run ci` (lint, typecheck, format, Jest, build) | Exit 0: 549 tests, 40 suites, 548 passed, 1 skipped (QA-039, new in round 2) | `$QA/logs/r2/npm-run-ci-2.log` |
| `npm run check:guardrails -- --all` | 158 files clean | `$QA/logs/r2/guardrails.log` |
| `npm run check:bundle` | Home JS 167.0 KB gzip (budget 350 KB) | `$QA/logs/r2/bundle.log` |
| `npm run test:e2e` (demo + live full stack) | Exit 0: 92 passed (demo + live), including the 16 QA tests in `tests/e2e/qa/` | `$QA/logs/r2/e2e-2.log` |
| `npm audit` | 0 production vulnerabilities (`--omit=dev`). Two moderate dev-only advisories have appeared since round 1 with the same lockfile: `esbuild` under `tsx` (dev server on Windows) and `sprintf-js` under Jest | `$QA/logs/r2/audit.log` |
| Authorisation matrix (69 endpoints × 9 roles) | 621 of 621 | `$QA/r2/security-matrix.json` |
| Targeted security checks | 118: 114 pass. The 4 others are expected: AC02-4 now answers 401 instead of 403 (stricter, because of the QA-008 fix), and AC02-7b, SEC01-c and PL01-size are the same false alarms as in round 1 | `$QA/r2/security-checks.json` |
| Session regression checks (QA-001, QA-008, QA-019) | 10 of 10 | `$QA/r2/sessions-checks.json` |
| Live functional flows (every role) | 151 checks: 137 pass, 1 N/T, 13 first-run fails, all triaged as script or data issues (§R2.5) | `$QA/r2/functional-results.jsonl` |
| axe, 36 routes and states × 1440/1280/768 × light/dark | 180 scans, **0 violations** (round 1: 28 pages with serious findings) | `$QA/r2/shots/report-tom-all-all.json` |
| Screenshots | 360 sweep + 124 flow captures | `$QA/r2/shots/`, `$QA/r2/flows/` |

During the first round-2 `npm run ci`, `tests/backend/migrations.test.ts` › "gives up waiting for a lock held
elsewhere without applying" timed out at Jest's default 5 s, while QA's browser runs were loading the machine. It
passed 3 times in isolation and in the clean re-run. The test is not new, but its 5 s budget is tight for a PGlite
start-up on a loaded CI runner, so it may flake.

### R2.3 Defect-by-defect result

"Verified" means the original repro was re-run and now gives the expected result.

| ID | Sev | Dev resolution | Round 2 | Evidence |
|---|---|---|---|---|
| QA-005 | Critical | Fixed e1f3dd0 | **Verified.** Live import of the same CSV: "1 created, 1 updated, 0 skipped". Zoë is created with PM, SM:2:30 and BA:1:20, target 90 and skills; Noma is matched by email and updated. Bad rows are still flagged in the preview. | `r2/functional-results.jsonl` (F6-import), `r2/flows/F6-import-result.png` |
| QA-001 | Major | Fixed 913eb8d | **Verified.** Login returns `{ user }` (AC03-1c). The 2FA second step returns `{ user }`. Refresh, `/session` and `/me` carry no JWT for cookie clients. A v1.1 token is still exchanged for a cookie with `{ user }` (AC03-2a/b). A bearer refresh still returns a token, but only to v1.1 bearer holders. | `r2/security-checks.json`, `r2/sessions-checks.json` |
| QA-002 | Major | Fixed eb91245 | **Verified.** Live, all 6 people × QBR1–4 (24 cells) match on People, the Allocations person rows and Capacity Outlook (person pivot), including Noma at 111 % (target 90). | `r2/shots/tom-1440x900-light-allocations.png`, `…-people.png`, `r2/flows/R2-same-outlook-person.png` |
| QA-003 | Major | Fixed 7ae3a2f | **Verified.** As Owen, on the locked Planview booking: PATCH `source`, `percentage`, `externalRef`, `notes` and `state`, a batch update, a batch source change and DELETE all get 409. Creating a booking with `source: planview` gets 400. The row is unchanged. (A PATCH that sets `externalRef` to its current value is a no-op 200.) | `r2/functional-results.jsonl` (R2-QA-003) |
| QA-004 | Major | Fixed 5c7ef43 | **Verified.** Unstaffed demand per quarter matches at the same moment in the open-demand CSV, Demand › By craft and the Marketplace (QBR1 0.9, QBR2 3.0, QBR3 1.3, QBR4 0). Home, Tribes (Payments "Gap 0.9"), Projects ("In Flight · gap 0.9") and the QBR pack also match for QBR1. | `r2/functional-results.jsonl` (R2-same-unstaffed, R2-same-unstaffed-all), `r2/flows/R2-same-*.png` |
| QA-006 | Major | Fixed e541c6c, a7dd124 | **Verified.** At 768 px, names are readable on People and Projects, and Allocations chips wrap without overlapping. | `r2/shots/tom-768x1024-light-people.png`, `…-projects.png`, `…-allocations.png` |
| QA-007 | Major | Fixed e541c6c | **Verified.** axe finds 0 violations on Allocations › By project and on Capacity at 768, and on every other route. | `r2/shots/report-tom-all-all.json` |
| QA-009 | Major | Fixed 863d6d0 | **Verified.** With egress failing, Jira test, projects, boards and usage all get 502 "Could not reach Jira at acme.atlassian.net. Check the address and try again in a minute." in about 10 ms; nothing is logged as unhandled. The UI toast shows the same text. | `r2/evidence-QA-009.txt`, `r2/functional-results.jsonl` (F8-jira-test) |
| QA-010 | Major | Fixed 863d6d0 | **Verified against the real `acme.atlassian.net`** with a fake token. Test connection gets 502 "Jira rejected the credentials (401)…", the sync job fails with "Jira rejected the credentials", health is `failed`, and the Home banner shows the reason. | `r2/evidence-QA-010.txt`, `r2/functional-results.jsonl` (F8-sync, F8-home-banner) |
| QA-011 | Major | Fixed 773608b | **Verified, with a new Minor gap (QA-039).** Tested on PostgreSQL 16 holding v1.1 data, with no manual `db:migrate`. (a) Fresh deploy: the first requests apply 0001–0009 and the user lands on Home in 4 s. (b) Migration lock held by another session for 25 s: a 2.0 cookie session shows "PMO Capacity Planner is being updated … Checking again automatically" and opens Home by itself at 23 s, with no reload. (c) Migration 0009 blocked by a table lock: `statement_timeout` cancels it at about 8 s, the request answers within 9 s (under Netlify's 10 s), the failure is logged as `migration.too_slow`, and a later request applies it. | `r2/QA-011.jsonl`, `r2/QA-011-*.png`, `r2/QA-011-*.api.log` |
| QA-013 | Major | Fixed fb3b7fb | **Verified.** The confirm dialog lists the people per chapter. 4 chapters are created and 5 of 5 people with an above-the-table craft are assigned. | `r2/functional-results.jsonl` (F7-chapters-create) |
| QA-008 | Minor | Fixed 197eb6d | **Verified.** After a role change the old token gets 401. A PATCH that sets the same role keeps the session. Self-PATCH keeps working with the fresh cookie. | `r2/security-checks.json` (AC06-2), `r2/sessions-checks.json` |
| QA-012 | Minor | Fixed cba1da9 | **Verified.** Entering 151 shows "Enter 0–150", the drawer stays open and nothing is saved. Typing a valid value then saves. One harness quirk: Playwright `fill()` into the rejected field produced "9585"; real keyboard input is correct. | `r2/flows/R2-drawer-151.png` |
| QA-016 | Minor | Fixed cba1da9 | **Verified.** At 390 px: 0 editable cells and no Add booking or Add person. | `r2/functional-results.jsonl` (F10-390) |
| QA-018 | Minor | Fixed f8a90cd | **Verified.** My plan shows "Approved by Pat PMO". | `r2/flows/F13-approved.png` |
| QA-019 | Minor | Fixed 197eb6d | **Verified.** After plain sign-out, the same cookie, and the same JWT sent as a bearer, both get 401, and refresh cannot revive it. A second browser stays signed in. Residual risk: a v1.1 token (which has no `jti`) is not revoked by plain sign-out or by the exchange. It expires within 7 days of go-live, and "Sign out of all devices" does revoke it. | `r2/sessions-checks.json` |
| QA-021 | Minor | Fixed cba1da9 | **Verified.** "Too many attempts. Try again in 4 minutes." | `r2/flows/F1-ratelimit-ui.png` |
| QA-023 | Minor | Fixed f8a90cd | **Verified.** The Home list is titled "Available", "below 50 % of target", and matches the tile (2 people). | `r2/shots/tom-1440x900-light-home.png` |
| QA-025 | Minor | Fixed cba1da9 | **Verified** at view-model level (`tests/qa/viewModels.qa.test.ts` now passes). The live seed has no `'TBC'` row. | Jest |
| QA-026 | Minor | Fixed f8a90cd | **Verified.** The Jira card shows "SYNC FAILING" with "Could not reach Jira…". | `r2/functional-results.jsonl` (F8-calibration-view text) |
| QA-027 | Minor | Fixed cba1da9 | **Verified.** Signed out: "Sign in first, then enter the 6-digit code…" with a "Sign in to verify" button. | `r2/shots/tom-1440x900-light-verify-email.png` |
| QA-028 | Minor | Fixed cba1da9 | **Verified.** `people-2026-10-17.csv` and `squad-catalogue-2026-10-17.csv`. | `r2/functional-results.jsonl` (F6-export, F5-export) |
| QA-029 | Minor | Fixed f8a90cd | **Verified.** The toggle stays off and shows "The AI assistant is not set up on this deployment (no OpenAI key)…". | `r2/flows/R2-ai-toggle.png` |
| QA-037 | Minor | Fixed 7baf420 | **Verified.** e2e `security.spec.ts` now asserts every HS-12 header. They are still Vite-served, not Netlify-served (see §10). | `$QA/logs/r2/e2e-2.log` |
| QA-038 | Minor | Fixed f8a90cd | **Verified** live. A new org shows "Start your plan" with Add people and Install sample data. Sample data installs with fresh UUIDs, and a second install gets 409. "Import CSV" is not shown on this live org because it depends on the plan's `csvImport` entitlement, which a new public-mode org does not have. The entitlement check matches PL-07. | `r2/flows/F14-create-org.png`, `r2/functional-results.jsonl` (F14-sample) |
| QA-030 | Cosmetic | Fixed f8a90cd | **Verified.** 0 `color-contrast` findings on all dark pages. | `r2/shots/report-tom-all-all.json`, `r2/shots/tom-768x1024-dark-settings-members.png` |
| QA-031 | Cosmetic | Fixed f8a90cd | **Verified.** The cover reads "generated 17 Oct 2026". | `r2/qbr-pack.pdf` |
| QA-032 | Cosmetic | Fixed cba1da9 | **Reopened.** My plan is fixed ("Tom Hayes · target 100%"). At 1280 px and below, the People row subtitle folds the team into the job-title line and shows "· Programme Management" for Tom Hayes, whose job title is empty: the same separator bug, in code added by the QA-006/QA-036 changes. | `r2/flows/R2-QA-036-people-1280.png`, `r2/shots/tom-768x1024-light-people.png` |
| QA-034 | Cosmetic | Fixed cba1da9 | **Verified.** The table fits its card at 1440, and the codes are PGM and PDM. | `r2/shots/tom-1440x900-light-settings-crafts.png` |
| QA-035 | Cosmetic | Fixed cba1da9 | **Verified.** With an unsaved change, scrolled to the bottom, the save bar sits 70 px below the last help text. | `r2/flows/R2-QA-035-planning-bottom-dirty.png` |
| QA-036 | Cosmetic | Fixed cba1da9 | **Reopened.** "Already exists" and the invite copy are fixed. But the band filter still truncates, to "Band (QBR1): a…", at 768, 1280 and 1440 px, and at 1280 px the filter bar still wraps ("Group: none" drops to a second line). | `r2/flows/R2-QA-036-people-1280.png`, `r2/shots/tom-1440x900-light-people.png` |

### R2.4 Deferred items: are the reasons acceptable?

| ID | Sev | Dev reason (short) | QA view |
|---|---|---|---|
| QA-014 | Minor | Changing how v1.1 craft ids migrate needs PO sign-off | **Acceptable as a deferral, but decide before go-live.** It is visible on the standard v1.1 replay, not only on dirty data: `delivery-lead` / `X7AC` appears in pickers, By craft, the Marketplace filter and My plan, and the crafts `x` / `X9DD` exist too. If the PO keeps the migration as is, an admin can rename or archive these crafts after go-live. |
| QA-015 | Minor | Restoring tribe leads and casing needs a PO rule | **Acceptable.** Both can be edited in Settings › Structure, and it changes no number. |
| QA-017 | Minor | Virtualisation is a grid rework; first paint ≤ 1.5 s at 500 people | **Acceptable.** It matches the round-1 measurements and is documented in the release notes. |
| QA-020 | Minor | Today/Window on quarter-shaped pages is a product decision | **Acceptable as a PO decision.** One correction: "every page already uses ?basis=" is not accurate. People, Capacity and Tribe detail do, but Allocations has no time-basis control. |
| QA-022 | Minor | Mapping part-time capacity to a target changes production data; needs PO decision | **Acceptable, with PO sign-off before go-live.** It is a same-number deviation on Reports (supply 0.8 vs denominator 1.0 FTE for one person). |
| QA-024 | Minor | Deliberate: the v1.1 sender is the only verified domain until `FROM_EMAIL` is set (CA-4) | **Acceptable only if `FROM_EMAIL` is set before go-live** (condition 2). |
| QA-033 | Cosmetic | "No untinted Available value found on re-test; Available uses the sunken tint by design" | **Not accepted; still reproducible.** Person rows tint Available cells with the sunken background, but the Allocations group rows show Available totals untinted, while Under and Over totals in the same rows are tinted. Examples: "Programme Management" QBR4 31 %, "Delivery" 0 % and 30 %, "Digital Planning" QBR3–4 0 %. It is Cosmetic and can stay deferred, but the reason should be corrected. Evidence: `r2/shots/tom-1440x900-light-allocations.png`. |

### R2.5 New defects found in round 2

| ID | Sev | Area | Steps to reproduce | Expected | Actual | Evidence | Story / AC |
|---|---|---|---|---|---|---|---|
| QA-039 | Minor | Deploy: v1.1 session during migration | PostgreSQL 16 with v1.1 data and no manual `db:migrate`. Hold the migration advisory lock from another session for 25 s, or block migration 0009 with a table lock. Open the app in a browser holding the v1.1 `localStorage.pcp_token`. Separately, try to sign in on `/login` during the migration. | The same "is being updated" notice and automatic retry as a cookie session; afterwards the user is signed in. Sign-in during the migration says the app is being updated. | `POST /api/auth/session` gets 503 `migration_pending`, and the runtime goes straight to the sign-in page with no notice and no retry. It stays there after the migration finishes (92 s observed). The v1.1 token is kept, so a manual reload after the migration signs the user in (verified), as does signing in with the unchanged password. Signing in during the migration shows "Something went wrong. Try again, or quote reference …". Cause: `DataRuntime.boot()` treats an exchange result of `failed` with no CSRF cookie as anonymous. | `r2/QA-011.jsonl` (scenarios lock, slowfile, lock-login, and lock with reload), `r2/QA-011-lock-final.png`, `r2/QA-011-lock-login-login-during-migration.png`; test `tests/qa/deploy.qa.test.ts` › "QA-039 …" (skipped) | AC-03#AC2, SH-07#AC4, §6.3-2 |

Triage of the 13 first-run failures in the live functional flows. None is a product defect:

- **F2-lock:** my script sent a PATCH without the `patch` envelope, which is a no-op 200. The lock was re-checked
  correctly in R2-QA-003.
- **F4-gaplink:** the By-craft gap links exist and point to the Marketplace filtered by craft and quarter, but are
  named by their value ("0.9"), so my selector missed them.
- **F6-export-formula and F6-report-formula:** the import fixture's formula row is invalid by design, so no formula
  name existed. Re-checked with a renamed person in R2-csv-formula: People export and the Utilisation-by-person
  report both prefix `'`.
- **F6-drawer-save:** caused by the Playwright `fill()` quirk above; keyboard entry saves.
- **F6-drawer-crafts, F6-band, F7-rename-archive, F8-health, F8-calibration-view, F10-search, F10-titles:** the same
  selector and expectation mistakes already reclassified as Pass in round 1, with the same evidence.
- **F9-ai:** expected, because the QA-029 fix now refuses to switch AI on without a key. Re-checked in R2-ai.

### R2.6 Updated counts

| Severity | Round 1 | Fixed and verified | Reopened | Deferred (open) | New in round 2 | **Open after round 2** |
|---|---:|---:|---:|---:|---:|---:|
| Blocker | 0 | 0 | 0 | 0 | 0 | **0** |
| Critical | 1 | 1 | 0 | 0 | 0 | **0** |
| Major | 10 | 10 | 0 | 0 | 0 | **0** |
| Minor | 20 | 14 | 0 | 6 | 1 | **7** (QA-014, 015, 017, 020, 022, 024, 039) |
| Cosmetic | 7 | 4 | 2 | 1 | 0 | **3** (QA-032, 033, 036) |
| **Total** | 38 | 29 | 2 | 7 | 1 | **10** |

New QA test committed in round 2: `tests/qa/deploy.qa.test.ts`. It has 1 passing test and 1 skipped test, QA-039,
which fails today for the reason above. The QA test files the developer edited in the fix round still keep every
original assertion; the round-1 skipped and `fixme` tests were only un-skipped, and further tests were added.

The rest of this report (§1–§11) is the round-1 record and is kept unchanged, apart from the developer's
"Resolution" column and §0. The §1 verdict is superseded by §R2.1.

## 1. Verdict

_Round-1 verdict, superseded by §R2.1._

**Go with conditions.**

The security model holds: the 69-endpoint × 9-role authorisation matrix passed every cell (621 of 621), no
cross-tenant read or write was possible, CSRF, origin and JWT checks behave, and the v1.1 → 2.0 upgrade lost no row
and changed no credential, including on deliberately dirty v1.1 data (PGlite and PostgreSQL 16). The baseline gates
(`npm run ci`, guardrails, bundle budget, e2e) are green.

The release is not ready to go live as it stands. One Critical and ten Major defects break core planning workflows
or the same-number promise. The conditions below are blocking for go-live, not for merging.

**Conditions for go-live (fix and re-test):**

1. **QA-005** (Critical): CSV people import skips every row with an above-the-table craft on the live API.
2. **QA-002** and **QA-004**: the same-number guarantee is broken for anyone whose target is not 100 % and for
   unstaffed demand (Home, Demand, Projects and Tribes against Marketplace and the QBR pack).
3. **QA-003**: a Planner can unlock a Planview-sourced booking through the API.
4. **QA-009** and **QA-010**: Jira failures surface as HTTP 500, and a sync whose credentials Jira rejects is
   reported as "Succeeded" and "Healthy".
5. **QA-013**: "Create chapters from crafts" says it assigns people but assigns nobody.
6. **QA-011**: mitigate operationally. RUNBOOK §2.4 must run `db:migrate` before publish; otherwise every user is
   stuck on "Loading your workspace" while the API answers 503 `migration_pending`.
7. **QA-006** and **QA-007**: product decision. Either fix the 768 px tables and the two serious axe findings, or
   formally waive SH-09#AC1 and DS-08#AC1 for 2.0.
8. **QA-001**: a documented known limitation in the release notes. The PO accepts it or it is fixed.

Minor and Cosmetic defects can follow in 2.0.x.

## 2. Test counts

| Activity | Executed | Passed | Failed / open | Notes |
|---|---:|---:|---:|---|
| `npm ci` | 1 | 1 | 0 | `logs/npm-ci.log` |
| `npm run ci` (lint, typecheck, format, Jest, build), baseline | 455 tests | 455 | 0 | `logs/npm-run-ci.log` |
| `npm run ci` with the QA suites added | 520 tests / 37 suites | 512 | 8 skipped (open defects) | `logs/npm-run-ci-final.log` |
| Guardrails (lint rules for hex, emoji, `alert`, `confirm`) | 157 files | clean | 0 | `logs/guardrails.log` |
| Bundle budget (Home JS gzip ≤ 350 KB) | 1 | 164.5 KB | 0 | `logs/bundle.log` |
| Developer e2e (Playwright demo + live) | 73 | 73 | 0 | `logs/e2e.log` |
| e2e with QA spec added | 80 | 74 | 6 `fixme` (open defects) | `logs/e2e-final.log` |
| `tests/backend/upgrade.test.ts` (PGlite + PostgreSQL 16) | 49 | 49 | 0 | |
| `npm audit` | 1 | 0 vulnerabilities | 0 | |
| **New QA Jest tests** (`tests/qa/**`, 5 files) | 65 | 57 | 8 skipped (open defects) | |
| **New QA Playwright tests** (`tests/e2e/qa/**`) | 7 | 1 | 6 `fixme` (open defects) | |
| Live functional checks (Playwright scripts, every role, local stack) | 170 | 158 | 9 defects; 3 superseded | `functional-results.jsonl` |
| Security authorisation matrix (69 endpoints × 9 roles) | 621 cells | 621 | 0 | `security-matrix.json` |
| Targeted security checks | 118 | 112 | 3 defects; 3 triaged as test errors | `security-checks.json` |
| axe-core scans (WCAG 2.1 A/AA), 36 routes and states at 1440, 1280 and 768, light and dark | 180 | 152 | 28 pages with serious findings (QA-007, QA-030) | `shots/report-tom-*.json` |
| Screenshots (1440×900, 1280×800, 768×1024, light and dark, plus flow captures) | 489 | | | `shots/`, `flows/` |
| CSP sweep on the production build (25 live routes) | 25 | 25 | 0 | 0 CSP violations |
| Time-zone quarter-edge tests (6 zones × 5 cases) | 30 | 30 | 0 | `tests/qa/quarters.tz.qa.test.ts` |

The 9 functional failures are the defects QA-005, QA-009, QA-011, QA-013, QA-016, QA-018, QA-021, QA-028 and
QA-038. The 3 superseded checks are dev-server performance runs, measured again on the production build (§9.3). Nine
further first-run failures were test-script errors (selector or expectation mistakes). They were re-checked by hand
and reclassified as Pass: F2-lock, F6-band, F7-dup, F7-rename-archive, F8-health, F8-calibration-view, F10-search,
F10-titles and SH02-nav.

**Evidence root.** The paths below are relative to the QA evidence folder
`/tmp/claude-0/-home-user-PMO-Capacity-Planner/30300e26-6330-58c3-8326-070765d23fff/scratchpad/qa/`, written `$QA/`.
That folder is session scratch space and is not committed. Every Critical and Major defect except QA-009, QA-010,
QA-011 and QA-013 is reproduced by a committed skipped or `fixme` test that names the defect ID. Those four depend
on outbound network or browser timing and are documented with logs.

## 3. Defect summary

| Severity | Count | IDs |
|---|---:|---|
| Blocker | 0 | |
| Critical | 1 | QA-005 |
| Major | 10 | QA-001, QA-002, QA-003, QA-004, QA-006, QA-007, QA-009, QA-010, QA-011, QA-013 |
| Minor | 20 | QA-008, QA-012, QA-014 to QA-029, QA-037, QA-038 |
| Cosmetic | 7 | QA-030 to QA-036 |
| **Total** | **38** | |

## 4. Defect table

Personas: Tom = `Tom.Hayes@acme.example` (platform admin and Org Admin), Pat = `pat.pmo@…` (PMO Admin), Owen =
`owen.owner@…` (Planner), Noma = `noma.odigie@…` (Viewer, target 90 %), Bea = `bea@beta.example` (other tenant).
"Live" means the local stack (`scripts/local-api.ts`, `LOCAL_API_DB=v11`, Vite on :3000). "Demo" means `/demo`.

### 4.1 Critical and Major

| ID | Sev | Area | Steps to reproduce | Expected | Actual | Evidence | Story / AC | Resolution |
|---|---|---|---|---|---|---|---|---|
| QA-005 | Critical | People: CSV import | Live, as Pat: People › More actions › Import CSV. Upload the downloaded template with one valid row (`above_craft` = `PM`) and one row updating Noma. The preview shows "2 valid". Click "Import 2 valid rows". | Rows are created or updated; result "1 created, 1 updated, 0 skipped". | "0 created, 0 updated, 2 skipped. Row 1: Too big: expected string to have <=10 characters". `parsePeopleCsv` resolves short codes to craft ids (`PM` → `project-mgmt`), and the `/people/import` schema caps `aboveCraft` at 10 characters (`netlify/functions/_lib/handlers/people.ts:362`). Every seeded craft id is longer than 10 characters, so every row with an above-the-table craft is skipped. The demo transport does not apply the schema, so the developer e2e passes. | `$QA/flows/F6-import-preview.png`, `$QA/flows/F6-import-result.png`, `$QA/logs/import-test.csv`; test `tests/qa/people.import.qa.test.ts` › "QA-005 …" | PPL-04#AC3, §6.3-31 | Fixed in e1f3dd0 |
| QA-001 | Major | Auth: session | `POST /api/auth/login` with valid credentials. | The body is `{ user }` only; the session lives only in the HttpOnly `pcp_session` cookie. | The body is `{ token, user }`. The 7-day JWT is readable by any script, which defeats the point of the HttpOnly cookie. Listed under "Known limitations" in the release notes. | `$QA/security-checks.json` (AC03-1c); test `tests/qa/security.qa.test.ts` › "QA-001 …" | AC-03#AC1 | Fixed in 913eb8d |
| QA-002 | Major | Allocations: same number | Live: Noma has target 90 % and 100 % booked in QBR1. Open People, then Allocations (person pivot). Demo: set Tom Hayes's target to 80 % in the person drawer, then open Allocations through the sidebar. | People, Home, Capacity Outlook and the Allocations person row show the same number (load as % of target). | People and Outlook show Noma at 111 % "Over capacity". The Allocations person row shows 100 %, under the same legend. In demo, People shows 73 % and the grid shows 58 %. The grid uses `cells[].pct` (raw load) where every other view uses `relativePct`. | `$QA/shots/tom-1440x900-light-allocations.png`, `$QA/shots/tom-1440x900-light-people.png`; tests `tests/qa/viewModels.qa.test.ts` › "QA-002 …" and `tests/e2e/qa/qa-findings.spec.ts` › "QA-002 …" | RP-03#AC3, AL-01#AC5, §6.3-24 | Fixed in eb91245 |
| QA-003 | Major | Allocations API: Planview lock | Live, as Owen (Planner), with the org rule "Planview bookings: Locked". `PATCH /api/v2/workspaces/:ws/allocations/:id` on a Planview booking with `{ percentage: 5 }` returns 409. Send `{ source: 'manual' }` instead, then `{ percentage: 5 }`. | 409 "Locked: sourced from Planview" for any change, including `source`. | `source: 'manual'` returns 200 and unlocks the booking; the next percentage edit returns 200. The UI lock (read-only cell and tooltip) works. | `$QA/logs/evidence-QA-009-QA-003.txt`; test `tests/qa/security.qa.test.ts` › "QA-003 …" | AL-05#AC2, §6.3-26 | Fixed in 7ae3a2f |
| QA-004 | Major | Demand: gap maths | Live: QBR1 has an open 0.9 FTE Scrum Master demand line on a project already staffed by a Product Manager at 120 %. Compare Home "Unstaffed demand", Demand, Projects and Tribes with Marketplace, Demand › By craft and the QBR pack. | One number: unstaffed demand is computed per craft everywhere. | Home shows 0.0 FTE unstaffed for QBR1, and Demand, Projects and Tribes show no gap. Marketplace, By craft and the QBR pack show 0.9 FTE Scrum Master open. `buildHome` and the project and tribe views net staffing at project level (any craft); `buildOpenDemand` works per craft. | `$QA/shots/tom-1440x900-light-home.png`, `$QA/shots/tom-1440x900-light-marketplace.png`, `$QA/shots/tom-1440x900-light-demand-bycraft.png`; test `tests/qa/viewModels.qa.test.ts` › "QA-004 …" | RP-01#AC1, DM-02, DM-03#AC5, RP-03 | Fixed in 5c7ef43 |
| QA-006 | Major | Responsive: tables | Open People, Projects and Allocations at 768×1024 (light or dark). | Tables reflow or scroll; names stay readable. | The People and Projects name columns collapse to 0 px, so no person or project name is visible. In Allocations, chips overlap the names. | `$QA/shots/tom-768x1024-light-people.png`, `$QA/shots/tom-768x1024-light-projects.png`, `$QA/shots/tom-768x1024-light-allocations.png`; test `tests/e2e/qa/qa-findings.spec.ts` › "QA-006 …" | SH-09#AC1 | Fixed in e541c6c (chip wrap a7dd124) |
| QA-007 | Major | Accessibility | Run axe (WCAG 2.1 A/AA) on Allocations › By project (`?pivot=project`) at any width, and on Capacity Outlook at 768 px. | 0 serious or critical findings on every route. | `label-content-name-mismatch` (serious, 20 nodes): cells show "0.0" but are labelled "Nebula, QBR1, 0.0 FTE". `scrollable-region-focusable` (serious): `.pcp-tbl-wrap` on Capacity at 768 px cannot be scrolled from the keyboard. | `$QA/shots/report-tom-1440-light.json`, `$QA/shots/report-tom-768-all.json`, `$QA/shots/tom-1440x900-light-allocations-byproject.png`; tests `tests/e2e/qa/qa-findings.spec.ts` › "QA-007 …" (two tests) | DS-08#AC1, §6.3-17 | Fixed in e541c6c |
| QA-009 | Major | Integrations: error handling | Live, as Pat, with outbound HTTP failing (`QA_EGRESS=fail` preload: DNS or connection failure). Settings › Integrations › Jira › Test connection. Also call `GET /api/integrations/jira/projects`, `GET …/boards` and `POST …/usage`. | A clear 502 message within about 8 s ("Could not reach Jira …"); never a 500. | All four return HTTP 500 "Server error"; the toast says "Server error". `safeFetch` rethrows the network `TypeError`, and `withApi` maps it to 500. The hang case is handled correctly: 502 "did not respond within 8s" at about 8.0 s. | `$QA/logs/evidence-QA-009-QA-003.txt`, `$QA/flows/F8-jira-test-fail.png` | HS-08 (error contract), ST-04#AC1 | Fixed in 863d6d0 |
| QA-010 | Major | Jira sync | Live, as Pat, with outbound network open. Save Jira site `acme.atlassian.net` with a fake API token. Test connection returns 502 "Jira 401". Click "Sync now". | The sync job fails with the Jira auth error; Sync health shows "Failed"; Home shows the banner. | The job is `succeeded` (1 page, 0 issues). Health is `ok`, the Delivery card says "CONNECTED · HEALTHY · Last successful sync just now", and no banner appears. `jira/sync.ts` treats the 200 answer that Jira Cloud returns for an unauthenticated JQL search as success. | `$QA/logs/evidence-QA-010.txt`, `$QA/flows/F8-delivery-connected.png` | JI-01#AC5, JI-07#AC1–2, §6.3-35 | Fixed in 863d6d0 |
| QA-011 | Major | Shell: maintenance | Deploy the new client before `db:migrate`. Simulated by routing `/api/v2/me` to 503 `{ code: 'migration_pending' }`. Open the app. | A full-page "PMO Capacity Planner is being updated" notice with Try again. | The app stays on the "Loading your workspace" spinner indefinitely. The maintenance page is shown only when the snapshot call returns 503, not `/me`. | `$QA/flows/F11-503.png`, `$QA/flows/F11-503-snapshot.png` (snapshot path works) | SH-07#AC4 | Fixed in 773608b |
| QA-013 | Major | Settings › Structure | Live, as Pat: Settings › Structure › Chapters (none yet) › "Create chapters from crafts". The confirm dialog says "People are assigned by their primary craft". Confirm. | 4 chapters created, each person assigned to the chapter of their primary craft. | 4 chapters created; `chapterId` stays null for all 8 people. `createChaptersFromCrafts()` in `pages/settings/StructureSettings.tsx` only creates chapters. | `$QA/logs/evidence-QA-013.txt`, `$QA/flows/F7-chapters-confirm.png` | ORG-03#AC3, §6.3-22 | Fixed in fb3b7fb |

### 4.2 Minor

| ID | Sev | Area | Steps to reproduce | Expected | Actual | Evidence | Story / AC | Resolution |
|---|---|---|---|---|---|---|---|---|
| QA-008 | Minor | Members API | As Tom, change Owen's workspace role with `PATCH /api/v2/orgs/:org/members/:id`, then call `/api/v2/me` with Owen's old token. | The role change bumps `token_version`; the old token returns 401. | The old token is still accepted (200). Authorisation is read from the database on every request, so the effect is limited (the next write is 403 when demoted; AC02-4 passes). | `$QA/security-checks.json` (AC06-2); test `tests/qa/security.qa.test.ts` › "QA-008 …" | AC-06#AC2 | Fixed in 197eb6d |
| QA-012 | Minor | Person drawer | Demo or live: open a person and set Target utilisation to 151 %. Save. | An inline error ("0–150 %"); the drawer stays open. | A "Saved" toast and the drawer closes; nothing is saved (the target is unchanged on reopen). | `$QA/flows/F6-drawer-151.png`; test `tests/e2e/qa/qa-findings.spec.ts` › "QA-012 …" | PPL-02#AC3 | Fixed in cba1da9 |
| QA-014 | Minor | Migration: crafts | Upgrade v1.1 data whose `craft_profile` or allocations name crafts not in the catalogue (`delivery-lead`, `x`, `unknown-craft`). | Unknown ids are mapped to an "Unmapped" bucket or reported in the parity report. | They become catalogue crafts with generated short codes (`X7AC`, `X9DD`, `XC03`). | `tests/qa/upgrade.edge.qa.test.ts` run (passes; behaviour observed in the migrated `crafts` table) | ORG-01#AC2 | Deferred: changes how v1.1 craft ids migrate on production data; mapping them to an "Unmapped" bucket instead of catalogue entries needs PO sign-off before the migration is rewritten |
| QA-015 | Minor | Migration: tribes | Upgrade v1.1 data with `qbr_tribes` leads and mixed-case `client_name` values. | Tribes keep their v1.1 lead names; the name casing comes from the most common or the QBR tribe name. | Migrated tribes have `lead = null` (only tribes created after the upgrade have a lead). The casing comes from an arbitrary v1.1 `client_name`, for example "PAYMENTS". | `$QA/functional-results.jsonl` (F7-tribe), `$QA/shots/tom-1440x900-light-tribes.png` | ORG-01#AC3 | Deferred: restoring v1.1 tribe leads and casing rewrites migrated tribe rows and needs the PO rule for which v1.1 name wins; both are editable in Settings › Structure meanwhile |
| QA-016 | Minor | Responsive: 390 px | Open Allocations at 390×844. | Editing is hidden (read-only cells, no Add booking). | 28 editable cells live (95 in demo), and "Add booking" and "Add person" are shown. Nothing overlaps, and the menu button works. | `$QA/flows/F10-390-allocations.png`; test `tests/e2e/qa/qa-findings.spec.ts` › "QA-016 …" | SH-09#AC2, §6.3-20 | Fixed in cba1da9 |
| QA-017 | Minor | Performance: large tables | Seed 500 people × 100 projects × 2,500 bookings; open People and Allocations on the production build. | Large tables are virtualised (DS-04#AC5); editing stays responsive. | Not virtualised: People renders 500 rows and 29 k DOM nodes; Allocations renders 1,001 rows and 34 k nodes. First paint is still ≤ 1.5 s, and a cell edit takes 872 ms with about 450 ms long tasks. The Allocations case is a documented known limitation; People is not documented. | `$QA/flows/F12p-org-people.png`, `$QA/flows/F12p-plan-allocations.png`, `$QA/logs/perf-seed.json` | DS-04#AC5, AL-01#AC6 | Deferred: virtualising People and the Allocations grid is a table/grid rework (keyboard grid, sticky groups, undo focus); first paint stays ≤ 1.5 s at 500 people; documented AL-01#AC6 limitation for 2.0.x |
| QA-018 | Minor | My plan: craft requests | As Noma, request a below-the-table craft. Pat approves it in Settings › Requests. Noma opens My plan. | "Approved by Pat PMO" is shown on the request. | No "Approved by {name}" outcome is shown in My plan (the approval itself works). | `$QA/flows/F13-approved.png`, `$QA/flows/F13-requests.png` | PPL-06#AC4, §6.3-30 | Fixed in f8a90cd |
| QA-019 | Minor | Auth: sign-out | Sign in, copy the `pcp_session` value, sign out (plain), and replay the cookie. | The session is revoked on the server. | The replayed cookie still authenticates (200) until it expires (7 days). "Sign out of all devices" does revoke it. | `$QA/security-checks.json` (AC03-6f); test `tests/qa/security.qa.test.ts` › "QA-019 …" | AC-03#AC6 (hardening) | Fixed in 197eb6d |
| QA-020 | Minor | Shell: time basis | Open Capacity Outlook, People, Allocations and Tribes; open the time-basis selector. | Today / QBR / Window options, persisted in `?basis=`. | The Today and Window options are missing, and there is no `?basis` parameter on these pages. | `$QA/shots/tom-1440x900-light-capacity.png`, `$QA/shots/tom-1440x900-light-people.png` | SH-03#AC2 | Deferred: these pages are quarter-shaped (QBR1–QBR4 columns, band filter per quarter), so what Today and Window mean there is a product decision; Home offers all six bases and every page already uses ?basis= |
| QA-021 | Minor | Sign-in: rate-limit copy | Make 11 failed sign-ins for one email within 15 minutes in the UI. | "Too many attempts. Try again in {n} minutes." (the API sends it). | The UI shows "Too many attempts. Wait a few minutes and try again." and ignores the API message and `Retry-After`. | `$QA/flows/F1-ratelimit-ui.png`, `$QA/security-checks.json` (HS05-3a) | HS-05#AC3, ST-07, §6.3-8 | Fixed in cba1da9 |
| QA-022 | Minor | Migration: part-time capacity | v1.1 person Kerrie has capacity 80 % (part-time). After the upgrade, open Reports › Utilisation by tribe and the Capacity Outlook. | One supply figure: either the target becomes 80 % or supply counts 1.0 FTE everywhere. | Reports "Supply" counts 0.8 FTE (5.7 FTE), but the utilisation denominator uses 1.0 FTE (5.9 FTE, 58 %); the target migrated as 100 %. | `$QA/logs/utilisation-by-tribe-2026-10-17.csv`, `$QA/shots/tom-1440x900-light-reports.png` | RP-03, ORG-01 (migration mapping) | Deferred: mapping v1.1 part-time capacity to a target changes production people data in a migration; needs the PO decision (target = capacity, or supply counts 1.0 FTE) |
| QA-023 | Minor | Home | Open Home and look at the "Under target" list. | RP-01#AC3: an "Available" list (people in the Available band) that matches the People filter "Band: Available". | The list mixes Available-band and Under-target people under one heading, so its count differs from the People band filter. | `$QA/shots/tom-1440x900-light-home.png` | RP-01#AC3 | Fixed in f8a90cd |
| QA-024 | Minor | Product name | Send an invitation or reset email without `FROM_EMAIL` set. | The sender is a PMO Capacity Planner address. | The sender is `noreply@orbitspace.io` (`LEGACY_FROM` in `netlify/functions/_lib/email.ts`). The UI and the bundle have no "Orbit" text, apart from a localStorage purge key. | code reading; `dist` grep | SH-10#AC1 | Deferred: deliberate SH-10 deviation (handoff-A §1): the v1.1 sender is the only Resend-verified domain until the customer sets FROM_EMAIL (CA-4); changing the fallback would stop 2FA and reset email |
| QA-025 | Minor | Data robustness | A v1.1 allocation with a non-ISO TEXT date (`end_date = 'TBC'`) survives the migration (allowed). Open People and Allocations. | The row is ignored or flagged; numbers stay finite. | The view-model load for that person computes as `NaN` instead of ignoring the row. | test `tests/qa/viewModels.qa.test.ts` › "QA-025 …" | PL-02 / ORG-06 data hygiene | Fixed in cba1da9 |
| QA-026 | Minor | Delivery: status card | With a failing Jira sync (egress fail), open Jira & Planview. | The card shows a failed state with the actual reason. | The card still says "CONNECTED", and the reason is the generic "Sync failed" (Home banner "Jira sync failed 1 minute ago: Sync failed"). | `$QA/flows/F8-delivery-sync-fail.png`, `$QA/flows/F8-home-banner.png` | JI-07#AC1, ST-04 | Fixed in f8a90cd (reason: 863d6d0) |
| QA-027 | Minor | Verify email page | Open `/verify-email` while signed out. | Either a sign-in prompt or a working flow. | A code form is shown that cannot succeed without a session. | `$QA/shots/tom-1440x900-light-verify-email.png` | ST-07#AC4 | Fixed in cba1da9 |
| QA-028 | Minor | Export file names | Export People CSV and the squad catalogue CSV. | `{page}-{yyyy-mm-dd}.csv` (DS-04#AC7). | `people-2026-Q4.csv` and `squad-catalogue-2026-Q4.csv`. Reports use dates correctly. | `$QA/functional-results.jsonl` (F6-export, F5-export) | DS-04#AC7, PPL-04#AC4 | Fixed in cba1da9 |
| QA-029 | Minor | AI assistant | Live, without `OPENAI_API_KEY`: Settings › Features › turn on the AI assistant (the confirm and egress notice work), then ask a question. | The toggle is unavailable, or a clear "AI is not configured" message appears. | The toggle succeeds (audited), and every question answers "Something went wrong. Try again, or quote reference …". | `$QA/flows/F9-ai-confirm.png`, `$QA/flows/F9-ai-drawer.png` | HS-11#AC2, ST-05 | Fixed in f8a90cd |
| QA-037 | Minor | Security headers: test gap | Fetch any page from `vite preview` (the e2e server). | The e2e checks the HS-12 headers that Netlify serves. | `vite preview` serves only the CSP header, so HSTS, `nosniff`, `Referrer-Policy` and `Permissions-Policy` from `netlify.toml` are not exercised by any automated test. | `$QA/logs/preview.log`, `netlify.toml` | HS-12, §6.3-10 | Fixed in 7baf420 |
| QA-038 | Minor | First run | Live, as `loner@nowhere.example` (no org): create "Lone Ranger PMO". | Home shows the first-run EmptyState (Add people / Import CSV / Install sample data). | Home shows a zeroed dashboard ("Everyone is at or above target", 0 FTE tiles). The first-run EmptyState with "Install sample data" is not shown. The org and the first workspace are created correctly. | `$QA/flows/F14-create-org.png` | ST-08#AC1 | Fixed in f8a90cd |

### 4.3 Cosmetic

| ID | Sev | Area | Steps to reproduce | Expected | Actual | Evidence | Story / AC | Resolution |
|---|---|---|---|---|---|---|---|---|
| QA-030 | Cosmetic | Dark theme | Force `prefers-color-scheme: dark`; open Settings pages. | Contrast ≥ 4.5:1. | axe `color-contrast` (serious) on the active settings-nav item on all 9 Settings pages; the brand pill is also low contrast. The dark theme has no switch in 2.0, so users cannot reach it except through the OS setting. | `$QA/shots/report-tom-1440-dark.json`, `$QA/shots/tom-1440x900-dark-settings-members.png` | DS-01#AC4 | Fixed in f8a90cd |
| QA-031 | Cosmetic | QBR pack | Reports › QBR pack (PDF). | The cover date reads "17 Oct 2026". | The cover date is truncated to "17 Oct 202". | `$QA/logs/qbr-pack.pdf`, `$QA/flows/F10-qbrpack-1.png` | RP-04#AC2 | Fixed in f8a90cd |
| QA-032 | Cosmetic | Person subtitle | Open a person whose job title is empty. | "Tom Hayes · target 100 %". | "Tom Hayes · · target 100 %" (double separator). | `$QA/shots/tom-1440x900-light-people-drawer.png` | PPL-02 | Fixed in cba1da9 |
| QA-033 | Cosmetic | Band tint | People and Allocations cells with Available values such as 27 % and 31 %. | The Available tint on every Available value. | Some Available cells render untinted. | `$QA/shots/tom-1440x900-light-people.png` | RP-03#AC1 | Deferred: no untinted Available value found on re-test; Available uses the neutral sunken tint by design (DESIGN_SYSTEM §2.4 contrast choice), so a distinct tint is a design decision |
| QA-034 | Cosmetic | Settings › Crafts | Open at 1440×900. | The table fits its card; seeded short codes follow the "2–4 capital letters or digits" rule. | The table overflows the card on the right; the seeded short codes `PgM` and `PdM` break the rule the form enforces. | `$QA/shots/tom-1440x900-light-settings-crafts.png` | ORG-04 | Fixed in cba1da9 (seed codes: migration 0009) |
| QA-035 | Cosmetic | Settings › Planning | Scroll to the bottom with unsaved changes. | The sticky save bar does not cover content. | The save bar overlaps the last help text. | `$QA/shots/tom-1440x900-light-settings-planning-full.png` | ST-03 | Fixed in cba1da9 |
| QA-036 | Cosmetic | People filter, copy | People at 1280 px; Add tribe with a duplicate name; invite dialog note. | Full filter label; spec copy. | The band filter truncates to "QBR1: Over capac…" and the filter bar wraps. The duplicate-name text is "A tribe with this name already exists." (spec: "Already exists"); the invite note wording differs from ST-02. | `$QA/shots/tom-1280x800-light-people.png`, `$QA/flows/F7-dup.png` | PPL-01, ORG-02#AC1, ST-02 | Fixed in cba1da9 |

## 5. AC pass/fail matrix (every Must story)

Status: **Pass** means every AC exercised passed. **Partial** means some ACs pass and the listed defects cover the
rest. **Fail** means a core AC fails. **N/T** means not testable here (see §10). The basis column names the evidence:
the functional check ID in `$QA/functional-results.jsonl`, the security check in `$QA/security-checks.json`, or a
gate.

| Story | Title | Status | Basis / defects |
|---|---|---|---|
| DS-01 | Design tokens, base styles, self-hosted Inter | Pass | No Google Fonts in `dist`, guardrails clean; dark-mode contrast QA-030 (cosmetic, theme hidden) |
| DS-02 | Core UI primitives | Pass | axe clean in light theme apart from the QA-007 pages; visual review |
| DS-03 | Overlays, no native alert/confirm | Pass | Guardrails; F6-delete (confirm + Undo), F9-ws-delete (type-to-confirm), F3-conflict |
| DS-04 | Data table | Partial | QA-017 (no virtualisation), QA-028 (file names), QA-006 (768 px) |
| DS-05 | Chart kit | Pass | F14-chart-table (Chart and Table toggle, same numbers) |
| DS-06 | Icon system, emoji purge | Pass | Guardrails; screenshot review |
| DS-07 | Design guardrails in lint | Pass | `logs/guardrails.log` (157 files) |
| DS-08 | Accessibility baseline | **Fail** | QA-007 (2 serious axe rules); Lighthouse N/T |
| SH-01 | Route map, deep links, redirects | Pass | F1-deeplink, F1-redirect, F1-openredirect(2), F10-titles |
| SH-02 | App shell, sidebar, embedded mode | Pass | F1-* nav, SH02-nav (11 items with the flag off), F10-collapsed, F10-embedded |
| SH-03 | Page header and time-basis selector | Partial | QA-020 |
| SH-04 | Retire duplicate and legacy views | Pass | Legacy routes redirect; route sweep |
| SH-05 | Feature flags; QBR sprint module hidden | Pass | F9-flags-default (404 when off), F9-sprints-on |
| SH-06 | Global search | Pass | F10-search, F10-search-person |
| SH-07 | Error boundary, 404, 403, maintenance | **Fail** | QA-011; 404 and 403 pages pass (F10-403, `shots/*-notfound.png`) |
| SH-08 | Code splitting and bundle budget | Pass | 164.5 KB of 350 KB; PDF library loads on click (F10-pdf: 0 → 2 scripts) |
| SH-09 | Responsive layout | **Fail** | QA-006, QA-016 |
| SH-10 | One product name | Partial | QA-024; PDF and title naming pass |
| HS-04 | QBR endpoint tenant isolation | Pass | HS04-1, HS04-3, HS04-6; matrix |
| HS-05 | OTP hardening and rate limiting | Partial | API passes (HS05-2, -3a, -3b, -4); UI copy QA-021 |
| HS-06 | Stripe webhook fails closed | Pass (lifecycle N/T) | SEC09-a/b (503), HS06-1; internal-mode 404; no Stripe keys |
| HS-07 | Open email relay removed | Pass | SEC10 (404) |
| HS-08 | Credentials not exfiltrable; SSRF closed | Partial | HS08-1b (secret cleared), HS08-2, HS08-3a–d, HS08-6, F8-planner (403); QA-009 |
| HS-09 | Versioned integration encryption key | Pass (API level) | `/api/health` reports the key present; secret never returned (HS08-6) |
| HS-10 | Logo-scraping endpoint removed | Pass | SEC15 (404), HS10-2a/b, F9-logo |
| HS-11 | AI off by default, opt-in, server prompt | Partial | HS11-1 (403 when off), F9-ai (confirm and audit); QA-029; answers N/T |
| HS-12 | Security headers and CSP | Partial | CSP sweep: 0 violations on 25 routes (production build); QA-037 |
| HS-13 | Password policy and enumeration | Pass | HS13-1, -1b, -2 (timing within 34 ms), -3a/b |
| HS-14 | Re-authentication to disable 2FA | Pass | HS14-1a/b/c, F9-2fa-off |
| HS-15 | No keys in the bundle | Pass | `dist` secret grep clean; gitleaks not run |
| HS-16 | Script guards and JWT fallback | Pass (developer tests) | Covered by `npm run ci`; not independently exercised |
| AC-01 | Target role model and backfill | Pass | F1-* (all 10 personas land with the right role); upgrade tests |
| AC-02 | One authn/authz library | Pass | Matrix 621/621; AC02-2a/b, -3, -3b, -4, -7a/c |
| AC-03 | Cookie session, CSRF, refresh, logout | **Fail** | QA-001, QA-019; AC03-1a/b, -2a/b, -3a–f, -4a–c, -6a–e, -7 pass |
| AC-04 | `/api/v2/me` and permission-driven UI | Pass | F7-planner-ro, F8-planner, F8-viewer, F5-viewer, F5-viewer-noedit |
| AC-05 | Invitations | Pass | F9-invite, F9-accept, F9-reuse; AC05-2a/b, -3a–d, -4, -8 |
| AC-06 | Tenant-scoped member management | Partial | QA-008; AC06-1a/b, -3a/b, -4, -5, -5b pass |
| AC-07 | Platform admin by flag; email verification | Pass | F14-unverified, F14-cockpit, ST09-1 |
| AC-08 | Workspace and org creation authorisation | Pass | AC08-1, -1b, -3, -4, -4b; F14-second-org |
| AC-09 | Workspace read visibility | Pass | F9-visibility (200 → 403) |
| AC-10 | Audit events for every write | Pass | AC10-1, -3, -4a/b/c; F10-export-audit; F8-cal-edit |
| PL-01 | Shared library, fail-closed config | Pass | PL01-json, -uuid, -sqli; v2 body limit 4 MB → 413 at 6 MB |
| PL-02 | Migration runner, no runtime DDL | Pass | upgrade.test 49/49; QA upgrade edge 14/14; re-run no-op |
| PL-03 | Legacy full save retired | Pass | PL03-1 (410), PL03-2, -2b |
| PL-04 | Per-entity API with optimistic concurrency | Pass | F3-conflict, F3-reload, F3-server, F6-bulk-stale; IDOR-1–8 |
| PL-05 | Client transport interface | Pass | Demo and live e2e; DemoTransport |
| PL-06 | Client store and hooks | Pass | Functional flows; F11 offline and abort handling |
| PL-07 | Entitlements service | Pass | Internal mode ENTERPRISE, `billingVisible: false` (`logs/evidence-internal-mode.txt`) |
| PL-08 | One CI pipeline with security gates | Pass | `npm run ci` exit 0; `npm audit` 0; gitleaks N/T |
| PL-09 | Repo hygiene, legacy server removed | Pass | SEC06, SEC15, SEC10, AC08-4b, PL09-jira |
| PL-10 | Dependency clean-up | Pass | `npm audit` 0 vulnerabilities |
| PL-11 | Lint, format, type-check | Pass | `npm run ci` |
| PL-12 | Authorisation matrix and regression tests | Pass | Independent matrix agrees with the developer matrix |
| PL-13 | Health endpoint, structured logs | Pass | PL13-1; JSON logs with `requestId` |
| PL-14 | Runbook, rehearsal, parity check | N/T | No Neon branch; local parity 0 lost / 0 changed (PGlite + PG16) |
| ORG-01 | Org structure as tenant data, migration | Partial | QA-014, QA-015, QA-022 |
| ORG-02 | Org-structure and craft API | Pass | F7-dup, F7-inuse (409), F7-craft-inuse |
| ORG-03 | Settings › Structure | **Fail** | QA-013; F7-tribe, F7-rename-archive pass |
| ORG-04 | Craft catalogue admin | Pass | F7-craft-add, -pickers, -rename, F7-short-invalid; QA-034 cosmetic |
| ORG-05 | Tribes pages | Partial | QA-004 (tribe gap at project level) |
| ORG-06 | Client domain uses entity ids | Pass | Snapshot ids; see QA-005 for the import contract mismatch |
| PPL-01 | People page | Pass | F6-band, F6-group, F6-drawer-open; QA-036 cosmetic |
| PPL-02 | Person drawer | Partial | QA-012, QA-032 |
| PPL-03 | Bulk edit people | Pass | F6-bulk, F6-bulk-undo, F6-bulk-stale |
| PPL-04 | CSV import and export | **Fail** | QA-005, QA-028; F6-template, F6-import-preview, F6-export-formula pass |
| PPL-05 | My plan | Pass | F5-accept, F5-decline, F5-myplan-proposed |
| PPL-06 | Craft-change approval | Partial | QA-018; F13-requests, F13-pending, F13-planner-confirm pass |
| PPL-07 | Projects page and drawer | Pass | F4-notribe, F4-create, F14-delivery-empty |
| AL-01 | Quarter-first allocation grid | **Fail** | QA-002, QA-017 |
| AL-02 | Inline editing, keyboard | Pass | F2-edit, F2-keys, F2-range, F2-over, F2-paste, F2-paste-bad, F2-zero |
| AL-03 | Copy forward and undo | Pass | F2-copyforward, F2-copyforward-undo, F2-undo, F2-paste-undo |
| AL-04 | Project-centric pivot | Partial | QA-007 (axe on the pivot) |
| AL-05 | Provenance, Planview lock, tentative state | **Fail** | QA-003; F2-lock (UI) passes |
| AL-06 | Date-precise booking editor | Pass | F14-edit-dates |
| DM-01 | Demand lines as entities | Pass | F4-demand, F4-dualwrite |
| DM-02 | Demand page | Partial | QA-004; F4-demand count drop and F4-gaplink pass |
| DM-03 | Marketplace propose → tentative → accept | Partial | QA-004; F5-propose, -propose-api, -double (409), -openproposed, -accept, -decline pass |
| DM-04 | Squad catalogue for tribe leads | Pass | F5-viewer, F5-copylink, F5-export (name QA-028) |
| DM-05 | Under-target list, Offer to marketplace | Pass | F13-offer |
| JI-01 | Scheduled chunked Jira sync | **Fail** | QA-010; scheduled run N/T |
| JI-02 | Jira project ↔ planner mapping | Pass (live mapping N/T) | v1.1 mapping carried over ("1 of 1 Jira projects") |
| JI-03 | Assignee ↔ person mapping | N/T | Needs Jira assignees |
| JI-04 | Per-tribe calibration | Pass | F8-cal-note (note required), F8-cal-edit (audited), v1.1 calibration carried over |
| JI-05 | Sprint and velocity view | N/T | Needs Jira sprint data |
| JI-06 | Delivery signal | Pass (with data N/T) | F14-delivery-empty empty state |
| JI-07 | Sync health | Partial | QA-010, QA-026; F8-health failure path passes |
| JI-08 | Portable Jira aggregation module | Pass (developer tests) | `npm run ci` |
| PV-01 | Preview diff, idempotent import | N/T | Needs a Planview sandbox; validation path F8-planview-test passes |
| PV-02 | Field-map editor with sample test | N/T | As PV-01 |
| PV-03 | Persisted Planview mappings | N/T | As PV-01; upgrade keeps v1.1 config |
| RP-01 | Home | **Fail** | QA-004, QA-023; F8-home-banner passes |
| RP-02 | Capacity Outlook | Pass | Numbers match People; F14-chart-table; 768 px a11y under QA-007 |
| RP-03 | Target bands, same-number guarantee | **Fail** | QA-002, QA-022, QA-033 |
| RP-04 | Reports: CSV and QBR pack | Partial | QA-031; F10-pdf, F10-csvs, F6-report-formula pass; 500×100 pack in 389 ms |
| ST-01 | Settings shell, org and workspace | Pass | F9-orgname, F9-logo, F9-ws-add, F9-ws-delete |
| ST-02 | Members and roles | Pass | F5-role, F5-orgrole-hidden, F9-pending |
| ST-03 | Planning settings | Pass | F14-thresholds, F14-fiscal; QA-035 cosmetic |
| ST-04 | Integrations settings | Partial | QA-009, QA-026; F8-jira-save, F8-planner pass |
| ST-05 | Features settings | Partial | QA-029; F9-flags-default, F9-sprints-on pass |
| ST-06 | Billing (public mode) | N/T | No Stripe keys; hidden in internal mode (pass) |
| ST-07 | Sign-in, reset, verification, invitation pages | Partial | QA-021, QA-027; F1-*, F9-accept, F9-reuse pass |
| ST-08 | Create organisation flow | Partial | QA-038; org and first workspace created, F14-second-org (409) passes; sample-data install not reachable from Home, so not exercised |
| ST-09 | Platform admin cockpit | Pass | F14-cockpit (404 for non-admins), ST09-1, AC10-pl2 |
| ST-10 | Demo mode | Pass | e2e demo project 74/74 |

**Totals (104 Must stories):** Pass 65 · Partial 21 · Fail 11 · N/T 7.

### 5.1 §6.3 acceptance checklist (45 items)

| # | Status | Note | # | Status | Note |
|---|---|---|---|---|---|
| 1 | Pass | F1-* incl. 2FA | 24 | **Fail** | QA-002 |
| 2 | Pass | AC03-2a/b; localStorage only `pcp.ui.*` | 25 | Pass | F2-* |
| 3 | Pass | Local parity 0/0; Neon N/T | 26 | **Fail** | QA-003 (UI lock passes) |
| 4 | Pass | SEC01-a/b; verify/send 503 without email, no code | 27 | Pass | F4-demand |
| 5 | Pass | HS04, AC06-1, AC05-3/4, AC08-1 | 28 | Pass | F5-propose (2.5 s), time-to-staff CSV |
| 6 | Pass | AC02-4 (see QA-008) | 29 | Pass | F5-viewer, F5-copylink, F5-export |
| 7 | Pass | AC03-3a | 30 | Partial | QA-018 |
| 8 | Partial | API 429 passes; UI copy QA-021 | 31 | **Fail** | QA-005 |
| 9 | Pass | HS08-1b, F8-planner | 32 | N/T | Customer Jira site |
| 10 | Partial | CSP passes; other headers QA-037 | 33 | Partial | Note and audit pass; suggested value needs sprint data |
| 11 | Pass | 404 / 410 as listed | 34 | N/T | Needs snapshots |
| 12 | Partial | Off and opt-in pass; answer N/T, QA-029 | 35 | **Fail** | QA-010 |
| 13 | Pass | AC10-1, -3, -4 | 36 | N/T | Production only |
| 14 | Pass | 11 items, collapse persists, no emoji | 37 | N/T | Planview sandbox |
| 15 | Pass | F10-titles, redirects | 38 | Partial | 500×100: 389 ms, 26 pages; QA-031 |
| 16 | Partial | 0 alert/confirm, 0 hex; QA-024 | 39 | Pass | 4 tiles with captions (values: QA-004) |
| 17 | **Fail** | QA-007; Lighthouse N/T | 40 | Pass | Copied-link path; email N/T |
| 18 | Pass | F6-delete | 41 | Pass | F9-reuse |
| 19 | Pass | 164.5 KB; lazy PDF | 42 | Pass | `logs/evidence-internal-mode.txt` |
| 20 | **Fail** | QA-016 | 43 | Pass | F9-flags-default, F9-sprints-on |
| 21 | Pass | F7-craft-* | 44 | Pass | e2e demo |
| 22 | **Fail** | QA-013 (manual chapter + bulk set works) | 45 | Pass | PL13-1 |
| 23 | Pass | F6-band | | | |

## 6. Security results

### 6.1 Authorisation matrix

69 endpoints (every `/api/v2` route, plus legacy, QBR, integrations, audit, org management and billing) × 9 roles:
anonymous, Viewer, Squad member (contributor), Planner, PMO Admin, Org Admin, other-tenant Org Admin, user with no
org, and platform admin. **621 of 621 cells as expected.**

| Role | Allowed endpoints | Result |
|---|---:|---|
| Anonymous | 0 (401 everywhere except public auth) | Pass |
| Viewer / Squad member | 11 | Pass |
| Planner | 41 | Pass |
| PMO Admin (workspace admin) | 61 | Pass |
| Org Admin | 67 | Pass |
| Other-tenant Org Admin | 0 on Acme resources (403, no data in the body) | Pass |
| No-org user | 0 (403) | Pass |
| Platform admin | 68 | Pass |

Each cell also checked that no other tenant's data appeared in the response body. File: `$QA/security-matrix.json`.

### 6.2 Targeted checks (118; 112 pass)

- **Sessions and CSRF**: the cookie flags are correct (`pcp_session` HttpOnly; Secure; SameSite=Lax; Path=/api;
  7 days, and `pcp_csrf` readable). A cookie write without, with a wrong, or with an unpaired CSRF header gets 403.
  Logout-all and the 2FA toggle need CSRF. A foreign `Origin` gets 403, and preflight is refused. `alg:none`, a
  token signed with another secret, a token-version mismatch and an expired token all get 401. A v1.1 bearer token
  is accepted and exchanged for a cookie, and logout-all revokes v1.1, exchanged and current sessions. **Fails:**
  QA-001 (token in the login body) and QA-019 (plain logout does not revoke).
- **IDOR and tenancy**: patching or deleting another tenant's person or allocation through your own workspace id
  gets 404. Using the other workspace id gets 403. Creating with another tenant's `resourceId` gets 400; batch
  delete of a foreign id gets 404 and the row is intact. A craft request for a foreign person gets 404, and a foreign
  Org Admin reading the snapshot gets 403. The legacy `GET /api/workspace?wsId=<other>` gets 403.
  `/api/my_workspaces` and the legacy user list are tenant-scoped.
- **Privilege escalation**: inviting with `SUPERUSER`, `isPlatformAdmin`, another org's id or another org's
  workspace gets 400 or 403. A PMO Admin inviting an Org Admin, or into a workspace they don't administer, gets 403.
  `plan` changes through member or org PATCH get 400 "Plan is managed by billing.". Removing the last Org Admin gets
  409. Demotion takes effect on the next write. **Fail:** QA-008 (no token-version bump; low impact).
- **Removed and legacy endpoints**: `debug_db`, `theme_extract`, `email_receipt` and `org_create` return 404.
  `POST /api/workspace`, `/api/auth/users/:id` PUT, `remove-member`, `users/invite`, `org_manage` POST and the
  `/api/jira` stub return 410.
- **OTP and brute force**: 11th login per email gets 429 with `Retry-After` and "Try again in 9 minutes". 31st per IP
  gets 429. After 5 wrong OTPs even the correct code is refused. `reset/confirm` is limited to 5 per email. Known and
  unknown emails get the same 401 and similar timing (100 ms vs 134 ms). The reset response is exactly
  `{ sent: true }`. By design the rightful owner is also locked out for the window (a lockout DoS); noted for the PO,
  not raised as a defect.
- **Integrations and SSRF**: a Jira domain outside `*.atlassian.net`, or a Planview private IP, `http:`,
  `localhost` or explicit port, gets 400. Changing the Jira domain without a new token clears the secret. The config
  GET returns `hasSecret` only. A Planner cannot test the connection (403). **Fail:** QA-009 (network failure gives
  500).
- **Planview lock**: a percentage PATCH on a locked booking gets 409, and DELETE gets 409. **Fail:** QA-003
  (`source` PATCH unlocks).
- **Billing**: a webhook without, or with a forged, signature gets 503 (never 200), and checkout without keys gets
  503. In internal mode, checkout and webhook return 404.
- **Robustness**: malformed JSON gets 400, a malformed or SQL-like id gets 404, and an oversized body gets 413 at
  6 MB (the v2 limit is 4 MB, not 1 MB).
- **Audit**: logins, failed logins, role change, invitation, 2FA change, secret update and edits are logged, with no
  password hash, OTP, token or secret in before/after. Audit reads are workspace-scoped, and CSV export works.
- **Supply chain**: `npm audit` reports 0. The `dist` grep for keys, tokens and `sk_`/`pk_` is clean. There are no
  external font or CDN requests, and 0 CSP violations across 25 routes on the production build.

The 3 checks triaged as test errors: AC02-7b (`workspace_lookup` returns only the caller's own org slug; no leak),
SEC01-c (`verify/send` answers 503 "Email delivery is not configured" when Resend is unset; no code leaked; correct
fail-closed behaviour), and PL01-size (a 1 MB body is within the documented 4 MB limit; 6 MB returns 413).

## 7. Upgrade and data integrity

| Check | PGlite | PostgreSQL 16 |
|---|---|---|
| Developer `tests/backend/upgrade.test.ts` | 49 / 49 combined | |
| **QA edge-case upgrade** (`tests/qa/upgrade.edge.qa.test.ts`): drifted v1.1 schema replay plus dirty rows | 7 / 7 | 7 / 7 |
| First request migrates to the required schema version (7) | Pass | Pass |
| Parity: 0 v1.1 rows lost, 0 credential changes | Pass | Pass |
| Every v1.1 user signs in, including a user with a NULL name | Pass | Pass |
| Two emails differing only by case: the lower-case one signs in (as in v1.1) | Pass | Pass |
| Snapshot, legacy QBR and delivery reads on dirty data: no 5xx | Pass | Pass |
| Workspace without an org is unreachable (403 / 404), not a 500 | Pass | Pass |
| Migration re-run is a no-op | Pass | Pass |

The dirty data included: duplicate emails differing by case; a NULL-name user; a workspace with no members; a
workspace with no org; `craft_profile` values `'"PM"'`, `'[]'` and invalid JSON; blank and whitespace
`client_name`; a non-array `craft_demand`; inverted, zero-length, cross-tenant, workspace-less, timestamp-typed and
`'TBC'` allocation dates; and dangling `qbr_bookings` after dropping their FK.

Live v1.1 seed (`LOCAL_API_DB=v11`): all 10 personas signed in with their v1.1 passwords. Ada's 2FA code flow works,
the former SUPERUSER (Tom) became platform admin and Org Admin, and v1.1 `USER` accounts became Viewers. The v1.1
Payments calibration (12 points per 10 days) and the Jira project mapping were carried over.

Data-mapping defects found: QA-014 (unknown craft ids become catalogue crafts), QA-015 (tribe leads lost, casing),
QA-022 (part-time capacity is not mapped to target) and QA-025 (`'TBC'` dates make the load NaN in the client).

## 8. UI review findings

Screenshots of every route and state at 1440×900, 1280×800 and 768×1024, in light and dark (360 files), plus 129
flow captures, are in `$QA/shots/` and `$QA/flows/`. File pattern: `tom-{w}x{h}-{light|dark}-{route}[-full].png`.

**What works well.** The navy shell, typography and spacing are consistent with `DESIGN_SYSTEM.md` at 1440 and
1280 (`shots/tom-1440x900-light-home.png`). Focus rings are visible (`flows/F10-focus-ring.png`). Drawers, confirms
and toasts are consistent, the conflict dialog is clear (`flows/F3-conflict.png`), and the 404 and 403 pages are
on-brand (`shots/tom-1440x900-light-notfound.png`, `flows/F10-403.png`). Unicode names (Ünïcødé 测试, Zoë) render
correctly everywhere, including the PDF. Offline edits roll back with an error toast, a failed load shows an inline
error with Retry, and a 500 quotes the reference (`flows/F11-offline-edit.png`, `flows/F11-500-allocations.png`).
Slow responses show skeletons (`flows/F11-slow-1s.png`).

**Findings** (also in §4):

| ID | Finding | Screenshot |
|---|---|---|
| QA-006 | 768 px: People and Projects name column collapses; Allocations chips overlap names | `shots/tom-768x1024-light-people.png`, `shots/tom-768x1024-light-projects.png`, `shots/tom-768x1024-light-allocations.png` |
| QA-016 | 390 px: editing controls still shown | `flows/F10-390-allocations.png`, `flows/F10-390-people.png` |
| QA-007 | By-project cells' visible text differs from the accessible name; Capacity table scroll region not focusable at 768 | `shots/tom-1440x900-light-allocations-byproject.png`, `shots/tom-768x1024-light-capacity.png` |
| QA-030 | Dark theme: active settings-nav item and brand pill below 4.5:1 | `shots/tom-1440x900-dark-settings-members.png` |
| QA-011 | Endless "Loading your workspace" during migration_pending | `flows/F11-503.png` |
| QA-038 | Empty workspace shows a zeroed dashboard instead of the first-run EmptyState | `flows/F14-create-org.png` |
| QA-031 | QBR pack cover year truncated | `flows/F10-qbrpack-1.png` |
| QA-032 | Double separator when the job title is empty | `shots/tom-1440x900-light-people-drawer.png` |
| QA-033 | Band tint missing on some Available values | `shots/tom-1440x900-light-people.png` |
| QA-034 | Crafts table overflows its card; seed short codes break the form rule | `shots/tom-1440x900-light-settings-crafts.png` |
| QA-035 | Planning sticky save bar overlaps help text | `shots/tom-1440x900-light-settings-planning-full.png` |
| QA-036 | Band filter label truncated; filter bar wraps at 1280 | `shots/tom-1280x800-light-people.png` |
| QA-023 | Home "Under target" list mixes bands | `shots/tom-1440x900-light-home.png` |
| QA-026 | Delivery card "CONNECTED" while sync fails; generic reason | `flows/F8-delivery-sync-fail.png` |

axe totals: 180 scans across 36 routes and states. Serious findings: `label-content-name-mismatch` (Allocations by
project, every width), `scrollable-region-focusable` (Capacity at 768) and `color-contrast` (9 Settings pages in dark
only). There were no critical findings. Light theme at 1440 and 1280 is otherwise clean.

## 9. Robustness

### 9.1 Network failure, errors and latency

Simulated with Playwright routing on the client and an egress preload on the API (`QA_EGRESS=fail|hang|500`).

- **Offline during an edit**: the optimistic edit rolls back and the toast says "That did not work"
  (`flows/F11-offline-edit.png`).
- **500 from the API**: "We couldn't load allocations. Try again, or quote reference …", with no raw server text
  and no white screen (`flows/F11-500-allocations.png`).
- **Network failure on load** (People): an inline error with Retry; Retry recovers once the network is back
  (`flows/F11-abort-people.png`). An expired session routes to `/login?next=…`.
- **9 s latency**: skeletons show, the shell stays interactive (help opens in 64 ms), and content arrives after
  9.7 s without a reload (`flows/F11-slow-1s.png`, `flows/F11-slow-done.png`).
- **Snapshot 503 migration_pending**: the maintenance page shows (pass). **`/me` 503**: the app hangs (QA-011).
- **Jira egress hang**: 502 "did not respond within 8s" at about 8.0 s (pass). **Egress fail**: 500 (QA-009).
  **Jira 401 with outbound open**: reported as success (QA-010).

### 9.2 Unicode and formula injection

Names with accents and CJK characters round-trip through the UI, API, CSV and PDF. CSV export neutralises
`=`, `+`, `-` and `@` prefixes in People export, report CSVs and the squad catalogue
(`$QA/logs/people-export.csv`; committed test `tests/e2e/qa/qa-findings.spec.ts` › "CSV export neutralises …").
The import preview rejects a formula-shaped row as invalid.

### 9.3 Scale: 500 people × 100 projects × 2,500 bookings

Measured on the production build (`vite preview`, :4175) against the live API.

| Page | Load | Notes |
|---|---:|---|
| Home, Capacity, Demand, Marketplace, Projects, Tribes, Reports | 0.46–0.93 s | |
| People | 1.1 s | 500 rows, 29 k DOM nodes, not virtualised (QA-017) |
| Allocations | 1.45 s | 1,001 rows, 34 k nodes; a cell edit takes 872 ms with long tasks up to 466 ms (QA-017) |
| Snapshot API | 160 ms | |
| QBR pack PDF | 389 ms | 26 pages, all sections |

Dev-server numbers (2.3–2.8 s) were superseded by these production measurements.

### 9.4 Time zones and quarter edges

`tests/qa/quarters.tz.qa.test.ts` covers UTC, Pacific/Pago_Pago (UTC−11), America/Los_Angeles, Europe/Dublin,
Asia/Kolkata and Pacific/Kiritimati (UTC+14). It checks QBR1 on both sides of 31 Dec / 1 Jan and 31 Mar / 1 Apr,
inclusive quarter bounds, and that a booking ending 31 Dec stays out of Q1 and one starting 1 Apr stays out of Q1.
It also checks that a one-day booking is exactly 1/90 of Q1 across DST, and that "today" is the local calendar day.
**30 of 30 pass.**

## 10. What could not be tested and why

| Area | Reason | Residual risk / recommendation |
|---|---|---|
| Real Jira Cloud site (sync data, project and people matching, sprints, velocity, delivery signal: JI-02 live, JI-03, JI-05, JI-06 with data, §6.3-32/34) | No customer test site (CA-11); only failure paths and a 401 from the real `acme.atlassian.net` were exercised | Run §6.3-32/34/35 on the customer site after QA-010 is fixed |
| Planview sandbox (PV-01/02/03, §6.3-37) | No sandbox or credentials (CA-11) | Run on the customer sandbox |
| Scheduled functions (05:00 UTC Jira sync, §6.3-36) | They run only on Netlify production | Check the first scheduled run after go-live |
| Neon rehearsal and production-data parity (PL-14, §6.3-3 on Neon) | No Neon branch available; parity was run on PGlite and local PostgreSQL 16 with v1.1 and dirty data | Run RUNBOOK §2 rehearsal; enforce `db:migrate` before publish (QA-011) |
| Stripe subscription lifecycle (HS-06 lifecycle, ST-06) | No Stripe keys; only fail-closed behaviour verified | Test in Stripe test mode before enabling public mode |
| OpenAI answers (HS-11#AC3) | No `OPENAI_API_KEY`; opt-in, audit and 403-when-off verified | QA-029 |
| Resend email delivery (invitation, reset, verify emails, sender name) | No Resend key; copied-link invitation path tested | Send real emails once and check the sender (QA-024) |
| Netlify-served security headers (HSTS, nosniff, Referrer-Policy, Permissions-Policy) | `vite preview` serves CSP only; there is no Netlify runtime here | Check headers on the deploy preview (QA-037) |
| Lighthouse a11y ≥ 95 (DS-08#AC5, §6.3-17) | Lighthouse is not installed in this sandbox; axe was run on every route instead | Run Lighthouse on the preview |
| gitleaks (PL-08, HS-15) | Not installed; manual `dist` and repo grep instead | Runs in GitHub CI |
| Mobile beyond a 390 px sanity pass; real touch devices | Out of scope for 2.0 (SH-09 is the only mobile AC) | |
| Dark theme as a product feature | No theme switch in 2.0 (release notes); tested only through `prefers-color-scheme` | QA-030 before shipping a switch |

## 11. Committed QA tests

| File | Tests | Open-defect tests (skipped or `fixme`) |
|---|---:|---|
| `tests/qa/viewModels.qa.test.ts` | People, Outlook and Marketplace numbers for a 90 %-target person | QA-002, QA-004, QA-025 |
| `tests/qa/security.qa.test.ts` | CSRF, `alg:none` and foreign secret, logout-all on a v1.1 token, IDOR through your own workspace id, legacy cross-tenant read, invitation escalation, Planview percentage and delete lock | QA-001, QA-019, QA-008, QA-003 |
| `tests/qa/people.import.qa.test.ts` | Client parser → real import handler | QA-005 |
| `tests/qa/upgrade.edge.qa.test.ts` | Dirty v1.1 upgrade, 7 tests × PGlite and PostgreSQL | none (all pass) |
| `tests/qa/quarters.tz.qa.test.ts` | 6 time zones × 5 quarter-edge tests | none (all pass) |
| `tests/e2e/qa/qa-findings.spec.ts` | CSV formula-injection guard (demo) | QA-002, QA-006, QA-007 (×2), QA-016, QA-012 |

Each skipped or `fixme` test carries its defect ID in the test name, fails today for the reason described, and
should be un-skipped when the defect is fixed. The Jest suite needs PostgreSQL 16 binaries for the `postgres` half
of the upgrade test, as the developer upgrade test does. That half is skipped automatically when they are absent.
