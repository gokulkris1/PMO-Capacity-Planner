/**
 * Shared Playwright fixtures (package I): every test fails on a console error or an uncaught page error, so a
 * route that "renders" but logs a React or network error does not pass.
 */
import { test as base, expect, type Page } from '@playwright/test';

/** Console messages that are not defects (none today; add a pattern here with a reason). */
const IGNORED: RegExp[] = [];

export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ page }, use, testInfo) => {
      const errors: string[] = [];
      page.on('console', (m) => {
        if (m.type() !== 'error') return;
        const text = m.text();
        if (IGNORED.some((re) => re.test(text))) return;
        errors.push(`[console] ${text}`);
      });
      page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
      await use(errors);
      if (testInfo.status === testInfo.expectedStatus) expect(errors, 'console errors').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** Opens a page of the demo workspace (DemoTransport, no backend) and waits for its H1. */
export async function openDemo(page: Page, route: string, query = ''): Promise<void> {
  await page.goto(`/demo/w/demo/${route}${query ? `?${query}` : ''}`);
  await expect(page.locator('main h1').first()).toBeVisible();
}

/** True when the document is wider than the viewport (horizontal page scroll). */
export async function hasHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
}

export const PRODUCT_ROUTES: Array<{ route: string; title: string | RegExp }> = [
  { route: 'home', title: 'Home' },
  { route: 'me', title: 'My plan' },
  { route: 'plan/capacity', title: 'Capacity Outlook' },
  { route: 'plan/demand', title: 'Demand' },
  { route: 'plan/allocations', title: 'Allocations' },
  { route: 'plan/marketplace', title: 'Marketplace' },
  { route: 'org/people', title: 'People' },
  { route: 'org/projects', title: 'Projects' },
  { route: 'org/tribes', title: 'Tribes' },
  { route: 'org/tribes/tribe-digital', title: 'Digital' },
  { route: 'delivery/jira-planview', title: 'Jira & Planview' },
  { route: 'reports', title: 'Reports' },
  { route: 'settings/profile', title: 'Settings' },
  { route: 'settings/organisation', title: 'Settings' },
  { route: 'settings/members', title: 'Settings' },
  { route: 'settings/structure', title: 'Settings' },
  { route: 'settings/crafts', title: 'Settings' },
  { route: 'settings/planning', title: 'Settings' },
  { route: 'settings/integrations', title: 'Settings' },
  { route: 'settings/features', title: 'Settings' },
];
