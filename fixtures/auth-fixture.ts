/**
 * Extended test fixture that pre-injects typed page objects.
 * Import `test` and `expect` from this file in all spec files.
 */
import { test as base, expect } from '@playwright/test';
import { LoginPage }            from '../page-objects/login.page';
import { ClientListPage }       from '../page-objects/clients/client-list.page';
import { ClientDetailPage }     from '../page-objects/clients/client-detail.page';
import { ComplianceListPage }   from '../page-objects/compliance/compliance-list.page';
import { ComplianceDetailPage } from '../page-objects/compliance/compliance-detail.page';
import { CaseListPage }         from '../page-objects/cases/case-list.page';
import { CaseDetailPage }       from '../page-objects/cases/case-detail.page';
import { AUTH_STATE_FILE }      from './global-setup';

const TEST_ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL ?? '';
const TEST_ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? '';

type Fixtures = {
  loginPage:           LoginPage;
  clientListPage:      ClientListPage;
  clientDetailPage:    ClientDetailPage;
  complianceListPage:  ComplianceListPage;
  complianceDetailPage: ComplianceDetailPage;
  caseListPage:        CaseListPage;
  caseDetailPage:      CaseDetailPage;
};

export const test = base.extend<Fixtures>({
  page: async ({ page }, use) => {
    if (!TEST_ADMIN_EMAIL || !TEST_ADMIN_PASSWORD) {
      throw new Error('TEST_ADMIN_EMAIL and TEST_ADMIN_PASSWORD must be set to run authenticated tests.');
    }

    const loginPage = new LoginPage(page);
    await page.goto('/clients');
    await page.waitForLoadState('domcontentloaded');

    await Promise.race([
      page.getByTestId('button-user-menu').waitFor({ state: 'visible', timeout: 8_000 }).catch(() => {}),
      page.getByTestId('input-email').waitFor({ state: 'visible', timeout: 8_000 }).catch(() => {}),
    ]);

    const hasAuthenticatedShell =
      await page.getByTestId('button-user-menu').isVisible().catch(() => false);

    if (!hasAuthenticatedShell) {
      await page.context().clearCookies();
      await page.goto('/login');
      await page.evaluate(() => {
        try { localStorage.clear(); } catch {}
        try { sessionStorage.clear(); } catch {}
      });

      await loginPage.navigate();
      await loginPage.loginAndExpectSuccess(TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);
      await page.context().storageState({ path: AUTH_STATE_FILE });
    }
    await expect(
      page.getByTestId('button-user-menu'),
      'Authenticated shell must be ready before each test',
    ).toBeVisible({ timeout: 15_000 });

    await use(page);
  },
  loginPage:           async ({ page }, use) => use(new LoginPage(page)),
  clientListPage:      async ({ page }, use) => use(new ClientListPage(page)),
  clientDetailPage:    async ({ page }, use) => use(new ClientDetailPage(page)),
  complianceListPage:  async ({ page }, use) => use(new ComplianceListPage(page)),
  complianceDetailPage: async ({ page }, use) => use(new ComplianceDetailPage(page)),
  caseListPage:        async ({ page }, use) => use(new CaseListPage(page)),
  caseDetailPage:      async ({ page }, use) => use(new CaseDetailPage(page)),
});

export { expect };
