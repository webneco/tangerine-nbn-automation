import { defineConfig } from '@playwright/test';

const httpCredentials =
  process.env.PORTAL_USER && process.env.PORTAL_PASS
    ? { username: process.env.PORTAL_USER, password: process.env.PORTAL_PASS }
    : undefined;

export default defineConfig({
  testDir: './scripts',
  testMatch: '**/*.spec.ts',
  timeout: 360_000,
  expect: { timeout: 10_000 },
  retries: 0,
  workers: 1,
  fullyParallel: false,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    browserName: 'chromium',
    headless: process.env.HEADLESS !== 'false',
    viewport: { width: 1366, height: 900 },
    actionTimeout: 15_000,
    navigationTimeout: 60_000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    // Always record — a backup to the screen capture made by `npm run demo:record`.
    video: { mode: 'on', size: { width: 1366, height: 900 } },
    // Open headed windows at the same place every time so screen recordings line up.
    launchOptions: { args: ['--window-position=0,0', '--window-size=1366,900'] },
    ...(httpCredentials ? { httpCredentials } : {}),
  },
});
