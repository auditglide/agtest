/**
 * Global Setup — runs once before the entire test suite.
 *
 * 1. Logs in as the test admin via the UI.
 * 2. Saves browser storage state so all other tests skip the login screen.
 */
import { chromium, FullConfig } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { waitForAuthRequestSlot } from '../helpers/auth-rate-limit.helper';

export const AUTH_STATE_FILE = path.join(__dirname, '..', '.auth', 'user.json');
export const AUTH_API_STATE_FILE = path.join(__dirname, '..', '.auth', 'api-user.json');

interface LoginBranch {
  branchId: string;
  bname: string;
  isdefault: boolean;
}

interface LoginResponseData {
  accessToken?: string;
  lastBranchId?: string | null;
  branches?: LoginBranch[];
}

export default async function globalSetup(_config: FullConfig) {
  const email    = process.env.TEST_ADMIN_EMAIL;
  const password = process.env.TEST_ADMIN_PASSWORD;
  const baseURL  = process.env.BASE_URL ?? 'http://localhost:5173';

  if (!email || !password) {
    throw new Error(
      'TEST_ADMIN_EMAIL and TEST_ADMIN_PASSWORD must be set in .env.local before running tests.',
    );
  }

  // Ensure .auth directory exists
  const authDir = path.dirname(AUTH_STATE_FILE);
  if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page    = await context.newPage();

  try {
    console.log('\n[setup] Logging in as test admin…');
    await page.goto(`${baseURL}/login`);

    await page.fill('[data-testid="input-email"]', email);
    await page.fill('[data-testid="input-password"]', password);
    const loginResponsePromise = page.waitForResponse((response) =>
      response.request().method() === 'POST' && response.url().includes('/auth/login'),
    );
    await waitForAuthRequestSlot();
    await page.click('[data-testid="button-submit-login"]');
    const loginResponse = await loginResponsePromise;
    const loginData = await loginResponse.json().catch(() => null) as LoginResponseData | null;

    // Wait for the app to land on a protected page after login
    await page.waitForURL(/\/(dashboard|clients|compliance|cases)/, { timeout: 20_000 });

    // If forced password change screen appears, fail with a clear message
    if (page.url().includes('change-password') || page.url().includes('first-login')) {
      throw new Error(
        'TEST_ADMIN user requires a password change before tests can run. ' +
        'Log in manually once and complete the password change, then re-run.',
      );
    }

    await context.storageState({ path: AUTH_STATE_FILE });
    if (loginData?.accessToken) {
      const branchId =
        loginData.lastBranchId ??
        loginData.branches?.find((branch) => branch.isdefault)?.branchId ??
        loginData.branches?.[0]?.branchId ??
        '';

      fs.writeFileSync(
        AUTH_API_STATE_FILE,
        JSON.stringify({
          token: loginData.accessToken,
          branchId,
          email,
          createdAt: new Date().toISOString(),
        }, null, 2),
      );
    }
    console.log('[setup] Auth state saved ✓');
  } finally {
    await browser.close();
  }
}
