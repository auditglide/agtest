/**
 * Client Inactive Toggle — deactivation modal flows
 */
import { test, expect } from '../../fixtures/auth-fixture';
import { apiFetch, getCachedApiAuth, seedClient, deleteClient, seedComplianceType, deleteComplianceType } from '../../helpers/api-seed.helper';
import { disconnectTestDb, setCaseFixtureState } from '../../helpers/test-db.helper';

let token = '';
let branchId = '';
let clientId = '';
let clientName = '';
let ctId = '';
const extraCtIds: string[] = [];
const extraClientIds: string[] = [];

test.beforeAll(async () => {
  const cachedAuth = getCachedApiAuth();
  if (!cachedAuth) {
    throw new Error('Missing cached API auth. Run the Playwright setup project before client-inactive tests.');
  }
  ({ token, branchId } = cachedAuth);
  const ct = await seedComplianceType(token, { type: `CI-CT-${Date.now()}`, frequency: 'Monthly' });
  ctId = ct.complianceTypeId;
});

test.beforeEach(async () => {
  // Fresh client for each test so toggle state is always 'active'
  clientName = `CI-Client-${Date.now()}`;
  const c = await seedClient(token, {
    name: clientName,
    pan: 'AACCC5555C',
    branchId,
    complianceTypeIds: [ctId],
  });
  clientId = c.clientId;
});

test.afterEach(async () => {
  await deleteClient(token, clientId);
  while (extraClientIds.length > 0) {
    const extraClientId = extraClientIds.pop();
    if (extraClientId) {
      await deleteClient(token, extraClientId);
    }
  }
  while (extraCtIds.length > 0) {
    const extraCtId = extraCtIds.pop();
    if (extraCtId) {
      await deleteComplianceType(token, extraCtId);
    }
  }
});

test.afterAll(async () => {
  await deleteComplianceType(token, ctId);
  await disconnectTestDb();
});

test.describe('Client Inactive Toggle', () => {

  test('CI1 toggling to Inactive shows deactivation modal @smoke', async ({ clientDetailPage }) => {
    await clientDetailPage.navigate(clientId, clientName);

    await test.step('Toggle to inactive', async () => {
      await clientDetailPage.toggleActive(false);
    });

    await test.step('Click Save Changes', async () => {
      await clientDetailPage.saveChanges();
    });

    await test.step('Deactivation modal must appear', async () => {
      await clientDetailPage.expectDialogVisible(/Deactivate Client/i);
    });
  });

  test('CI2 Cancel in modal keeps client active', async ({ clientDetailPage }) => {
    await clientDetailPage.navigate(clientId, clientName);
    await clientDetailPage.toggleActive(false);

    await test.step('Save and Cancel in modal', async () => {
      await clientDetailPage.saveAndDeactivate('cancel');
    });

    await test.step('Client must remain active', async () => {
      await clientDetailPage.navigate(clientId, clientName); // reload
      await clientDetailPage.expectActiveLabelVisible();
      expect(
        await clientDetailPage.getIsActiveState(),
        'Client must remain active after clicking Cancel in deactivation modal',
      ).toBe(true);
    });
  });

  test('CI3 No (keep cases) deactivates client and retains cases', async ({ clientDetailPage }) => {
    await clientDetailPage.navigate(clientId, clientName);
    await clientDetailPage.toggleActive(false);

    await test.step('Save and choose No — Keep Cases', async () => {
      await clientDetailPage.saveAndDeactivate('no');
    });

    await test.step('Client is now inactive', async () => {
      await clientDetailPage.navigate(clientId, clientName);
      expect(
        await clientDetailPage.getIsActiveState(),
        'Client must be inactive after deactivation',
      ).toBe(false);
      await clientDetailPage.expectInactiveLabelVisible();
    });
  });

  test('CI4 Yes (delete cases) deactivates client', async ({ clientDetailPage }) => {
    await clientDetailPage.navigate(clientId, clientName);
    await clientDetailPage.toggleActive(false);

    await test.step('Save and choose Yes — Delete Open Cases', async () => {
      await clientDetailPage.saveAndDeactivate('yes');
    });

    await test.step('Client is now inactive', async () => {
      await clientDetailPage.navigate(clientId, clientName);
      expect(
        await clientDetailPage.getIsActiveState(),
        'Client must be inactive after deactivation with case deletion',
      ).toBe(false);
    });
  });

  test('CI5 reactivating an inactive client saves without modal', async ({ clientDetailPage, page }) => {
    // Start: deactivate via API
    const { deactivateClient } = await import('../../helpers/api-seed.helper');
    await deactivateClient(token, clientId);

    await clientDetailPage.navigate(clientId, clientName);

    await test.step('Toggle back to Active', async () => {
      await clientDetailPage.toggleActive(true);
    });

    await test.step('Save — no modal should appear', async () => {
      await clientDetailPage.saveChanges();
      // If a dialog appeared that is not expected, this will catch it
      const dialog = page.locator('[role="alertdialog"]');
      await expect(
        dialog,
        'No deactivation modal must appear when reactivating a client',
      ).not.toBeVisible({ timeout: 2_000 });
    });

    await test.step('Client is active again', async () => {
      await clientDetailPage.navigate(clientId, clientName);
      expect(
        await clientDetailPage.getIsActiveState(),
        'Client must be active after reactivation',
      ).toBe(true);
    });
  });

  test('CI6 deactivate client with delete-cases keeps closed cases but removes open ones @p1', async ({ clientDetailPage }) => {
    test.skip(!process.env.TEST_DB_URL, 'TEST_DB_URL must be set to run DB-backed client case-state fixtures');

    const extraCt = await seedComplianceType(token, {
      type: `CI6-CT-${Date.now()}`,
      frequency: 'Monthly',
      schedule: Array.from({ length: 12 }, (_, i) => ({
        period_index: i,
        creation_month_offset: 3,
        creation_day: 1,
        deadline_month_offset: 3,
        deadline_day: 20,
      })),
    });
    extraCtIds.push(extraCt.complianceTypeId);

    const dedicatedClientName = `CI6-Client-${Date.now()}`;
    const dedicatedClient = await seedClient(token, {
      name: dedicatedClientName,
      pan: `AACIC${String(Date.now()).slice(-4)}C`,
      branchId,
      complianceTypeIds: [ctId, extraCt.complianceTypeId],
    });
    extraClientIds.push(dedicatedClient.clientId);

    const seededCases = await apiFetch<{
      data: Array<{ caseId: string; status: string; complianceTypeId: string }>;
    }>(
      'GET',
      `/cases?branchId=${encodeURIComponent(branchId)}&clientid=${encodeURIComponent(dedicatedClient.clientId)}&page=1&limit=20`,
      token,
    );
    expect(seededCases.status, 'The dedicated CI6 client cases must be readable before deactivation').toBe(200);

    const closedCaseId =
      seededCases.data.data.find((entry) => entry.complianceTypeId === ctId)?.caseId
      ?? await (async () => {
        const manual = await apiFetch<{ caseId: string }>(
          'POST',
          '/cases',
          token,
          { clientId: dedicatedClient.clientId, complianceTypeId: ctId },
        );
        expect(manual.status, 'If the baseline case is missing, the test must be able to create it explicitly').toBe(201);
        return manual.data.caseId;
      })();

    const openCaseId =
      seededCases.data.data.find((entry) => entry.complianceTypeId === extraCt.complianceTypeId)?.caseId
      ?? await (async () => {
        const manual = await apiFetch<{ caseId: string }>(
          'POST',
          '/cases',
          token,
          { clientId: dedicatedClient.clientId, complianceTypeId: extraCt.complianceTypeId },
        );
        expect(
          manual.status,
          'If the extra-compliance open case is missing, the test must create it explicitly before verifying delete-open-cases behavior',
        ).toBe(201);
        return manual.data.caseId;
      })();

    await setCaseFixtureState({
      caseId: closedCaseId,
      status: 'Closed',
      assignedToUserId: null,
      closedByUserId: null,
    });

    const deactivateResponse = await apiFetch<{ isactive: boolean }>(
      'PATCH',
      `/clients/${dedicatedClient.clientId}`,
      token,
      {
        isactive: false,
        deleteCases: true,
      },
    );
    expect(
      deactivateResponse.status,
      'Deactivating with deleteCases=true must succeed for a client that has both protected and deletable cases',
    ).toBe(200);

    await test.step('The client becomes inactive after choosing to delete open cases', async () => {
      await clientDetailPage.navigate(dedicatedClient.clientId, dedicatedClientName);
      expect(await clientDetailPage.getIsActiveState()).toBe(false);
    });

    await test.step('Closed cases remain while open cases are removed', async () => {
      const remainingCases = await apiFetch<{
        data: Array<{ caseId: string; status: string }>;
      }>(
        'GET',
        `/cases?branchId=${encodeURIComponent(branchId)}&clientid=${encodeURIComponent(dedicatedClient.clientId)}&page=1&limit=20`,
        token,
      );
      expect(remainingCases.status, 'Client cases must remain queryable after deactivation').toBe(200);

      const remainingIds = remainingCases.data.data.map((entry) => entry.caseId);
      expect(remainingIds, 'The closed case must be preserved when deactivating with delete-cases').toContain(closedCaseId);
      expect(remainingIds, 'The still-open case must be removed when delete-cases is chosen').not.toContain(openCaseId);
      expect(
        remainingCases.data.data.find((entry) => entry.caseId === closedCaseId)?.status,
        'The preserved case must remain Closed after the deactivation cleanup',
      ).toBe('Closed');
    });
  });

});
