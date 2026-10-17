#!/usr/bin/env node
/**
 * Visual review screenshots (package I, dev only): the demo workspace and the sign-in page at 1440×900 and 1280×800,
 * light theme, plus a few pages in the dark theme. Needs `vite preview` on :4173 (or SHOTS_BASE_URL).
 *
 *   node scripts/e2e/screenshots.mjs [outDir]
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const base = process.env.SHOTS_BASE_URL || 'http://localhost:4173';
const out = process.argv[2] || 'test-results/screenshots';
// eslint-disable-next-line security/detect-non-literal-fs-filename -- dev-only output folder from the command line
mkdirSync(out, { recursive: true });

const PAGES = [
  ['login', '/login?demo=1&demoSignedOut=1'],
  ['home', '/demo/w/demo/home'],
  ['my-plan', '/demo/w/demo/me'],
  ['capacity', '/demo/w/demo/plan/capacity'],
  ['demand', '/demo/w/demo/plan/demand'],
  ['allocations', '/demo/w/demo/plan/allocations'],
  ['marketplace', '/demo/w/demo/plan/marketplace'],
  ['people', '/demo/w/demo/org/people'],
  ['person-drawer', '/demo/w/demo/org/people?person=r1'],
  ['projects', '/demo/w/demo/org/projects'],
  ['tribes', '/demo/w/demo/org/tribes'],
  ['tribe-detail', '/demo/w/demo/org/tribes/tribe-digital'],
  ['jira-planview', '/demo/w/demo/delivery/jira-planview'],
  ['reports', '/demo/w/demo/reports'],
  ['settings-profile', '/demo/w/demo/settings/profile'],
  ['settings-members', '/demo/w/demo/settings/members'],
  ['settings-features', '/demo/w/demo/settings/features'],
  ['not-found', '/demo/w/demo/nope'],
];
const DARK = ['login', 'home', 'allocations', 'capacity', 'people'];
const SIZES = [
  [1440, 900],
  [1280, 800],
];

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
for (const [w, h] of SIZES) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  for (const [name, path] of PAGES) {
    for (const theme of ['light', ...(DARK.includes(name) && w === 1440 ? ['dark'] : [])]) {
      await page.goto(base + path);
      await page.locator('h1').first().waitFor();
      await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(out, `${w}x${h}-${theme}-${name}.png`) });
    }
  }
  await ctx.close();
}
await browser.close();
console.log(`screenshots in ${out}`);
