import { test, expect } from '../../fixtures/auth-fixture';
import {
  assignClientToCompliance,
  deleteClient,
  deleteComplianceType,
  findCaseIdForClient,
  getCachedApiAuth,
  seedCase,
  seedClient,
  seedComplianceType,
} from '../../helpers/api-seed.helper';
import {
  addCasePayment,
  createSubtype,
} from '../../helpers/payment.helper';
import {
  countPaymentEntries,
  ensureTestDbConnection,
  disconnectTestDb,
  getCaseState,
  getClientComplianceSubtypeCases,
  getComplianceTypeState,
  getSubtypeState,
} from '../../helpers/test-db.helper';
import { validPan } from '../../helpers/payment-test-utils';

let token = '';
let branchId = '';
let dbReady = false;

function complianceIdFromUrl(url: string): string {
  const match = url.match(/\/compliance\/([0-9a-f-]{36})(?:\?.*)?$/i);
  return match?.[1] ?? '';
}

function skipIfDbUnavailable(reason: string) {
  test.skip(!process.env.TEST_DB_URL, reason);
  test.skip(
    !dbReady,
    'TEST_DB_URL is set but the DB tunnel is not reachable. Start the SSH tunnel before running DB-backed payment tests.',
  );
}

test.beforeAll(async () => {
  const cachedAuth = getCachedApiAuth();
  if (!cachedAuth) {
    throw new Error('Missing cached API auth. Run the Playwright setup project before payment compliance tests.');
  }
  ({ token, branchId } = cachedAuth);

  if (process.env.TEST_DB_URL) {
    try {
      await ensureTestDbConnection();
      dbReady = true;
    } catch {
      dbReady = false;
    }
  }
});

test.afterAll(async () => {
  await disconnectTestDb();
});

test.describe('Payment Settings — Compliance Types and Subtypes', () => {
  test('CT-01 Create CT without Receive Payment', async ({ complianceListPage, page }) => {
    skipIfDbUnavailable('TEST_DB_URL must be set to verify receive_payment state in the DB');

    await complianceListPage.navigate();
    await complianceListPage.openCreateModal();
    await complianceListPage.fillCreateForm({
      name: `CT01-${Date.now()}`,
      frequency: 'Monthly',
      receivePayment: false,
    });
    await complianceListPage.submitCreate();

    const ctId = complianceIdFromUrl(page.url());
    expect(ctId, 'The browser must land on the new compliance detail page after creation').toBeTruthy();

    try {
      const state = await getComplianceTypeState(ctId);
      expect(state.receivePayment, 'Receive Payment must default to false when the checkbox is left unchecked').toBe(false);
    } finally {
      await deleteComplianceType(token, ctId);
    }
  });

  test('CT-02 Create CT with Receive Payment', async ({ complianceListPage, page }) => {
    skipIfDbUnavailable('TEST_DB_URL must be set to verify receive_payment state in the DB');

    await complianceListPage.navigate();
    await complianceListPage.openCreateModal();
    await complianceListPage.fillCreateForm({
      name: `CT02-${Date.now()}`,
      frequency: 'Monthly',
      receivePayment: true,
    });
    await complianceListPage.submitCreate();

    const ctId = complianceIdFromUrl(page.url());
    expect(ctId, 'The browser must land on the new compliance detail page after creation').toBeTruthy();

    try {
      const state = await getComplianceTypeState(ctId);
      expect(state.receivePayment, 'Receive Payment must be true when enabled at creation time').toBe(true);
    } finally {
      await deleteComplianceType(token, ctId);
    }
  });

  test('CT-03 Receive Payment hidden when subtypes exist', async ({ complianceDetailPage }) => {
    const ct = await seedComplianceType(token, {
      type: `CT03-${Date.now()}`,
      frequency: 'Monthly',
      receivePayment: false,
    });

    try {
      const subtype = await createSubtype(token, ct.complianceTypeId, {
        name: `CT03-Subtype-${Date.now()}`,
        receivePayment: false,
      });
      expect(subtype.status, 'The subtype fixture must be created before verifying the parent compliance detail layout').toBe(201);

      await complianceDetailPage.navigate(ct.complianceTypeId);
      await complianceDetailPage.expectReceivePaymentConfiguredPerSubtype();
    } finally {
      await deleteComplianceType(token, ct.complianceTypeId);
    }
  });

  test('CT-04 Enable Receive Payment on existing CT (no subtypes)', async ({ complianceDetailPage }) => {
    const ct = await seedComplianceType(token, {
      type: `CT04-${Date.now()}`,
      frequency: 'Monthly',
      receivePayment: false,
    });

    try {
      await complianceDetailPage.navigate(ct.complianceTypeId);
      await complianceDetailPage.setReceivePayment(true);
      await complianceDetailPage.saveChanges();
      await complianceDetailPage.expectDialogVisible(/Enable Payment Tracking/i);
      await complianceDetailPage.clickDialogButton(/Cancel/i);
    } finally {
      await deleteComplianceType(token, ct.complianceTypeId);
    }
  });

  test('CT-05 Enable — Apply to existing open cases', async ({ complianceDetailPage }) => {
    skipIfDbUnavailable('TEST_DB_URL must be set to verify case payment snapshots');

    const runId = Date.now();
    const ct = await seedComplianceType(token, {
      type: `CT05-${runId}`,
      frequency: 'Monthly',
      receivePayment: false,
    });
    const client = await seedClient(token, {
      name: `CT05-Client-${runId}`,
      pan: validPan('CTFIV', 1),
      branchId,
    });

    try {
      await assignClientToCompliance(token, ct.complianceTypeId, [client.clientId]);
      const caseId = await findCaseIdForClient(token, branchId, client.clientId);
      expect(caseId, 'A client mapped to the compliance type must have an open case before the toggle is applied').toBeTruthy();

      await complianceDetailPage.navigate(ct.complianceTypeId);
      await complianceDetailPage.setReceivePayment(true);
      await complianceDetailPage.saveAndHandleReceivePaymentModal('apply');

      const state = await getCaseState(caseId);
      expect(state.paymentRequired, 'Applying the toggle to existing open cases must mark the current case as payment-required').toBe(true);
      expect(state.paymentStatus, 'Applying the toggle to existing open cases must mark the case payment status as Pending').toBe('Pending');
    } finally {
      await deleteClient(token, client.clientId);
      await deleteComplianceType(token, ct.complianceTypeId);
    }
  });

  test('CT-06 Enable — New cases only', async ({ complianceDetailPage }) => {
    skipIfDbUnavailable('TEST_DB_URL must be set to verify case payment snapshots');

    const runId = Date.now();
    const ct = await seedComplianceType(token, {
      type: `CT06-${runId}`,
      frequency: 'Monthly',
      receivePayment: false,
    });
    const client = await seedClient(token, {
      name: `CT06-Client-${runId}`,
      pan: validPan('CTSIX', 2),
      branchId,
    });

    try {
      await assignClientToCompliance(token, ct.complianceTypeId, [client.clientId]);
      const existingCaseId = await findCaseIdForClient(token, branchId, client.clientId);
      expect(existingCaseId, 'The seeded client must have an existing case before toggling Receive Payment').toBeTruthy();

      await complianceDetailPage.navigate(ct.complianceTypeId);
      await complianceDetailPage.setReceivePayment(true);
      await complianceDetailPage.saveAndHandleReceivePaymentModal('new-only');

      const existingCase = await getCaseState(existingCaseId);
      expect(existingCase.paymentRequired, 'Choosing "New cases only" must leave existing cases unchanged').toBe(false);
      expect(existingCase.paymentStatus, 'Existing cases must stay NotRequired when the toggle only applies to future cases').toBe('NotRequired');

      const newCase = await seedCase(token, {
        clientId: client.clientId,
        complianceTypeId: ct.complianceTypeId,
      });
      const newCaseState = await getCaseState(newCase.caseId);
      expect(newCaseState.paymentRequired, 'Future cases created after enabling Receive Payment must snapshot the new flag').toBe(true);
      expect(newCaseState.paymentStatus, 'Future cases created after enabling Receive Payment must snapshot Pending status').toBe('Pending');
    } finally {
      await deleteClient(token, client.clientId);
      await deleteComplianceType(token, ct.complianceTypeId);
    }
  });

  test('CT-07 Enable — Cancel', async ({ complianceDetailPage }) => {
    skipIfDbUnavailable('TEST_DB_URL must be set to verify the toggle remains unchanged after cancellation');

    const ct = await seedComplianceType(token, {
      type: `CT07-${Date.now()}`,
      frequency: 'Monthly',
      receivePayment: false,
    });

    try {
      await complianceDetailPage.navigate(ct.complianceTypeId);
      await complianceDetailPage.setReceivePayment(true);
      await complianceDetailPage.saveAndHandleReceivePaymentModal('cancel');

      await complianceDetailPage.navigate(ct.complianceTypeId);
      await complianceDetailPage.expectReceivePaymentChecked(false);

      const state = await getComplianceTypeState(ct.complianceTypeId);
      expect(state.receivePayment, 'Cancelling the Receive Payment confirmation must leave the DB unchanged').toBe(false);
    } finally {
      await deleteComplianceType(token, ct.complianceTypeId);
    }
  });

  test('CT-08 Disable Receive Payment on existing CT', async ({ complianceDetailPage }) => {
    const ct = await seedComplianceType(token, {
      type: `CT08-${Date.now()}`,
      frequency: 'Monthly',
      receivePayment: true,
    });

    try {
      await complianceDetailPage.navigate(ct.complianceTypeId);
      await complianceDetailPage.setReceivePayment(false);
      await complianceDetailPage.saveChanges();
      await complianceDetailPage.expectDialogVisible(/Disable Payment Tracking/i);
      await complianceDetailPage.clickDialogButton(/Cancel/i);
    } finally {
      await deleteComplianceType(token, ct.complianceTypeId);
    }
  });

  test('CT-09 Disable — cases with no payment history cleared', async ({ complianceDetailPage }) => {
    skipIfDbUnavailable('TEST_DB_URL must be set to verify case payment snapshots');

    const runId = Date.now();
    const ct = await seedComplianceType(token, {
      type: `CT09-${runId}`,
      frequency: 'Monthly',
      receivePayment: true,
    });
    const client = await seedClient(token, {
      name: `CT09-Client-${runId}`,
      pan: validPan('CTNIN', 3),
      branchId,
    });

    try {
      await assignClientToCompliance(token, ct.complianceTypeId, [client.clientId]);
      const caseId = await findCaseIdForClient(token, branchId, client.clientId);
      expect(caseId, 'A payment-enabled compliance type must generate an open case before the disable flow runs').toBeTruthy();

      await complianceDetailPage.navigate(ct.complianceTypeId);
      await complianceDetailPage.setReceivePayment(false);
      await complianceDetailPage.saveAndHandleReceivePaymentModal('apply');

      const state = await getCaseState(caseId);
      expect(await countPaymentEntries(caseId), 'This fixture case should still have no payment history when the toggle is disabled').toBe(0);
      expect(state.paymentRequired, 'Cases with no payment history must clear payment_required when disabling Receive Payment').toBe(false);
      expect(state.paymentStatus, 'Cases with no payment history must reset to NotRequired when disabling Receive Payment').toBe('NotRequired');
    } finally {
      await deleteClient(token, client.clientId);
      await deleteComplianceType(token, ct.complianceTypeId);
    }
  });

  test('CT-10 Disable — cases with payment history preserved', async ({ complianceDetailPage }) => {
    skipIfDbUnavailable('TEST_DB_URL must be set to verify case payment history preservation');

    const runId = Date.now();
    const ct = await seedComplianceType(token, {
      type: `CT10-${runId}`,
      frequency: 'Monthly',
      receivePayment: true,
    });
    const client = await seedClient(token, {
      name: `CT10-Client-${runId}`,
      pan: validPan('CTTEN', 4),
      branchId,
    });

    try {
      await assignClientToCompliance(token, ct.complianceTypeId, [client.clientId]);
      const historyCaseId = await findCaseIdForClient(token, branchId, client.clientId);
      expect(historyCaseId, 'The first seeded case must exist before payment history is added').toBeTruthy();

      const dueResponse = await addCasePayment(token, historyCaseId, {
        totalDue: 10000,
        amountReceived: 0,
        note: 'Due seeded before disabling Receive Payment',
      });
      expect(dueResponse.status, 'Creating a due-update ledger entry must succeed before the disable flow is exercised').toBe(200);

      const untouchedCase = await seedCase(token, {
        clientId: client.clientId,
        complianceTypeId: ct.complianceTypeId,
      });

      await complianceDetailPage.navigate(ct.complianceTypeId);
      await complianceDetailPage.setReceivePayment(false);
      await complianceDetailPage.saveAndHandleReceivePaymentModal('apply');

      const historyCase = await getCaseState(historyCaseId);
      const untouchedState = await getCaseState(untouchedCase.caseId);

      expect(historyCase.paymentRequired, 'Cases with existing payment ledger entries must keep payment tracking enabled').toBe(true);
      expect(historyCase.paymentStatus, 'Cases with existing payment ledger entries must keep their current payment status').toBe('Pending');
      expect(await countPaymentEntries(historyCaseId, { nonVoidedOnly: true }), 'The payment-history case must still have its ledger entry after the toggle').toBe(1);

      expect(untouchedState.paymentRequired, 'Cases with no payment history must still be cleared during the same disable flow').toBe(false);
      expect(untouchedState.paymentStatus, 'Cases with no payment history must reset to NotRequired during the same disable flow').toBe('NotRequired');
    } finally {
      await deleteClient(token, client.clientId);
      await deleteComplianceType(token, ct.complianceTypeId);
    }
  });

  test('CT-11 Subtype — enable Receive Payment', async ({ complianceDetailPage }) => {
    skipIfDbUnavailable('TEST_DB_URL must be set to verify subtype case snapshots');

    const runId = Date.now();
    const ct = await seedComplianceType(token, {
      type: `CT11-${runId}`,
      frequency: 'Monthly',
      receivePayment: false,
    });
    const subtypeAName = `CT11-Subtype-A-${runId}`;
    const subtypeBName = `CT11-Subtype-B-${runId}`;
    const subtypeA = await createSubtype(token, ct.complianceTypeId, { name: subtypeAName, receivePayment: false });
    const subtypeB = await createSubtype(token, ct.complianceTypeId, { name: subtypeBName, receivePayment: false });
    const client = await seedClient(token, {
      name: `CT11-Client-${runId}`,
      pan: validPan('CTELE', 5),
      branchId,
    });

    try {
      expect(subtypeA.status, 'Subtype A must be created successfully').toBe(201);
      expect(subtypeB.status, 'Subtype B must be created successfully').toBe(201);
      await assignClientToCompliance(token, ct.complianceTypeId, [client.clientId]);

      const before = await getClientComplianceSubtypeCases(client.clientId, ct.complianceTypeId);
      expect(before.length, 'Assigning a client to a compliance type with subtypes must produce subtype cases to update').toBeGreaterThan(0);

      await complianceDetailPage.navigate(ct.complianceTypeId);
      await complianceDetailPage.openEditSubtypeModal(subtypeAName);
      await complianceDetailPage.setSubtypeReceivePayment(true);
      await complianceDetailPage.submitSubtypeAndHandleReceivePaymentModal('apply');

      const after = await getClientComplianceSubtypeCases(client.clientId, ct.complianceTypeId);
      const subtypeACases = after.filter((row) => row.complianceSubtypeId === subtypeA.data.subtypeId);
      const subtypeBCases = after.filter((row) => row.complianceSubtypeId === subtypeB.data.subtypeId);
      const parentCases = after.filter((row) => row.complianceSubtypeId === null);

      expect(subtypeACases.length, 'The targeted subtype must have at least one case to verify the payment flag update').toBeGreaterThan(0);
      subtypeACases.forEach((row) => {
        expect(row.paymentRequired, 'Only the edited subtype cases should become payment-required').toBe(true);
        expect(row.paymentStatus, 'Only the edited subtype cases should move to Pending').toBe('Pending');
      });
      subtypeBCases.forEach((row) => {
        expect(row.paymentRequired, 'Sibling subtype cases must remain unchanged').toBe(false);
        expect(row.paymentStatus, 'Sibling subtype cases must remain NotRequired').toBe('NotRequired');
      });
      parentCases.forEach((row) => {
        expect(row.paymentRequired, 'Any parent-level cases must remain unaffected by a subtype-only change').toBe(false);
        expect(row.paymentStatus, 'Any parent-level cases must remain NotRequired').toBe('NotRequired');
      });
    } finally {
      await deleteClient(token, client.clientId);
      await deleteComplianceType(token, ct.complianceTypeId);
    }
  });

  test('CT-12 Subtype — disable Receive Payment', async ({ complianceDetailPage }) => {
    skipIfDbUnavailable('TEST_DB_URL must be set to verify subtype case snapshots');

    const runId = Date.now();
    const ct = await seedComplianceType(token, {
      type: `CT12-${runId}`,
      frequency: 'Monthly',
      receivePayment: false,
    });
    const subtypeName = `CT12-Subtype-${runId}`;
    const subtype = await createSubtype(token, ct.complianceTypeId, { name: subtypeName, receivePayment: true });
    const client = await seedClient(token, {
      name: `CT12-Client-${runId}`,
      pan: validPan('CTTWL', 6),
      branchId,
    });

    try {
      expect(subtype.status, 'The payment-enabled subtype fixture must be created successfully').toBe(201);
      await assignClientToCompliance(token, ct.complianceTypeId, [client.clientId]);

      const before = await getClientComplianceSubtypeCases(client.clientId, ct.complianceTypeId);
      const subtypeCasesBefore = before.filter((row) => row.complianceSubtypeId === subtype.data.subtypeId);
      expect(subtypeCasesBefore.length, 'The payment-enabled subtype must have cases before the disable flow runs').toBeGreaterThan(0);
      subtypeCasesBefore.forEach((row) => {
        expect(row.paymentRequired, 'Subtype cases must initially snapshot payment tracking from the enabled subtype').toBe(true);
      });

      await complianceDetailPage.navigate(ct.complianceTypeId);
      await complianceDetailPage.openEditSubtypeModal(subtypeName);
      await complianceDetailPage.setSubtypeReceivePayment(false);
      await complianceDetailPage.submitSubtypeAndHandleReceivePaymentModal('apply');

      const after = await getClientComplianceSubtypeCases(client.clientId, ct.complianceTypeId);
      const subtypeCasesAfter = after.filter((row) => row.complianceSubtypeId === subtype.data.subtypeId);
      subtypeCasesAfter.forEach((row) => {
        expect(row.paymentRequired, 'Disabling Receive Payment on the subtype must clear payment tracking for that subtype’s cases with no history').toBe(false);
        expect(row.paymentStatus, 'Disabling Receive Payment on the subtype must reset those subtype cases to NotRequired').toBe('NotRequired');
      });

      const subtypeState = await getSubtypeState(subtype.data.subtypeId);
      expect(subtypeState.receivePayment, 'The subtype itself must persist the disabled Receive Payment flag after saving').toBe(false);
    } finally {
      await deleteClient(token, client.clientId);
      await deleteComplianceType(token, ct.complianceTypeId);
    }
  });
});
