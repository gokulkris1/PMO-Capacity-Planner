# PMO Capacity Planner: Product Brief for Release 2.0 "Corporate"

| | |
|---|---|
| Owner | Product Owner, PMO Capacity Planner |
| Date | 16 October 2026 (QBR1 = Q4 2026 … QBR4 = Q3 2027) |
| Baseline | v1.1.0 on `claude/resource-allocation-pmo-visibility-oi2g5f` (see `docs/CURRENT_STATE_AND_ROADMAP.md`, `RTM.md`) |
| Audience | BA, UX, tech lead, dev team, PMO lead (customer) |
| Status | For decision. Section 8 lists the open decisions. |

**This release in one line:** turn v1.1 into a corporate-grade capacity tracker that uses Jira and Planview data. It gets one design system in corporate blue and one information architecture, closes the security gaps, gives org structure and crafts proper data models, and adds scheduled Jira and Planview sync. Release 2.0 must also make the later port to a Jira Marketplace (Forge) app a change of transport, not a rewrite.

---

## 1. Vision and personas

**Vision.** Every PMO squad member is planned close to 100% on the right work for the next four quarters, across above-the-table and below-the-table crafts. Tribes can see and request what the squad offers. The plan is checked continuously against what Jira and Planview say is actually happening.

**North-star metric.** Squad planned utilisation per quarter within the target band (90–105%), with unstaffed demand closed within 5 working days.

| Persona | Who | Jobs to be done ("When …, I want to …, so I can …") | Primary 2.0 screens |
|---|---|---|---|
| **PMO lead** (primary buyer, the customer) | Owns the PMO squad and its service to tribes | When the QBR approaches, I want to see supply vs demand per craft for QBR1–4, so I can rebalance, hire or push back before the quarter starts. When a tribe initiates a project, I want its craft needs captured and approved quickly, so I can staff it while still in Mobilising. I want one trusted number for squad utilisation, so I can report 100% use upward. | Capacity Outlook, Demand Roadmap, Marketplace, Allocation Grid, Reports |
| **Chapter lead** | Line manager for a craft (e.g. Programme Mgmt) | Keep each person's above/below-the-table crafts, proficiency and caps current, so the matching is believable. See who in my chapter is benched or over 100%, so I can act in 1:1s. Approve a squad member's new below-the-table craft. | People (Craft Profiles), Person drawer, Capacity Outlook filtered to chapter |
| **PMO squad member** (PM, PgM, SM, BA, DP, Analyst) | Delivers on projects | See my bookings for QBR1–4 and what I am being proposed for, so I can accept or flag. Declare below-the-table crafts I can offer, so I get interesting work and stay at target. | My Plan (person page), notifications |
| **Tribe lead / project sponsor** | Consumes PMO services | Browse what the PMO squad can offer my tribe this quarter, and raise a request ("0.5 FTE Change in QBR2"), so I get cover without a hiring case. See who is staffed on my projects. | Marketplace catalogue (read + request), Project page |
| **PMO analyst** | Runs the data and the QBR pack | Keep Jira and Planview mappings and calibration right, so story points convert into honest FTE per tribe. Produce the QBR pack in under an hour. | Delivery (Jira/Planview) sync health, Calibration, Reports/exports |
| **Org admin** | IT / tool owner | Manage members, roles, crafts catalogue, tribes/chapters, fiscal calendar and integrations credentials securely. Pass security review. | Settings (Admin) |

---

## 2. Requested features: traceability

Rating: **Met** = works end-to-end in the product today. **Partially met** = the core exists but the gaps block real use. **Not met** = absent.

| # | Customer ask (verbatim summary) | What exists today | Rating | Gap to close |
|---|---|---|---|---|
| 1 | Capture above-the-table and below-the-table crafts per individual; allocation over QBR1–QBR4 | `Resource.primaryCraft`, `secondaryCrafts[]` (proficiency L1–L3, `maxPct`) edited in `Modals.tsx` ResourceModal; `components/crafts/CraftProfilesView.tsx` with a per-quarter load bar; `utils/craftEngine.ts` (`personQuarterLoad`), `utils/quarters.ts` rolling window | **Partially met** | The craft catalogue is hard-coded (`constants.ts PMO_CRAFTS`), so orgs cannot edit it. QBR3/QBR4 columns are cut off at 1440 px (`10-craft-profiles.png`). Allocations cannot be edited per quarter: the Allocation Matrix is month-based with no craft column. Squad members cannot maintain their own profile. "By Skills" free-text tags compete with crafts. |
| 2 | Project requirement roadmap: new projects initiated; anticipate above-the-table craft requirements | `components/crafts/DemandRoadmapView.tsx`: stage, `initiatedOn`, `craftDemand[]` per quarter, staffed vs gap, copy-forward; supply vs demand by craft (`craftBalance`) | **Partially met** | No intake form or approval: demand is typed straight into the plan. Tribes are free text (`project.clientName`). Planview-imported projects arrive without demand. No demand at Jira epic level. No history of how demand changed. |
| 3 | Below-the-table crafts showcased to projects; engage the squad across projects and tribes; maximum efficiency per resource | `components/crafts/SquadMarketplaceView.tsx`: open demand ranked with `suggestMatches`, one-click *Propose* (books immediately), "What the squad can offer" catalogue per craft | **Partially met** | The catalogue is only visible inside the PMO tool, so tribe leads have no shareable view and cannot raise a request. Proposals become live bookings with no tentative/accept step and no notification to the person. Nobody owns "under target" follow-up. |
| 4 | Pan out the current state; show how to improve | `docs/CURRENT_STATE_AND_ROADMAP.md`, this brief; Utilisation Outlook four-quarter view | **Met** (as documents) / **Partially met** (in product) | There is no trend or history in the product: every number is computed live and nothing is snapshotted. No QBR pack export. |
| 5 | Jira and Planview API integration for end-to-end visibility of allocation and utilisation; story points per tribe/quarter/sprint, mapped to capacity per tribe | `components/integrations/IntegrationsHub.tsx` + `netlify/functions/integrations.ts`: encrypted credentials, story-point field detection, usage by project/sprint/assignee/quarter, per-tribe calibration (`pointsPerSprintPerFte`), planned-vs-implied "delivery signal"; Planview AdaptiveWork and generic REST/OData import | **Partially met** | Sync is **on demand only**, with no schedule, snapshots or trend. Calibration is keyed by tribe-name text and has no "add tribe" or suggested value. Mapping is a dropdown per row (`— map to —`) with no bulk or auto-match. Jira results stay inside the hub and never reach the Outlook or People views. Jira auth is a personal API token, not OAuth. The Planview generic adapter has not been validated against the customer's instance. Tables overflow (`30-int-jira.png`). |
| 6 | Ultimate goal: PMO teams 100% used, servicing projects when needed | `targetUtil` (default 100) per person; Utilisation Outlook under-used / strained lists | **Partially met** | The status thresholds contradict the goal. `types.ts getAllocationStatus` labels 60–80% "Optimal" and 80–100% "High" (amber warning), so Dashboard, Matrix and By Team show a person at 100% as a warning. There is no target band, no per-tribe/chapter utilisation trend, and no planned vs actual. |
| 7a | "Very bad quality UX/UI"; corporate tool, crisp elements, corporate blues | `index.css` has Atlassian-blue tokens, but most UI uses inline styles and emoji | **Not met** | Full design system and app-shell overhaul (section 3). |
| 7b | Fully functional capacity tracker in tandem with Jira and Planview | See rows 1–6 | **Partially met** | Epics EP-04 to EP-11 (section 4). |
| 7c | Next phase: Jira Marketplace app; keep in mind now | Nothing marketplace-specific; architecture is Netlify + Neon + JWT, with business state partly in `localStorage` | **Not met** | Section 5, plus Release 2.0 enablers in EP-04. |
| 7d | Existing users keep the same logins | Email + password (bcrypt), OTP verification, optional 2FA, JWT (`netlify/functions/auth.ts`) | **Met (constraint)** | Must stay true through 2.0: no forced password reset, no change of identifier, same org slugs and URLs (old URLs redirect). |

---

## 3. UX/UI assessment and corporate design direction

### 3.1 Honest critique of the current UI

Evidence is in the review screenshots taken at 1440×900 against the demo workspace and a mocked authenticated workspace. File names are in brackets.

**Identity and polish**
1. **Four product names.** "Orbit Space" (logo, landing, AI), "PMO Capacity Planner" (tour), "PMO Planner v1.1.0" (footer) and "Tom's team capacity tool" (tour copy). The logo is a planet emoji (`00-landing.png`, `01-first-visit-tour.png`). This does not read as a corporate product.
2. **Emoji as icons.** There are 180 emoji in 29 component files: nav, KPI tiles, buttons ("✅ Apply", "🔬 What-If"), locks on buttons ("+ Resource 🔒") and empty states. They render differently on each OS and look consumer-grade. `lucide-react` is a dependency, but **0** files import it.
3. **Mixed visual languages.** Atlassian-blue tokens in `index.css` sit alongside indigo/violet gradients (tour, AI button, pricing), a dark-navy hero on What-If, pastel decorative circles on KPI tiles, and pill tabs in three different styles. The code holds **358 unique hex colours** and **1,412 inline `style={{}}` objects**, so there is no single source of truth.
4. **Dark mode is broken.** The toggle flips its label, but Dashboard and the Crafts views stay light (`23-dark.png`, `24-dark-marketplace.png`).

**Colour semantics**

5. **Red, amber and green are overloaded.** The same hues encode allocation status, **project colour** (Orion Security is red) and **craft colour** (Risk & Governance is a solid red chip). By Team tints each cell by project colour, so a 20% booking on a red project reads as "over" (`08-by-team.png`). The 12 saturated craft colours make every table a rainbow.
6. **Thresholds fight the goal.** A person at 100% shows amber "High" (`02-dashboard.png`, `03-allocation-matrix.png`). The customer's target is 100%.

**Navigation and layout**

7. **Sidebar overload.** Up to about 25 entries in 8 groups: 14 views, plus Manage, Data, Organization, Pricing, Tour, theme and plan. "Integrations" falls below the fold at 900 px. Some entries are duplicates: "Manage Resources" equals By Individual, and "Manage Projects" equals By Project. A large "Log In / Sign Up" button takes the top slot (`22-shell-full.png`).
8. **Header collisions.** Long subtitles push the actions to wrap onto 2–3 lines ("+ Resource 🔒" stacked) on Craft Profiles, Demand Roadmap, Marketplace and Integrations (`10`, `11`, `12`, `14`). "+ Resource / + Project / What-If" appear on every page whatever the context.
9. **Views are not URLs.** `activeTab` is React state, so no view can be bookmarked, shared or deep-linked. That is a blocker for Jira modules later. The settings route still shows the title "Dashboard" (`33-settings.png`).

**Legacy views duplicating new ones**

10. By Tribe, By Project and By Individual each render **day-level availability calendars** per person (month grids of "45%" cells). This is the wrong granularity for quarter planning and fills screen after screen (`04`, `05`, `06`).
11. By Skills (free-text tags) duplicates Craft Profiles. By Team duplicates the Allocation Matrix. Dashboard and Utilisation Outlook lead with overlapping KPIs computed differently: 63% "today" vs 70% QBR1, with no label saying which is which.
12. **Numbers disagree between views.** Tom Hayes is 45% on the Matrix (today), but his By Team row lists 20% + 25% + 20%. The Orion booking starts in November, and neither view states its time basis.

**Core screens**

13. **Allocation Matrix** (`03`): month date pickers are truncated ("October 202"), project headers are truncated ("APOLLO REV…"), cells are tiny boxes with "·" placeholders, and there is no craft, no quarter view, no sticky header or first column, no keyboard navigation and no bulk edit. It is the most important editing surface and the weakest one.
14. **Overflowing tables.** Craft Profiles cuts off QBR3/QBR4 (ask #1 is literally "QBR1 to QBR4"), and the Jira usage and calibration tables clip at the right edge (`30-int-jira.png`, `30-int-cal.png`).
15. **Dashboard** (`02`): the KPI grid wraps 5 + 1 and leaves an orphan tile. Sub-labels are cryptic ("10P / 0C") and helper text is near-invisible pale grey. A 0% person has no visible bar.
16. **What-If** (`31-whatif-auth.png`) is a global, sticky mode that persists in `localStorage`. It shows three sets of Apply/Discard at once (top bar, yellow banner, dark hero) and bleeds into Settings. On the Free plan the nav click fails behind a native `alert()`.
17. **Feedback patterns.** 26 `alert()` and 11 `confirm()` calls handle permissions, plan limits and errors. Raw API errors are shown verbatim (`33-settings.png`). Empty states use emoji with low-contrast text (`13`, `14`).
18. **Settings** cards "Workspace Details" and "Billing & Quotas" are text-only placeholders with no controls.
19. **First run.** The landing page is a login card next to an "Orbit Space" hero with no value proposition. An 11-step tour with voice narration and a purple gradient starts automatically on first visit.
20. **Responsiveness.** At 390 px the layout collapses: the sidebar stacks on top and the header overlaps content (`25-mobile.png`). The floating AI button covers table content on every page.

**What is worth keeping:** the craft model and engine; the four-quarter stacked capacity chart (Utilisation Outlook); the Marketplace's two-panel "open demand ↔ what we can offer"; the Demand Roadmap's quarter grid; and the explicit calibration explanation.

### 3.2 Design direction: "Corporate Blue"

**Principles:** quiet chrome with loud data; one accent colour (blue), with status colours used only for status; dense but legible tables (enterprise planners live in grids); every number states its time basis (Today / QBR1 / QBR1–4); designed to sit inside Jira without imitating it.

#### Colour tokens (light theme)

All text pairs are checked for WCAG 2.1 AA (≥ 4.5:1 for text, ≥ 3:1 for UI and graphics).

| Token | Value | Use | Contrast |
|---|---|---|---|
| `--color-primary` | `#1F5FCC` | Primary buttons, links, selected tab, focus accents, "above the table" series | 5.89 on white |
| `--color-primary-hover` | `#184EA8` | Hover | 7.80 with white text |
| `--color-primary-pressed` | `#123F8A` | Active/pressed | |
| `--color-primary-subtle` | `#EBF2FD` | Selected row, active nav (light contexts), info chips | primary text 5.23 |
| `--color-primary-border` | `#B7CDF3` | Selected input/card border | |
| `--color-focus` | `#4C8DF6` | 2 px focus ring, 2 px offset | |
| `--color-navy-900` | `#0B1F3A` | **App chrome**: sidebar, Jira-less top bar | |
| `--color-navy-800` | `#13294B` | Sidebar hover | |
| `--color-navy-700` | `#1B3A66` | Sidebar active item | white 11.39 |
| `--color-nav-text` | `#C7D2E3` | Sidebar labels | 10.82 on navy |
| `--color-nav-muted` | `#8C9DB8` | Sidebar section headings | 6.00 on navy |
| `--color-nav-accent` | `#6FA4FF` | Active item indicator bar and icon | 6.63 on navy |
| `--color-bg` | `#F4F6F9` | Page background | |
| `--color-surface` | `#FFFFFF` | Cards, tables, drawers | |
| `--color-surface-sunken` | `#EEF1F6` | Table header, grouped rows, input fill (read-only) | |
| `--color-border` | `#DCE2EA` | Card and table dividers (decorative) | |
| `--color-border-strong` | `#B8C3D2` | Section dividers | |
| `--color-border-input` | `#7D8AA0` | Form control borders | 3.49 (UI ≥ 3:1) |
| `--color-text` | `#14233B` | Primary text, numbers | 15.75 |
| `--color-text-secondary` | `#44546F` | Labels, secondary text | 7.65 |
| `--color-text-tertiary` | `#637189` | Helper text, captions (never lighter) | 4.94 / 4.56 on bg |
| `--color-text-disabled` | `#9AA6B8` | Disabled only (exempt) | |
| `--color-success` / `-bg` | `#17744A` / `#E6F4EC` | **On target** (90–105%), sync OK | 5.78 / 5.10 |
| `--color-warning` / `-bg` / `-fill` | `#A35200` / `#FFF3E0` / `#F5A524` | **Under target**, stale sync, pending approval | 5.58 / 5.09 |
| `--color-danger` / `-bg` | `#C22E2E` / `#FDECEC` | **Over capacity** (>105%), sync failed, destructive | 5.64 / 4.94 |
| `--color-info` / `-bg` | `#0B6E8F` / `#E3F3F8` | Neutral notices, "Planview-sourced" provenance | 5.77 / 5.06 |

**Utilisation status scale.** This replaces `getAllocationStatus`. Thresholds are configurable per org and these are the defaults.

| Band | Range | Colour | Label |
|---|---|---|---|
| Bench | < 50% | `--color-text-tertiary` on `--color-surface-sunken` | "Available" |
| Under target | 50–89% | warning | "Under target" |
| On target | 90–105% | success | "On target" |
| Over | > 105% | danger | "Over capacity" |

**Chart series.** Use them in this order; each is ≥ 3:1 on white.

| # | Hex | Fixed meaning where applicable |
|---|---|---|
| 1 | `#1F5FCC` blue | Above-the-table load |
| 2 | `#0E8C9A` teal | Below-the-table load |
| 3 | `#C77A12` amber | Undeclared craft (load on a craft the person does not hold) |
| 4 | `#6E56CF` violet | Demand / requested |
| 5 | `#C2417A` magenta | |
| 6 | `#4E7F2A` green-olive | |
| 7 | `#5C6B82` slate | Other / unmapped |
| 8 | `#0B1F3A` navy | Totals, target line (dashed) |
| — | `#E3E8EF` with 45° hatch | Bench / free capacity |

**Rules:**
- **Crafts are not colour-coded with status hues.** A craft renders as a neutral chip (`--color-surface-sunken` with a short code: PM, SM, BA…). A filled chip means above the table; an outlined chip means below the table; the proficiency suffix reads ·L1–L3.
- **Projects get no colour.** Identify them by name and key (e.g. `APOLLO`). This removes the rainbow from By Team and Matrix.
- **Dark theme is a token swap later** (Could, section 4). No hard-coded hex values are allowed in components, so it stays cheap to add.

#### Typography: Inter

- **Choice: Inter** (variable, weights 400/500/600/700), **self-hosted** via `@fontsource-variable/inter`, not Google Fonts. Self-hosting is required for Forge CSP and for offline/corporate proxies.
- **Why Inter over IBM Plex Sans:**
  - its tall x-height and open apertures stay legible at 12–13 px in dense grids;
  - it has true **tabular numerals** (`font-feature-settings: "tnum"`) so FTE and % columns align;
  - it is neutral and widely used in enterprise SaaS, so it sits comfortably next to Jira's UI type without copying Atlassian branding;
  - it is already declared in `index.css`, which makes the migration nearly free.
- Plex carries a recognisable IBM identity and is wider, which costs columns in the allocation grid.
- **Scale** (px / line-height / weight): Display 28/36/600 (landing only) · H1 page title 24/32/600 · H2 section 20/28/600 · H3 card title 16/24/600 · Body 14/20/400 (default, matches Jira density) · Body-strong 14/20/600 · Table 13/18/400 · Caption 12/16/400 · Overline 11/16/600, +0.04em, uppercase (max one per card). **No weights of 800/900. No 56 px hero type inside the app.**
- Numbers in KPI tiles and tables always use `tnum`. Percentages and FTE are right-aligned.

#### Spacing, radius and elevation
- **Spacing (4 px base):** `0, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64`. Card padding is 16 (dense) or 24 (default). Table cell padding is 8×12. The page gutter is 24, and 16 when embedded.
- **Radius:** 3 px for chips/lozenges/checkboxes, 4 px for buttons/inputs, 6 px for cards/tables, 8 px for modals/drawers/popovers. Full pill shape only for avatars and toggle switches.
- **Elevation:**
  - **E0** flat with a 1 px `--color-border` (cards, tables);
  - **E1** `0 1px 2px rgba(11,31,58,.08)` (sticky headers, raised cards on hover);
  - **E2** `0 4px 12px rgba(11,31,58,.12)` (dropdowns, popovers, toasts);
  - **E3** `0 12px 32px rgba(11,31,58,.18)` (modals, drawers).
  - No coloured glows. No decorative blobs.
- **Motion:** 120 ms for hover/press, 200 ms for drawers. Respect `prefers-reduced-motion`.

#### Component inventory (build once in `components/ui/`, no inline styles)

| Component | Requirements |
|---|---|
| **App shell** | Collapsible navy sidebar: 248 px expanded, 64 px icon rail collapsed, state remembered per user. An **embedded mode** flag hides the sidebar and top bar and moves nav into page tabs (for Jira later). |
| **Top bar** (white, 56 px, bottom border) | Workspace switcher (org › workspace), global search (people, projects, crafts; ⌘K), Plan context switch (**Live / Scenario ▾**), help (?), notifications bell, user menu (profile, theme, sign out). |
| **Page header** | Breadcrumbs, H1, one-line description (truncates, never wraps the actions), time-basis selector where relevant (Today · QBR1…QBR4 · Window), and a right-aligned action group: one primary action, a secondary set, and an overflow "⋯" menu holding Export/Import. |
| **KPI tile** | Label, value (`tnum`), delta vs the previous quarter with direction icon, time basis in the caption, optional sparkline. Grid of 4 per row on desktop, never orphaned. No icons-in-blobs. |
| **Data table** | Sticky header and first column, column sort, filter chips, column visibility, row density (compact/comfortable), row selection with bulk-action bar, virtualisation above 200 rows, empty/loading/error states, horizontal scroll inside the card only, CSV export of the current view. |
| **Allocation grid cell** | Editable % with craft badge, keyboard navigation (arrows, Enter, Tab), paste from Excel, status tint by band (never by project). |
| **Tabs** | Underline style (one style app-wide). |
| **Chips and lozenges** | Craft chip (filled = above, outlined = below, ·L1–3), status lozenge (uppercase 11 px, 3 px radius), provenance tag (Manual / Marketplace / Jira / Planview). |
| **Avatar** | Initials on `--color-primary-subtle`, with the Atlassian avatar when available. |
| **Drawer** | Right-side, 480/720 px, for person and project detail and editing without losing context. |
| **Modal** | Confirmations and short forms only. Replaces every `alert()` and `confirm()`. |
| **Toast** | Success, info, error, with undo for destructive or bulk actions. |
| **Banner** | Page-level, e.g. "Viewing scenario 'Q1 rebalance', changes are not live" with a single Apply/Discard. |
| **Empty state** | Lucide icon (not emoji), one sentence, primary CTA. |
| **Skeleton loaders** | Tables, tiles, charts. |
| **Form controls** | Text, number with unit (%, FTE), select, combobox (people, projects), date and quarter picker, inline validation messages. |
| **Charts** (Recharts) | Stacked capacity bar (above/below/undeclared/bench + demand marker), utilisation heat strip (person × quarter), trend line (planned vs Jira-implied), using the series tokens above. |

**Icons:** `lucide-react` only, 16 px in nav and tables and 20 px in headers, stroke 1.75, `currentColor`. Mapping examples: Dashboard `LayoutDashboard`, Capacity `Gauge`, Demand `Map`, Allocations `Grid3x3`, Marketplace `Store`, People `Users`, Projects `FolderKanban`, Tribes `Network`, Delivery `Activity`, Reports `FileBarChart`, Settings `Settings`, Integrations `Plug`, Scenario `GitBranch`, Lock `Lock`. Emoji are banned in the UI, which can be enforced by a lint rule.

#### Information architecture

**Proposed navigation.** Every item is a URL route: `/o/:org/w/:ws/<area>/<view>`. Old `/o/:org` URLs keep working through redirects.

| Group | Item | Built from | Notes |
|---|---|---|---|
| — | **Home** | Dashboard + Utilisation Outlook KPIs | One overview: squad utilisation QBR1–4 vs target, unstaffed demand, over/under lists, sync health, pending approvals. |
| **Plan** | **Capacity Outlook** | Utilisation Outlook | Four-quarter stacked chart; pivot by craft, chapter, tribe or person. |
| | **Demand** | Demand Roadmap (+ requests in EP-13) | Project × quarter demand grid, intake queue. |
| | **Allocations** | Allocation Matrix + By Team + What-If edit table | Quarter grid (person × project × QBR1–4); group by team/chapter/tribe; scenario switch in the top bar. |
| | **Marketplace** | Squad Marketplace | Open demand ↔ squad offer; shareable catalogue link for tribe leads. |
| **Organisation** | **People** | By Individual + Craft Profiles + By Skills | Table of people with crafts and QBR1–4 heat strip; the person drawer replaces the day calendars. |
| | **Projects** | By Project | Table plus project drawer (demand, staffing, Jira/Planview links). |
| | **Tribes** | By Tribe | Tribe pages: projects, demand, PMO staffing, calibration. |
| **Delivery** | **Jira & Planview** | Integrations Hub (usage and delivery signal) | Sync health, story points per tribe/quarter/sprint, planned vs implied FTE. Connection setup moves to Settings. |
| | **Sprint planning** *(feature-flagged)* | QBR Sprint Planning | Hidden by default until unified (EP-21). |
| **Reports** | **Reports** | Exec Summary PDF, CSV export | QBR pack, utilisation by tribe/chapter/craft, exports. |
| *(bottom)* | **Settings** | SettingsHub, AdminPanel, Directory | Org, workspace, members and roles, org structure, craft catalogue, integrations, calibration, fiscal calendar and thresholds, billing (public mode only), audit log. |

**Retired or merged.**

| Item | Fate |
|---|---|
| By Skills | Retired. Skills become searchable tags on the person. |
| By Team | Becomes "group by team" in Allocations and People. |
| By Individual / By Tribe / By Project day calendars | Retired. Replaced by quarter/month heat strips. |
| "Manage Resources / Manage Projects" | Removed (duplicates). |
| Sidebar "Data" group | Moved to page ⋯ menus and Reports. |
| Pricing button | Settings › Billing, public mode only. |
| Dark-mode toggle | User menu. |
| Take a Tour | Help menu (?). |
| What-If page | Becomes the top-bar scenario context (EP-14). |
| Floating AI button | Retired from the canvas. The assistant becomes an optional right drawer, off by default (EP-24). |

**Fit inside Atlassian.** Release 2.0 aligns with Atlassian Design System sensibilities without copying its branding:
- 14 px body;
- 3–4 px control radii;
- underline tabs;
- uppercase lozenges for status;
- left nav with a top bar;
- restrained elevation.

Release 2.0 does **not** use Atlassian logos, the "Atlassian blue" `#0C66E4`/`#0052CC` as brand, the Atlaskit package names, or Jira-like naming. Our tokens are defined as CSS variables so that in embedded/Forge mode they can map to Atlassian design tokens (`var(--ds-text, #14233B)`, `var(--ds-surface, #FFFFFF)`…). The app then inherits Jira's light/dark theme automatically.

---

## 4. Gap list → epics, prioritised

**MoSCoW for Release 2.0 "Corporate"** (this pass) **vs Release 3.0 "Marketplace"**. Sizes are relative: S < 1 dev-week, M 1–3, L 3–6.

### 4.1 Release 2.0 Must-haves (12 epics)

| ID | Epic | Size | Scope (in) | Acceptance (headline) |
|---|---|---|---|---|
| **EP-01** | **Corporate design system and app shell** | L | Tokens (§3.2) in one `tokens.css`; self-hosted Inter; `components/ui/*` kit; navy collapsible sidebar; top bar; page header; lucide icons; toasts/modals replace all `alert`/`confirm`; skeletons; empty states; single product name. | 0 emoji in UI. 0 `alert(`/`confirm(` calls. No hex values in components outside `tokens.css` (lint rule). Every page uses the shell, page header and table components. Axe shows 0 serious/critical issues. |
| **EP-02** | **IA consolidation and routable views** | M | Nav per §3.2. Routes per view with deep links (`/o/:org/w/:ws/...`) and redirects from old URLs. Retire the views listed in §3.2. Time-basis label on every metric. Same-number guarantee: all views use `craftEngine` for quarter maths and one `today()` function for "now". | Sidebar ≤ 12 items. Every view is bookmarkable. A view-consistency test shows the Matrix, People and Outlook totals agree for the same person and period. |
| **EP-03** | **Security hardening** | M | (a) Delete `netlify/functions/debug_db.ts`: it is **unauthenticated and returns user emails, roles and all workspace memberships**. (b) `qbr.ts`: verify workspace membership for `wsId`/`orgId` on every route; today any logged-in user can read or write any workspace (IDOR). (c) `theme_extract.ts`: require auth and block private IP ranges and non-HTTP(S) schemes (SSRF). (d) CORS: no `*` fallback; fail closed if `URL` is unset. (e) Refuse to boot without `JWT_SECRET`. (f) Rate-limit auth, OTP and invite endpoints. (g) Move the session token from `localStorage` to an httpOnly, Secure, SameSite=Lax cookie with CSRF protection, so existing credentials keep working. (h) Run the role check server-side on every write (not just `authGate` in the UI). (i) Write audit events for every write (`audit.ts` exists). | External pen-test or OWASP ZAP baseline shows no high/critical findings. Unit tests for cross-tenant access return 403 on every function. |
| **EP-04** | **API and state layer (Marketplace enabler)** | L | Per-entity REST endpoints (`/people`, `/projects`, `/allocations`, `/demand`, `/tribes`, `/crafts`…) with optimistic concurrency (`version`), replacing the full delete-and-reinsert workspace save. A typed `api/` client behind a **transport interface** (HTTP now, `@forge/bridge` later). A state store (context and reducers, or TanStack Query) moved out of the 1,561-line `App.tsx`. Route-level code splitting. **No business state in `localStorage`** (scenarios and data move server-side; only UI preferences remain). UUIDs for all ids; every row tenant-scoped. | Two admins editing different people concurrently both persist. A conflicting edit on the same row gets a "changed by X, reload?" prompt. Initial route JS ≤ 350 KB gzip. `craftEngine` and `quarters` stay pure (no DOM/Node imports). |
| **EP-05** | **Org structure and craft catalogue as entities** | M | Tables and admin UI for **Tribes**, **Chapters**, **Teams**, **Crafts**. Person gets `chapterId`, `teamId`, `homeTribeId`. Project gets `tribeId` (replacing `clientName` text). Crafts are editable per org (name, short code, description, family, active/archived) with the 12 current crafts seeded and their ids kept stable. Migration: tribes from distinct `clientName` plus `qbr_tribes`; teams from `TEAMS`; calibration keys re-pointed from tribe name to `tribeId`. | Renaming a tribe or craft changes no historic numbers. Archived crafts stay readable on old data. Migration runs idempotently on prod data with a dry-run report. |
| **EP-06** | **People and craft profiles** | M | One **People** page: table with avatar, chapter, team, above-the-table chip, below-the-table chips (·L, cap), target, QBR1–4 heat strip (all four visible at 1280 px). Filters: craft, chapter, tribe affinity, band. **Person drawer**: profile, crafts editor, quarter load breakdown (above/below/undeclared/bench), bookings list, Jira identity link. Bulk edit (set chapter, target, add a secondary craft). CSV import/export of people and crafts. | A chapter lead updates 10 people's crafts in under 5 min. QBR4 is visible without horizontal scroll at 1280 px. |
| **EP-07** | **Allocation grid (editing UX)** | L | Quarter-first grid: rows are people (grouped by team/chapter/tribe), columns are QBR1–4 with project sub-rows, or a project-centric pivot. Inline % edit with a craft selector. Keyboard navigation. Copy-forward to later quarters. Paste a range. Row totals with band colour. Over-capacity warnings inline. Date-precise bookings stay available in the drawer. Provenance tag per booking (Manual / Marketplace / Jira / Planview), with Planview-sourced cells locked or overridable per org rule. **Tentative vs Confirmed** booking state. | The PMO lead can rebalance an over-allocated person across QBR1–2 in 3 clicks or keystrokes per cell. Undo is available for the last action and bulk actions. |
| **EP-08** | **Demand Roadmap and Marketplace v2** | M | Demand grid restyled. Demand lines carry `status` (Forecast / Confirmed) and an owner. Marketplace: *Propose* creates a **tentative** booking and notifies the person and project owner; Accept turns it Confirmed. **Shareable read-only catalogue** for the *Viewer* role (tribe leads): "what the squad can offer this quarter, by craft". "Under target" list with one-click "Offer to marketplace". | A tribe lead with the Viewer role sees the catalogue and can't edit. Proposed → Confirmed is tracked with time-to-staff. |
| **EP-09** | **Jira sync v2** | L | **Scheduled sync** (Netlify scheduled function, daily plus manual "sync now") writing `delivery_snapshots` per project, sprint, assignee and quarter. **Mapping UI**: Jira project/board → planner project and tribe, with auto-match by key or name and bulk confirm. **Assignee ↔ person mapping table** (match by Atlassian `accountId` first, then email, then name, with manual override stored). **Per-tribe calibration** keyed by `tribeId`, with a suggested value computed from the last 3 closed sprints (completed points ÷ mapped FTE) and an editable override plus a history note. **Sprint and velocity view per tribe** (points committed vs done, implied FTE per sprint). Delivery signal (planned vs implied FTE) surfaced in Capacity Outlook, Project and Tribe pages. Sync health panel (last run, errors, rate limits). Pagination via async batches to stay under the function time limit. | Story points per tribe/quarter/sprint visible without a manual pull. Snapshots provide ≥ 2 quarters of trend after 2 quarters live. A failed sync shows on Home within 1 run. |
| **EP-10** | **Planview sync v2** | M | Mapping review screen: **preview diff before apply** (new, changed and removed projects and assignments), with conflict rules: Planview owns project existence and dates, the planner owns craft demand and PMO allocations. Field-map editor for the generic adapter with a "test with sample record". Persisted person and project mappings. Scheduled import (behind a flag until validated on the customer instance). | Re-import is idempotent: no duplicate allocations and no overwritten manual bookings. The generic adapter is validated against the customer's real Planview product (dependency D-2). |
| **EP-11** | **Capacity Outlook, Home and reporting** | M | Home and Capacity Outlook per §3.2 with the new **target-band** semantics (`targetUtil`, org thresholds). Pivot by craft/chapter/tribe/person. Planned vs Jira-implied trend. **Exports**: grid and tables to CSV/XLSX, a restyled **QBR pack** PDF (cover, squad utilisation QBR1–4, supply vs demand by craft, open demand, over/under lists, delivery signal by tribe). | QBR pack generated in under 1 minute. Every chart has a table-view toggle (accessibility). |
| **EP-12** | **Admin settings, auth and first-run polish** | M | Real Settings: org profile, workspace, **members and roles** (invite, change role, remove; roles are Org Admin, PMO Admin, Chapter Lead, Member, Viewer, mapped from existing roles), org structure (EP-05), craft catalogue, integrations credentials, calibration, **fiscal calendar** (quarter start-month offset, sprint length default), utilisation thresholds, billing (public mode only). Login and landing restyled to the new design. **Unchanged credentials and URLs**. The auto-tour is removed. | 100% of existing users sign in with their current email, password and 2FA. No data loss (verified by row counts before and after migration). |

**Critical path:** EP-03 → EP-04 → EP-05 → (EP-06, EP-07, EP-09 in parallel) → EP-08, EP-10, EP-11. EP-01 and EP-02 start on day one and the screens are rebuilt on the new kit as each epic lands. Release 2.0 is large but mostly re-composes existing logic. **Descope order if time is short:** EP-10 scheduled import → EP-11 XLSX → EP-07 paste-range → EP-06 bulk edit.

### 4.2 Release 2.0 Should / Could / Won't

| ID | Epic | 2.0 | 3.0 | Notes |
|---|---|---|---|---|
| EP-13 | **Demand intake workflow and tribe requests**: request form (project or no project), Draft → Submitted → Approved/Rejected → Staffed, approval by PMO lead, SLA timer | **Should** | Must | First increment of "requests from tribes" (roadmap item 5). |
| EP-14 | **Server-side scenarios**: named scenarios, compare vs live (delta per person/quarter), apply/discard, top-bar context | **Should** | Must | Today scenarios live in `localStorage` (`pcp_scenario_allocations`), which blocks the port. If it slips, hide What-If rather than ship it in its current state. |
| EP-15 | **Notifications**: in-app and email (proposal, approval, over-capacity, sync failure), digest | **Should** | Must (Jira notifications) | Resend already integrated. |
| EP-16 | **Audit trail UI**: who changed which allocation, when and from where; filter and export | **Should** | Must | Events are captured in EP-03; this epic is the viewer. |
| EP-17 | **Onboarding wizard and help**: first-run setup (tribes, people CSV, crafts, connect Jira), glossary (above/below the table, FTE, QBR, calibration), contextual help | **Should** | Must | |
| EP-18 | **Jira OAuth 2.0 (3LO)** instead of personal API token | **Should** | Superseded by Forge auth | Removes the personal-token dependency. |
| EP-19 | **Dark theme** via token swap | Could | Must (inherit Jira theme) | Remove the broken toggle in 2.0 until this ships. |
| EP-20 | Drag-and-drop rebalancing on the grid | Could | Should | |
| EP-21 | **Unify QBR sprint module** with the core model (`qbr_members`/`qbr_projects` → people/projects; sprint bookings derived from allocations plus Jira sprints) | Could (feature-flagged off) | Must | Two sources of truth today. |
| EP-22 | **Actuals**: person confirms the quarter split; seed from Jira worklogs | Could | Should | |
| EP-23 | Enterprise SSO (SAML/OIDC) for the SaaS edition | Could | Should (SaaS only) | The Forge edition uses Atlassian identity. |
| EP-24 | AI assistant | **Won't change**: off by default, admin toggle, data-egress notice | Rovo agent (Could) | Sends workspace data to OpenAI, which is a corporate and Marketplace blocker unless opted in. |
| EP-25 | Mobile editing | Won't | Won't | Read-only responsive at ≥ 768 px is enough. |
| EP-26 | **Forge app and Marketplace listing** | Won't | **Must** | Section 5. |
| EP-27 | Slack/Teams notifications, Confluence QBR-pack macro | Won't | Could | |

---

## 5. Jira Marketplace phase (Release 3.0): considerations for the BA

| Topic | Recommendation | Why / implications |
|---|---|---|
| **Platform** | **Forge** (not Connect). | Atlassian has stopped accepting new Connect listings and is winding Connect down, which makes Forge the only realistic route for a new listing. Confirm current dates on developer.atlassian.com at kick-off. Forge also brings hosted compute and storage, Atlassian auth, and eligibility for the **"Runs on Atlassian"** badge, which enterprise buyers increasingly require. |
| **Tenant** | Tenant = **Jira site (`cloudId`)** plus installation id. One installation is one org. Workspaces become optional sub-partitions. | Our `org_id` maps 1:1 to the installation. All ids are UUIDs scoped by tenant (done in EP-04/05). No org slugs or URLs. |
| **Identity** | Atlassian **`accountId`** is the user key. No passwords, OTP or 2FA in the Forge edition: Atlassian handles login. Roles come from app-level admin settings plus Jira groups/permissions (e.g. "PMO Admins" group). | Email is often hidden by user privacy settings, so person ↔ user linking must go by `accountId` through a user picker (EP-09 builds the mapping table now). SaaS users keep email/password. A SaaS → Forge migration tool links by email where visible, otherwise by manual mapping. |
| **Storage** | **Forge SQL** for the relational model (people, projects, allocations, demand, snapshots). Forge KVS / custom entities for settings and small documents. No Neon in the "Runs on Atlassian" variant. | Our schema is relational and modest in volume; keep SQL portable (no Postgres-only features in core queries, or isolate them). Respect Forge storage and query limits: paginate, no giant JSON blobs. Data residency follows the site's realm only with Atlassian-hosted storage. |
| **UI** | **Custom UI** (our React app in an iframe, via `@forge/bridge` `invoke` to resolvers and `view.getContext`), not UI Kit. | Reuses the 2.0 React code. Theme via `view.theme.enable()` plus our tokens mapped to `--ds-*`. Use the shell's embedded mode: Jira provides the outer chrome, so we show in-page tabs and no sidebar. |
| **Modules** | `jira:globalPage` (the planner: Home, Capacity, Demand, Allocations, Marketplace, People). `jira:projectPage` (this Jira project's demand, PMO staffing and delivery signal). `jira:issuePanel` on epics ("PMO support": crafts needed and allocated, request button). `jira:adminPage` (settings, crafts, calibration, mappings). `jira:dashboardGadget` (team utilisation, open demand). `scheduledTrigger` (sync and snapshots). Async events (long-running sync). `webtrigger` (Planview inbound, optional). | The issue panel puts "request PMO help" where tribes already work, which serves ask #3 natively. |
| **Jira data access** | `requestJira` as app/as user with minimal scopes (e.g. `read:jira-work`, `read:jira-user`, `read:board-scope:jira-software`, `read:sprint:jira-software`, `storage:app`). | Removes API tokens entirely. Story points are read through the field id detected per site (logic already in `integrations.ts`; move it into a pure module). |
| **Egress and CSP** | Jira needs no egress. **Planview requires egress** (`permissions.external.fetch.backend`), which forfeits "Runs on Atlassian" for that capability. Make Planview an **optional connector** that admins enable explicitly. All fonts and scripts are bundled (no Google Fonts or CDNs). Avoid runtime-injected `<style>` without declaring it in the manifest. | Decide whether Planview is in the Marketplace v1 scope (D-4). |
| **Execution limits** | Resolver invocations are short (~25 s). Long syncs go through the async events queue with chunking. | Already constrained to 8 s calls today, so the design carries over. |
| **Pricing and licensing** | Atlassian Marketplace per-user tiered pricing, charged on the **site's Jira user tier**, not app users. Free tier ≤ 10 users. Check `license` in context (`isLicensed`) and degrade to read-only when unlicensed. Stripe and our Free/Pro/Max plans are disabled in the Forge edition. | The SaaS edition keeps Stripe. Plan gates move behind a single `entitlements` service (EP-04) so either source can feed them. Confirm the current revenue share. |
| **Trust and compliance** | Marketplace security requirements, privacy and security tab, DPA, data residency statement, bug bounty participation, app review. The customer appears to be in Ireland (`.ie` demo data), so expect **EU data residency** questions. | The "Runs on Atlassian" variant answers residency by inheriting the site's realm. |
| **Naming** | A brand name followed by "for Jira" is acceptable. "Jira …" as the leading word is not. | Feeds decision D-1 on product name. |

**Do now in Release 2.0 so the port is cheap** (already inside the Must epics):
1. A **transport-agnostic API client** (`api/transport.ts`: `HttpTransport` now, `ForgeBridgeTransport` later) with typed DTOs shared between client and server (EP-04).
2. **Pure domain core**: `craftEngine`, `quarters`, matching, calibration and Jira aggregation as pure TS with no DOM, Node or Netlify imports (EP-04, EP-09).
3. **No browser-only business state**: scenarios, workspace data and drafts live server-side (EP-04, EP-14).
4. **Tenant-scoped UUIDs everywhere** and an `external_identities` table (person ↔ email, Atlassian `accountId`, Planview id) (EP-05, EP-09).
5. **Routable views** and an **embedded shell mode** (EP-02, EP-01).
6. **Design tokens mappable to `--ds-*`**, 14 px body density, and self-hosted fonts (EP-01).
7. An **entitlements abstraction** in place of hard-coded `PLAN_LIMITS` checks in the UI (EP-04, EP-12).
8. **No request over ~8 s**: chunked or async sync jobs (EP-09).
9. Keep the **SQL portable** and avoid Neon-specific features in core paths (EP-04).

---

## 6. Release 2.0 success metrics and Definition of Done

### 6.1 Success metrics (measured 1 quarter after go-live unless noted)

| Area | Metric | Target |
|---|---|---|
| Outcome | Squad **planned utilisation** QBR1 (demo baseline 70%) | **≥ 90%**, with no person > 110% for a full quarter |
| Outcome | **Unstaffed demand** in QBR1 at quarter start (demo baseline 1.4 FTE) | ≤ 0.5 FTE |
| Outcome | Median **time to staff** a demand line (submitted or proposed → confirmed) | ≤ 5 working days |
| Adoption | Squad members with an above-the-table craft and ≥ 1 below-the-table craft (with cap) | 100% within 2 weeks |
| Adoption | Initiated/Mobilising projects with craft demand for QBR1–2 | 100% |
| Adoption | Weekly active: PMO lead, chapter leads, analysts | 100% of named users |
| Integration | Daily Jira sync success rate | ≥ 99% |
| Integration | Active Jira projects mapped to planner projects and tribes | ≥ 90% |
| Integration | Tribes with calibration set from real sprint data (not default 10) | 100% of active tribes |
| UX | SUS score (PMO lead, 2 chapter leads, 2 squad members, 1 analyst) | ≥ 75 |
| UX | Task: "find and tentatively book 0.5 FTE BA for Nebula in QBR2" | ≤ 2 min, no help |
| UX | QBR pack preparation time | < 1 hour (from days) |
| Quality | Lighthouse accessibility (key pages) | ≥ 95; WCAG 2.1 AA |
| Quality | p95 page load (200 people × 100 projects × 2,000 allocations) | < 2 s; grid edit round-trip < 300 ms |
| Security | Open high/critical findings | 0 |
| Continuity | Existing users signing in with unchanged credentials; data parity after migration | 100%; 0 rows lost |

### 6.2 Definition of Done

**Per story:**
- Acceptance criteria met and demoed on a deploy preview.
- Uses only `components/ui` and tokens: no inline hex, emoji, `alert` or `confirm`.
- Keyboard operable, visible focus, labels, and colour not the only signal; axe shows 0 serious issues.
- Server-side authorisation and tenant scoping on every new endpoint, with a cross-tenant test.
- Unit tests for any domain logic; existing jest suite green.
- Empty, loading and error states designed.
- Copy reviewed against the glossary; time basis labelled on every metric.

**Per release (2.0 "Corporate"):**
- All 12 Must epics accepted by the PMO lead in a UAT session on a production-like copy of real data.
- **Playwright e2e** for these journeys: sign in (existing user, with 2FA); edit a person's crafts; capture demand for a new project; propose → accept in Marketplace; rebalance in the Allocation grid; run a Jira sync and view per-tribe sprint points; Planview preview and apply; export the QBR pack.
- Visual regression baseline for all routes at 1280 and 1440 px.
- Security: EP-03 items closed, ZAP baseline clean, secrets only in environment variables, dependency audit with no high/critical issues.
- Migration scripts idempotent, dry-run reviewed, rollback tested; release notes; old URLs redirect.
- Docs updated: `README.md`, `RTM.md` (new REQ ids mapped to EP-xx), `docs/CURRENT_STATE_AND_ROADMAP.md`, admin guide (Jira/Planview setup, calibration), glossary.
- Repo hygiene: delete `debug_db.ts`, root `test-*.ts`, `fix_qbr.js` and `test_payload.json`; move historical audit markdown to `docs/history/`; decide whether to delete `server/` (Express) or make it the local dev host.

---

## 7. Assumptions and dependencies

| Ref | Item |
|---|---|
| A-1 | Calendar quarters by default. The fiscal offset becomes an org setting in EP-12. |
| A-2 | One above-the-table craft per person. Dual roles are modelled as an L3 below-the-table craft with a high cap. |
| A-3 | Story-point calibration differs by tribe and is owned by the PMO analyst. Jira-implied FTE is a signal, not a timesheet. |
| A-4 | Planview owns project existence and dates. The planner owns craft demand and PMO allocations. |
| D-1 | Customer access to a Jira Cloud test site with real boards (calibration, sprint view, e2e). |
| D-2 | Which Planview product (AdaptiveWork vs Portfolios vs PPM Pro), plus a sandbox and field names. This gates EP-10 acceptance. |
| D-3 | Named UAT users for each persona. |

## 8. Decisions needed from the customer (before sprint 1)

1. **Product name.** Keep "PMO Capacity Planner" (recommended: it is what users call it) and retire "Orbit Space" everywhere.
2. **Utilisation bands.** Accept the defaults: on target 90–105%, under 50–89%, bench < 50%, over > 105%.
3. **Roles.** Confirm the five roles (Org Admin, PMO Admin, Chapter Lead, Member, Viewer for tribe leads) and that squad members may edit their own below-the-table crafts subject to chapter-lead approval.
4. **Planview scope for Marketplace v1.** Optional connector with egress (recommended), or SaaS edition only.
5. **QBR sprint module.** Hide it behind a flag in 2.0 and unify it in 3.0 (recommended), or keep it visible as-is.
6. **AI assistant.** Off by default in 2.0 with an admin opt-in (recommended).
