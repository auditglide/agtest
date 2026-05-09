/**
 * Auth helper — reusable login shortcut for specs that need to switch users.
 *
 * The primary test session uses the saved storage state from global-setup.
 * Use these helpers only when you need to act as a different user within a test.
 */
import { Page } from '@playwright/test';
import { waitForAuthRequestSlot } from './auth-rate-limit.helper';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173';

export async function loginAs(page: Page, email: string, password: string): Promise<void> {
  // Clear existing session before logging in as a different user
  await page.context().clearCookies();
  await page.evaluate(() => {
    try { localStorage.clear(); } catch { /* ignore */ }
    try { sessionStorage.clear(); } catch { /* ignore */ }
  });

  await page.goto(`${BASE_URL}/login`);
  await page.getByTestId('input-email').fill(email);
  await page.getByTestId('input-password').fill(password);
  await waitForAuthRequestSlot();
  await page.getByTestId('button-submit-login').click();
  await page.waitForURL(/dashboard|clients|compliance|cases/, { timeout: 15_000 });
}

export async function logout(page: Page): Promise<void> {
  await page.getByTestId('button-user-menu').click();
  await page.getByTestId('menu-logout').click();
  await page.waitForURL(/\/login/, { timeout: 8_000 });
}
