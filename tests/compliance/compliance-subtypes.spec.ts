/**
 * Compliance Sub-types — CRUD and lifecycle
 */
import { test, expect } from '../../fixtures/auth-fixture';
import {
  apiFetch,
  defaultSchedule,
  getCachedApiAuth,
  seedComplianceType,
  deleteComplianceType,
} from '../../helpers/api-seed.helper';

let token = '';
let ctId  = '';

test.beforeAll(async () => {
  const cachedAuth = getCachedApiAuth();
  if (!cachedAuth) {
    throw new Error('Missing cached API auth. Run the Playwright setup project before compliance-subtypes tests.');
  }
  ({ token } = cachedAuth);
  const ct = await seedComplianceType(token, { type: `QS-CT-${Date.now()}`, frequency: 'Monthly' });
  ctId = ct.complianceTypeId;
});

test.afterAll(async () => {
  await deleteComplianceType(token, ctId);
});

test.describe('Compliance Subtypes', () => {

  test('QS1 add a new subtype — appears in list @smoke', async ({ complianceDetailPage }) => {
    const subtypeName = `QS1-Subtype-${Date.now()}`;
    await complianceDetailPage.navigate(ctId);

    await test.step('Open add subtype modal', async () => {
      await complianceDetailPage.openAddSubtypeModal();
    });

    await test.step('Fill name and submit', async () => {
      await complianceDetailPage.fillSubtypeForm(subtypeName);
      await complianceDetailPage.submitSubtype();
    });

    await test.step('Subtype must appear in the list', async () => {
      await complianceDetailPage.expectSubtypeVisible(subtypeName);
    });
  });

  test('QS2 edit subtype name', async ({ complianceDetailPage, page }) => {
    await complianceDetailPage.navigate(ctId);

    const editBtns = page.locator('[data-testid^="button-edit-subtype-"]');
    const existingCount = await editBtns.count();

    if (existingCount === 0) {
      const subtypeName = `QS2-Subtype-${Date.now()}`;
      await test.step('Create a subtype because none was left behind by earlier tests', async () => {
        await complianceDetailPage.openAddSubtypeModal();
        await complianceDetailPage.fillSubtypeForm(subtypeName);
        await complianceDetailPage.submitSubtype();
        await complianceDetailPage.expectSubtypeVisible(subtypeName);
      });
    }

    await test.step('Click edit on first subtype', async () => {
      await editBtns.first().click();
      await expect(page.getByRole('dialog')).toBeVisible();
    });

    await test.step('Change name and save', async () => {
      await complianceDetailPage.fillSubtypeForm('QS2-Renamed');
      await complianceDetailPage.submitSubtype();
    });

    await test.step('Updated name appears', async () => {
      await complianceDetailPage.expectSubtypeVisible('QS2-Renamed');
    });
  });

  test('QS5 delete subtype with no cases succeeds', async ({ complianceDetailPage, page }) => {
    const subtypeName = `QS5-To-Delete-${Date.now()}`;
    // Create a fresh subtype via UI to ensure it has no cases
    await complianceDetailPage.navigate(ctId);
    await complianceDetailPage.openAddSubtypeModal();
    await complianceDetailPage.fillSubtypeForm(subtypeName);
    await complianceDetailPage.submitSubtype();
    await complianceDetailPage.expectSubtypeVisible(subtypeName);

    const deleteBtns = page.locator('[data-testid^="button-delete-subtype-"]');
    const subtypeId  = (await deleteBtns.last().getAttribute('data-testid'))?.replace('button-delete-subtype-', '') ?? '';

    await test.step('Delete the new subtype', async () => {
      await complianceDetailPage.deleteSubtype(subtypeId);
    });

    await test.step('Subtype is gone from list', async () => {
      await complianceDetailPage.expectSubtypeHidden(subtypeName);
    });
  });

  test('QS7 deleteCases is rejected unless the subtype is being deactivated @p0', async () => {
    const subtypeName = `QS7-Subtype-${Date.now()}`;

    const createResponse = await apiFetch<{ subtypeId: string }>(
      'POST',
      `/compliance/${ctId}/subtypes`,
      token,
      {
        name: subtypeName,
        schedule: defaultSchedule('Monthly'),
        needsWorkAllocation: true,
      },
    );

    expect(createResponse.status, 'Creating the subtype fixture must succeed').toBe(201);

    const patchResponse = await apiFetch<{ error?: string; message?: string }>(
      'PATCH',
      `/compliance/${ctId}/subtypes/${createResponse.data.subtypeId}`,
      token,
      {
        name: subtypeName,
        deleteCases: true,
      },
    );

    expect(
      patchResponse.status,
      'A subtype patch must reject deleteCases when the subtype stays active',
    ).toBe(400);
    expect(
      patchResponse.text,
      'The validation error must explain that deleteCases only applies when deactivating',
    ).toMatch(/deleteCases can only be set when isactive is false/i);
  });

});
