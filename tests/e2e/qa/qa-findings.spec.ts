/* eslint-disable security/detect-non-literal-regexp -- patterns are built from fixed demo names */
/**
 * Independent QA (Release 2.0): browser checks on the demo workspace that the developer e2e suite does not make.
 * Each `test.fixme` reproduces an open QA defect (docs/qa/QA_REPORT.md) and is expected to fail until it is fixed;
 * the plain tests pin behaviour QA verified.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, openDemo, test } from '../fixtures';

test.describe('QA findings (demo workspace)', () => {
  test('CSV export neutralises formula injection in a person name (security)', async ({ page }) => {
    await openDemo(page, 'org/people', 'person=r1');
    const drawer = page.getByRole('dialog');
    await drawer.getByLabel('Name', { exact: true }).fill('=HYPERLINK("http://evil.example","x")');
    await drawer.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(drawer).toBeHidden();
    await page.getByRole('button', { name: 'More actions' }).click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('menuitem', { name: 'Export CSV' }).click(),
    ]);
    const text = await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c).toString('utf8'));
    const line = text.split(/\r?\n/).find((l) => l.includes('HYPERLINK')) ?? '';
    expect(line).toMatch(/^"'=HYPERLINK/);
  });

  test('QA-002 People, Allocations and Capacity Outlook show the same % of target for an 80 % target', async ({
    page,
  }) => {
    await openDemo(page, 'org/people', 'person=r1');
    const drawer = page.getByRole('dialog');
    const name = (await drawer.getByLabel('Name', { exact: true }).inputValue()).trim();
    await drawer.getByLabel(/Target utilisation/).fill('80');
    await drawer.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(drawer).toBeHidden();
    const peopleLabel = await page
      .getByRole('img', { name: new RegExp(`^${name}, QBR1, `) })
      .first()
      .getAttribute('aria-label');
    const peopleQ1 = /QBR1, (\d+)%/.exec(peopleLabel ?? '')?.[1];
    expect(peopleQ1).toBeDefined();
    // Client-side navigation keeps the demo edit (no reload).
    const nav = page.getByRole('navigation', { name: /primary/i });
    await nav.getByRole('link', { name: 'Allocations' }).click();
    const gridCell = page.getByRole('gridcell', { name: new RegExp(`^${name}, QBR1, `) }).first();
    await expect(gridCell).toHaveAccessibleName(new RegExp(`, ${peopleQ1}%`));
    await nav.getByRole('link', { name: 'Capacity Outlook' }).click();
    await page.getByRole('radiogroup', { name: 'Pivot' }).getByRole('radio', { name: 'Person' }).click();
    await expect(page.getByRole('img', { name: new RegExp(`^${name} QBR1, ${peopleQ1}%`) }).first()).toBeVisible();
  });

  test.fixme('QA-006 at 768 px every person name in the People table is readable (not collapsed under the chips)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await openDemo(page, 'org/people');
    const names = page.locator('tbody tr td:nth-child(2), tbody tr th');
    const first = names.first();
    const box = await first.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(120);
    await expect(
      page
        .getByRole('cell', { name: /Tom Hayes/ })
        .or(page.getByRole('rowheader', { name: /Tom Hayes/ }))
        .first(),
    ).toBeVisible();
  });

  test.fixme('QA-007 Allocations › By project has no serious axe violations (label-content-name-mismatch)', async ({
    page,
  }) => {
    await openDemo(page, 'plan/allocations', 'pivot=project');
    const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual(
      [],
    );
  });

  test.fixme('QA-007 Capacity Outlook at 768 px has no serious axe violations (scrollable-region-focusable)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await openDemo(page, 'plan/capacity');
    const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual(
      [],
    );
  });

  test.fixme('QA-016 at 390 px editing is hidden (SH-09#AC2)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openDemo(page, 'plan/allocations');
    await expect(page.locator('[role="gridcell"][aria-readonly="false"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Add booking/ })).toHaveCount(0);
  });

  test.fixme('QA-012 an out-of-range target (151 %) is reported inline instead of "Saved" with nothing saved', async ({
    page,
  }) => {
    await openDemo(page, 'org/people', 'person=r1');
    const drawer = page.getByRole('dialog');
    await drawer.getByLabel(/Target utilisation/).fill('151');
    await drawer.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText(/150/)).toBeVisible();
  });
});
