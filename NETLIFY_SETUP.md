# Production and preproduction deployment

## Canonical topology

Production is deployed only from `main` to the **pmocapacityplanner** Netlify site:

- Vite application: `dist`
- API: Netlify Functions in `netlify/functions`
- Browser API path: `/api/*`, routed by `netlify.toml`
- Database: Neon PostgreSQL, accessed only from serverless functions

Preproduction is deployed only from `develop` to the separate **pmocapacityplanner-preprod** Netlify site at `https://pmocapacityplanner-preprod.netlify.app`. It uses a separate Neon PostgreSQL 17 database with the production-compatible schema plus the pending lifecycle, RBAC, and QBR structures, but no copied production data or credentials. This prevents test activity, test users, and schema experiments from reaching the production database.

The deployment lanes are intentionally separate:

| Branch | Netlify site | Database | Purpose |
| --- | --- | --- | --- |
| `main` | `pmocapacityplanner` | production Neon database | Production releases only |
| `develop` | `pmocapacityplanner-preprod` | isolated preproduction Neon database | Integration and acceptance testing |

The GitHub workflow at `.github/workflows/deploy-netlify.yml` remains restricted to `main`. Netlify's Git integration builds the `develop` branch only in the preproduction site; it cannot publish to the production site.

The legacy Render Express service has been retired and exposes only `/health`.
Vercel and Render are deliberately not deployed by GitHub Actions because their former API route targeted the retired service. Do not point a Vercel site at a guessed Netlify hostname; either retire the Vercel site or configure its replacement after confirming the production Netlify domain.

## Required Netlify environment variables

Configure the production and preproduction site values independently. Never put values in source control or variables prefixed with `VITE_`.

- `NETLIFY_DATABASE_URL_UNPOOLED` (preferred), `NETLIFY_DATABASE_URL`, or `NEON_DATABASE_URL`
- `JWT_SECRET` — a long, random signing secret
- `RESEND_API_KEY` and optional `FROM_EMAIL` — required for verification, account recovery, and invitations
- `INTERNAL_API_SECRET` — required by server-to-server email receipts
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO`, and `STRIPE_PRICE_MAX` — required only for billing
- Provider key required by the selected AI integration

Netlify supplies the `URL` value for each site automatically. Do not attempt to create it as a custom environment variable because `URL` is a reserved Netlify key.

For preproduction, set each database URL and the newly generated `JWT_SECRET` as a secret-scoped Functions variable in the Netlify **production** context (the primary `develop` branch deploy). Do not reuse production database URLs, JWT secrets, email-provider keys, Stripe keys, or AI-provider keys. Email, billing, and AI integrations remain intentionally unconfigured in preproduction unless separately approved.

The source-controlled, data-free preproduction baseline is `scripts/bootstrap_preprod_schema.sql`. It can be safely applied only to an empty preproduction database; it must never be used to overwrite a production database.

## Release safeguards

1. Keep all connection strings and JWT values secret-scoped in Netlify. Correct any existing production database or JWT values classified as non-secret before the next production release.
2. Take a backup or verify point-in-time recovery before applying database migrations.
3. Review and apply `scripts/migrate_v2_rbac.sql`, then `scripts/migrate_project_lifecycle_and_skills.sql`, to the intended database only.
4. Confirm preproduction works with serverless functions, a new self-registered test account, workspace creation, and capacity planning.
5. Promote reviewed work from `develop` to `main`; `main` is the only production deployment branch. The GitHub Netlify workflow runs tests and the production build first.

## Local development

Use a local Netlify-compatible environment when testing API behavior so `/api/*` resolves to functions. A Vite-only server builds the UI but does not emulate production functions.

## Deprecated deployment files

- `render.yaml` retains an auto-deploy-disabled, health-only compatibility service.
- The obsolete Vercel routing configuration was removed so it cannot forward API traffic to the retired Render backend.
