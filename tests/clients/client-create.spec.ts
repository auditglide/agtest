/**
 * Client Create — all validation and success paths
 */
import { test, expect } from '../../fixtures/auth-fixture';
import { getCachedApiAuth, deleteClient } from '../../helpers/api-seed.helper';

let token = '';
const created: string[] = [];

test.beforeAll(async () => {
  const cachedAuth = getCachedApiAuth();
  if (!cachedAuth) {
    throw new Error('Missing cached API auth. Run the Playwright setup project before client-create tests.');
  }
  ({ token } = cachedAuth);
});

test.afterAll(async () => {
  for (const id of created) await deleteClient(token, id);
});

test.describe('Client Create', () => {

  test.beforeEach(async ({ clientListPage }) => {
    await clientListPage.navigate();
  });

  test('CC1 create client with PAN only succeeds and navigates to detail @smoke', async ({ clientListPage, page }) => {
    await clientListPage.waitForLoadingDone();
    await clientListPage.openAddClientModal();

    await test.step('Fill form with PAN only', async () => {
      await clientListPage.fillCreateForm({
        name: 'CC1 PAN Client',
        pan:  'AACCC1111C',
      });
      await clientListPage.selectFirstComplianceType();
    });

    await test.step('Submit form', async () => {
      await clientListPage.submitCreateForm();
    });

    await test.step('Navigates to client detail page', async () => {
      await expect(page, 'Must navigate to /clients/:id after creation').toHaveURL(/\/clients\/[0-9a-f-]{36}/, { timeout: 10_000 });
      const clientId = page.url().split('/').pop()!;
      created.push(clientId);
    });
  });

  test('CC2 create client with GSTN only succeeds', async ({ clientListPage, page }) => {
    await clientListPage.waitForLoadingDone();
    await clientListPage.openAddClientModal();

    await clientListPage.fillCreateForm({
      name: 'CC2 GSTN Client',
      gstn: '27AACCC2222C1Z5',
    });
    await clientListPage.selectFirstComplianceType();
    await clientListPage.submitCreateForm();

    await expect(page, 'Must navigate to detail page').toHaveURL(/\/clients\/[0-9a-f-]{36}/, { timeout: 10_000 });
    created.push(page.url().split('/').pop()!);
  });

  test('CC3 submit without PAN or GSTN shows validation error', async ({ clientListPage }) => {
    await clientListPage.waitForLoadingDone();
    await clientListPage.openAddClientModal();

    await test.step('Fill only the name — no PAN, no GSTN', async () => {
      await clientListPage.fillCreateForm({ name: 'CC3 No Identifiers' });
      await clientListPage.selectFirstComplianceType();
    });

    await test.step('Submit and expect error', async () => {
      await clientListPage.submitCreateForm();
      await clientListPage.expectFormError(/at least one of pan or gstn/i);
    });
  });

  test('CC8 create client requires at least one compliance type @p0', async ({ clientListPage }) => {
    await clientListPage.waitForLoadingDone();
    await clientListPage.openAddClientModal();

    await test.step('Fill a valid client without choosing any compliance type', async () => {
      await clientListPage.fillCreateForm({
        name: 'CC8 No Compliance',
        pan:  'AACCC8888C',
      });
    });

    await test.step('Submitting must show the compliance selection validation', async () => {
      await clientListPage.submitCreateForm();
      await clientListPage.expectFormError(/at least one compliance type is required/i);
    });
  });

  test('CC4 invalid PAN format shows field error', async ({ clientListPage }) => {
    await clientListPage.waitForLoadingDone();
    await clientListPage.openAddClientModal();

    await clientListPage.fillCreateForm({ name: 'CC4 Bad PAN', pan: 'BADPAN' });
    await clientListPage.selectFirstComplianceType();
    await clientListPage.submitCreateForm();
    await clientListPage.expectFormError(/invalid pan/i);
  });

  test('CC5 invalid GSTN format shows field error', async ({ clientListPage }) => {
    await clientListPage.waitForLoadingDone();
    await clientListPage.openAddClientModal();

    await clientListPage.fillCreateForm({ name: 'CC5 Bad GSTN', gstn: 'BADGSTN' });
    await clientListPage.selectFirstComplianceType();
    await clientListPage.submitCreateForm();
    await clientListPage.expectFormError(/invalid gstn/i);
  });

  test('CC6 PAN and GSTN mismatch shows validation error', async ({ clientListPage }) => {
    await clientListPage.waitForLoadingDone();
    await clientListPage.openAddClientModal();

    await clientListPage.fillCreateForm({
      name: 'CC6 Mismatch',
      pan:  'AACCC1111C',
      gstn: '27AABBB9999B1Z5', // different entity in GSTN
    });
    await clientListPage.selectFirstComplianceType();
    await clientListPage.submitCreateForm();
    await clientListPage.expectFormError(/gstin.*pan|pan.*gstin|mismatch/i);
  });

  test('CC7 invalid email format shows field error', async ({ clientListPage }) => {
    await clientListPage.waitForLoadingDone();
    await clientListPage.openAddClientModal();

    await clientListPage.fillCreateForm({ name: 'CC7 Bad Email', pan: 'AACCC7777C' });
    await clientListPage.selectFirstComplianceType();
    await clientListPage.page.getByTestId('input-email').fill('not-an-email'); // page is public on BasePage
    await clientListPage.submitCreateForm();
    await clientListPage.expectInputValidationMessage('input-email', /@|email/i);
  });

  test('CC9 invalid phone format shows field error @p0', async ({ clientListPage }) => {
    await clientListPage.waitForLoadingDone();
    await clientListPage.openAddClientModal();

    await clientListPage.fillCreateForm({
      name:  'CC9 Bad Phone',
      pan:   'AACCC9999C',
      phone: '12345',
    });
    await clientListPage.selectFirstComplianceType();
    await clientListPage.submitCreateForm();
    await clientListPage.expectFormError(/10-digit mobile number|valid 10-digit/i);
  });

});
