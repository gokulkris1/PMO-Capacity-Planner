/**
 * Role switch via `?demoRole=` (AC-04, SH-03#AC4, DM-04): write actions are hidden or read-only for Viewers and
 * Contributors; settings sections follow the role.
 */
import { expect, openDemo, test } from './fixtures';

test.describe('Viewer (tribe lead)', () => {
  test('sees no write actions on People, Projects and Demand', async ({ page }) => {
    await openDemo(page, 'org/people', 'demoRole=VIEWER');
    await expect(page.getByRole('button', { name: 'Add person' })).toHaveCount(0);
    await expect(page.getByRole('checkbox', { name: /^Select / })).toHaveCount(0);
    await page.goto('/demo/w/demo/org/projects?demoRole=VIEWER');
    await expect(page.locator('main h1')).toHaveText('Projects');
    await expect(page.getByRole('button', { name: 'Add project' })).toHaveCount(0);
    await page.goto('/demo/w/demo/plan/demand?demoRole=VIEWER');
    await expect(page.locator('main h1')).toHaveText('Demand');
    await expect(page.getByRole('button', { name: 'Add demand' })).toHaveCount(0);
  });

  test('cannot edit allocation cells', async ({ page }) => {
    await openDemo(page, 'plan/allocations', 'demoRole=VIEWER');
    await expect(page.getByRole('button', { name: 'Add booking' })).toHaveCount(0);
    const cell = page.getByRole('gridcell', { name: /^Apollo Revamp, Scrum Master[^,]*, QBR1, / }).first();
    await expect(cell).toHaveAttribute('aria-readonly', 'true');
    await cell.dblclick();
    await expect(page.getByRole('textbox', { name: /^Edit Apollo Revamp/ })).toHaveCount(0);
  });

  test('sees the squad catalogue but not open demand matching', async ({ page }) => {
    await openDemo(page, 'plan/marketplace', 'demoRole=VIEWER');
    await expect(page.getByRole('tab', { name: /Open demand/ })).toHaveCount(0);
    await expect(page.getByText(/What the squad can offer/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Propose' })).toHaveCount(0);
  });

  test('cannot open members or organisation settings', async ({ page }) => {
    await page.goto('/demo/w/demo/settings/members?demoRole=VIEWER');
    await expect(page.getByRole('heading', { name: /don.t have access|not found/i }).first()).toBeVisible();
    await page.goto('/demo/w/demo/settings/profile?demoRole=VIEWER');
    await expect(page.getByRole('heading', { name: 'Profile', level: 2 })).toBeVisible();
  });
});

test.describe('Contributor (squad member)', () => {
  test('has My plan and no planning write actions', async ({ page }) => {
    await openDemo(page, 'me', 'demoRole=CONTRIBUTOR');
    await expect(page.locator('main h1')).toHaveText('My plan');
    await page.goto('/demo/w/demo/org/people?demoRole=CONTRIBUTOR');
    await expect(page.locator('main h1')).toHaveText('People');
    await expect(page.getByRole('button', { name: 'Add person' })).toHaveCount(0);
    await page.goto('/demo/w/demo/plan/allocations?demoRole=CONTRIBUTOR');
    await expect(page.locator('main h1')).toHaveText('Allocations');
    await expect(page.getByRole('button', { name: 'Add booking' })).toHaveCount(0);
  });

  test('settings show only the profile', async ({ page }) => {
    await openDemo(page, 'settings/profile', 'demoRole=CONTRIBUTOR');
    const sub = page.getByRole('navigation', { name: /settings/i });
    await expect(sub.getByRole('link', { name: 'Profile' })).toBeVisible();
    await expect(sub.getByRole('link', { name: 'Members and roles' })).toHaveCount(0);
    await expect(sub.getByRole('link', { name: 'Organisation' })).toHaveCount(0);
  });
});

test.describe('Planner', () => {
  test('can edit allocations but not manage members', async ({ page }) => {
    await openDemo(page, 'plan/allocations', 'demoRole=PLANNER');
    await expect(page.getByRole('button', { name: 'Add booking' })).toBeVisible();
    await page.goto('/demo/w/demo/settings/members?demoRole=PLANNER');
    await expect(page.getByRole('heading', { name: /don.t have access|not found/i }).first()).toBeVisible();
  });
});
