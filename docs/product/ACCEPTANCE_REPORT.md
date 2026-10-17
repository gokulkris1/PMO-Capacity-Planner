# PMO Capacity Planner 2.0: user acceptance report

| | |
|---|---|
| Release | 2.0.0 "Corporate", branch `claude/resource-allocation-pmo-visibility-oi2g5f` at `0844ca5` |
| UAT date | 17 Oct 2026 (QBR1 = Q4 2026 … QBR4 = Q3 2027) |
| Run by | Product Owner and Business Analyst, acting for the PMO lead (customer), on behalf of gokulkris1 |
| Inputs | `docs/product/PRODUCT_BRIEF.md`, `docs/product/BACKLOG.md` §6, `docs/product/DESIGN_SYSTEM.md`, `docs/qa/QA_REPORT.md` (after the fix round), `docs/release/RELEASE_NOTES_2.0.md`, `docs/release/RUNBOOK.md`, hand-offs, `README.md` |
| Product code changed | None. This report is the only file added. |

## 0. Decision

**Accepted with conditions.**

Release 2.0 meets the customer's brief. Every ask was walked end to end as its persona, on the demo workspace and on the
live local stack, which starts from the v1.1 production-shaped database and upgrades it on the first request. Every ask
works. Two parts could not be proven here: Jira and Planview against the customer's own instances, and the Neon
production rehearsal. The UI now looks like one corporate product. Of the 45 §6.3 checklist items, 35 pass, 5 pass
with notes and 5 cannot be tested here. None fails.

**Must-fix before go-live (product):**

- **QA-022**: v1.1 part-time capacity must become the person's target (PO rule below). Without it, Reports and the
  QBR pack show two supply figures for the same tribe. If the code fix cannot ship, the operational fallback in
  condition C-3 is acceptable.

Everything else goes live under the conditions in §8.

**Evidence root.** All screenshots and logs are in the session scratch folder
`/tmp/claude-0/-home-user-PMO-Capacity-Planner/30300e26-6330-58c3-8326-070765d23fff/scratchpad/uat/`, written `$UAT/`
below. It is not committed, as with the QA evidence.

---

## 1. How UAT was run

| Environment | How | Used for |
|---|---|---|
| Demo | `npm run build`, then `vite preview` on :4180, at `/demo/w/demo/...` (DemoTransport, no backend) | Every page at 1440×900 and 1280×800; dark tokens; embedded mode; Jira & Planview with sample data (sprints, mapping, calibration, Planview preview) |
| Live full stack | `scripts/local-api.ts` with `LOCAL_API_DB=v11` on :8890 (the real function handlers on PGlite, seeded as the v1.1 production schema and data), the same production build proxied to it, with the CSP enforced | Persona journeys signed in with the printed v1.1 accounts and their old passwords |
| Live, production-like env | The same, with `CONTEXT=production` and no `INTEGRATIONS_ENC_KEY` | `npx playwright test --project=live`: **10/10 passed** |
| Automated, demo | `E2E_BASE_URL=http://localhost:4180 npx playwright test --project=demo` | **82/82 passed** (routes, roles, flows, axe, QA regressions, CSP) |
| Gates | `npm run check:guardrails -- --all`, `npm run check:bundle` | 158 files clean; Home JS 167.0 KB of 350 KB gzip |

The first request upgraded the v1.1 database to schema 9 (`migration.applied` 1…9 in `$UAT/api-run1.log`). Every
account used signed in with its v1.1 password. Ada's 2FA code is printed to the dev log because Resend is not set up
here. Personas:

| Persona | Account (v1.1 → 2.0 role) |
|---|---|
| PMO lead | Pat PMO (PMO Admin) |
| Org admin | Tom Hayes (former SUPERUSER → Org Admin and platform admin), Ada Admin (Org Admin, 2FA) |
| Squad member | Noma Odigie (v1.1 `USER` → Viewer; Tom changed her to Squad member during UAT, which is CA-15 in practice) |
| Chapter lead / approver | Pat PMO (chapters created during UAT; no chapter lead is set in the v1.1 data) |
| Tribe lead | Victor Lee (Viewer) |
| PMO analyst | Pat PMO; Rita Analyst (new Planner, invited during UAT) |

---

## 2. Customer-ask acceptance

| # | Customer ask | Verdict | Scenario walked (persona, steps) | Evidence |
|---|---|---|---|---|
| 1 | Above- and below-the-table crafts per individual; allocation over QBR1–QBR4 | **Accepted** | *Squad member* Noma: My plan › Suggest changes › add CM L1 20 %, submit. *Approver* Pat: People › Requests › Approve. Noma sees "Approved by Pat PMO". People shows filled chips (above the table) and outlined chips (below the table, ·L1–L3) with all four quarters. QBR4 is visible without horizontal scroll at 1280 px. *PMO lead* Pat: Allocations is a person × project × QBR1–QBR4 grid with craft chips. | `$UAT/uat-D2-noma-suggest.png`, `uat-D3`…`D7`, `uat-R-1280-org-people.png`, `uat-C1-pat-allocations.png` |
| 2 | Project requirement roadmap: newly initiated projects anticipate craft demand | **Accepted** | Pat: Projects › Add project "Atlas Onboarding" (tribe Lending, Initiated). Home › "Needs a decision" lists "Atlas Onboarding is initiated with no demand captured". Pat opens Demand › Add demand and adds BA 1.0 FTE, Confirmed, QBR2. The warning disappears and "Initiated projects without demand" drops from 2 to 1. Demand by craft shows supply against demand. | `uat-A2`, `uat-A3-pat-home-needs-decision.png`, `uat-A4-pat-demand-dialog.png`, `uat-A5-pat-demand-saved.png` |
| 3 | Showcase below-the-table crafts to projects and tribes; engage the squad; maximise efficiency | **Accepted with notes** | Pat: Marketplace › QBR2 › Nebula · BA. Mary (above the table, score 124) and Noma (L2 below the table, 84) are ranked. Propose Noma → confirm → tentative booking. Noma: My plan › Accept. Proposals tab: "Accepted, time to staff under an hour". The time-to-staff CSV records it. *Tribe lead* Victor sees the "What the squad can offer" catalogue, copies the link and exports CSV, and has no edit controls on any page. Squad members can "Offer my capacity". **Note:** a tribe lead still cannot raise a request in the tool (IN-01/02 is a Should, deferred). Requests go to the PMO lead outside the tool until 3.0. | `uat-B4-pat-market-matches.png`, `uat-B5`, `uat-B7-noma-myplan-proposal.png`, `uat-B9-pat-proposals.png`, `uat-E3-victor-catalogue-copied.png` |
| 4 | Pan out the current state and show how to improve | **Accepted with notes** | Home gives utilisation against target per QBR with the next-quarter delta, unstaffed demand, over-capacity and available lists, "Needs a decision" and recent activity. Capacity Outlook pivots by craft, chapter, tribe and person. The QBR pack PDF (cover, utilisation QBR1–QBR4, supply against demand, by craft) downloads in 0.2 s. `CURRENT_STATE_AND_ROADMAP.md` and this report give the narrative. **Note:** there is no utilisation trend over time yet. Only Jira delivery is snapshotted; plan history arrives with snapshots and audit UI (AU-01) later. | `uat-A1-pat-home.png`, `uat-A6-pat-capacity-table.png`, `$UAT/qbrpack-1.png`, `qbr-pack-2026-Q4.pdf` |
| 5 | Jira + Planview end to end; story points per tribe/quarter/sprint mapped to capacity with per-tribe calibration | **Accepted with conditions** | *Demo:* Overview (planned against Jira-implied FTE per tribe), Sprints (velocity committed and done, implied against planned FTE per sprint), Sync health, Project mapping (auto-match by key, confirm), People mapping, Calibration (current, suggested 11.5 "based on Sprint 41–43: 186 pts, 5.4 FTE", edit requires a note), Planview import (preview new, changed and removed before apply). *Live:* Pat saves Jira credentials and runs Sync now against `acme.atlassian.net` with a bad token. The card shows "SYNC FAILING · Jira rejected the credentials" and Home shows the failure banner. **Conditions:** validate against the customer's Jira site and Planview sandbox (CA-11; §6.3-32/34/36/37), and set `INTEGRATIONS_ENC_KEY` (CA-3). Without that key, saving Jira credentials fails with a generic error (UAT-01). | `uat-H-demo-delivery-*.png`, `uat-H-demo-planview-preview.png`, `uat-H-demo-calibration-edit.png`, `uat-J2-pat-delivery-after-sync.png`, `uat-J3-pat-home-banner.png`, `uat-G5-tom-jira-save-nokey.png` |
| 6 | Ultimate goal: PMO teams 100 % utilised | **Accepted** | 100 % reads "On target" (green). The bands are Available < 50, Under 50–89, On target 90–105 and Over > 105, compared with each person's target (Noma, at 90 % target and 100 % booked, shows 111 %, Over capacity). Pat rebalances Noma in Allocations: click the Phoenix QBR1 cell, type 50 and press Enter. Noma goes from 111 % to 100 %, On target. Ctrl+Shift+→ copies forward ("Copied to QBR2–QBR4", with Undo), and Undo restores both changes. The same number appears on People, Allocations and Capacity Outlook. | `uat-C2-pat-rebalanced.png`, `uat-C3-pat-copyforward.png`, `uat-C4-pat-undo.png`, `uat-C5-pat-capacity-person.png` |
| 7a | Corporate UI: crisp elements, corporate blues across the tool | **Accepted with notes** | One navy shell, Inter, blue accent, uppercase lozenges, underline tabs and lucide icons. Status colours are used only for status, and projects carry no colour. The same quality runs across sign-in, the shell, every page, drawers, dialogs, toasts and the 403/404 pages. The notes in §5 are cosmetic. | §5 |
| 7b | Fully functional capacity tracker in tandem with Jira and Planview | **Accepted with conditions** | Rows 1–6, plus Settings (members, invitations, structure, crafts, planning, integrations, features) and CSV import/export, all walked live. Same conditions as row 5. | §3 |
| 7c | Jira Marketplace readiness kept in mind | **Accepted** | `?embedded=1` hides the sidebar and moves navigation into page tabs. One `Transport` interface sits under the client (`HttpTransport`, `DemoTransport`). Every view is a URL, and old `/o/:org` URLs redirect. Tokens can map to `--ds-*`. Fonts are self-hosted and the CSP is `'self'` only. There is an entitlements service, and `localStorage` holds only `pcp.ui.*` keys. | `uat-M1-demo-embedded.png`; `services/api/transport.ts` |
| 7d | Same logins | **Accepted** | Tom, Pat, Noma, Victor, Owen and Ada signed in with their v1.1 passwords. Noma's email has mixed case. Ada used 2FA. A held v1.1 token is exchanged for a cookie session (live e2e). The login body is `{ user }` only, and the cookies `pcp_session`/`pcp_csrf` are set. | `live-01-login.png`, `live-03-tom-home.png`, `live-04-ada-2fa.png`, `live-05-ada-home.png` |

UX target "find and tentatively book 0.5 FTE BA for Nebula in QBR2 in ≤ 2 min without help": 5 interactions (Marketplace,
QBR2, expand the line, Propose, confirm), 5.4 s scripted. **Met.** The SUS score needs the named users (CA-11).

---

## 3. §6.3 acceptance checklist

Pass = verified in this UAT. "Pass (QA)" = verified by the QA fix round and its committed tests, with no UAT reason to
doubt it. "N/T" = not testable here, with the reason given.

| # | Item | Result | Evidence / reason |
|---|---|---|---|
| 1 | Existing user (password) and 2FA user sign in unchanged | **Pass** | Tom `live-03`; Ada 2FA `live-04/05` (code from the dev log; production needs Resend, CA-4) |
| 2 | v1.1 `pcp_token` browser stays signed in; no token in `localStorage` | **Pass** | Live e2e (10/10); `localStorage` after login holds only `pcp.ui.lastWorkspace*` |
| 3 | Parity 0 rows lost, 0 credential changes; re-run 0 pending | **N/T** (Neon) | Locally, the first request migrated v1.1 to schema 9 and every v1.1 account signed in. QA parity on PGlite and PG16 shows 0/0. The Neon rehearsal is RUNBOOK §1.3–1.5 (CA-5, CA-12) |
| 4 | Reset/verify responses contain no code | **Pass** | `POST /api/auth/reset/send-otp` returns `{"sent":true}` for known and unknown emails |
| 5 | Cross-tenant attempts 403/404 | **Pass (QA)** | 621/621 matrix cells; not re-run |
| 6 | Role change takes effect on the next request; removed member signed out | **Pass** | Noma promoted Viewer → Squad member and could accept on her next request (`uat-B2`); demotion and revocation in QA (QA-008/019 fixed) |
| 7 | CSRF: cookie PATCH without `X-CSRF-Token` → 403 | **Pass** | curl as Owen: 403 |
| 8 | 11th login → 429 with a friendly message | **Pass** | 429 "Too many attempts. Try again in 10 minutes." |
| 9 | Changing the Jira site clears the token; Planner cannot test the connection | **Pass (QA)** | HS08-1b, F8-planner |
| 10 | CSP, HSTS and nosniff headers; no CSP console violations | **Pass** | `vite preview` serves the `netlify.toml` headers (CSP, HSTS, nosniff, Referrer-Policy, Permissions-Policy). No console errors on any page I opened. `security.spec` passes. Recheck on the Netlify preview |
| 11 | Removed endpoints 404; `POST /api/workspace` 410 | **Pass** | 404 ×4; 410 "PMO Capacity Planner was updated. Reload the page." |
| 12 | AI off by default (403); opt-in with notice and an answer | **Pass with notes** | 403 `feature_disabled`; the egress notice is shown and the demo answers (e2e). A live answer needs `OPENAI_API_KEY` (N/T) |
| 13 | Audit log API covers this session | **Pass (QA)** | AC10-1/3/4; Home "Recent activity" showed my edits |
| 14 | 11 grouped nav items at 1440×900, collapse persists, no emoji, favicon | **Pass** | 11 items with no scroll (`demo-1440-light-home.png`); guardrails clean; `favicon.svg` mark; collapse persistence from QA F10 |
| 15 | Direct URLs and titles; `/o/:org`, `/settings`, `/directory` redirect | **Pass** | Every route's title is "Page · PMO Capacity Planner"; all 3 redirects land on the right pages |
| 16 | 0 native dialogs, 0 hex, 0 "Orbit" | **Pass** | Guardrails 158 files; `confirm(` hits are the in-app hook. "Orbit" appears only in the `orbitTheme` purge key. The email sender is covered by QA-024/CA-4 |
| 17 | axe 0 serious/critical; Lighthouse ≥ 95 | **Pass with notes** | `a11y.spec` and the QA-007 axe tests pass (82/82). Lighthouse N/T (not installed): run it on the preview |
| 18 | In-app confirm and Undo toast | **Pass** | Confirm dialogs ("Create 4 chapters?", "Propose this booking?"); Undo toasts after copy-forward and bulk chapter (restored) |
| 19 | Home JS ≤ 350 KB; PDF lazy | **Pass** | 167.0 KB gzip; lazy PDF (QA F10-pdf) |
| 20 | 390 px nothing overlaps and editing hidden; 1280 px People shows QBR4 | **Pass** | `uat-R-390-plan-allocations.png` (no Add booking); `uat-R-1280-org-people.png` |
| 21 | Add craft "Service Design (SD)"; appears in pickers; rename changes no number | **Pass** | Added live; SD offered in the demand craft picker. Rename invariance from QA |
| 22 | Chapter with lead; bulk-assign; undo | **Pass with notes** | "Create chapters from crafts" created 4 chapters and assigned 4 people. Bulk "Set chapter" on 2 people took 1.7 s, and Undo restored it. I did not set a chapter lead in UAT |
| 23 | Band "Over capacity" QBR1 = Maria Kelly, Noma Odigie; 100 % = On target | **Pass** | Demo Home and Outlook over-capacity lists = Noma 115 %, Maria 110 %; Agnese 100 % green |
| 24 | Same number on People, Allocations and Outlook (person) | **Pass** | Live Noma 111 % on all three; Tom Hayes 50 % on all three |
| 25 | Rebalance to On target within 3 keystrokes per cell; copy forward; undo | **Pass** | Noma 111 % → 100 %; copy forward and Undo (`uat-C2`…`C4`) |
| 26 | Planview cell locked; editable after the Overridable rule | **Pass (QA)** | Locked cells and "Planview bookings are locked" legend seen live; API lock QA-003 fixed |
| 27 | Demand for a new Initiated project; the count drops | **Pass** | Atlas Onboarding, 2 → 1 |
| 28 | Propose 0.5 FTE BA Nebula QBR2 tentative ≤ 2 min; accept in My plan; time to staff | **Pass** | §2 row 3; `time-to-staff-2026-10-17.csv` row "accepted" |
| 29 | Viewer: catalogue only, copy link, export, no edit controls | **Pass** | Victor: link copied, `squad-catalogue-2026-10-17.csv`, no edit buttons on 12 pages, Settings 403 except Profile |
| 30 | Squad member craft change → approved → "Approved by {name}" | **Pass** | `uat-D7-noma-approved.png` |
| 31 | CSV import with a bad row: preview flags it, the rest imports | **Pass** | Preview "1 VALID 2 WITH ERRORS" with row reasons; result "0 created, 1 updated, 0 skipped" (`uat-K1/K2`) |
| 32 | Jira on the customer site: connect, auto-match, sync, sprint points | **N/T** | No customer site (CA-11). Demo flows and the failure path verified |
| 33 | Calibration suggested value with basis; change needs a note; audited | **Pass with notes** | Demo dialog: suggested 11.5 with basis, "Why are you changing this?". A live suggested value needs sprint data; audit in QA |
| 34 | Delivery signal on the project drawer and Outlook (tribe) | **N/T** | Needs synced snapshots; demo tribe page and Overview show it |
| 35 | Forced Jira failure shows on Home within one run | **Pass** | Live: "Jira sync failed just now: Jira rejected the credentials" (`uat-J3`) |
| 36 | 05:00 UTC scheduled sync in production | **N/T** | Production only. Check the first run after go-live (C-8) |
| 37 | Planview preview/apply on the customer sandbox | **N/T** | No sandbox (CA-11). Demo preview shows new, changed and removed |
| 38 | QBR pack < 60 s at scale, correct name | **Pass with notes** | 0.2 s here; 389 ms at 500×100 (QA). Name correct. The craft table can show raw migrated craft ids such as "delivery-lead" (QA-014, C-4) |
| 39 | Home: 4 tiles with time basis, no orphan | **Pass** | `live-03-tom-home.png` |
| 40 | Invite by email or copied link; accept; land with role | **Pass** | Rita invited as Planner ("Email isn't set up. Send this link yourself"), joined and landed on Home. The email path is N/T (Resend) |
| 41 | Expired invitation message | **Pass (QA)** | F9-reuse |
| 42 | Internal mode: no Create account, no billing, `/settings/billing` 404 | **Pass (QA)** | Needs a `VITE_APP_MODE=internal` build; my build was public mode (Billing and "Create account" visible, as expected) |
| 43 | Sprint planning appears only after enabling it | **Pass** | Tom: Settings › Features; nav gains "Sprint planning" with the v1.1 QBR data (`uat-F2-tom-sprints.png`) |
| 44 | `/demo` without a backend, with banner | **Pass** | Demo sweep |
| 45 | `/api/health` shows schema version and env booleans only | **Pass** | `schemaVersion` 9 / required 9, env booleans only |

---

## 4. Definition of Done

### 4.1 Per story (BACKLOG §6.1)

| # | Criterion | Status |
|---|---|---|
| 1 | ACs pass and are demoed on a Netlify deploy preview on Neon `preview` | **Partly.** ACs pass per QA (fix round) and this UAT on the local stack and demo. No Netlify preview with Neon `preview` exists yet (CA-5) |
| 2 | Only `components/ui` and tokens; lint and guardrails green | **Met** |
| 3 | Keyboard, focus, labels; axe 0 serious | **Met** (axe e2e). Lighthouse not run |
| 4 | `withApi` + `requireUser` + `can()`, zod, audit, same- and cross-tenant tests | **Met** (QA matrix 621/621) |
| 5 | Unit tests; Jest and typecheck green | **Met** (QA: 547 Jest tests, CI green) |
| 6 | Loading, empty and error states | **Met.** Seen: skeletons, empty proposals, "Jira isn't connected", 403/404, first-run (QA-038) |
| 7 | Copy and glossary; time basis on every metric | **Met with notes.** Every tile and list states QBRn · quarter. Copy nits in §6 |
| 8 | No business state in `localStorage` | **Met** |
| 9 | Numbered idempotent migrations with dry-run | **Met** locally (0001–0009). Neon dry-run is CA-12 |

### 4.2 Release (BACKLOG §6.2 and brief §6.2)

| # | Criterion | Status |
|---|---|---|
| 1 | All Musts done; Shoulds done or moved to 3.0 in `RTM.md` | **Met with notes.** 106/107 Musts (AL-01 virtualisation, QA-017). `RTM.md` marks Shoulds "Not done" rather than "moved to 3.0", and its summary is stale (455 tests; "AC-03 deviation" was fixed by QA-001). Tidy it in 2.0.1 |
| 2 | CI green: lint, typecheck, coverage ≥ 60 %, audit, gitleaks, build, bundle, dist grep, guardrails | **Met** per the QA fix round. Gitleaks runs only in GitHub |
| 3 | Playwright e2e for the PO journeys | **Met with notes.** Demo 82/82 and live 10/10 here. Jira sync with sprint points and Planview preview/apply run on demo data only until CA-11 |
| 4 | Visual baseline (`toHaveScreenshot`) for every route at 1280 and 1440 | **Not met.** There are review screenshots (`npm run e2e:screenshots`) but no committed baseline. Condition C-9 (2.0.1) |
| 5 | OWASP ZAP baseline; CSP clean | **Partly.** CSP is enforced with 0 violations. ZAP has not been run: run it on the preview (C-6) |
| 6 | Migration rehearsal on a Neon branch of production, dry-run approved, rollback rehearsed | **Not yet.** It is a customer step (CA-5, CA-12): condition C-1 |
| 7 | Docs: README, RTM, CURRENT_STATE, admin guide, glossary, release notes, runbook | **Mostly met.** README, RTM, release notes and runbook exist. **No `docs/admin-guide.md`**: roles, Jira/Planview set-up and calibration are spread across README, RUNBOOK and in-app Help. The glossary is in-app only. Condition C-9 |
| 8 | CA-1…CA-12 done or accepted as open by the PMO lead | **Open.** See §8 |
| 9 | PMO lead UAT sign-off with named users on a production-like copy | **This report is the PO/BA UAT.** The PMO lead's session with named users on the Neon rehearsal branch is condition C-2 |
| Brief | Repo hygiene (`debug_db.ts`, `test-*.ts`, `fix_qbr.js`, `test_payload.json`, `server/`) | **Met.** All gone |

---

## 5. UI acceptance

**Verdict: Accepted.** End to end it reads as one polished corporate product, matching the brief §3.2 and
DESIGN_SYSTEM.md. The navy sidebar has 11 items in 4 groups. The white top bar holds breadcrumb › workspace,
⌘K search, a LIVE or DEMO lozenge, help, notifications and the avatar. H1 with a one-line description and one primary
action is used everywhere. Inter is used with tabular numbers, the KPI tiles always show 4 with a time-basis caption,
and status lozenges are uppercase. Status colours mean status only. Charts use the fixed series and have Chart/Table
toggles. Every v1.1 complaint (four product names, emoji, rainbow crafts, amber at 100 %, broken dark mode, sidebar
overload, header collisions) is gone.

| Surface | Verdict | Notes (would anything embarrass the PMO lead in a demo?) |
|---|---|---|
| Sign-in, 2FA, invitation, reset | Clean | Centred card, wordmark, version footer, auto-submit on the 6th digit. The 2FA copy says "we emailed" even when Resend is not set up (CA-4) |
| Shell | Clean | Collapsed rail at 768. Embedded mode works |
| Home | Clean | The "Available" card subtitle wraps to two lines and its "Marketplace" link sits lower than "View all" (UAT-11) |
| Capacity Outlook | Good | The right-hand "Under target" list mixes Available-band people (0 %, 20 %, 30 %) with Under target (QA-023 was fixed on Home only, UAT-06) |
| Demand | Good | "NO DEMAND CAPTURED" appears on Nebula although QBR3 demand is visible. The rule is QBR1–2, so the copy should say so (UAT-07). **Migrated junk craft "X7AC" appears as a demand chip** (QA-014) |
| Allocations | Strong | Over-capacity warnings inline, tentative chips dashed, keyboard legend, Undo toast |
| Marketplace | Good | Open-demand rows: chips of different widths (PM, RG, PGM) misalign the project names (UAT-09). **The tribe-facing catalogue shows "X7AC · delivery-lead"** (QA-014) |
| My plan | Good | The proposal meta line wraps mid-phrase ("proposed by Tom Hayes 5 / days ago", UAT-10). The crafts drawer stacks craft, level and an unlabelled "%" cap vertically (UAT-13) |
| People | Good | The band filter label is cut to "Band (QBR1): a" at 1440 and 1280 (QA-036 residual, UAT-04). With an empty job title the subtitle starts with "·" (QA-032 residual, UAT-05). **Migrated chip "X7AC·L3"** on Tom Hayes |
| Projects, Tribes | Good | The Owner column is all "—" (owner picker limited: hand-off I open issue 7). Migrated tribes show "No lead set" (QA-015) |
| Jira & Planview | Good | Planview preview lists raw field keys (`startDate`, `endDate`) (UAT-12). In Project mapping a "Not mapped / NONE" row is labelled "PROPOSED" |
| Reports, QBR pack | Clean | The PDF is on brand; its by-craft table can show raw "delivery-lead" (QA-014) |
| Settings | Clean | Integrations: "Test connection" tests the saved settings, not the form, and says "not configured" (UAT-02). A bare host `acme.atlassian.net` is rejected (UAT-03). Saving without `INTEGRATIONS_ENC_KEY` shows "Something went wrong" (UAT-01) |
| Sprint planning (flagged) | Acceptable | Restyled. It labels the current quarter "QBR1 FY27" (v1.1 data) while the rest of the app and the QBR pack say "QBR1 = Q4 2026 (FY26 Q4)". Two quarter vocabularies until EP-21 (UAT-08) |
| Dialogs, drawers, toasts, 403/404 | Clean | Consistent E3 overlays, toasts with Undo, on-brand error pages |
| Dark mode | Not user-facing (by scope) | The app forces light (`index.tsx`). With `data-theme="dark"` set by hand, Home, Allocations, People, Members and Delivery swap tokens cleanly (`$UAT/demo-forceddark-*.png`). Ship the switch with XT-01 |
| 768 / 390 px | Acceptable | Tables scroll inside their cards with names readable. At 390 the grid is read-only |

**Top 5 UI/UX notes:**

1. **Migrated craft ids leak into customer-facing surfaces.** "X7AC · delivery-lead" and "X9DD · x" appear in craft
   pickers, People chips, Demand chips, the tribe catalogue and the QBR pack (QA-014). Clean them up in Settings ›
   Crafts before anyone outside the PMO sees the tool (C-4).
2. **Integration error copy.** Saving Jira credentials without `INTEGRATIONS_ENC_KEY` shows a generic "Something went
   wrong". "Test connection" ignores the unsaved form, and a bare host is rejected (UAT-01…03). The analyst's first
   Jira session will stumble here unless CA-3 is done first.
3. **List labels disagree with bands.** Capacity Outlook "Under target" includes Available people, and Demand says
   "No demand captured" when the rule means QBR1–2 only (UAT-06, UAT-07).
4. **People page polish.** The band filter label is truncated and the subtitle gets a leading "·" when the job title
   is empty (UAT-04, UAT-05). This is the page a chapter lead uses most.
5. **Small alignment nits on Home, Marketplace and My plan** (UAT-09…11). The craft chips in the open-demand list
   and the Available card header do not line up.

---

## 6. New UAT findings

None blocks go-live. All are proposed for 2.0.1 unless the condition column says otherwise.

| ID | Sev | Finding | Where | Proposed |
|---|---|---|---|---|
| UAT-01 | Minor | Saving Jira credentials without `INTEGRATIONS_ENC_KEY` returns 503. The UI shows "Something went wrong. Try again, or quote reference …" rather than saying an administrator must configure encryption | Settings › Integrations (`uat-G5`) | 2.0.1 copy fix; avoided by CA-3 before go-live (C-5) |
| UAT-02 | Minor | "Test connection" tests the stored config, not the values in the form, and answers "Jira is not configured … API token are required" although a token was typed | Settings › Integrations (`uat-J1`) | 2.0.1 |
| UAT-03 | Minor | Site `acme.atlassian.net` is rejected; only `https://acme.atlassian.net` is accepted | Settings › Integrations (`uat-G3`) | 2.0.1: add the scheme automatically |
| UAT-04 | Cosmetic | Band filter label truncated "Band (QBR1): a" at 1440 and 1280 (residual of QA-036) | People | 2.0.1 |
| UAT-05 | Cosmetic | People row subtitle starts with "·" when the job title is empty (residual of QA-032; the drawer is fixed) | People at 1280/768 | 2.0.1 |
| UAT-06 | Minor | Capacity Outlook "Under target" list includes Available-band people | Capacity Outlook | 2.0.1 (as QA-023 on Home) |
| UAT-07 | Cosmetic | "No demand captured" badge on projects that have demand outside QBR1–2 | Demand | 2.0.1: "No QBR1–2 demand" |
| UAT-08 | Minor | Sprint planning says "QBR1 FY27" for the quarter the rest of the app calls "QBR1 = Q4 2026 (FY26 Q4)" | Sprint planning (flagged) | Tell the Sprint planning users (CA-14); unify in 3.0 (EP-21) |
| UAT-09 | Cosmetic | Open-demand rows misalign because the craft chips have different widths | Marketplace | 2.0.1 |
| UAT-10 | Cosmetic | Proposal meta line wraps mid-phrase ("5 / days ago") | My plan | 2.0.1 |
| UAT-11 | Cosmetic | Available card subtitle wraps; header link misaligned | Home | 2.0.1 |
| UAT-12 | Cosmetic | Planview preview shows raw field keys (`startDate`, `endDate`) | Jira & Planview › Planview import | 2.0.1 |
| UAT-13 | Cosmetic | Below-the-table craft editor stacks the controls vertically; the "%" cap field has no visible label | Person drawer › Crafts | 2.0.1 |

Behaviour checked and accepted as designed: Propose defaults to the person's free capacity rather than the open FTE;
the QBR pack file name uses the quarter (`qbr-pack-2026-Q4.pdf`); Home "Recent activity" lists edits, proposals and
approvals but not project creation.

---

## 7. Deferred defects: PO calls

| ID | Defect | PO call | Reason |
|---|---|---|---|
| QA-014 | Unknown v1.1 craft ids become catalogue crafts with generated codes (`X7AC · delivery-lead`, `X9DD · x`) | **Accept deferral to 2.1, with go-live condition C-4** | The migration rewrite ("Unmapped" bucket) changes production data and is not needed for correctness: renaming or archiving a craft changes no number (ORG-02#AC3). On the rehearsal branch and again after production migration, a PMO Admin renames real crafts properly (for example "Delivery Lead", code `DL`) and archives junk ones in Settings › Crafts. This must happen before tribe leads see the catalogue or a QBR pack is shared |
| QA-015 | Migrated tribes lose the v1.1 `qbr_tribes` lead and take arbitrary casing ("PAYMENTS") | **Accept deferral to 2.1, with condition C-7** | Both are editable in Settings › Structure. The PMO lead sets tribe leads and casing in the first week. PO rule for 2.1: the QBR tribe name and lead win, otherwise the most common `client_name` casing |
| QA-017 | People and Allocations are not virtualised (500 rows: 29–34 k DOM nodes, cell edit ~870 ms) | **Accept deferral to 2.1** | The squad is tens of people, not hundreds. First paint stays ≤ 1.5 s at 500 people and it is documented in the release notes. Revisit if a workspace passes 200 people |
| QA-020 | Today and Window time bases missing on Capacity Outlook, People, Allocations and Tribes | **Accept deferral (close as by design for 2.x)** | PO decision: quarter-shaped pages stay QBR1–QBR4 only. Home keeps all six bases. Reopen only if users ask |
| QA-022 | v1.1 part-time capacity: Reports supply counts 0.8 FTE but the utilisation denominator uses 1.0 (target migrated as 100 %) | **Must-fix before go-live** | It breaks the "one trusted number" the PMO lead reports upward, in the Reports and QBR pack that are 2.0's main outputs. **PO rule (decision made):** a v1.1 person with capacity < 100 % gets `targetUtil` = that capacity (consistent with BACKLOG A-4). It is a small, idempotent, additive data migration (only rows whose target is still the default 100), plus a test. **Fallback if it cannot ship in time:** condition C-3: list v1.1 people with capacity < 100 on the rehearsal branch and set their target with People › bulk "Set target" right after go-live, before the first QBR pack |
| QA-024 | Without `FROM_EMAIL`, mail is sent from `noreply@orbitspace.io` | **Accept deferral to 2.1, with go-live condition C-5 (CA-4)** | Setting `FROM_EMAIL` removes the symptom, and changing the fallback now would break 2FA and reset emails. Delete the legacy fallback in 2.1 once `FROM_EMAIL` is confirmed in production |
| QA-033 | Some Available values untinted | **Accept, closed as by design** | Not reproduced in UAT (every Available cell had the neutral sunken tint). The neutral tint is the DESIGN_SYSTEM §2.4 contrast choice |

---

## 8. Decision, conditions and customer actions

### 8.1 Decision

**Accepted for release with conditions.** The release can be merged and deployed once C-1 to C-5 are met. C-6 to C-9
are tracked in hypercare and 2.0.1.

| # | Condition | Owner | When |
|---|---|---|---|
| C-1 | Neon rehearsal (RUNBOOK §1.3–1.6): dry-run on a branch of production with timings, parity "0 rows lost, 0 credential changes", and a smoke test on a deploy preview | Operator, PMO lead approves (CA-5, CA-12) | Before go-live |
| C-2 | PMO lead UAT session with named users per persona on the rehearsal preview (CA-11, D-3): repeat §2 rows 1–3 and 6, and measure SUS | PMO lead | Before go-live |
| C-3 | **QA-022** fixed as ruled in §7, or the operational fallback (set part-timers' targets) done and the QBR pack checked | Dev; or PMO lead | Before go-live (fallback: before the first QBR pack) |
| C-4 | QA-014 clean-up: rename or archive generated crafts (codes starting `X`) in Settings › Crafts on the rehearsal branch and again in production | PMO Admin | Before go-live comms |
| C-5 | Environment ready: `JWT_SECRET` unchanged, `INTEGRATIONS_ENC_KEY` set and `reencrypt_integrations.ts` run, `RESEND_API_KEY` + verified `FROM_EMAIL`, `APP_MODE`/`VITE_APP_MODE` decided (CA-3, CA-4, CA-6) | Customer IT | Before go-live |
| C-6 | Lighthouse a11y ≥ 95 on Home, Allocations, People and Settings › Members, plus an OWASP ZAP baseline with no high findings, on the preview | QA | Before or in the go-live window |
| C-7 | Data hygiene week 1: tribe leads and casing (QA-015), chapter leads, review roles (CA-15) | PMO lead, Org Admins | Week 1 |
| C-8 | Customer-instance validation: §6.3-32, 34, 35, 37 on the customer's Jira site and Planview sandbox; first 05:00 UTC scheduled sync creates snapshots (§6.3-36); then set calibration from real sprints | PMO analyst, QA | Hypercare (first 2 weeks) |
| C-9 | 2.0.1: UAT-01…13, `docs/admin-guide.md` (roles, Jira/Planview set-up, calibration), committed visual baseline at 1280/1440, `RTM.md` refreshed (Shoulds marked "moved to 3.0") | Dev, BA | Within 2 sprints |

### 8.2 Customer actions

**Before go-live**

| Action | Ref |
|---|---|
| Rotate the Neon `neondb_owner` password (it is in git history) and update `NETLIFY_DATABASE_URL`, `NETLIFY_DATABASE_URL_UNPOOLED` and `NEON_DATABASE_URL` | CA-1 (now) |
| Delete the Render service and any Vercel project | CA-2 (now) |
| Netlify env: keep `JWT_SECRET` **unchanged**; add `INTEGRATIONS_ENC_KEY` (`openssl rand -base64 32`), then run `scripts/reencrypt_integrations.ts` (dry-run first); set `APP_MODE=internal` + `VITE_APP_MODE=internal` for the corporate deployment (closes sign-up, `/demo` and billing); optional `ALLOWED_ORIGINS`; `OPENAI_API_KEY` only if the AI opt-in will be used | CA-3 |
| `RESEND_API_KEY` and `FROM_EMAIL` on a Resend-verified domain (2FA, reset, invitations; removes the Orbit sender, QA-024) | CA-4 |
| Deploy previews: `NETLIFY_AUTH_TOKEN` and `NETLIFY_SITE_ID` as GitHub secrets, a Neon `preview` branch, and preview-scoped database variables (preview secrets) | CA-5 |
| Run `node scripts/check_jwt_fallback.mjs` with the production `JWT_SECRET` and report match or no match | CA-6 |
| Delete `testuser@test.com` if present | CA-7 |
| Name the platform admins; grant with `scripts/grant_platform_admin.mjs` | CA-8 |
| SEC-01 forensics (RUNBOOK §6) before the deploy, then decide on forced resets. The v1.1 reset-code leak stays live until 2.0 ships, so go-live should not slip | CA-9 |
| Stripe (public mode only): webhook events and `STRIPE_WEBHOOK_SECRET` | CA-10 |
| Jira Cloud test site, Planview product, sandbox and field names, named UAT users | CA-11 |
| Maintenance window, Neon backup branch `pre-2-0-<date>`, approve the dry-run report | CA-12 |

**Right after go-live**

| Action | Ref |
|---|---|
| Org Admins of organisations that use it: switch on **Sprint planning** in Settings › Features | CA-14 |
| Review the mapped roles in Settings › Members and roles: v1.1 `USER` → Viewer, so squad members who must accept proposals need **Squad member**, and analysts need Planner | CA-15 |
| Uptime check on `GET /api/health` | CA-13 |
| Clean up crafts (C-4), tribe leads (C-7) and part-time targets (C-3 fallback); create chapters ("Create chapters from crafts") and set chapter leads | C-3, C-4, C-7 |
| Connect Jira in Settings › Integrations (save first, then Test), map projects (Auto-match, Confirm), confirm people mappings, and set calibration from the suggested values | C-8 |
| After go-live, remove `VITE_OPENAI_API_KEY`, `GEMINI_API_KEY`, `API_KEY`, `VITE_GEMINI_API_KEY`, `SUPER_ADMIN_EMAIL` and `INTERNAL_API_SECRET` | CA-3 |
| Add `GITLEAKS_LICENSE` if the repository moves to an organisation | CA-16 |

### 8.3 Release 3.0 (Jira Marketplace) next steps

The 2.0 enablers are in place and were seen working in UAT: embedded shell mode, routable views, one `Transport`
interface, tokens mappable to `--ds-*`, self-hosted fonts with a `'self'` CSP, an entitlements service, no business
state in the browser, tenant-scoped ids, the `external_identities`/people mapping, and pure Jira aggregation.
Recommended order (BACKLOG §7):

1. **Kick-off checks:** confirm on developer.atlassian.com the current Forge limits, Connect end-of-life dates and
   revenue share. Decide D-4 (Planview as an optional egress connector, which loses "Runs on Atlassian" for that
   capability) and the product name ("PMO Capacity Planner for Jira").
2. **R3-01 Forge skeleton:** `jira:globalPage` with Custom UI in embedded mode, `ForgeBridgeTransport` implementing
   `Transport`, resolvers wrapping `_lib/handlers/*`, and `view.theme.enable()` with the `--ds-*` mapping (this also
   delivers dark mode).
3. **R3-02 Tenant and identity:** installation = org from `cloudId`, a `ForgeContextAuth` adapter, `accountId` as the
   user key, and roles from app admin plus Jira groups.
4. **R3-04 Jira-native data:** `requestJira` with minimal scopes, no API tokens, `scheduledTrigger` plus async events
   for the sync.
5. **R3-03 Storage:** port the migrations to Forge SQL, add a SaaS→Forge migration tool (match by email where visible,
   otherwise manual), and keep the SaaS edition on Neon.
6. **R3-05 Modules:** project page, the epic issue panel "PMO support" with a request button (this is where the tribe
   request ask lands, with IN-01/02 promoted to Must), the admin page and a dashboard gadget.
7. **R3-06 Licensing and R3-08 Trust:** `context.license` → entitlements, the Marketplace security self-assessment,
   DPA and EU data residency statement (customer in Ireland), and app review.
8. **R3-09:** promote the 2.0 Shoulds that the Marketplace needs: server-side scenarios, notifications through Jira,
   the audit UI, onboarding, and demand intake. Unify the QBR sprint module (EP-21, resolves UAT-08).

---

*Sign-off:* PO/BA, 17 Oct 2026. Accepted with conditions C-1…C-9. The PMO lead signs after C-2.
