/**
 * HS-12: the suite runs under the production Content-Security-Policy, enforced. Locally `vite preview` serves the
 * policy from netlify.toml; against a deploy (E2E_BASE_URL) Netlify serves it. Any violation is a console error,
 * which the shared fixture turns into a failure, so every other spec doubles as a CSP check.
 */
import { expect, test } from './fixtures';

test('pages are served with the enforced CSP and the security headers', async ({ page }) => {
  const res = await page.goto('/demo/w/demo/home');
  expect(res).not.toBeNull();
  const h = res!.headers();
  expect(h['content-security-policy']).toContain("script-src 'self'");
  expect(h['content-security-policy']).toContain("object-src 'none'");
  if (process.env.E2E_BASE_URL) {
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['strict-transport-security']).toContain('max-age=');
  }
  await expect(page.locator('main h1')).toHaveText('Home');
});

test('an inline script is refused by the CSP (the policy is enforced, not report-only)', async ({
  page,
  consoleErrors,
}) => {
  await page.goto('/demo/w/demo/home');
  await expect(page.locator('main h1')).toHaveText('Home');
  const ran = await page.evaluate(async () => {
    const w = window as unknown as { __cspProbe?: boolean };
    const s = document.createElement('script');
    s.textContent = 'window.__cspProbe = true';
    document.body.append(s);
    await new Promise((r) => setTimeout(r, 50));
    return w.__cspProbe === true;
  });
  expect(ran).toBe(false);
  // The refusal is the expected console error; take it out so the fixture checks the rest.
  const i = consoleErrors.findIndex((e) => /Content Security Policy/.test(e));
  expect(i).toBeGreaterThanOrEqual(0);
  consoleErrors.splice(i, 1);
});

test('a page chunk missing after a new deploy reloads the app once instead of failing', async ({
  page,
  consoleErrors,
}) => {
  await page.goto('/demo/w/demo/home');
  await expect(page.locator('main h1')).toHaveText('Home');
  let refused = 0;
  await page.route(/\/assets\/ReportsPage-[^/]+\.js$/, async (route) => {
    if (refused++ === 0) return route.fulfill({ status: 404, contentType: 'text/html', body: 'gone' });
    return route.continue();
  });
  await page.getByRole('link', { name: 'Reports' }).click();
  await expect(page.locator('main h1')).toHaveText('Reports');
  expect(refused).toBeGreaterThanOrEqual(2);
  // The refused chunk is the expected console error.
  for (let i = consoleErrors.length - 1; i >= 0; i--)
    if (/404|dynamically imported module|ReportsPage/.test(consoleErrors[i])) consoleErrors.splice(i, 1);
});
