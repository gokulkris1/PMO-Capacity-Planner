/**
 * QA-011 (SH-07#AC4) on the live stack: a deploy is still migrating, so the first API requests answer 503
 * `migration_pending`. The app must show "PMO Capacity Planner is being updated" (never an endless "Loading your
 * workspace"), retry on its own and open the workspace as soon as the API is ready, without anyone clicking.
 * The 503s are injected in front of the real API for `/api/v2/me` and then for the snapshot.
 */
import { expect, test } from '../fixtures';

const ORG = 'acme-bank';
const WS = 'a1000000-0000-4000-8000-0000000000a1';
const PAT = { email: 'pat.pmo@acme.example', password: 'Pat-PMO-Admin-1' };
const PENDING = { error: 'PMO Capacity Planner is being updated.', code: 'migration_pending' };

test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ page }) => {
  const res = await page.request.post('/api/auth/login', { data: PAT });
  expect(res.status()).toBe(200);
});

/** The browser logs each injected 503; those are expected here, anything else is not. */
function dropExpected503s(consoleErrors: string[]): void {
  for (let i = consoleErrors.length - 1; i >= 0; i--)
    if (/status of 503/.test(consoleErrors[i])) consoleErrors.splice(i, 1);
}

test('QA-011 /me answers migration_pending: maintenance state, then the app boots on its own', async ({
  page,
  consoleErrors,
}) => {
  let pending = 2;
  let served503 = 0;
  await page.route('**/api/v2/me', async (route) => {
    if (pending-- > 0) {
      served503++;
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify(PENDING) });
    }
    return route.continue();
  });
  await page.goto(`/o/${ORG}/w/${WS}/home`);
  await expect(page.getByRole('heading', { name: 'PMO Capacity Planner is being updated' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: /Checking again automatically/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  // No click: the retry every 3 s brings the workspace up once the API answers.
  await expect(page.locator('main h1')).toHaveText('Home', { timeout: 15_000 });
  await expect(page).toHaveURL(new RegExp(`/o/${ORG}/w/${WS}/home`));
  expect(served503).toBe(2);
  dropExpected503s(consoleErrors);
});

test('QA-011 the snapshot answers migration_pending after /me: same recovery', async ({ page, consoleErrors }) => {
  // 503 for every snapshot request in the first 4 s (concurrent loads included), then the real API.
  let firstAt = 0;
  await page.route('**/api/v2/workspaces/*/snapshot', async (route) => {
    firstAt ||= Date.now();
    if (Date.now() - firstAt < 4000)
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify(PENDING) });
    return route.continue();
  });
  await page.goto(`/o/${ORG}/w/${WS}/org/people`);
  await expect(page.getByRole('heading', { name: 'PMO Capacity Planner is being updated' })).toBeVisible();
  await expect(page.locator('main h1')).toHaveText('People', { timeout: 15_000 });
  dropExpected503s(consoleErrors);
});
