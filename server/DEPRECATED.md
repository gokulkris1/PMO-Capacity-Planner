# Retired Express API

The Express application in this directory is retired and is **not a supported application API**.

## Why it is retired

The old routes pre-date multi-tenant workspace authorization. They cannot safely provide the commercial application API because they do not enforce the current organization, workspace-membership, lifecycle, or RBAC rules. Their route, database, authentication, and Swagger source files were removed rather than left available for accidental remounting.

The supported backend is the Netlify Functions implementation in [../netlify/functions](../netlify/functions). It is responsible for authentication, workspace access, tenant isolation, and data persistence.

## Runtime behavior

`server/index.ts` exposes only `GET /health` for infrastructure health checks. Every `/api/*` request returns HTTP 410 (Gone). This is deliberate fail-closed behavior that prevents the retired service from becoming a public data or AI endpoint.

## Local development

Use Netlify's local development workflow when API behavior is needed. `npm run dev` starts the frontend only and does not provide backend functions.

## Do not re-enable it casually

Re-enabling any legacy router requires a full implementation and review of:

- current JWT verification and revocation behavior;
- database-backed organization and workspace membership checks;
- tenant filtering on every read and write;
- role and workspace-role authorization;
- validation, audit events, per-user rate limits, and automated security tests.
