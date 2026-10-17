/**
 * Final fix round (Release 2.0): layout and copy checks for the reopened cosmetic defects (QA-032, QA-033, QA-036)
 * and the UAT notes (UAT-06, UAT-09, UAT-10, UAT-11), on the demo workspace. Each test failed before its fix.
 */
import type { Page } from '@playwright/test';
import { expect, openDemo, test } from './fixtures';

/** Distinct rounded tops of the visible children of `selector` (one value = one row). */
async function rowTops(page: Page, selector: string): Promise<number[]> {
  return page
    .locator(selector)
    .evaluate((bar) =>
      [
        ...new Set(
          [...bar.children]
            .filter((c) => !c.classList.contains('pcp-spacer') && (c as HTMLElement).offsetWidth > 0)
            .map((c) => Math.round(c.getBoundingClientRect().top)),
        ),
      ].sort((a, b) => a - b),
    );
}

test.describe('final polish (demo)', () => {
  test('QA-036 at 1280 px the People filter bar is one row and "Band (QBR1): all" is not cut off', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openDemo(page, 'org/people');
    expect(await rowTops(page, '[role="search"][aria-label="Filter people"]')).toHaveLength(1);
    const fit = await page.getByLabel(/^Filter by band in QBR1$/).evaluate((el) => {
      const s = el as HTMLSelectElement;
      const cs = getComputedStyle(s);
      const ctx = document.createElement('canvas').getContext('2d')!;
      ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const text = s.options[s.selectedIndex]?.text ?? '';
      return {
        text,
        need: ctx.measureText(text).width,
        room: s.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
      };
    });
    expect(fit.text).toBe('Band (QBR1): all');
    expect(fit.need).toBeLessThanOrEqual(fit.room);
  });

  test('QA-032 a person without a job title has no leading "·" in the People row (1280 px)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openDemo(page, 'org/people', 'person=r1');
    const drawer = page.getByRole('dialog');
    const name = (await drawer.getByLabel('Name', { exact: true }).inputValue()).trim();
    await drawer.getByLabel(/^Job title/).fill('');
    await drawer.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(drawer).toBeHidden();
    const row = page.getByRole('row', { name }).first();
    const sub = (await row.locator('.pp-person').innerText()).split('\n').slice(1).join(' ').trim();
    expect(sub).not.toMatch(/^·/);
    expect(sub.length).toBeGreaterThan(0); // chapter / team still shown
  });

  test('QA-033 Allocations group rows band their Available totals like Under and Over', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openDemo(page, 'plan/allocations');
    const bench = page.locator('.al-row--group .pcp-band-value--bench').first();
    await expect(bench).toBeVisible();
    const look = await bench.evaluate((el) => {
      const cell = el.closest('td') as HTMLElement;
      const cs = getComputedStyle(el);
      return { chip: cs.backgroundColor, row: getComputedStyle(cell).backgroundColor, ring: cs.boxShadow };
    });
    expect(look.chip).not.toBe(look.row);
    expect(look.ring).not.toBe('none');
  });

  test('UAT-06 Capacity Outlook: "Under target" lists only the Under band; Available has its own list', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openDemo(page, 'plan/capacity');
    const card = (title: string) =>
      page.locator('section.pcp-card').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
    const under = await card('Under target')
      .locator('.pcp-band-value')
      .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
    const available = await card('Available')
      .locator('.pcp-band-value')
      .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
    expect(under.length + available.length).toBeGreaterThan(0);
    for (const l of under) expect(l).toMatch(/Under target$/);
    for (const l of available) expect(l).toMatch(/Available$/);
  });

  test('UAT-09 Marketplace open demand: project names line up whatever the craft code width', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openDemo(page, 'plan/marketplace');
    const lefts = await page
      .locator('.mk-line__title')
      .evaluateAll((els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().left)))]);
    const codes = await page.locator('.mk-line__craft').allInnerTexts();
    expect(new Set(codes.map((c) => c.trim().length)).size).toBeGreaterThan(1); // e.g. PM and PGM
    expect(lefts).toHaveLength(1);
  });

  for (const width of [1440, 1280, 768]) {
    test(`UAT-10 My plan at ${width} px: the proposal line never breaks inside "N days ago"`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await openDemo(page, 'me');
      const when = page.locator('.me-proposals__when').first();
      await expect(when).toHaveText(/ago|just now|today/);
      expect(await when.evaluate((e) => e.getClientRects().length)).toBe(1);
      // A wrapped line never starts with the separator.
      const parts = page.locator('.me-proposals__meta').first().locator(':scope > span');
      const lefts = await parts.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
      const metaLeft = await page
        .locator('.me-proposals__meta')
        .first()
        .evaluate((e) => Math.round(e.getBoundingClientRect().left));
      const starts = await parts.evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()[0]));
      lefts.forEach((l, i) => {
        if (l === metaLeft) expect(starts[i]).not.toBe('·');
      });
    });
  }

  for (const width of [1440, 1280]) {
    test(`UAT-11 Home at ${width} px: the Available subtitle is one line and its link lines up with "View all"`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await openDemo(page, 'home');
      const card = (title: string) =>
        page
          .locator('section.pcp-card')
          .filter({ has: page.getByRole('heading', { name: title, exact: true }) })
          .last();
      const geometry = async (title: string) =>
        card(title).evaluate((c) => {
          const top = c.getBoundingClientRect().top;
          const action = c.querySelector('.pcp-card__actions')!.getBoundingClientRect();
          const sub = c.querySelector('.pcp-card__subtitle') as HTMLElement;
          const line = parseFloat(getComputedStyle(sub).lineHeight);
          return { action: Math.round(action.top - top), lines: Math.round(sub.getBoundingClientRect().height / line) };
        });
      const over = await geometry('Over capacity');
      const available = await geometry('Available');
      expect(available.lines).toBe(1);
      expect(available.action).toBe(over.action);
    });
  }
});
