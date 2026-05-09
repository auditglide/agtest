/**
 * Auth — Login tests
 * These run WITHOUT saved auth state.
 */
import { test, expect } from '@playwright/test';
import { LoginPage } from '../../page-objects/login.page';

const ADMIN_EMAIL    = process.env.TEST_ADMIN_EMAIL    ?? '';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? '';
const DEADLOCK_EMAIL = process.env.TEST_DEADLOCK_EMAIL ?? '';
const DEADLOCK_PASSWORD = process.env.TEST_DEADLOCK_PASSWORD ?? '';

test.use({ storageState: { cookies: [], origins: [] } }); // fresh context

test.describe('Login', () => {

  test('A1 valid admin login redirects to protected page @smoke', async ({ page }) => {
    const loginPage = new LoginPage(page);

    await test.step('Navigate to /login', async () => {
      await loginPage.navigate();
      await expect(page.getByTestId('input-email'), 'Email field must be visible').toBeVisible();
    });

    await test.step('Fill credentials and submit', async () => {
      await loginPage.loginAndExpectSuccess(ADMIN_EMAIL, ADMIN_PASSWORD);
    });

    await test.step('Confirm we are on a protected page', async () => {
      expect(
        page.url(),
        'After login must land on dashboard/clients/compliance/cases',
      ).toMatch(/dashboard|clients|compliance|cases/);
    });
  });

  test('A2 wrong password shows error and stays on login', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.navigate();

    await test.step('Submit with wrong password', async () => {
      await loginPage.loginAndExpectError(ADMIN_EMAIL, 'WrongPassword!99', /invalid|incorrect|password/i);
    });
  });

  test('A3 non-existent email shows error', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.navigate();

    await test.step('Submit with non-existent email', async () => {
      await loginPage.loginAndExpectError('nobody@nowhere.com', 'AnyPassword1!', /not found|invalid|no.*account/i);
    });
  });

  test('A4 accessing protected route while logged out redirects to login', async ({ page }) => {
    await test.step('Navigate directly to /clients without auth', async () => {
      await page.goto('/clients');
    });

    await test.step('Must be redirected to /login', async () => {
      await expect(page, 'Must redirect unauthenticated users to /login').toHaveURL(/\/login/, { timeout: 8_000 });
    });
  });

  test('A5 logout clears session and redirects to login @smoke', async ({ page }) => {
    const loginPage = new LoginPage(page);

    await test.step('Log in first', async () => {
      await loginPage.navigate();
      await loginPage.loginAndExpectSuccess(ADMIN_EMAIL, ADMIN_PASSWORD);
    });

    await test.step('Click logout', async () => {
      // Open the user menu dropdown first
      await page.getByTestId('button-user-menu').click();
      // Then click the logout menu item
      await page.getByTestId('menu-logout').click();
    });

    await test.step('Must land back on /login', async () => {
      await expect(page, 'Must redirect to /login after logout').toHaveURL(/\/login/, { timeout: 8_000 });
    });

    await test.step('Navigating to protected route must still redirect to login', async () => {
      await page.goto('/clients');
      await expect(page, 'Must block access after logout').toHaveURL(/\/login/, { timeout: 8_000 });
    });
  });

  test('A6 empty email field shows validation error', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.navigate();

    await test.step('Submit with empty email', async () => {
      await page.getByTestId('button-submit-login').click();
      await expect(
        page.getByText(/email.*required|required/i),
        'Validation error must appear for empty email',
      ).toBeVisible();
    });
  });

  test('A7 repeated wrong passwords lock the account @p0', async ({ page }) => {
    test.skip(
      !DEADLOCK_EMAIL || !DEADLOCK_PASSWORD,
      'Set TEST_DEADLOCK_EMAIL and TEST_DEADLOCK_PASSWORD in .env.local to run the lockout test.',
    );

    const loginPage = new LoginPage(page);
    const lockedMessage = /locked after too many failed attempts|account has been locked/i;

    await test.step('Wrong password attempts should eventually lock the dedicated test account', async () => {
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        await loginPage.navigate();
        await loginPage.loginAndExpectError(
          DEADLOCK_EMAIL,
          `WrongPassword-${attempt}!`,
          /invalid|incorrect|password/i,
        );
      }

      await loginPage.navigate();
      await loginPage.loginAndExpectError(
        DEADLOCK_EMAIL,
        'WrongPassword-final!',
        lockedMessage,
      );
    });

    await test.step('Once locked, even the correct password must still be rejected with the lockout message', async () => {
      await loginPage.navigate();
      await loginPage.loginAndExpectError(
        DEADLOCK_EMAIL,
        DEADLOCK_PASSWORD,
        lockedMessage,
      );
    });
  });

});
