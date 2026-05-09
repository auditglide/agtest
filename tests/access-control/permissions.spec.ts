/**
 * Access Control — permission-based UI visibility
 *
 * Requires a second test user with all permissions set to false.
 * Set TEST_READONLY_EMAIL and TEST_READONLY_PASSWORD in .env.local.
 */
import { test, expect } from '@playwright/test';
import { waitForAuthRequestSlot } from '../../helpers/auth-rate-limit.helper';

const READONLY_EMAIL    = process.env.TEST_READONLY_EMAIL    ?? '';
const READONLY_PASSWORD = process.env.TEST_READONLY_PASSWORD ?? '';
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173';

async function loginAs(email: string, password: string, page: import('@playwright/test').Page) {
  await page.goto(`${BASE_URL}/login`);
  await page.getByTestId('input-email').fill(email);
  await page.getByTestId('input-password').fill(password);
  await waitForAuthRequestSlot();
  await page.getByTestId('button-submit-login').click();
  await page.waitForURL(/dashboard|clients|compliance|cases/, { timeout: 15_000 });
}

test.describe('Access Control', () => {
  test.beforeEach(async ({}) => {
    if (!READONLY_EMAIL || !READONLY_PASSWORD) {
      test.skip(true, 'TEST_READONLY_EMAIL and TEST_READONLY_PASSWORD must be set to run access control tests');
    }
  });

  test('AC1 user without client_write cannot see Add Client button', async ({ page }) => {
    await loginAs(READONLY_EMAIL, READONLY_PASSWORD, page);
    await page.goto(`${BASE_URL}/clients`);

    await test.step('Add Client button must be absent for no-write user', async () => {
      await expect(
        page.getByTestId('button-add-client'),
        'Add Client button must not be visible for users without client_write permission',
      ).not.toBeVisible({ timeout: 5_000 });
    });
  });

  test('AC2 user without client_delete cannot see delete icon on client rows', async ({ page }) => {
    await loginAs(READONLY_EMAIL, READONLY_PASSWORD, page);
    await page.goto(`${BASE_URL}/clients`);

    await test.step('No delete icons must appear in the client list', async () => {
      await page.waitForLoadState?.('networkidle').catch(() => {});
      const deleteIcons = page.locator('[data-testid="clients-table"] button[class*="red"], [data-testid="clients-table"] [class*="trash"]');
      const count = await deleteIcons.count();
      expect(
        count,
        'Delete icons must not appear in client list for users without client_delete permission',
      ).toBe(0);
    });
  });

  test('AC3 user without compliance_write cannot edit compliance type', async ({ page }) => {
    await loginAs(READONLY_EMAIL, READONLY_PASSWORD, page);
    await page.goto(`${BASE_URL}/compliance`);

    await test.step('Create compliance button must be absent', async () => {
      await expect(
        page.getByTestId('button-create-compliance'),
        'Create compliance button must not be visible for no-write users',
      ).not.toBeVisible({ timeout: 5_000 });
    });
  });

  test('AC4 user without case_write cannot see status transition buttons', async ({ page }) => {
    await loginAs(READONLY_EMAIL, READONLY_PASSWORD, page);
    await page.goto(`${BASE_URL}/cases`);

    const caseRow = page.locator('[data-testid^="case-row-"]').first();
    const caseCount = await page.locator('[data-testid^="case-row-"]').count();
    if (caseCount === 0) {
      test.skip(true, 'No cases available to test access control');
    }

    const caseId = (await caseRow.getAttribute('data-testid'))?.replace('case-row-', '') ?? '';
    await page.goto(`${BASE_URL}/cases/${caseId}`);

    await test.step('Status transition buttons must be absent for read-only user', async () => {
      const transitionBtns = page.locator('[data-testid^="button-transition-"]');
      const count = await transitionBtns.count();
      expect(
        count,
        'Transition buttons must not appear for users without case_write',
      ).toBe(0);
    });
  });

  test('AC5 readonly user is blocked from branches, users, and teams management surfaces @p1', async ({ page }) => {
    await loginAs(READONLY_EMAIL, READONLY_PASSWORD, page);

    await test.step('Users page shows the explicit no-access banner and hides invite actions', async () => {
      await page.goto(`${BASE_URL}/users`);
      await expect(
        page.getByText(/you don't have permission to view users/i),
        'Readonly users must see the users-page permission banner',
      ).toBeVisible();
      await expect(
        page.getByTestId('button-invite-user'),
        'Readonly users must not see invite actions on the users page',
      ).not.toBeVisible();
    });

    await test.step('Branches page does not expose Add Branch and surfaces the denied read state', async () => {
      await page.goto(`${BASE_URL}/branches`);
      await expect(
        page.getByTestId('button-add-branch'),
        'Readonly users must not see Add Branch',
      ).not.toBeVisible();
      await expect(
        page.locator('body'),
        'Branches page must reflect the denied-read state for a no-permission user',
      ).toContainText(/you do not have read permission for branch|failed to load branches/i);
    });

    await test.step('Teams page does not expose Create Team and surfaces the denied read state', async () => {
      await page.goto(`${BASE_URL}/teams`);
      await expect(
        page.getByTestId('button-create-team'),
        'Readonly users must not see Create Team',
      ).not.toBeVisible();
      await expect(
        page.locator('body'),
        'Teams page must reflect the denied-read state for a no-permission user',
      ).toContainText(/you do not have read permission for team|failed to load teams/i);
    });
  });

});
