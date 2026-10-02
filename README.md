# PMO Capacity Planner

Capacity, craft and demand planning for a PMO squad: who holds which craft above and below the table,
what projects need per quarter (QBR1–QBR4), where the gaps and the bench are, and how that squares with
Jira and Planview.

## Run it

```bash
npm install
npm run dev            # Vite on http://localhost:3000 (demo mode with sample data, no backend needed)
npm test               # jest: engine + API handler tests
npm run build          # production bundle
```

Production runs on Netlify: the SPA plus the functions in `netlify/functions/` (`/api/*`), backed by Neon
Postgres. Required environment: `NEON_DATABASE_URL` (or the Netlify Neon variables), `JWT_SECRET` (also
derives the key that encrypts integration secrets), optional `OPENAI_API_KEY`, `RESEND_API_KEY`, Stripe keys.
See `NETLIFY_SETUP.md`.

First-time schema for the planning features: run `scripts/migrate_crafts.sql` and
`scripts/migrate_integrations.sql` in the Neon console (both are idempotent; the functions also apply them
lazily on cold start).

## Where things are

| Need | Go to |
|---|---|
| Set a person's above/below-the-table crafts | **Craft Profiles** → Edit crafts (or the resource modal) |
| Capture a new project's craft requirements | **Demand Roadmap** (click a quarter cell) or the project modal |
| Find who can fill open demand, offer the squad to tribes | **Squad Marketplace** |
| See four-quarter utilisation, bench and strain | **Utilisation Outlook** |
| Connect Jira / Planview, calibrate story points per tribe | **Jira & Planview** |
| Sprint-level bookings, squads, OKRs | **QBR Sprint Planning** |

The design, the maths, the integration contract and the roadmap are in
[`docs/CURRENT_STATE_AND_ROADMAP.md`](docs/CURRENT_STATE_AND_ROADMAP.md). Requirements traceability is in
[`RTM.md`](RTM.md).

## Code map

- `types.ts`, `constants.ts` — data model and the craft catalogue (`PMO_CRAFTS`).
- `utils/quarters.ts`, `utils/craftEngine.ts` — rolling-quarter maths, supply/demand/gap, matching.
- `components/crafts/*` — Craft Profiles, Demand Roadmap, Squad Marketplace, Utilisation Outlook.
- `components/integrations/IntegrationsHub.tsx` + `netlify/functions/integrations.ts` — Jira / Planview.
- `components/qbr/*` + `netlify/functions/qbr.ts` — sprint-level QBR module.
- `netlify/functions/workspace.ts` — workspace load/save (persists craft fields).
