# PMO Capacity Planner 2.0: admin guide

For **Org Admins** (and PMO Admins, who can do everything below except the organisation-wide settings). It covers the
first day after the upgrade from v1.1 and the jobs that come back every quarter. Deploying the release, the
database and rollback are in [`docs/release/RUNBOOK.md`](release/RUNBOOK.md); what changed for users is in
[`docs/release/RELEASE_NOTES_2.0.md`](release/RELEASE_NOTES_2.0.md).

Everything here is in the app, under **Settings** (bottom of the sidebar) unless it says otherwise. Nothing needs
SQL.

## Roles in one table

| Role | Who | Can |
|---|---|---|
| **Org Admin** | Runs the organisation | Everything, in every workspace: organisation settings, members, structure, crafts, features, billing |
| **PMO Admin** | Runs a workspace's plan | Everything in the workspace: people, projects, demand, bookings, structure, crafts, integrations, members of the workspace |
| **Planner** | Plans capacity | People, projects, demand, bookings, proposals, approving craft-change requests |
| **Squad member** | A person in the squad | Their own crafts (as a request), answering proposals, offering their own capacity (My plan) |
| **Viewer** | Reads the plan | Every page and export, no changes |

## First-day checklist (after the upgrade)

Work through it in this order. Each step takes minutes.

| # | Step | Where | Done when |
|---|---|---|---|
| 1 | **Check you are Org Admin** and the organisation and workspaces look right | Avatar menu (top right), Settings › Organisation | Your name shows "Org Admin" |
| 2 | **Review the mapped roles** | Settings › Members and roles | Every member has the role you want (see below) |
| 3 | **Clean up imported crafts** | Settings › Crafts | No craft shows "Imported — review" |
| 4 | **Check tribes: names and leads** | Settings › Structure › Tribes | Every tribe has the right spelling and a lead |
| 5 | **Create chapters and set chapter leads** | Settings › Structure › Chapters › "Create chapters from crafts" | Each chapter has a lead; chapter leads approve craft requests |
| 6 | **Check part-time targets** | People (Target column) | Part-timers' targets are what you expect |
| 7 | **Switch on Sprint planning** (only if you used the v1.1 QBR module) | Settings › Features | "Sprint planning (legacy QBR module)" is on |
| 8 | **Connect Jira** (needs `INTEGRATIONS_ENC_KEY`, below) | Settings › Integrations | "Test connection" succeeds, then Save |
| 9 | **Map Jira projects and people, set calibration per tribe** | Jira & Planview | Mappings confirmed; each tribe has a calibration |
| 10 | **Invite the people who are not users yet** | Settings › Members and roles › Invite people | Invitations sent (or links copied) |
| 11 | **Check planning rules** (fiscal year, band thresholds, sprint length) | Settings › Planning | Saved |

### 2. Review mapped roles

v1.1 roles were mapped automatically:

| v1.1 | 2.0 |
|---|---|
| Organisation `ORG_ADMIN`, users with role `ADMIN` | Org Admin |
| `SUPERUSER` | Platform admin, and Org Admin in their own organisation |
| Workspace `PMO_ADMIN` | PMO Admin |
| Workspace `WORKSPACE_OWNER` | Planner |
| Everyone else (`USER`, `MEMBER`, `VIEWER`) | Viewer |

So people who planned in v1.1 as plain users are **Viewers** now. In Settings › Members and roles, filter by role,
and raise planners to **Planner** and squad members who should answer proposals to **Squad member**. A role change
ends that person's current session, so they sign in again (same password) and get the new rights at once.

### 3. Clean up imported crafts

The upgrade turned every craft id that v1.1 data used but the catalogue did not know into a craft of its own, named
after the id in words, with a code taken from the name, for example `delivery-lead` → **"Delivery Lead"**, code
**DL**. Settings › Crafts flags these **"Imported — review"** and shows a banner while any are left. For each one:

- **It is a real craft:** open it (click the name), correct the name, code, family and description, and **Save**.
  Saving marks it reviewed. The craft id never changes, so every person, booking and demand line that uses it
  keeps pointing at it and no number changes.
- **It is a duplicate of a catalogue craft** (for example `project_mgmt` next to Project Management): move each
  person to the catalogue craft in the person drawer (Crafts), and the demand lines in Demand, then **Archive** the
  imported craft (… › Archive). Archived crafts stay on old records but leave the pickers.
- **It is junk** (for example a craft called "X" from a test row): **Archive** it. If nothing uses it, it can be
  deleted instead.

The twelve v1.1 crafts (Programme Management, Project Management, Scrum Master / Agile Delivery, Product Management,
Business Analysis, Digital Planning, Change & Adoption, PMO Analytics & Reporting, Risk, Governance & Compliance,
Vendor & Commercial Management, Release & Delivery Coordination, Jira / Tooling Administration) kept their ids and
need no review. Do this before tribe leads see the Marketplace catalogue or a QBR pack is shared.

### 4. Tribes: names and leads

Tribes were created from v1.1 project client names, QBR tribes and tribe affinities. The upgrade keeps the v1.1
QBR tribe's spelling and lead where there was one, otherwise the most common client-name spelling. Check the list
in Settings › Structure › Tribes: fix a spelling or add a lead with … › Edit. Merge duplicates by moving projects
and people to one tribe and archiving the other.

### 6. Part-time targets

A v1.1 person whose capacity was below 100 % and who had no target now has that capacity as their target (for
example capacity 80 % → target 80 %), so supply and utilisation agree in every view, report and the QBR pack. If
someone should work towards a different target, change it in the person drawer, or for several people at once
with People › select › Bulk edit › Target.

### 7. Sprint planning

The v1.1 QBR sprint module is kept as **Delivery › Sprint planning**, with all its data, behind a switch that is
**off** after the upgrade. Settings › Features › "Sprint planning (legacy QBR module)" switches it on for the whole
organisation. Its quarter picker uses the app's quarter names ("QBR1 · Q4 2026"), with the v1.1 label in brackets.

### 8. Connect Jira (and the encryption key)

Jira and Planview credentials are stored encrypted with a key that only the server knows: the environment variable
**`INTEGRATIONS_ENC_KEY`** (32 random bytes, base64). Until it is set, Settings › Integrations shows "Credentials
cannot be saved on this deployment yet" and saving a token is refused with a message naming the variable. Nothing is
lost; you can still test a connection.

Whoever runs the deployment sets it once:

1. Generate a key: `openssl rand -base64 32`. Store it in the password manager; losing it means re-entering every
   integration token.
2. Netlify → Site configuration → Environment variables → add `INTEGRATIONS_ENC_KEY` (all contexts), then redeploy.
3. If v1.1 had saved Jira or Planview credentials, re-encrypt them with the new key (RUNBOOK step 2.10):
   `DATABASE_URL=… JWT_SECRET=… INTEGRATIONS_ENC_KEY=… npx tsx scripts/reencrypt_integrations.ts --dry-run`, then
   again without `--dry-run`.

Then, as Org Admin or PMO Admin, in Settings › Integrations › Jira Cloud:

1. **Site**: your Jira Cloud site, `acme.atlassian.net` (with or without `https://`).
2. **Account email** and **API token** (create the token at id.atlassian.com › Security › API tokens; use a service
   account that can browse the projects you plan).
3. **Project keys** and **Board IDs**: the projects and boards to read, comma-separated.
4. **Test connection** tests what is in the form, saved or not. It reports the Jira user and whether a story-points
   field was found. Testing a different site or account needs the token typed in again.
5. **Save**. The token is never shown again; enter a new one only to replace it.

### 9. Map Jira, then calibrate per tribe

In **Jira & Planview**:

- **Project mapping**: "Auto-match" proposes a planner project and tribe for each Jira project (by key, then by
  name). Proposals count only once you **Confirm** them.
- **People mapping**: confirm which Jira assignee is which person (matched by email first).
- **Sync now** runs the first sync; afterwards it runs every day at 05:00 UTC ("Daily Jira sync" in Settings ›
  Features). **Sync health** shows the last runs and any error in words.
- **Calibration**: story points per sprint per FTE, **per tribe**, which turns delivered points into "Jira-implied
  FTE". Start with the default (10 points per sprint per FTE, 14-day sprints). Once sprints have synced, the tab
  suggests a value from that tribe's recent sprints ("based on Sprint 41–43: 186 pts, 5.4 FTE"): use **Use
  suggested** or **Edit**. Every change asks for a note and is audited. Revisit it each quarter or when a tribe
  changes how it estimates.

Planview (optional) is switched on in Settings › Integrations › Planview; imports always show a preview of new,
changed and removed items before anything is applied.

### 10. Invite users

Settings › Members and roles › **Invite people**: enter one or more email addresses and the role. With email set
up (`RESEND_API_KEY` and `FROM_EMAIL`), they get an email with a link valid for 7 days; without it, copy the
invitation link from the dialog and send it yourself. Pending invitations are listed with the members and can be
resent or revoked. An invited person who is already a user joins with the role you chose; a new person creates a
password and verifies their email.

My plan shows a user the person in the plan that is linked to their login. The upgrade linked every person whose
email matched a user's email; Settings › Members and roles lists each member's linked person, and the person
drawer's Identity tab shows whether a person is linked. 2.0 has no screen for linking someone added later: give
the person the same email as their login and ask whoever runs the deployment to set the link through the API
(`PATCH /api/v2/workspaces/:ws/people/:id` with `linkedUserId`).

## Every quarter

- Roll the plan: demand for the new QBR4, bookings copied forward (Allocations › copy forward), proposals answered.
- Re-check calibration per tribe (Jira & Planview › Calibration).
- Reports › **QBR pack** for the quarterly review; CSV exports for anything else. Every export is audited.

## When something looks wrong

| You see | Do |
|---|---|
| "PMO Capacity Planner is being updated" | A deploy is migrating the database. Wait; the page retries by itself and signs you in when it is ready. Signing in during the update also waits and retries. |
| A craft with a code like `X7AC` or "Imported — review" | Step 3 above. |
| Someone "doesn't have access" | Their role (step 2), or the workspace visibility in Settings › Organisation. |
| Saving Jira credentials says the encryption key is missing | Step 8: `INTEGRATIONS_ENC_KEY` is not set on the deployment. |
| Sprint planning is not in the sidebar | Step 7: the feature switch is off. |
| Numbers differ between two pages | They should not: report it with the page, the quarter and the person or tribe. |
