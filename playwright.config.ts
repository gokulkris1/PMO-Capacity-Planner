import { defineConfig, devices } from '@playwright/test';

// Playwright e2e (package I owns tests/e2e/**).
//
// Projects
// - demo: the production build served by `vite preview` on :4173, using the in-browser DemoTransport (/demo…).
// - live: the same build on :4174 with /api proxied to scripts/local-api.ts on :8899, i.e. the real Netlify
//   function handlers on an in-process PGlite database that starts as the v1.1 production schema and data
//   (tests/backend/helpers/v11Production.ts). Signs in with an existing v1.1 user through the real login page.
// - E2E_BASE_URL set (e.g. a Netlify deploy preview): the demo project runs against it, no local servers, and
//   the live project is skipped unless E2E_LIVE_BASE_URL is set too.
// Browsers: the preinstalled ones (PLAYWRIGHT_BROWSERS_PATH, e.g. /opt/pw-browsers); never run
// `playwright install` in CI agents. @playwright/test is pinned to 1.56.1 (Chromium 1194). If the pin and the
// installed revision differ, set PW_CHROMIUM_PATH to the chrome binary.
const demoURL = process.env.E2E_BASE_URL || 'http://localhost:4173';
const liveURL = process.env.E2E_LIVE_BASE_URL || 'http://localhost:4174';
const external = !!process.env.E2E_BASE_URL;
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;
const chrome = { ...devices['Desktop Chrome'], launchOptions: executablePath ? { executablePath } : {} };

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'demo',
      testIgnore: 'live/**',
      use: { ...chrome, baseURL: demoURL },
    },
    ...(external && !process.env.E2E_LIVE_BASE_URL
      ? []
      : [
          {
            name: 'live',
            testMatch: 'live/**/*.spec.ts',
            fullyParallel: false,
            use: { ...chrome, baseURL: liveURL },
          },
        ]),
  ],
  webServer: external
    ? undefined
    : [
        {
          command: 'npm run build && npx vite preview --port 4173 --strictPort',
          url: demoURL,
          reuseExistingServer: !process.env.CI,
          timeout: 180_000,
        },
        {
          // The production environment as it is today (CONTEXT=production; no INTEGRATIONS_ENC_KEY, ALLOWED_ORIGINS,
          // APP_MODE, FROM_EMAIL or ANTHROPIC_API_KEY): no page may answer 5xx under it.
          command:
            'env -u INTEGRATIONS_ENC_KEY -u ALLOWED_ORIGINS -u APP_MODE -u FROM_EMAIL -u ANTHROPIC_API_KEY -u RESEND_API_KEY -u TWILIO_API_KEY -u TWILIO_API_SECRET -u TWILIO_ACCOUNT_SID -u TWILIO_AUTH_TOKEN ' +
            `CONTEXT=production URL=${liveURL} LOCAL_API_DB=v11 LOCAL_API_PORT=8899 npx tsx scripts/local-api.ts`,
          url: 'http://localhost:8899/api/health',
          reuseExistingServer: false,
          timeout: 120_000,
        },
        {
          // Starts after the demo server is up (so after its build); serves the same dist with /api → :8899.
          command: `node scripts/e2e/wait-for.mjs ${demoURL} && LOCAL_API_PORT=8899 npx vite preview --port 4174 --strictPort`,
          url: liveURL,
          reuseExistingServer: false,
          timeout: 180_000,
        },
      ],
});
