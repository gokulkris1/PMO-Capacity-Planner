/* eslint-disable security/detect-non-literal-regexp -- patterns are built from fixed seed names */
/**
 * Live full stack (package I): the production build against the real function handlers (scripts/local-api.ts)
 * on a database that starts as the v1.1 production schema and data. An existing v1.1 user signs in through the real
 * login page with their old password (the first request runs the 2.0 auto-migration), walks the main pages, saves
 * a change that survives a reload, and a browser holding a v1.1 token stays signed in (AC-03#AC1–2, §6.3 1–3).
 */
import { expect, test } from '../fixtures';

const ORG = 'acme-bank';
const WS = 'a1000000-0000-4000-8000-0000000000a1';
const PAT = { email: 'pat.pmo@acme.example', password: 'Pat-PMO-Admin-1' };
const base = `/o/${ORG}/w/${WS}`;

test.describe.configure({ mode: 'serial' });

test('a v1.1 user signs in with their existing password through the login page', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
  await page.getByLabel('Email').fill(PAT.email);
  await page.getByLabel('Password', { exact: true }).fill(PAT.password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page).toHaveURL(new RegExp(`/o/${ORG}/w/${WS}/home`));
  await expect(page.locator('main h1')).toHaveText('Home');
  // No demo banner: this is the live workspace.
  await expect(page.getByText('Demo workspace.')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Account: Pat PMO/ })).toBeVisible();
});

test('a wrong password is refused', async ({ page, consoleErrors }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(PAT.email);
  await page.getByLabel('Password', { exact: true }).fill('not-my-password');
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page.getByRole('alert').filter({ hasText: /email or password is incorrect/i })).toBeVisible();
  // The browser logs the expected 401 of the refused login; nothing else may be logged.
  const i = consoleErrors.findIndex((e) => /status of 401/.test(e));
  expect(i).toBeGreaterThanOrEqual(0);
  consoleErrors.splice(i, 1);
});

test.describe('signed in as the PMO Admin', () => {
  test.beforeEach(async ({ page }) => {
    const res = await page.request.post('/api/auth/login', { data: PAT });
    expect(res.status()).toBe(200);
  });

  test('main pages show the migrated v1.1 data', async ({ page }) => {
    await page.goto(`${base}/org/people`);
    await expect(page.locator('main h1')).toHaveText('People');
    for (const name of ['Noma Odigie', 'Tom Hayes', 'Maria Kelly', 'Kerrie Dalton', 'Gokul Gurijala', 'Mary Vithalani'])
      await expect(page.getByRole('row', { name: new RegExp(name) }).first()).toBeVisible();

    await page.goto(`${base}/org/projects`);
    await expect(page.locator('main h1')).toHaveText('Projects');
    for (const name of ['Phoenix', 'Ledger', 'Nebula', 'Operations Uplift', 'Legacy Migration'])
      await expect(
        page
          .getByRole('cell', { name, exact: true })
          .or(page.getByRole('rowheader', { name: new RegExp(`^${name}`) }))
          .first(),
      ).toBeVisible();

    for (const [route, title] of [
      ['home', 'Home'],
      ['plan/capacity', 'Capacity Outlook'],
      ['plan/demand', 'Demand'],
      ['plan/allocations', 'Allocations'],
      ['plan/marketplace', 'Marketplace'],
      ['org/tribes', 'Tribes'],
      ['delivery/jira-planview', 'Jira & Planview'],
      ['reports', 'Reports'],
      ['settings/profile', 'Settings'],
      ['settings/members', 'Settings'],
    ] as const) {
      await page.goto(`${base}/${route}`);
      await expect(page.locator('main h1').first()).toHaveText(title);
      await expect(page.getByText(/couldn't load/i)).toHaveCount(0);
    }
    // Members of the workspace include the migrated v1.1 accounts.
    await expect(page.getByText('owen.owner@acme.example')).toBeVisible();
  });

  test('an allocation edit is saved on the server and survives a reload', async ({ page }) => {
    await page.goto(`${base}/plan/allocations`);
    const cell = () => page.getByRole('gridcell', { name: /^Phoenix, [^,]+, QBR1, / }).first();
    await expect(cell()).toBeVisible();
    await cell().dblclick();
    const input = page.getByRole('textbox', { name: /^Edit Phoenix/ });
    await input.fill('45');
    await input.press('Enter');
    await expect(cell()).toHaveAccessibleName(/, 45%/);
    await page.reload();
    await expect(cell()).toHaveAccessibleName(/, 45%/);
  });

  test('sign out ends the session', async ({ page }) => {
    await page.goto(`${base}/home`);
    await page.getByRole('button', { name: /Account: Pat PMO/ }).click();
    await page
      .getByRole('menuitem', { name: /sign out/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto(`${base}/home`);
    await expect(page).toHaveURL(/\/login/);
  });
});

test('a browser holding a v1.1 token stays signed in and the token is removed (AC-03#AC2)', async ({
  page,
  request,
}) => {
  // What v1.1 returned from /api/auth/login and kept in localStorage.pcp_token.
  const res = await request.post('/api/auth/login', {
    data: { email: 'owen.owner@acme.example', password: 'Owen-Owner-2025' },
  });
  const { token, user } = (await res.json()) as { token: string; user: unknown };
  await page.context().clearCookies();
  await page.addInitScript(
    ([t, u]) => {
      if (!sessionStorage.getItem('pcp-e2e-seeded')) {
        localStorage.setItem('pcp_token', t);
        localStorage.setItem('pcp_user', u);
        sessionStorage.setItem('pcp-e2e-seeded', '1');
      }
    },
    [token, JSON.stringify(user)],
  );
  await page.goto('/');
  await expect(page.locator('main h1')).toHaveText('Home');
  await expect(page.getByRole('button', { name: /Account: Owen Owner/ })).toBeVisible();
  expect(await page.evaluate(() => [localStorage.getItem('pcp_token'), localStorage.getItem('pcp_user')])).toEqual([
    null,
    null,
  ]);
});
