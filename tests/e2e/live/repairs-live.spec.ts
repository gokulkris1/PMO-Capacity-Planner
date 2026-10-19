/**
 * Final fix round on the live full stack (v1.1 production-shaped database, upgraded by the first request): what the
 * data repairs 0010-0012 and the UAT notes look like to an Org Admin.
 *  - QA-014: no craft shows as a raw v1.1 id with a generated code ("X7AC · delivery-lead"); the imported craft is
 *    "DL · Delivery Lead", flagged "Imported — review" in Settings › Crafts.
 *  - QA-015: the v1.1 QBR tribe lead is kept.
 *  - QA-022: the v1.1 part-timer (capacity 80, no target) has an 80 % target.
 *  - UAT-01: without INTEGRATIONS_ENC_KEY (as in production today) Settings › Integrations says so up front.
 *  - UAT-07: the "no demand" badge says it is about QBR1–2.
 * Signs in once (Tom Hayes, Org Admin) and reuses the session, so the per-email sign-in limit is never reached.
 */
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { expect, test } from '../fixtures';

const ORG = 'acme-bank';
const WS = 'a1000000-0000-4000-8000-0000000000a1';
const TOM = { email: 'tom.hayes@acme.example', password: 'Pmo-Planner-2024' };
const base = `/o/${ORG}/w/${WS}`;

test.describe.configure({ mode: 'serial' });

let state: Awaited<ReturnType<BrowserContext['storageState']>>;
test.beforeAll(async ({ browser }: { browser: Browser }) => {
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const res = await ctx.request.post('/api/auth/login', { data: TOM });
  expect(res.status()).toBe(200);
  state = await ctx.storageState();
  await ctx.close();
});
test.beforeEach(async ({ context }) => {
  await context.addCookies(state.cookies);
});

async function open(page: Page, route: string, h1: string | RegExp): Promise<void> {
  await page.goto(`${base}/${route}`);
  await expect(page.locator('main h1')).toHaveText(h1);
}

test('QA-014 imported v1.1 crafts are named in words and flagged for review, never "X7AC · delivery-lead"', async ({
  page,
}) => {
  await open(page, 'settings/crafts', 'Settings');
  await expect(page.getByText(/imported crafts? needs? a review/)).toBeVisible();
  const row = page.getByRole('row', { name: /Delivery Lead/ });
  await expect(row.getByText('Imported — review')).toBeVisible();
  await expect(row.getByText('DL', { exact: true })).toBeVisible();
  await expect(page.getByText(/^X[0-9A-F]{3}$/)).toHaveCount(0);
  for (const [route, h1] of [
    ['org/people', 'People'],
    ['plan/demand', 'Demand'],
  ] as const) {
    await open(page, route, h1);
    await expect(page.getByText(/X7AC|delivery-lead/)).toHaveCount(0);
  }
  // Tom Hayes's below-the-table craft reads DL, Nebula's demand chip too.
  await open(page, 'org/people', 'People');
  await expect(page.getByRole('row', { name: /Tom Hayes/ }).getByText(/^DL/)).toBeVisible();
});

test('QA-022 the v1.1 part-timer has their capacity as target; QA-015 the QBR tribe lead is kept', async ({ page }) => {
  await open(page, 'org/people', 'People');
  await expect(page.getByRole('row', { name: /Kerrie Dalton/ }).getByRole('cell', { name: '80%' })).toBeVisible();
  await open(page, 'org/tribes', 'Tribes');
  await expect(page.getByText('Digital Experience').first()).toBeVisible();
  await page.goto(`${base}/settings/structure`);
  await expect(page.getByRole('row', { name: /Digital Experience/ }).getByText('Tom Hayes')).toBeVisible();
});

test('UAT-07 the Demand badge names the QBR1–2 rule', async ({ page }) => {
  await open(page, 'plan/demand', 'Demand');
  await expect(page.getByText('No QBR1–2 demand').first()).toBeVisible();
  await expect(page.getByText(/^No demand captured$/)).toHaveCount(0);
});

test('UAT-01 without INTEGRATIONS_ENC_KEY Settings › Integrations says credentials cannot be saved, and why', async ({
  page,
  consoleErrors,
}) => {
  await open(page, 'settings/integrations', 'Settings');
  await expect(page.getByText('Credentials cannot be saved on this deployment yet.')).toBeVisible();
  // UAT-03: a bare host is accepted. UAT-01: saving a token says what is missing instead of "Something went wrong".
  await page.getByLabel('Site').fill('acme.atlassian.net');
  await page.getByLabel('API token').fill('not-a-real-token');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/INTEGRATIONS_ENC_KEY/).last()).toBeVisible();
  await expect(page.getByText(/Something went wrong/)).toHaveCount(0);
  await expect(page.getByText('Use your Jira Cloud site, e.g. acme.atlassian.net')).toHaveCount(0);
  // The browser may log the expected 503 of the refused save (Chromium versions differ); nothing else may be logged.
  const i = consoleErrors.findIndex((e) => /status of 503/.test(e));
  if (i >= 0) consoleErrors.splice(i, 1);
});
