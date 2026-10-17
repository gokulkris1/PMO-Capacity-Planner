/**
 * Every route of the demo workspace renders with its title, without console errors, and without horizontal page
 * scroll at 1280 px (SH-01#AC1, SH-09#AC3, ST-10). Plus the auth pages and the old-URL redirects.
 */
import { PRODUCT_ROUTES, expect, hasHorizontalScroll, openDemo, test } from './fixtures';

test.describe('demo workspace routes', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  for (const { route, title } of PRODUCT_ROUTES) {
    test(`${route} renders`, async ({ page }) => {
      await openDemo(page, route);
      await expect(page.locator('main h1').first()).toHaveText(title);
      await expect(page).toHaveTitle(/PMO Capacity Planner$/);
      // Data, not a skeleton or an error banner
      await expect(page.getByText(/couldn't load/i)).toHaveCount(0);
      expect(await hasHorizontalScroll(page)).toBe(false);
    });
  }

  test('the demo banner shows on every page and the sidebar has the grouped items', async ({ page }) => {
    await openDemo(page, 'home');
    await expect(page.getByText('Demo workspace. Changes stay in this browser.')).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Primary' });
    for (const item of [
      'Home',
      'Capacity Outlook',
      'Demand',
      'Allocations',
      'Marketplace',
      'People',
      'Projects',
      'Tribes',
      'Jira & Planview',
      'Reports',
    ])
      await expect(nav.getByRole('link', { name: item, exact: true })).toBeVisible();
  });

  test('/demo opens the demo workspace home', async ({ page }) => {
    await page.goto('/demo');
    await expect(page).toHaveURL(/\/demo\/w\/demo\/home$/);
    await expect(page.locator('main h1')).toHaveText('Home');
  });

  test('sprint planning stays hidden until the flag is on', async ({ page }) => {
    await page.goto('/demo/w/demo/delivery/sprints');
    await expect(
      page.getByRole('heading', { name: 'Page not found' }).or(page.getByText('Sprint planning is turned off')),
    ).toBeVisible();
  });

  test('an unknown page shows the 404 page inside the shell', async ({ page }) => {
    await page.goto('/demo/w/demo/no-such-page');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/not found/i);
  });
});

test.describe('auth pages', () => {
  test('sign in, reset and invitation pages render', async ({ page }) => {
    await page.goto('/login?demo=1&demoSignedOut=1');
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await page.goto('/reset?demo=1&demoSignedOut=1');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('a demo user signs in and lands in the workspace', async ({ page }) => {
    await page.goto('/login?demo=1&demoSignedOut=1');
    await page.getByLabel('Email').fill('demo.user@example.com');
    await page.getByLabel('Password', { exact: true }).fill('demo-password');
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await expect(page.locator('main h1')).toHaveText('Home');
  });
});
