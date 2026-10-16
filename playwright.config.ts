import { defineConfig, devices } from '@playwright/test';

// Playwright e2e (package I owns tests/e2e/**). Created by WP-0; owned by package I afterwards.
//
// - E2E_BASE_URL set (e.g. a Netlify deploy preview): tests run against it, no local server.
// - Otherwise a production build is served locally with `vite preview` on port 4173.
// Browsers: use the preinstalled ones (PLAYWRIGHT_BROWSERS_PATH, e.g. /opt/pw-browsers); never
// run `playwright install` in CI agents. @playwright/test is pinned to 1.56.1, whose Chromium
// revision (1194) matches /opt/pw-browsers/chromium-1194. If the pin and the installed revision
// ever differ, set PW_CHROMIUM_PATH to the chrome binary, e.g.
// /opt/pw-browsers/chromium-1194/chrome-linux/chrome.
const baseURL = process.env.E2E_BASE_URL || 'http://localhost:4173';
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], launchOptions: executablePath ? { executablePath } : {} },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run build && npx vite preview --port 4173 --strictPort',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
});
