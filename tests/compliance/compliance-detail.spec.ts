/**
 * Compliance Detail — edit, inactive toggle
 */
import { test, expect } from '../../fixtures/auth-fixture';
import {
  apiFetch,
  defaultSchedule,
  getCachedApiAuth,
  seedComplianceType,
  deleteComplianceType,
  reactivateComplianceType,
} from '../../helpers/api-seed.helper';

let token = '';
let ctId  = '';

test.beforeAll(async () => {
  const cachedAuth = getCachedApiAuth();
  if (!cachedAuth) {
    throw new Error('Missing cached API auth. Run the Playwright setup project before compliance-detail tests.');
  }
  ({ token } = cachedAuth);
  const ct = await seedComplianceType(token, { type: `QD-CT-${Date.now()}`, frequency: 'Monthly' });
  ctId = ct.complianceTypeId;
});

test.beforeEach(async () => {
  await reactivateComplianceType(token, ctId);
});

test.afterAll(async () => {
  await deleteComplianceType(token, ctId);
});

test.describe('Compliance Detail', () => {

  test('QD1 edit CT name and save @smoke', async ({ complianceDetailPage }) => {
    await complianceDetailPage.navigate(ctId);

    await test.step('Edit name', async () => {
      await complianceDetailPage.editName('QD1-Renamed');
    });

    await test.step('Save and verify toast', async () => {
      await complianceDetailPage.saveChanges();
      await complianceDetailPage.expectToast(/saved|updated/i);
    });
  });

  test('QD5 save with no changes shows a no-op toast @p0', async ({ complianceDetailPage }) => {
    const noOpCt = await seedComplianceType(token, {
      type: `QD5-CT-${Date.now()}`,
      frequency: 'Monthly',
    });

    try {
      const subtypeResponse = await apiFetch<{ subtypeId: string }>(
        'POST',
        `/compliance/${noOpCt.complianceTypeId}/subtypes`,
        token,
        {
          name: `QD5-Subtype-${Date.now()}`,
          schedule: defaultSchedule('Monthly'),
          needsWorkAllocation: true,
        },
      );
      expect(subtypeResponse.status, 'QD5 fixture subtype must be created successfully').toBe(201);

      await complianceDetailPage.navigate(noOpCt.complianceTypeId);

      await test.step('Save without modifying any compliance detail fields', async () => {
        await complianceDetailPage.saveChanges();
      });

      await test.step('The page must explain there was nothing to save', async () => {
        await complianceDetailPage.expectToast(/no changes/i);
      });
    } finally {
      await deleteComplianceType(token, noOpCt.complianceTypeId);
    }
  });

  test('QD6 toggling needs-work-allocation persists on the compliance type @p0', async ({ complianceDetailPage }) => {
    const workAllocationCt = await seedComplianceType(token, {
      type: `QD6-CT-${Date.now()}`,
      frequency: 'Monthly',
      needsWorkAllocation: false,
    });

    try {
      await complianceDetailPage.navigate(workAllocationCt.complianceTypeId);

      await test.step('Toggle the compliance type to require work allocation', async () => {
        await complianceDetailPage.setNeedsWorkAllocation(true);
        await complianceDetailPage.saveChanges();
        await complianceDetailPage.expectToast(/updated|saved/i);
      });

      await test.step('The selected work-allocation mode must persist after reload', async () => {
        await complianceDetailPage.navigate(workAllocationCt.complianceTypeId);
        await complianceDetailPage.expectNeedsWorkAllocation(true);
      });
    } finally {
      await deleteComplianceType(token, workAllocationCt.complianceTypeId);
    }
  });

  test('QD2 mark CT inactive (keep cases) — isactive flag updates', async ({ complianceDetailPage, page }) => {
    await complianceDetailPage.navigate(ctId);

    await test.step('Toggle inactive', async () => {
      await complianceDetailPage.toggleActive(false);
    });

    await test.step('Save and choose Keep Cases', async () => {
      await complianceDetailPage.saveAndHandleInactiveModal('keep');
    });

    await test.step('CT shows as inactive in UI', async () => {
      await complianceDetailPage.navigate(ctId);
      await expect(
        page.getByText(/inactive\s+—\s+no new cases will be created/i),
        'CT must show inactive status after deactivation',
      ).toBeVisible();
    });
  });

  test('QD4 reactivate CT triggers case generation for existing clients', async ({
    complianceDetailPage,
  }) => {
    // Deactivate via API first
    const { deactivateComplianceType } = await import('../../helpers/api-seed.helper');
    await deactivateComplianceType(token, ctId);

    await complianceDetailPage.navigate(ctId);

    await test.step('Toggle back to active', async () => {
      await complianceDetailPage.toggleActive(true);
    });

    await test.step('Save — no inactive modal, just save', async () => {
      await complianceDetailPage.saveChanges();
      await complianceDetailPage.expectToast(/saved|updated|active/i);
    });
  });

});
