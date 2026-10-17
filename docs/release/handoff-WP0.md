# Hand-off: WP-0 "Contracts & scaffold" (Release 2.0)

| | |
|---|---|
| Package | WP-0 (runs before A, B, C) |
| Branch | `claude/resource-allocation-pmo-visibility-oi2g5f` |
| Base | `bf70a40` (backlog + design system) |
| Stories | PL-09 (deletions), PL-10, PL-11 (config), DS-07 (config scaffold), §4.3 contracts, `state/` stubs |
| Gate | `npm ci && npm run typecheck && npm run lint && npm run format:check && npm test && npm run build` all green; `npm audit --omit=dev --audit-level=high` reports 0 vulnerabilities |

## 1. What was created

### Contracts (`shared/**`, frozen from now on; change requests go to I)

| File | Content |
|---|---|
| `shared/features.ts` | `FEATURE_FLAGS`, `FeatureFlag(s)`, `DEFAULT_FEATURES`, `resolveFeatures()` |
| `shared/utilisation.ts` | `UtilBand`, thresholds, `BAND_LABEL`, `bandFor()`, `relativeLoad()`, `bandForLoad()`, `validateThresholds()` |
| `shared/entitlements.ts` | `Plan`, `Entitlements`, `PLAN_ENTITLEMENTS`, `entitlementsFor()`, `entitled()`, `withinLimit()` |
| `shared/permissions.ts` | `PERMISSIONS`, role → permission tables, `ROLE_LABEL`, `permissionsFor()`, legacy role mapping |
| `shared/contracts/dto.ts` | every DTO, `WorkspaceSnapshot`, `MeResponse` |
| `shared/contracts/api.ts` | `ApiError`, request/response types, batch ops, the `API` route builder |

All six files are **byte-identical to BACKLOG §4.3** except the one deviation in §3. They compile under `strict: true`. To verify at any time:

```bash
extract(){ awk -v f="$1" '$0=="#### `"f"`"{s=1;next} s==1&&/^```ts$/{s=2;next} s==2&&/^```$/{exit} s==2{print}' docs/product/BACKLOG.md; }
for f in shared/features.ts shared/utilisation.ts shared/entitlements.ts shared/permissions.ts shared/contracts/dto.ts shared/contracts/api.ts; do
  diff <(extract $f) $f > /dev/null && echo "same  $f" || { echo "DIFF  $f"; diff <(extract $f) $f; }
done
```

`shared/` is excluded from Prettier so this diff stays exact (see `.prettierignore`).

### Client data-layer stubs (`state/**`, `utils/viewModels/**`; package C owns both)

| File | Purpose |
|---|---|
| `state/index.ts` | The public surface from §4.3 with the exact signatures: `useSession`, `useWorkspace` (with `can()`, `isOwnPerson()`, `thresholds`, `switchWorkspace()`), `useFeature`, `useEntitlements` (with `has()`), `useQuarters`, `useWorkspaceData`, `useConflict`, `useUndo`, `useMutations`, plus `ApiRequestError`, `TimeBasis`, `QuarterView`. |
| `state/stub/demoData.ts` | `constants.ts` demo data (`MOCK_RESOURCES`, `MOCK_PROJECTS`, `MOCK_ALLOCATIONS`, `PMO_CRAFTS`, `TEAMS`) converted to DTOs (`version: 1`, legacy ids kept) and the demo `MeResponse` for any role. |
| `state/stub/store.ts` | In-memory external store (`useSyncExternalStore`), undo stack (20), no provider required. |
| `state/stub/mutations.ts` | Every `useMutations()` method applied locally, with 403/404/409/413 errors mirroring the route table. |
| `state/stub/quarters.ts` | 4 rolling quarters with QBR, calendar and fiscal labels (A-1). |
| `state/stub/errors.ts` | `ApiRequestError` (adds a constructor; fields as in §4.3). |
| `utils/viewModels/index.ts` | `utilisationFor`, `buildPeopleRows`, `buildAllocationGrid`, `setQuarterCell`, `copyForward`, `buildCapacityOutlook`, `buildDemandGrid`, `buildCatalogue`, `buildHome`, `buildTribeView`, `buildSearchIndex` and the contract interfaces (`PersonRow`, `GridCell`, `GridRow`, `GridModel`, `OutlookPoint`, `OutlookModel`, `CatalogueEntry`, `HomeModel`). |
| `utils/viewModels/types.ts` | `TimeBasis`, `QuarterView` (pure; re-exported by `state/index.ts`). |
| `utils/viewModels/legacy.ts` | DTO → v1.1 type adapters so the stubs can call `utils/craftEngine.ts` unchanged. |
| `utils/viewModels/allocationOps.ts` | `setBookingRange()` (split/clip logic behind `setQuarterCell`/`copyForward`) and `applyAllocationOps()`. |

### Tooling (owned by I after WP-0)

`package.json` scripts, `package-lock.json`, `tsconfig.json` (explicit `include`/`exclude`), `tsconfig.strict.json` (new), `eslint.config.js` (new), `.prettierrc` and `.prettierignore` (new), `jest.config.ts` (rewritten), `playwright.config.ts` (new).

## 2. npm scripts

| Script | Command | Notes |
|---|---|---|
| `dev` | `netlify dev` | PL-09#AC3. Needs Netlify CLI (`npm i -g netlify-cli`, or `npx netlify-cli dev`); not a devDependency because of its size. `netlify.toml [dev]` now runs `npm run dev:vite` (see §5). |
| `dev:vite` | `vite` | Front end only (what `npm run dev` did in v1.1). |
| `dev:demo` | `vite --mode demo` | ST-10 demo mode (C/B wire it up). |
| `build` / `preview` | `vite build` / `vite preview` | Unchanged. |
| `typecheck` | `tsc -p tsconfig.json && tsc -p tsconfig.strict.json` | Strict config covers `shared/`, `state/`, `utils/viewModels/`, `services/api/`, `netlify/functions/_lib/` (PL-11#AC2; full `strict`, not just `strictNullChecks`). |
| `lint` / `lint:fix` | `eslint .` | See §4. |
| `format` / `format:check` | `prettier --write .` / `--check .` | 2 spaces, single quotes, 120 columns (PL-11#AC3). |
| `test` | `node --experimental-vm-modules node_modules/jest/bin/jest.js` | The flag lets PGlite (ESM, dynamic imports) run inside Jest. Pass Jest args after `--`. |
| `test:watch` / `test:coverage` | `npm test -- --watch` / `--coverage` | |
| `test:e2e` | `playwright test --pass-with-no-tests` | `tests/e2e/**/*.spec.ts`. |
| `check:guardrails` | `node scripts/check-ui-guardrails.mjs` | **B creates the file** (DS-06/DS-07). |
| `check:bundle` | `node scripts/check-bundle-size.mjs` | **A creates the file** (SH-08, PL-08). |
| `check:pure` | `node scripts/check-pure.mjs` | **A creates the file** (PL-06#AC6). |
| `db:migrate` | `tsx scripts/db/migrate.ts` | **A creates the file** (PL-02); `npm run db:migrate -- --dry-run`. |
| `db:parity` | `tsx scripts/db/parity.ts` | **A creates the file** (PL-14). |
| `ci` | lint → typecheck → format:check → test → build | Local convenience; CI itself is A's (PL-08). |

The script names are reserved so no package needs to edit `package.json`. If A prefers other file paths, A asks I to change the command, not the name.

## 3. Contract deviations (from BACKLOG §4.3)

| # | Where | Change | Why |
|---|---|---|---|
| CD-1 | `shared/contracts/dto.ts` | `CraftDTO` now `extends Versioned` (adds `version`, `updatedAt`, `updatedBy`). | ORG-02#AC1 and the route table PATCH crafts with `PatchBody` (which requires `version`, 409 on stale version), but the spec's `CraftDTO` had no `version`, so a client could never send one. A must give `crafts` a `version` column (ORG-01 lists `crafts(…, …)`, so this fits). |
| CD-2 | `state/index.ts` | `TimeBasis` and `QuarterView` are **defined** in `utils/viewModels/types.ts` and re-exported from `state/index.ts` (same names, same shapes). | `utils/viewModels/**` must stay pure (PL-06#AC6) and must not import from `state/` (which imports React). Consumers still import them from `state/`. |
| CD-3 | `state/index.ts` | `ApiRequestError` has a constructor `(status, code, message, extra?)`. | The spec only lists fields; a constructor is needed to create one. Fields unchanged. |
| CD-4 | `utils/viewModels/index.ts` | The §4.3 note says WP-0 view-model stubs return "empty-but-typed structures"; they compute plausible numbers from the snapshot instead (via `craftEngine`). | Requested for WP-0 so B can design against realistic data. Still stubs: see §6. |

No other change. `QUARTER_KEY_RE` is the only runtime value in `dto.ts` (as specified).

## 4. Lint, format and type-check set-up

- **ESLint 9 flat config** (`eslint.config.js`): `@eslint/js` recommended, `typescript-eslint` recommended, `eslint-plugin-security` recommended (with `detect-object-injection` off: it flags every `obj[key]`), `eslint-plugin-react-hooks` v7 flat recommended with `rules-of-hooks` and `exhaustive-deps` as **errors** (v7 also enables the React Compiler rules such as `purity`, `set-state-in-effect`, `refs`), `eslint-plugin-jsx-a11y` recommended on `*.tsx`, `@typescript-eslint/no-explicit-any: warn`.
- **Legacy files are not linted yet.** `LEGACY_FILES` in `eslint.config.js` lists every v1.1 source file by path (no directory globs except `components/{crafts,integrations,qbr}/**`), so **any new file anywhere is linted in full** (including new files in `components/`, `netlify/functions/`, `scripts/`, `tests/`). A package that rewrites a legacy file asks I to drop it from the list (and from `.prettierignore`, which repeats the list). The list must be empty at release (PL-11#AC1).
- **DS-07 rules are already wired** for `components/**` and `pages/**`: `no-alert`, hex colour literals in strings and template literals ("Use a design token (var(--…)) instead of a hex colour."), and inline `style={{ color | background | backgroundColor | borderColor | fill | stroke }}` ("Theme colours belong in CSS classes, not inline styles."). `styles/**` and `utils/pdfExport.ts` are exempt. B only adds the emoji/hex scanner script.
- **Type-checking now includes React types.** v1.1 had no `@types/react`, so every React import was implicitly `any`. With `@types/react@19` installed the legacy UI type-checks with only two errors, fixed with type-only casts (§5).
- **Jest** (`jest.config.ts`): two projects. `node` runs `tests/**` except `tests/state/**` and `tests/e2e/**`; `jsdom` runs `tests/state/**` (React hook tests with `@testing-library/react`). ts-jest compiles TS/TSX (`jsx: react-jsx`). A file can still opt into jsdom with `/** @jest-environment jsdom */`.
- **Playwright** (`playwright.config.ts`): `testDir: tests/e2e`, Chromium only. `@playwright/test` and `playwright-core` are **pinned to 1.56.1**, whose Chromium revision 1194 matches the preinstalled `/opt/pw-browsers/chromium-1194` (`PLAYWRIGHT_BROWSERS_PATH`). Never run `playwright install`. If the pin and the installed browser ever diverge, set `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`. With `E2E_BASE_URL` set it tests that URL; otherwise it builds and serves `vite preview` on port 4173. Verified with a throw-away spec (app loads in Chromium), then removed.

## 5. Dead code removed and files of other packages touched

Deleted (PL-09#AC1): `server/` (Express API), `Claude files /`, `test-ai.js`, `test-date.js`, `test-time*.ts` (6), `test_limits.sh`, `test_payload.json`, `fix_qbr.js`, `render.yaml`, `vercel.json`, `tsconfig.server.json`, `deno.lock`, `metadata.json`, `.system_logs.txt`, `netlify_logs.txt`, `README_API_KEY.md`.

Moved to `docs/history/` (PL-09#AC2): `ACTUAL_CURRENT_STATE_AUDIT.md`, `BUG_ANALYSIS.md`, `CRITICAL_BUGS_FOUND.md`, `FINAL_AUDIT_REPORT.md`, `REAUDIT_3_REPORT.md`, `REAUDIT_REPORT.md`, `SESSION_FIXES_AUDIT.md`. `NETLIFY_SETUP.md` stays in the root for I to merge into `README.md` (I owns both). `RTM.md` stays.

References checked before deleting: `package.json` `server`/`dev:all` scripts (removed), `tsconfig.json` exclude of `Claude files *` (removed), `render.yaml` start command (file deleted). One runtime reference remains in an A-owned file, see §7.

Edits outside WP-0's own files (all minimal, behaviour-preserving):

| File (owner) | Change | Reason |
|---|---|---|
| `App.tsx` (B) | `user.role === 'ADMIN'` → `(user.role as string) === 'ADMIN'` | TS2367 once React types exist. Same runtime behaviour. |
| `components/Slider.tsx` (B) | cast `writingMode` to `React.CSSProperties['writingMode']` | TS2322 (`'bt-lr'` is not in the type). Same runtime behaviour. |
| `netlify.toml` (A) | `[dev] command = "npm run dev:vite"` (was `npm run dev`) | `npm run dev` is now `netlify dev`; keeping the old value would recurse. |

## 6. How the stubs work (B and C)

- **No provider, no network.** Hooks read a module-level store via `useSyncExternalStore`. Data is the demo workspace, in memory only; a reload resets it. `useSession().mode` is `'demo'`; status starts `'authenticated'`.
- **Demo identity.** User "Demo User", org "Demo Organisation" (`slug: demo`, plan ENTERPRISE, `appMode: internal`, default features), one workspace `demo` ("IE Portfolio & Change Office"), linked to person `r9` (Gokul Gurijala) so My Plan and "own" permissions have data.
- **URL switches** (read once at load, browser only): `?demoRole=ORG_ADMIN|WORKSPACE_ADMIN|PLANNER|CONTRIBUTOR|VIEWER` (default `ORG_ADMIN`), `?demoPlatformAdmin=1`, `?demoSignedOut=1` (start anonymous to build the sign-in page; `login()` with any credentials signs back in).
- **Derived structure.** The v1.1 data has no tribes or chapters, so: tribes = distinct `project.clientName` (`tribe-digital`, `tribe-payments`, `tribe-lending`, `tribe-operations`); chapters = one per primary craft in use (`chapter-<craftId>`, leads Tom Hayes and Emer Ward where the job title says "Lead"); people's `homeTribeId` = first tribe affinity; demand lines from `craftDemand` (`Forecast` for Pipeline projects, else `Confirmed`); all allocations `confirmed`; no offers, craft requests or delivery data.
- **Mutations** apply to the snapshot, bump `version`/`dataVersion`, push an undo entry (`useUndo()` restores the previous snapshot), and throw `ApiRequestError` with status 403 `forbidden` when the demo role lacks the permission (so gated UI can be tried with `?demoRole=VIEWER`), 404 for unknown ids, 409 for decided requests and stale structure versions, 400 for `setQuarterCell` outside 0–200, and 413 for batches over 500 ops. `admin.members()` returns only the demo user; `invite()` returns a fake `/invite/demo-<id>` URL; `updateMember`/`removeMember` are no-ops.
- **View-models** compute real-looking numbers from the snapshot through `utils/craftEngine.ts` (overlap-weighted quarter %, above/below/undeclared split, bands from `shared/utilisation.ts` on load relative to `targetUtil`). `setQuarterCell` and `copyForward` are functional: they split an allocation so only the target range changes, clip to the project window, reuse an allocation that lies wholly inside the range, and never chain temporary ids. Known stub simplifications for C to replace: `utilisationFor` returns load % (not relative), "today" uses `new Date()` (no `utils/clock.ts` yet), `buildHome` uses QBR1 for the `today`/`window` bases, group totals in the person pivot are Σload ÷ Σtarget, no same-number test exists yet (RP-03#AC3).
- **For C:** delete `state/stub/**` and `utils/viewModels/{legacy,allocationOps}.ts` when you no longer need them; keep the exports of `state/index.ts` and `utils/viewModels/index.ts` exactly. `resetStubState()` in `state/stub/store.ts` resets the stub between tests. `tests/state/**` already runs in jsdom.
- **For B:** import only the names in `state/index.ts` and `utils/viewModels/index.ts`. Hook return objects are memoised and `useMutations()` returns one stable object, so they are safe in dependency lists.

## 7. Notes per package

**A (backend)**
- **PGlite** (`@electric-sql/pglite`, devDependency) gives a real in-process Postgres for migration and API tests, no Docker or Neon needed:
  ```ts
  import { PGlite } from '@electric-sql/pglite';
  const db = new PGlite();                        // in-memory, fresh per test file
  await db.exec(readFileSync('migrations/0001_baseline.sql', 'utf8'));
  const { rows } = await db.query('SELECT count(*)::int AS n FROM users WHERE email = $1', ['a@b.c']);
  await db.close();
  ```
  It only works under `npm test` (which passes `--experimental-vm-modules`); calling `npx jest` directly fails with "dynamic import callback was invoked without --experimental-vm-modules". To run the `_lib/db.ts` code against it, put an adapter behind `getSql()`/`withTx()` that maps the tagged template to `db.query(text, params)`. Verified with a throw-away test (create table, insert, select), then removed.
- `scripts/migrate.ts` (A-owned, legacy) reads `../server/migrations_user.sql`, which is deleted. It type-checks but would fail at run time; replace it with the PL-02 runner. The old SQL is recoverable: `git show bf70a40:server/migrations_user.sql` (also `server/migrations.sql`, `server/migrate_orgs.js`, `server/migrate_org_slug.js`) as input for the `0001` baseline.
- `uuid`, `pg` and `dotenv` are now devDependencies because only `scripts/**` imports them (`uuid`: `scripts/generateData.ts`; PL-10#AC1 wants `uuid` gone). Use `crypto.randomUUID()` in new code; ask I to remove `uuid` once `generateData.ts` is rewritten or deleted.
- Please add `playwright-report/`, `test-results/` and `coverage/` to `.gitignore` (A owns it).
- CI (PL-08) should use Node 22; the current workflows use Node 18 and `npm install`.
- `CraftDTO` now carries `version` (CD-1): give `crafts` a `version` column in `0004`.
- Reserved script names `check:bundle`, `check:pure`, `db:migrate`, `db:parity` point at `scripts/check-bundle-size.mjs`, `scripts/check-pure.mjs`, `scripts/db/migrate.ts`, `scripts/db/parity.ts`.

**B (UI)**
- Installed for you: `@fontsource-variable/inter` (DS-01, import once in `index.tsx`), `@tanstack/react-virtual` (DS-04), `lucide-react` (kept), `recharts` (kept), `@types/react`/`@types/react-dom`, `eslint-plugin-jsx-a11y`, `@axe-core/playwright` (DS-08, used by I).
- DS-07 lint rules are live for new files in `components/**` and `pages/**`; you only write `scripts/check-ui-guardrails.mjs` (script name `check:guardrails` reserved).
- The legacy UI is not linted until it leaves `LEGACY_FILES`; send I the list of files you delete or rewrite.

**C (domain/data)**
- Stubs: see §6. Hook tests go in `tests/state/**` (jsdom), pure tests in `tests/utils/**` and `tests/shared/**` (node).
- `@testing-library/react`, `@testing-library/dom`, `jest-environment-jsdom` and `jsdom` are installed.
- `services/geminiService.ts` still exists (C deletes it, HS-11); `context/AuthContext.tsx` likewise (PL-06).

**I (integration)**
- After WP-0 you own `package.json`, the lockfile, `tsconfig*.json`, `eslint.config.js`, `.prettierrc`/`.prettierignore`, `jest.config.ts`, `playwright.config.ts`.
- `package.json` `name` is already `pmo-capacity-planner`; `version` stays `0.0.0` until you set `2.0.0` (SH-10#AC3).
- Shrink `LEGACY_FILES` (and the copy in `.prettierignore`) as packages report rewritten files; it must be empty at release.
- Merge `NETLIFY_SETUP.md` into `README.md` (PL-09#AC2).
- `npm audit` (including dev) reports 21 moderate/low advisories, all in dev tooling (Jest's Babel/istanbul chain, esbuild under Vite, `sprintf-js`); none has a non-breaking fix. Production (`--omit=dev`) is clean.

## 8. Dependencies

**Removed** (unused after `server/` deletion; verified with grep): `@google/genai`, `express`, `cors`, `helmet`, `express-rate-limit`, `swagger-jsdoc`, `swagger-ui-express`, `openai`, `@types/cors`, `@types/express`, `@types/swagger-jsdoc`, `@types/swagger-ui-express`, `@types/uuid` (uuid 13 ships its own types), `supertest`, `@types/supertest`, `concurrently`.

**Moved to devDependencies:** `pg`, `dotenv`, `uuid` (only `scripts/**` import them).

**Upgraded for `npm audit --omit=dev`:** `jspdf` ^4.2.0 → ^4.2.1 (critical), `react-router-dom` ^7.13.0 → ^7.18.4 (high), `resend` ^6.9.2 → ^6.34.1 (moderate via `svix`/`uuid`); transitive `dompurify` and `fflate` fixed by `npm audit fix`.

**Added, runtime:** `@fontsource-variable/inter`, `@tanstack/react-virtual`.

**Added, dev:** `@playwright/test@1.56.1` and `playwright-core@1.56.1` (exact pins, see §4), `@axe-core/playwright`, `eslint@9`, `@eslint/js@9`, `typescript-eslint`, `eslint-plugin-react-hooks@7`, `eslint-plugin-jsx-a11y`, `eslint-plugin-security`, `globals`, `prettier`, `@electric-sql/pglite`, `@testing-library/react`, `@testing-library/dom`, `jest-environment-jsdom`, `jsdom`, `@types/react@19`, `@types/react-dom@19`.

**Kept:** `lucide-react`, `recharts`, `papaparse`, `zod`, `jspdf-autotable`, `bcryptjs`, `jsonwebtoken`, `@neondatabase/serverless`, `resend`, `stripe`, `react`, `react-dom`, Jest/ts-jest/ts-node (ts-node loads `jest.config.ts`), `tsx`, Vite.

Not added (Should/Could stories; add through I if they are picked up): an XLSX library (RP-05), Sentry (PL-17), `netlify-cli` (too large for `npm ci`; see `dev`).
