/**
 * Compliance Create — all frequency types and validation
 */
import { test, expect } from '../../fixtures/auth-fixture';
import { getCachedApiAuth, deleteComplianceType } from '../../helpers/api-seed.helper';

let token = '';
const created: string[] = [];

test.beforeAll(async () => {
  const cachedAuth = getCachedApiAuth();
  if (!cachedAuth) {
    throw new Error('Missing cached API auth. Run the Playwright setup project before compliance-create tests.');
  }
  ({ token } = cachedAuth);
});

test.afterAll(async () => {
  for (const id of created) await deleteComplianceType(token, id);
});

test.describe('Compliance Create', () => {

  test('QL2 create Monthly compliance type @smoke', async ({ complianceListPage, page }) => {
    await complianceListPage.navigate();
    await complianceListPage.openCreateModal();

    await test.step('Fill form — Monthly', async () => {
      await complianceListPage.fillCreateForm({ name: `QL2-Monthly-${Date.now()}`, frequency: 'Monthly' });
    });

    await test.step('Submit and verify in list', async () => {
      await complianceListPage.submitCreate();
      // After creation we're likely redirected to the detail page
      await expect(page, 'Must land on detail page after creation').toHaveURL(/\/compliance\/[0-9a-f-]{36}/, { timeout: 10_000 });
      const ctId = page.url().split('/').pop()!;
      created.push(ctId);
    });
  });

  test('QL3 create Quarterly compliance type', async ({ complianceListPage, page }) => {
    await complianceListPage.navigate();
    await complianceListPage.openCreateModal();
    await complianceListPage.fillCreateForm({ name: `QL3-Quarterly-${Date.now()}`, frequency: 'Quarterly' });
    await complianceListPage.submitCreate();
    await expect(page, 'Quarterly CT must redirect to detail').toHaveURL(/\/compliance\/[0-9a-f-]{36}/, { timeout: 10_000 });
    created.push(page.url().split('/').pop()!);
  });

  test('QL4 create Yearly compliance type', async ({ complianceListPage, page }) => {
    await complianceListPage.navigate();
    await complianceListPage.openCreateModal();
    await complianceListPage.fillCreateForm({ name: `QL4-Yearly-${Date.now()}`, frequency: 'Yearly' });
    await complianceListPage.submitCreate();
    await expect(page, 'Yearly CT must redirect to detail').toHaveURL(/\/compliance\/[0-9a-f-]{36}/, { timeout: 10_000 });
    created.push(page.url().split('/').pop()!);
  });

  test('QL5 submitting without a name shows validation error', async ({ complianceListPage }) => {
    await complianceListPage.navigate();
    await complianceListPage.openCreateModal();
    // Don't fill name
    await complianceListPage.submitCreate();
    await complianceListPage.expectCreateError(/compliance type name is required/i);
  });

});
