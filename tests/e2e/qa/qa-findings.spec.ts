/* eslint-disable security/detect-non-literal-regexp -- patterns are built from fixed demo names */
/**
 * Independent QA (Release 2.0): browser checks on the demo workspace that the developer e2e suite does not make.
 * Each test named after a QA defect (docs/qa/QA_REPORT.md) reproduced it and failed until the fix; they now guard
 * against regressions. The other tests pin behaviour QA verified.
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
    expect(download.suggestedFilename()).toMatch(/^people-\d{4}-\d{2}-\d{2}\.csv$/); // QA-028 (DS-04#AC7)
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

  test('QA-006 at 768 px every person name in the People table is readable (not collapsed under the chips)', async ({
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

  test('QA-006 at 768 px project names are readable and booking chips never overlap the names', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await openDemo(page, 'org/projects');
    const name = page.getByRole('rowheader').first();
    expect((await name.boundingBox())?.width ?? 0).toBeGreaterThan(180);
    await expect(page.getByRole('button', { name: /Telephony Cloud Migration/ })).toBeVisible();
    await openDemo(page, 'plan/allocations');
    const subRows = page.locator('.al-name--sub');
    const n = await subRows.count();
    expect(n).toBeGreaterThan(5);
    for (let i = 0; i < n; i++) {
      const boxes = await subRows.nth(i).evaluate((el) => {
        const cell = el.closest('th')!.getBoundingClientRect();
        const kids = [...el.children].map((c) => c.getBoundingClientRect());
        return {
          cell: { left: cell.left, right: cell.right },
          kids: kids.map((k) => ({ left: k.left, right: k.right })),
        };
      });
      // Every chip sits after the previous one and inside the name cell: nothing overlaps, nothing spills over.
      boxes.kids.forEach((k, j) => {
        if (j > 0) expect(k.left).toBeGreaterThanOrEqual(boxes.kids[j - 1].right - 0.5);
        expect(k.right).toBeLessThanOrEqual(boxes.cell.right + 0.5);
      });
    }
  });

  for (const route of ['org/people', 'org/projects', 'plan/allocations', 'plan/demand', 'plan/capacity']) {
    test(`QA-007 ${route} at 768 px: every scrollable table is a named, keyboard-reachable region`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 768, height: 1024 });
      await openDemo(page, route);
      const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect(res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual(
        [],
      );
      const regions = page.locator('.pcp-tbl-wrap[role="region"]');
      for (let i = 0; i < (await regions.count()); i++) {
        await expect(regions.nth(i)).toHaveAttribute('tabindex', '0');
        await expect(regions.nth(i)).toHaveAttribute('aria-label', /\S/);
      }
    });
  }

  test('QA-007 Allocations › By project has no serious axe violations (label-content-name-mismatch)', async ({
    page,
  }) => {
    await openDemo(page, 'plan/allocations', 'pivot=project');
    const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual(
      [],
    );
  });

  test('QA-007 Capacity Outlook at 768 px has no serious axe violations (scrollable-region-focusable)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await openDemo(page, 'plan/capacity');
    const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual(
      [],
    );
  });

  test('QA-016 at 390 px editing is hidden (SH-09#AC2)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openDemo(page, 'plan/allocations');
    await expect(page.locator('[role="gridcell"][aria-readonly="false"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Add booking/ })).toHaveCount(0);
  });

  test('QA-012 an out-of-range target (151 %) is reported inline instead of "Saved" with nothing saved', async ({
    page,
  }) => {
    await openDemo(page, 'org/people', 'person=r1');
    const drawer = page.getByRole('dialog');
    await drawer.getByLabel(/Target utilisation/).fill('151');
    await drawer.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText(/150/)).toBeVisible();
  });

  test('QA-027 /verify-email while signed out asks to sign in instead of showing a code form', async ({ page }) => {
    await page.goto('/verify-email?demo=1&demoSignedOut=1');
    await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign in to verify' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Verify email' })).toHaveCount(0);
  });
});

test('QA-038 a new, empty workspace opens on the first-run state with sample data one click away', async ({ page }) => {
  await openDemo(page, 'settings/organisation');
  await page.getByRole('button', { name: 'Add workspace' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Workspace name').fill('Empty Office');
  await dialog.getByRole('button', { name: 'Add workspace' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: /Switch workspace$/ }).click();
  await page.getByRole('menuitemradio', { name: /Empty Office/ }).click();
  await page
    .getByRole('navigation', { name: /primary/i })
    .getByRole('link', { name: 'Home' })
    .click();
  await expect(page.getByText('Start your plan', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Add people' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Import CSV' })).toBeVisible();
  await page.getByRole('button', { name: 'Install sample data' }).click();
  await expect(page.getByText('Start your plan', { exact: true })).toBeHidden();
  await expect(page.getByRole('list', { name: 'Key figures' })).toBeVisible();
});

test('QA-030 dark theme: Settings pages meet colour contrast (active nav item included)', async ({ page }) => {
  for (const section of ['profile', 'organisation', 'members', 'structure', 'crafts', 'planning', 'integrations']) {
    await openDemo(page, `settings/${section}`);
    await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'));
    const res = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
    expect([section, res.violations.map((v) => v.id)]).toEqual([section, []]);
  }
});
