/**
 * QA-039 on the live stack: go-live day. Every browser still holds its v1.1 token (`localStorage.pcp_token`), and
 * the first requests find the migration advisory lock held by another function invocation that is migrating the
 * database, so the API answers 503 `migration_pending` for a while. The held lock is simulated in front of the real
 * API (every `/api/*` request answers 503 for the first few seconds, as each invocation does while it cannot take
 * the lock); after that the requests reach the real handlers.
 *
 * Expected: the "PMO Capacity Planner is being updated" state, never the sign-in page; the v1.1 token is kept until
 * the exchange succeeds; then the user is signed in with no click. A sign-in typed during the migration says it is
 * being updated, retries on its own and signs the user in.
 */
import jwt from 'jsonwebtoken';
import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';

const ORG = 'acme-bank';
const WS = 'a1000000-0000-4000-8000-0000000000a1';
const PAT = { email: 'pat.pmo@acme.example', password: 'Pat-PMO-Admin-1' };
const PENDING = { error: 'PMO Capacity Planner is being updated.', code: 'migration_pending' };

test.describe.configure({ mode: 'serial' });

/** Every /api request answers 503 migration_pending for `ms` after the first one: the lock is held elsewhere. */
async function holdMigrationLock(page: Page, ms: number): Promise<{ served: () => number; paths: string[] }> {
  let firstAt = 0;
  let served = 0;
  const paths: string[] = [];
  await page.route('**/api/**', async (route) => {
    firstAt ||= Date.now();
    if (Date.now() - firstAt < ms) {
      served++;
      paths.push(new URL(route.request().url()).pathname);
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify(PENDING) });
    }
    return route.continue();
  });
  return { served: () => served, paths };
}

/** The browser logs each injected 503; those are expected here, anything else is not. */
function dropExpected503s(consoleErrors: string[]): void {
  for (let i = consoleErrors.length - 1; i >= 0; i--)
    if (/status of 503/.test(consoleErrors[i])) consoleErrors.splice(i, 1);
}

test('QA-039 a v1.1 token holder waits in "being updated" and is signed in by itself', async ({
  page,
  request,
  consoleErrors,
}) => {
  // The v1.1 token the browser kept: v1.1 claims (no `tv`, no `jti`) signed with the unchanged JWT_SECRET.
  expect((await request.post('/api/auth/login', { data: PAT })).status()).toBe(200);
  const me = (await (await request.get('/api/v2/me')).json()) as { user: { id: string }; org: { id: string } | null };
  const token = jwt.sign(
    { id: me.user.id, email: PAT.email, role: 'USER', org_id: me.org?.id ?? null },
    process.env.JWT_SECRET ?? 'local-dev-jwt-secret-not-for-production',
    { expiresIn: '7d' },
  );
  await page.context().clearCookies();
  await page.addInitScript((t) => {
    if (!sessionStorage.getItem('pcp-e2e-seeded')) {
      localStorage.setItem('pcp_token', t);
      localStorage.setItem('pcp_user', '{}');
      sessionStorage.setItem('pcp-e2e-seeded', '1');
    }
  }, token);
  const lock = await holdMigrationLock(page, 7000);

  await page.goto(`/o/${ORG}/w/${WS}/home`);
  await expect(page.getByRole('heading', { name: 'PMO Capacity Planner is being updated' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: /Checking again automatically/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /sign in/i })).toHaveCount(0);
  // The token is the user's way back in: kept while the exchange cannot run.
  expect(await page.evaluate(() => localStorage.getItem('pcp_token'))).toBe(token);

  // No click: the automatic retry exchanges the token as soon as the lock is free and opens Home.
  await expect(page.locator('main h1')).toHaveText('Home', { timeout: 20_000 });
  await expect(page).toHaveURL(new RegExp(`/o/${ORG}/w/${WS}/home`));
  await expect(page.getByRole('button', { name: /Account: Pat PMO/ })).toBeVisible();
  expect(await page.evaluate(() => [localStorage.getItem('pcp_token'), localStorage.getItem('pcp_user')])).toEqual([
    null,
    null,
  ]);
  expect(lock.served()).toBeGreaterThanOrEqual(2);
  expect(lock.paths.every((p) => p === '/api/auth/session')).toBe(true);
  dropExpected503s(consoleErrors);
});

test('QA-039 signing in during the migration says it is being updated, retries and signs in', async ({
  page,
  consoleErrors,
}) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
  const lock = await holdMigrationLock(page, 6000);
  await page.getByLabel('Email').fill(PAT.email);
  await page.getByLabel('Password', { exact: true }).fill(PAT.password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  const notice = page.getByRole('status').filter({ hasText: 'PMO Capacity Planner is being updated.' });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText(/Signing you in as soon as it is ready\. Retrying in \d+ s/);
  await expect(page.getByText(/Something went wrong/)).toHaveCount(0);
  // No second click.
  await expect(page.locator('main h1')).toHaveText('Home', { timeout: 30_000 });
  await expect(page.getByRole('button', { name: /Account: Pat PMO/ })).toBeVisible();
  expect(lock.served()).toBeGreaterThanOrEqual(2);
  expect(new Set(lock.paths)).toEqual(new Set(['/api/auth/login']));
  dropExpected503s(consoleErrors);
});
