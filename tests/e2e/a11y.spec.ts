/**
 * DS-08: axe (WCAG 2.0/2.1 A and AA) on the main pages of the demo workspace and the sign-in page: no serious or
 * critical violations.
 */
import AxeBuilder from '@axe-core/playwright';
import { PRODUCT_ROUTES, expect, openDemo, test } from './fixtures';

const PAGES = PRODUCT_ROUTES.map((r) => r.route);

async function seriousViolations(page: import('@playwright/test').Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
    }));
}

test.describe('accessibility (axe)', () => {
  for (const route of PAGES) {
    test(`${route} has no serious or critical violations`, async ({ page }) => {
      await openDemo(page, route);
      expect(await seriousViolations(page)).toEqual([]);
    });
  }

  test('sign-in page has no serious or critical violations', async ({ page }) => {
    await page.goto('/login?demo=1&demoSignedOut=1');
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });

  test('person drawer and a dialog have no serious or critical violations', async ({ page }) => {
    await openDemo(page, 'org/people', 'person=r1');
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });
});
