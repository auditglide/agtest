/**
 * Client Detail — edit, compliance type management
 */
import { test, expect } from '../../fixtures/auth-fixture';
import { apiFetch, getCachedApiAuth, seedClient, seedComplianceType, deleteClient, deleteComplianceType } from '../../helpers/api-seed.helper';

let token = '';
let branchId = '';
let clientId = '';
let clientName = '';
let baseCtId = '';
let addCtId  = '';
let addCtType = '';

test.beforeAll(async () => {
  const cachedAuth = getCachedApiAuth();
  if (!cachedAuth) {
    throw new Error('Missing cached API auth. Run the Playwright setup project before client-detail tests.');
  }
  ({ token, branchId } = cachedAuth);
  const baseCt = await seedComplianceType(token, { type: `CD-Base-CT-${Date.now()}`, frequency: 'Monthly' });
  const addCt = await seedComplianceType(token, { type: `CD-CT-${Date.now()}`, frequency: 'Monthly' });
  baseCtId = baseCt.complianceTypeId;
  addCtId = addCt.complianceTypeId;
  addCtType = addCt.type;
});

test.beforeEach(async () => {
  clientName = `CD-Client-${Date.now()}`;
  const c = await seedClient(token, {
    name: clientName,
    pan: 'AACDD1111D',
    branchId,
    complianceTypeIds: [baseCtId],
  });
  clientId = c.clientId;
});

test.afterEach(async () => {
  await deleteClient(token, clientId);
});

test.afterAll(async () => {
  await deleteComplianceType(token, addCtId);
  await deleteComplianceType(token, baseCtId);
});

test.describe('Client Detail', () => {

  test('CD1 edit client name and save @smoke', async ({ clientDetailPage }) => {
    await clientDetailPage.navigate(clientId, clientName);

    await test.step('Edit name', async () => {
      await clientDetailPage.editName('CD1 Updated Name');
    });

    await test.step('Save changes', async () => {
      await clientDetailPage.saveChanges();
      await clientDetailPage.expectSaveSuccess();
    });

    await test.step('Reload and verify persisted', async () => {
      await clientDetailPage.navigate(clientId, 'CD1 Updated Name');
      await expect(
        clientDetailPage.byTestId('input-name'),
        'Name must be persisted after save',
      ).toHaveValue('CD1 Updated Name');
    });
  });

  test('CD2 saving with no changes shows No changes toast', async ({ clientDetailPage }) => {
    await clientDetailPage.navigate(clientId, clientName);

    await test.step('Click save without changing anything', async () => {
      await clientDetailPage.saveChanges();
      await clientDetailPage.expectSaveNoChanges();
    });
  });

  test('CD3 invalid email format shows validation error and does not save', async ({ clientDetailPage }) => {
    await clientDetailPage.navigate(clientId, clientName);

    await test.step('Enter invalid email', async () => {
      await clientDetailPage.editEmail('not-valid');
    });

    await test.step('Submit — error must appear, no success toast', async () => {
      await clientDetailPage.saveChanges();
      await clientDetailPage.expectInputValidationMessage('input-email', /@|email/i);
    });
  });

  test('CD4 add compliance type to client @smoke', async ({ clientDetailPage }) => {
    await clientDetailPage.navigate(clientId, clientName);

    await test.step('Add the seeded compliance type', async () => {
      await clientDetailPage.addComplianceType(addCtType);
    });

    await test.step('CT appears in client compliance list', async () => {
      await clientDetailPage.expectComplianceTypeVisible(addCtType);
    });
  });

  test('CD6 duplicate compliance assignment is rejected by the API contract @p0', async () => {
    await import('../../helpers/api-seed.helper').then(({ assignClientToCompliance }) =>
      assignClientToCompliance(token, addCtId, [clientId]));

    const response = await apiFetch<{ error?: string; message?: string }>(
      'POST',
      `/clients/${clientId}/compliance-types`,
      token,
      { complianceTypeId: addCtId },
    );

    expect(response.status, 'Adding an already assigned compliance type must fail').toBe(409);
    expect(
      response.text,
      'Duplicate compliance assignment must explain the client is already assigned to that type',
    ).toMatch(/already assigned to this compliance type/i);
  });

  test('CD5 remove compliance type — No Keep Cases — CT removed, mapping gone', async ({ clientDetailPage }) => {
    // Pre-assign CT via API
    const { assignClientToCompliance } = await import('../../helpers/api-seed.helper');
    await assignClientToCompliance(token, addCtId, [clientId]);

    await clientDetailPage.navigate(clientId, clientName);

    await test.step('Remove the CT and choose No (keep cases)', async () => {
      await clientDetailPage.removeComplianceType(addCtId, 'no-keep');
    });

    await test.step('CT must no longer appear in the list', async () => {
      await clientDetailPage.expectComplianceTypeHidden(addCtType);
    });
  });

});
