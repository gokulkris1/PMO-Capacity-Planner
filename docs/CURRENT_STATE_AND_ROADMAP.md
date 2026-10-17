# PMO Capacity Planner — Current State, Craft Model and Roadmap

_Last updated: 2 October 2026 · branch `claude/resource-allocation-pmo-visibility-oi2g5f`_

## 1. The goal in one paragraph

The PMO squad should be **100% used, on the right work, with nothing hidden**. Every individual has an
**above-the-table craft** (the role they are hired and reported for, e.g. Project Manager) and a set of
**below-the-table crafts** (what else they can credibly serve, e.g. Scrum Master, Business Analysis,
Jira administration). Projects raise **craft demand per quarter**; the PMO matches demand to people across
the next four quarters (**QBR1–QBR4**), surfaces spare capacity to tribes as a service catalogue, and uses
**Jira story points and Planview assignments** as the ground truth for whether the plan is real.

## 2. Current state as found (before this iteration)

### What already worked
| Area | State |
|---|---|
| Core model | Resources, projects, allocations (with optional date ranges) persisted per workspace in Neon Postgres via a single `POST /api/workspace` full-replace save. |
| Views | Dashboard, allocation matrix, by tribe/project/individual/skills/team, 6-month forecast, what-if sandbox, PDF/CSV export, CSV import. |
| Tenancy & auth | Multi-org slugs (`/o/:orgSlug`), JWT auth, OTP/2FA, 5-tier RBAC, Stripe plans, superuser cockpit. |
| QBR sprint module | Separate `qbr_*` tables (tribes, chapters, CoEs, squads, OKRs, sprints, bookings, scenarios) with its own API and demo seed. |

### What was broken or misleading
| # | Finding | Impact | Status |
|---|---|---|---|
| 1 | `JiraImportModal` could never open: `modal.type === 'syncJira'` was not a legal modal state and nothing set it. | Jira "integration" was unreachable dead code. | Replaced by the Integrations hub. |
| 2 | The old `/api/jira` function hard-coded `customfield_10016`, used the deprecated `/rest/api/3/search`, assumed 20 points = 1 FTE for every team and stored the API token in `localStorage`. | Wrong numbers, security exposure. | Endpoint now returns 410; new `/api/integrations/*` with encrypted server-side secrets and per-tribe calibration. |
| 3 | QBR module rendered with a hard-coded dark palette on the light theme. | Text invisible; module unusable. | Re-themed to the design-system tokens. |
| 4 | Scenario bookings never refreshed after an edit; member slide-over ignored scenario mode; quarter selection reset on refresh. | Horse-trading in a scenario looked like it did nothing. | Fixed. |
| 5 | Dashboard showed a hard-coded "+2.4% vs last month" trend. | Fake KPI. | Now shows QBR1 → QBR2 utilisation and unstaffed demand. |
| 6 | Demo data was dated Jan–Jun 2026, so every forward-looking view was empty. | Nothing to demonstrate. | Demo data now spans Q4 2026 – Q3 2027 with crafts and demand. |
| 7 | No notion of craft: "skills" were free-text tags, so you could not ask "how many PMs do we have, and who else could run a project?" | The core PMO question was unanswerable. | Craft model added (section 3). |
| 8 | No demand side at all: projects had no requirement roadmap, so utilisation could only be measured, never planned. | No way to anticipate needs from newly initiated projects. | Demand roadmap added. |

Residual issues that are **not** fixed in this iteration are listed in section 7.

## 3. The craft model

### Definitions
- **Craft catalogue** (`constants.ts → PMO_CRAFTS`): 12 PMO crafts (Programme Management, Project
  Management, Scrum Master, Product Management, Business Analysis, Digital Planning, Change & Adoption,
  PMO Analytics, Risk & Governance, Vendor Management, Release Coordination, Tooling Administration). Edit
  the list to match the chapter; ids are stable strings so stored data survives renames.
- **Above the table** = `resource.primaryCraft`. One per person. This is their reported supply.
- **Below the table** = `resource.secondaryCrafts[]`, each with a **proficiency** (L1 can assist, L2 can own
  with support, L3 can own independently) and a **maxPct** (the most of their capacity they will give to
  that craft, default 40%). This caps how much "reach" a secondary craft adds.
- **Craft on an allocation** = `allocation.craftId`. Every booking says which craft the person is performing
  on that project. If omitted it is their primary craft. This is what lets the engine split a person's load
  into above-the-table, below-the-table and undeclared.
- **Craft demand** = `project.craftDemand[]`: `{ quarterKey, craftId, fte }`. Captured when a project is
  initiated (the project modal and the Demand Roadmap both edit it).
- **Target utilisation** = `resource.targetUtil`, default 100.

### Quarter maths (`utils/quarters.ts`, `utils/craftEngine.ts`)
- QBR1 is the current calendar quarter; the window is four quarters and rolls automatically. Demand is
  keyed by stable quarter keys (`2026-Q4`) so entries keep meaning as the window moves.
- An allocation contributes `percentage × (overlap days / quarter days)` to a quarter. Undated allocations
  inherit the project's dates; undated projects count for the whole window.
- Per person per quarter: above-the-table %, below-the-table %, undeclared %, bench %.
- Per craft per quarter: primary supply (FTE of holders), committed, demand, gap, primary bench and
  **secondary reach** (extra FTE that below-the-table holders could still give, bounded by free capacity and
  their maxPct).
- Matching (`suggestMatches`): for an unstaffed line, rank people by above-the-table (+60), secondary
  proficiency (+20 +8/level), free capacity (up to +25), tribe familiarity (+10), covering the whole gap
  (+5) and being under-used (+5). Proposals are capped at the person's free capacity and secondary maxPct.

All of this is unit-tested in `tests/utils/craftEngine.test.ts`.

## 4. How the PMO runs a quarter with it

| Step | View | Who |
|---|---|---|
| 1. Keep profiles honest | **Craft Profiles** — set above/below-the-table crafts, proficiency, caps, tribe familiarity. | Chapter lead with each person |
| 2. Capture demand on initiation | **Demand Roadmap** — when a project is initiated set its stage, "initiated on" date and the FTE per craft per quarter. Copy forward across quarters. | PM / PMO intake |
| 3. See the gap | Demand Roadmap → *Supply vs demand by craft* shows demand, staffed, supply, gap and reach for QBR1–4. | PMO lead |
| 4. Fill it | **Squad Marketplace** — open demand with ranked matches; *Propose* books the person for that quarter (clipped to the project window) with the craft and `source: marketplace`. The right-hand catalogue is what to show tribes: who can do what, and how much is free. | PMO lead with tribe leads |
| 5. Pan out | **Utilisation Outlook** — four-quarter stacked capacity vs demand, under-used and strained lists, per person / team / tribe outlook. | QBR review |
| 6. Verify against delivery | **Jira & Planview** — pull story points per project/sprint/assignee, convert to FTE with the tribe calibration, compare with planned FTE ("delivery signal"), import Planview projects and assignments. | PMO analyst, each sprint |

The What-If sandbox still works on top: marketplace proposals made while a scenario is active go into the
scenario, not the live plan.

## 5. Jira and Planview integration design

### Architecture
- `netlify/functions/integrations.ts` (routes under `/api/integrations/*`), per-workspace config in
  `workspace_integrations` (`scripts/migrate_integrations.sql`). Secrets are AES-256-GCM encrypted with a key
  derived from `JWT_SECRET`; the client only ever sees `hasSecret: true`.
- Reads need org membership; saving connection details needs workspace-admin rights (same rule as saving
  the workspace).
- Every outbound call has an 8-second timeout because Netlify functions die at 10 seconds; paging is capped
  at 10 pages per call. For large Jira estates, narrow the date range or project list.

### Jira Cloud
- Auth: Atlassian API token (Basic). `POST /jira/test` detects the **story points field** by name
  ("Story point estimate" / "Story Points") and the Sprint field, instead of assuming `customfield_10016`.
- `POST /jira/usage` pages `POST /rest/api/3/search/jql` (the current endpoint) and aggregates points by
  assignee, project, sprint and quarter, with done vs total.
- **Story point → capacity** is a per-tribe calibration (`settings.calibration[tribe]`): points per sprint
  per FTE and sprint length. Default is 10 points / 2-week sprint / FTE. Calibrate from a tribe's last three
  closed sprints: completed points ÷ full-time people on the board. Tribes genuinely size differently, so
  never share one number.
- The **delivery signal** in the hub compares Jira-implied FTE with the PMO's planned FTE for QBR1 per mapped
  project: *under-allocated* means Jira shows more effort than the PMO has booked; *over-allocated* the
  reverse. Treat it as a conversation starter, not a verdict, until the calibration is trusted.
- Assignees are matched to planner people by email, then by name, so the squad's own Jira work can be
  reconciled against their allocations.

### Planview
- Two adapters: **AdaptiveWork** (Clarizen REST v2: session login, `data/query` with paging) and **generic
  REST/OData** for Planview Portfolios or PPM Pro, where you supply the two paths, the auth header and a
  dotted-path field map. Import creates planner projects (stage *Initiated*, linked by `planviewId`) and
  allocations (`source: planview`, matched by email then name, hours converted at 8h/day over a 65-day
  quarter). Re-importing replaces earlier Planview allocations for the same person/project instead of
  stacking them.
- Planview is treated as the system of record for *project existence and dates*; the planner remains the
  system of record for *craft demand and PMO allocations*.

## 6. Data model changes (idempotent, applied on cold start and in `scripts/migrate_crafts.sql`)

| Table | Column | Purpose |
|---|---|---|
| resources | `craft_profile JSONB` | `{ primaryCraft, secondaryCrafts[], tribeAffinity[], targetUtil }` |
| projects | `stage`, `initiated_on`, `craft_demand JSONB`, `jira_key`, `planview_id` | Roadmap and links |
| allocations | `craft_id`, `source` | Craft performed, provenance (manual / marketplace / planview / jira) |
| workspace_integrations | whole table | Encrypted connector config per workspace |

Guest/demo mode keeps the same model in `localStorage`.

## 7. Improvement roadmap

### Now (done in this iteration)
Craft model, four-quarter engine, Craft Profiles, Demand Roadmap, Squad Marketplace, Utilisation Outlook,
Integrations hub with calibrated Jira usage and Planview import, QBR module re-theme and scenario fixes,
dashboard honesty fixes, 51 automated tests.

### Next quarter
1. **Unify the QBR sprint module with the core model.** `qbr_members` and `qbr_projects` are separate
   tables from `resources`/`projects`, so sprint bookings and quarter allocations can disagree. Add an
   "import workspace people" action, then derive sprint bookings from allocations (or the reverse) rather
   than keeping two truths.
2. **Scheduled sync.** The hub pulls on demand. Add a Netlify scheduled function that snapshots Jira usage
   per sprint into a `delivery_snapshots` table so the delivery signal has history and the dashboard can
   show trend without a live call.
3. **Demand at epic level.** Today demand is per project per quarter. Pull Jira epics (or Planview work
   items) as demand lines so a tribe's backlog can raise PMO requirements directly.
4. **Actuals.** Allow a person to confirm their actual split per quarter (above/below/bench) so planned vs
   actual utilisation is visible; timesheets or Jira worklogs can seed it.
5. **Marketplace requests from tribes.** Let a tribe lead raise a request ("need 0.5 FTE Change in QBR2 for
   Payments") that lands as open demand without a project record, approved by the PMO lead.

### Platform hygiene
- `App.tsx` is a 1,500-line shell holding all state; move data state into a store (context/reducer) and
  split handlers so views can be lazy-loaded (the bundle is already 1.3 MB).
- The workspace save is a full delete-and-reinsert per keystroke (debounced 1.5 s). Move to per-entity
  upserts with optimistic concurrency before multiple admins edit at once.
- `server/` (Express) duplicates a subset of the Netlify functions and is out of date; either make it the
  local dev host for the same handlers or remove it.
- Add row-level org checks on every `qbr` endpoint (they filter by `wsId` from the query string without
  verifying membership).
- Add UI tests (Playwright) for the five planning views; today only engine and API handlers are tested.
- Audit-report markdown files in the repo root are historical; move them under `docs/history/`.

## 8. Assumptions and open questions

- **Quarters are calendar quarters.** If the business runs a fiscal year, add an offset in
  `utils/quarters.ts` (one constant) — the labels QBR1–4 stay the same.
- **Below-the-table caps default to 40%** of a person's capacity per secondary craft. Chapter leads should
  set these per person.
- **One primary craft per person.** A dual-role person (PM + SM) models the second role as a secondary
  craft at L3 with a high cap.
- **Story-point calibration starts at 10 points / sprint / FTE.** This is a placeholder until each tribe is
  measured; the hub explains how.
- **Planview product.** The AdaptiveWork adapter follows the Clarizen v2 API; the generic adapter needs the
  real Portfolios/PPM Pro endpoints and field names from your instance before first use.
- Which crafts count as "PMO squad" vs tribe-owned (e.g. Product Management) is a chapter decision; the
  catalogue is editable.
