/**
 * First-login forced password change flow.
 *
 * Requires a test user whose is_first_login flag is still true.
 * Set FIRST_LOGIN_EMAIL / FIRST_LOGIN_PASSWORD in .env.local.
 * After the test runs it sets a new password — subsequent runs will skip.
 */
import { test, expect } from '@playwright/test';
import { LoginPage } from '../../page-objects/login.page';
import { apiFetch } from '../../helpers/api-seed.helper';

const FIRST_LOGIN_EMAIL    = process.env.FIRST_LOGIN_EMAIL    ?? '';
const FIRST_LOGIN_PASSWORD = process.env.FIRST_LOGIN_PASSWORD ?? '';
const NEW_PASSWORD         = process.env.FIRST_LOGIN_NEW_PASSWORD ?? 'AuditGlide@Changed1';
let consumedFirstLoginToken = '';

test.use({ storageState: { cookies: [], origins: [] } }); // fresh context

test.describe('First Login — forced password change', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(() => {
    if (!FIRST_LOGIN_EMAIL || !FIRST_LOGIN_PASSWORD) {
      test.skip(true,
        'Set FIRST_LOGIN_EMAIL and FIRST_LOGIN_PASSWORD in .env.local to run first-login tests. ' +
        'The user must have is_first_login=true in the database.',
      );
    }
  });

  test('FL1 first login redirects to change-password screen @smoke', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.navigate();

    await test.step('Login with first-login credentials', async () => {
      await loginPage.login(FIRST_LOGIN_EMAIL, FIRST_LOGIN_PASSWORD);
    });

    await test.step('Must be redirected to change-password page', async () => {
      await expect(
        page,
        'First login must force redirect to the change-password screen',
      ).toHaveURL(/change-password|first-login/, { timeout: 12_000 });
    });
  });

  test('FL2 change-password screen requires current password', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.navigate();
    await loginPage.login(FIRST_LOGIN_EMAIL, FIRST_LOGIN_PASSWORD);
    await page.waitForURL(/change-password|first-login/, { timeout: 12_000 });

    await test.step('Try submitting without current password — validation error', async () => {
      await page.getByTestId('input-new-password').fill(NEW_PASSWORD);
      await page.getByTestId('input-confirm-password').fill(NEW_PASSWORD);
      await page.getByTestId('button-change-password').click();
      await expect(
        page.getByText(/current password.*required|required/i),
        'Current password field must be required',
      ).toBeVisible();
    });
  });

  test('FL3 mismatched new passwords show validation error', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.navigate();
    await loginPage.login(FIRST_LOGIN_EMAIL, FIRST_LOGIN_PASSWORD);
    await page.waitForURL(/change-password|first-login/, { timeout: 12_000 });

    await test.step('Enter mismatched new passwords', async () => {
      await page.getByTestId('input-current-password').fill(FIRST_LOGIN_PASSWORD);
      await page.getByTestId('input-new-password').fill(NEW_PASSWORD);
      await page.getByTestId('input-confirm-password').fill('DifferentPassword99!');
      await page.getByTestId('button-change-password').click();

      await expect(
        page.getByText(/passwords.*match|do not match|mismatch/i),
        'Mismatch error must appear when new password ≠ confirm password',
      ).toBeVisible();
    });
  });

  test('FL5 navigating to a protected page while on first-login redirect loops back', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.navigate();
    await loginPage.login(FIRST_LOGIN_EMAIL, FIRST_LOGIN_PASSWORD);
    await page.waitForURL(/change-password|first-login/, { timeout: 12_000 });

    await test.step('Try to navigate directly to /clients', async () => {
      await page.goto('/clients');
    });

    await test.step('Must be redirected back to change-password', async () => {
      await expect(
        page,
        'Protected routes must be inaccessible until first-login password is changed',
      ).toHaveURL(/change-password|first-login|login/, { timeout: 8_000 });
    });
  });

  test('FL7 same current and new password is rejected @p0', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.navigate();
    await loginPage.login(FIRST_LOGIN_EMAIL, FIRST_LOGIN_PASSWORD);
    await page.waitForURL(/change-password|first-login/, { timeout: 12_000 });

    await test.step('Try to reuse the current password as the new password', async () => {
      await page.getByTestId('input-current-password').fill(FIRST_LOGIN_PASSWORD);
      await page.getByTestId('input-new-password').fill(FIRST_LOGIN_PASSWORD);
      await page.getByTestId('input-confirm-password').fill(FIRST_LOGIN_PASSWORD);
      await page.getByTestId('button-change-password').click();
    });

    await test.step('A validation error must explain the password must change', async () => {
      await expect(
        page.getByText(/different from the current password|must be different/i),
        'The change-password screen must reject reusing the current password',
      ).toBeVisible();
    });
  });

  test('FL4 successful password change redirects to the app', async ({ page }) => {
    const loginPage = new LoginPage(page);
    const loginResponse = await apiFetch<{
      requiresPasswordChange: boolean;
      firstLoginToken?: string;
    }>('POST', '/auth/login', undefined, {
      emailid: FIRST_LOGIN_EMAIL,
      password: FIRST_LOGIN_PASSWORD,
      useragent: 'playwright-first-login-replay',
    });

    expect(
      loginResponse.status,
      'The first-login fixture user must still require an initial password change before FL4 runs',
    ).toBe(200);
    expect(
      loginResponse.data.requiresPasswordChange,
      'FL4 must capture a first-login token from the backend before consuming it in the UI',
    ).toBe(true);
    consumedFirstLoginToken = loginResponse.data.firstLoginToken ?? '';
    expect(consumedFirstLoginToken, 'FL4 must capture the first-login token for the replay check').toBeTruthy();

    await loginPage.navigate();
    await loginPage.login(FIRST_LOGIN_EMAIL, FIRST_LOGIN_PASSWORD);
    await page.waitForURL(/change-password|first-login/, { timeout: 12_000 });

    await test.step('Fill all fields correctly and submit', async () => {
      await loginPage.changePassword(FIRST_LOGIN_PASSWORD, NEW_PASSWORD);
    });

    await test.step('Must redirect to the main app after password change', async () => {
      await expect(
        page,
        'After changing password, must land on dashboard or main page — not stay on change-password',
      ).toHaveURL(/dashboard|clients|compliance|cases/, { timeout: 12_000 });
    });
  });

  test('FL6 first-login token cannot be reused after successful password set', async () => {
    expect(
      consumedFirstLoginToken,
      'FL6 depends on FL4 capturing and consuming the initial first-login token',
    ).toBeTruthy();

    const replayResponse = await apiFetch<{ error?: string; message?: string }>(
      'POST',
      '/auth/change-password',
      consumedFirstLoginToken,
      { newPassword: `Replay-${Date.now()}!` },
    );

    expect(
      replayResponse.status,
      'A consumed first-login token must be rejected when reused',
    ).toBe(403);
    expect(
      replayResponse.text,
      'The backend must explain that the first-login token has already been consumed',
    ).toMatch(/first login token consumed|token can only be used for the initial password set/i);
  });

});
