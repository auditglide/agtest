import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '.env.local') });

export const AUTH_STATE_FILE = path.join(__dirname, '.auth', 'user.json');

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,       // keep sequential within a spec; specs run in parallel
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 1,
  timeout: 45_000,            // 45 s per test
  expect: { timeout: 10_000 },

  reporter: [
    ['./helpers/custom-reporter.ts'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ...(process.env.CI ? [['junit', { outputFile: 'test-results/results.xml' }] as const] : []),
  ],

  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:5173',
    headless: true,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
  },

  projects: [
    // Auth setup — runs first, saves browser storage state
    {
      name: 'setup',
      testMatch: /global-setup\.ts/,
    },
    // All tests depend on the setup project
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: AUTH_STATE_FILE,
      },
      dependencies: ['setup'],
    },
    // Onboarding tests do NOT use saved auth (they test the login flow from scratch)
    {
      name: 'onboarding',
      testMatch: /onboarding\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  globalSetup: './fixtures/global-setup.ts',
  globalTeardown: './fixtures/global-teardown.ts',

  outputDir: 'test-results',
});
