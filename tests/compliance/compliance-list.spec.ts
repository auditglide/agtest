/**
 * Compliance List — loading, visibility, navigation
 */
import { test, expect } from '../../fixtures/auth-fixture';
import {
  getCachedApiAuth,
  seedComplianceType,
  deleteComplianceType,
  deactivateComplianceType,
  reactivateComplianceType,
} from '../../helpers/api-seed.helper';

let token = '';
let ctId  = '';
let ctName = '';

test.beforeAll(async () => {
  const cachedAuth = getCachedApiAuth();
  if (!cachedAuth) {
    throw new Error('Missing cached API auth. Run the Playwright setup project before compliance-list tests.');
  }
  ({ token } = cachedAuth);
  ctName = `QL1-CT-${Date.now()}`;
  const ct = await seedComplianceType(token, { type: ctName, frequency: 'Monthly' });
  ctId = ct.complianceTypeId;
});

test.afterAll(async () => {
  await deleteComplianceType(token, ctId);
});

test.describe('Compliance List', () => {

  test('QL1 compliance list loads and shows seeded CT @smoke', async ({ complianceListPage }) => {
    await complianceListPage.navigate();

    await test.step('Page loads without error', async () => {
      await expect(
        complianceListPage.page.locator('body'),
        'Compliance list must not show an error state',
      ).not.toContainText('Error');
    });

    await test.step('Seeded compliance type is visible in the list', async () => {
      await complianceListPage.expectComplianceVisible(ctName);
    });
  });

  test('QL6 clicking a compliance type navigates to its detail page', async ({ complianceListPage, page }) => {
    await complianceListPage.navigate();

    await test.step('Click the seeded CT', async () => {
      await complianceListPage.clickCompliance(ctName);
    });

    await test.step('Must navigate to /compliance/:id', async () => {
      await expect(
        page,
        'Clicking a compliance type must navigate to its detail page',
      ).toHaveURL(/\/compliance\/[0-9a-f-]{36}/, { timeout: 8_000 });
    });
  });

  test('QL7 inactive compliance types remain visible in the list', async ({
    complianceListPage,
  }) => {
    await deactivateComplianceType(token, ctId);

    await complianceListPage.navigate();

    await test.step('Inactive seeded CT must still be visible in the current list view', async () => {
      await complianceListPage.expectComplianceVisible(ctName);
    });

    await reactivateComplianceType(token, ctId);
  });

});
