import { Buffer } from 'node:buffer';
import { test, expect } from '../../fixtures/auth-fixture';
import {
  deleteClient,
  deleteComplianceType,
  findCaseIdForClient,
  getCachedApiAuth,
  seedClient,
  seedComplianceType,
} from '../../helpers/api-seed.helper';
import {
  addCasePayment,
  correctCasePayment,
  getCasePayment,
  reverseWriteOffCasePayment,
  writeOffCasePayment,
} from '../../helpers/payment.helper';
import {
  disconnectTestDb,
  getCasePaymentHistory,
  getCaseState,
  updatePaymentEntryCreatedAt,
} from '../../helpers/test-db.helper';
import {
  closeCaseAsUser,
  decodeJwtSubject,
  inr,
  validPan,
} from '../../helpers/payment-test-utils';

let token = '';
let branchId = '';
let requesterUserId = '';

async function seedPaymentCaseFixture(input: {
  prefix: string;
  receivePayment?: boolean;
  needsWorkAllocation?: boolean;
  closeCase?: boolean;
}) {
  const runId = Date.now();
  const compliance = await seedComplianceType(token, {
    type: `${input.prefix}-CT-${runId}`,
    frequency: 'Monthly',
    receivePayment: input.receivePayment ?? true,
    needsWorkAllocation: input.needsWorkAllocation ?? true,
  });
  const client = await seedClient(token, {
    name: `${input.prefix}-Client-${runId}`,
    pan: validPan(input.prefix, runId % 999),
    branchId,
    complianceTypeIds: [compliance.complianceTypeId],
  });
  const caseId = await findCaseIdForClient(token, branchId, client.clientId);
  expect(caseId, `The ${input.prefix} payment fixture must create a case`).toBeTruthy();

  if (input.closeCase) {
    await closeCaseAsUser(token, caseId, requesterUserId);
  }

  return {
    ctId: compliance.complianceTypeId,
    clientId: client.clientId,
    clientName: client.name,
    caseId,
  };
}

async function cleanupFixture(fixture: { clientId: string; ctId: string }) {
  await deleteClient(token, fixture.clientId);
  await deleteComplianceType(token, fixture.ctId);
}

async function seedDue(caseId: string, totalDue: number, note = 'Due updated') {
  const response = await addCasePayment(token, caseId, {
    totalDue,
    amountReceived: 0,
    note,
  });
  expect(response.status, 'Seeding a due-update entry must succeed before the case payment assertions run').toBe(200);
}

async function seedPayment(caseId: string, totalDue: number, amountReceived: number, note?: string) {
  const response = await addCasePayment(token, caseId, {
    totalDue,
    amountReceived,
    note,
  });
  expect(response.status, 'Seeding a payment entry must succeed before the case payment assertions run').toBe(200);
}

test.beforeAll(async () => {
  const cachedAuth = getCachedApiAuth();
  if (!cachedAuth) {
    throw new Error('Missing cached API auth. Run the Playwright setup project before case-payment tests.');
  }
  ({ token, branchId } = cachedAuth);
  requesterUserId = decodeJwtSubject(token);
  if (!requesterUserId) {
    throw new Error('Could not decode the current user id from the cached API token for payment case fixtures.');
  }
});

test.afterAll(async () => {
  await disconnectTestDb();
});

test.describe('Case Payment Section', () => {
  test('VC-01 Payment section visible — payment required', async ({ caseDetailPage }) => {
    const fixture = await seedPaymentCaseFixture({ prefix: 'VC01', receivePayment: true });

    try {
      await caseDetailPage.navigate(fixture.caseId);
      await caseDetailPage.expectPaymentSectionVisible();
    } finally {
      await cleanupFixture(fixture);
    }
  });

  test('VC-02 Payment section hidden — payment not required', async ({ caseDetailPage }) => {
    const fixture = await seedPaymentCaseFixture({ prefix: 'VC02', receivePayment: false });

    try {
      await caseDetailPage.navigate(fixture.caseId);
      await caseDetailPage.expectPaymentSectionHidden();
    } finally {
      await cleanupFixture(fixture);
    }
  });

  test('VC-03 Summary shows correct initial values', async ({ caseDetailPage }) => {
    const fixture = await seedPaymentCaseFixture({ prefix: 'VC03', receivePayment: true });

    try {
      await caseDetailPage.navigate(fixture.caseId);
      await caseDetailPage.expectPaymentSummary({
        totalDue: inr(0),
        totalReceived: inr(0),
        outstanding: inr(0),
        paymentStatus: /Pending/i,
      });
    } finally {
      await cleanupFixture(fixture);
    }
  });

  test('VC-04 Pencil icon on Total Due', async ({ caseDetailPage }) => {
    const fixture = await seedPaymentCaseFixture({ prefix: 'VC04', receivePayment: true });

    try {
      await caseDetailPage.navigate(fixture.caseId);
      await caseDetailPage.openEditTotalDueModal();
    } finally {
      await cleanupFixture(fixture);
    }
  });

  test('VC-05 Update Total Due', async ({ caseDetailPage }) => {
    test.skip(!process.env.TEST_DB_URL, 'TEST_DB_URL must be set to verify payment ledger rows');

    const fixture = await seedPaymentCaseFixture({ prefix: 'VC05', receivePayment: true });

    try {
      await caseDetailPage.navigate(fixture.caseId);
      await caseDetailPage.updateTotalDue('10000');
      await caseDetailPage.expectToast(/Total due updated/i);
      await caseDetailPage.expectPaymentSummary({
        totalDue: inr(10000),
        outstanding: inr(10000),
      });

      const state = await getCaseState(fixture.caseId);
      const history = await getCasePaymentHistory(fixture.caseId);
      expect(state.paymentTotalDue, 'Updating the total due must persist the case-level total due summary').toBe(10000);
      expect(state.paymentOutstanding, 'Updating the total due must recalculate the outstanding amount immediately').toBe(10000);
      expect(history[0]?.entryType, 'Updating the total due must create a Due Updated ledger entry').toBe('due_update');
    } finally {
      await cleanupFixture(fixture);
    }
  });

  test('VC-06 Record Payment — partial', async ({ caseDetailPage }) => {
    const fixture = await seedPaymentCaseFixture({ prefix: 'VC06', receivePayment: true });

    try {
      await seedDue(fixture.caseId, 10000, 'Initial due before preview');
      await caseDetailPage.navigate(fixture.caseId);
      await caseDetailPage.enterPaymentAmount('4000');
      await caseDetailPage.expectPaymentPreview({
        totalReceivedAfter: inr(4000),
        outstandingAfter: inr(6000),
        status: /Partial/i,
      });
    } finally {
      await cleanupFixture(fixture);
    }
  });

  test('VC-07 Record Payment — full', async ({ caseDetailPage }) => {
    const fixture = await seedPaymentCaseFixture({ prefix: 'VC07', receivePayment: true });

    try {
      await seedDue(fixture.caseId, 10000, 'Initial due before full preview');
      await caseDetailPage.navigate(fixture.caseId);
      await caseDetailPage.enterPaymentAmount('10000');
      await caseDetailPage.expectPaymentPreview({
        totalReceivedAfter: inr(10000),
        outstandingAfter: inr(0),
        status: /Paid/i,
      });
    } finally {
      await cleanupFixture(fixture);
    }
  });

  test('VC-08 Record Payment — zero blocked', async ({ caseDetailPage }) => {
    const fixture = await seedPaymentCaseFixture({ prefix: 'VC08', receivePayment: true });

    try {
      await seedDue(fixture.caseId, 10000, 'Initial due before zero-payment validation');
      await caseDetailPage.navigate(fixture.caseId);
      await caseDetailPage.recordPayment({ amount: '0' });
      await caseDetailPage.expectPaymentFormError(/Enter an amount greater than zero/i);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  test('VC-09 Status auto-derived correctly', async ({ caseDetailPage }) => {
    const fixture = await seedPaymentCaseFixture({ prefix: 'VC09', receivePayment: true });

    try {
      await seedDue(fixture.caseId, 10000, 'Initial due for auto-derived status preview');
      await caseDetailPage.navigate(fixture.caseId);

      await caseDetailPage.enterPaymentAmount('0');
      await caseDetailPage.expectPaymentPreview({
        totalReceivedAfter: inr(0),
        outstandingAfter: inr(10000),
        status: /Pending/i,
      });

      await caseDetailPage.enterPaymentAmount('1');
      await caseDetailPage.expectPaymentPreview({
        totalReceivedAfter: inr(1),
        outstandingAfter: inr(9999),
        status: /Partial/i,
      });

      await caseDetailPage.enterPaymentAmount('10000');
      await caseDetailPage.expectPaymentPreview({
        totalReceivedAfter: inr(10000),
        outstandingAfter: inr(0),
        status: /Paid/i,
      });
    } finally {
      await cleanupFixture(fixture);
    }
  });

  test('VC-10 Cumulative totals correct across multiple payments', async ({ caseDetailPage }) => {
    test.skip(!process.env.TEST_DB_URL, 'TEST_DB_URL must be set to verify cumulative payment totals');

    const fixture = await seedPaymentCaseFixture({ prefix: 'VC10', receivePayment: true });

    try {
      await caseDetailPage.navigate(fixture.caseId);
      await caseDetailPage.updateTotalDue('10000');
      await caseDetailPage.recordPayment({ amount: '4000', note: 'First payment' });
      await caseDetailPage.recordPayment({ amount: '3000', note: 'Second payment' });

      const state = await getCaseState(fixture.caseId);
      expect(state.paymentTotalReceived, 'The running total received must accumulate across multiple payment entries').toBe(7000);
      expect(state.paymentOutstanding, 'Outstanding must reduce cumulatively as payments are recorded').toBe(3000);
      expect(state.paymentStatus, 'Any remaining balance after multiple payments must keep the status Partial').toBe('Partial');
    } finally {
      await cleanupFixture(fixture);
    }
  });

  test('VC-11 Total Due change does not affect running total', async ({ caseDetailPage }) => {
    test.skip(!process.env.TEST_DB_URL, 'TEST_DB_URL must be set to verify recalculated outstanding totals');

    const fixture = await seedPaymentCaseFixture({ prefix: 'VC11', receivePayment: true });

    try {
      await caseDetailPage.navigate(fixture.caseId);
      await caseDetailPage.updateTotalDue('10000');
      await caseDetailPage.recordPayment({ amount: '4000', note: 'Partial collection before due revision' });
      await caseDetailPage.updateTotalDue('12000');

      const state = await getCaseState(fixture.caseId);
      expect(state.paymentTotalReceived, 'Changing the due after receiving a payment must not alter the received running total').toBe(4000);
      expect(state.paymentOutstanding, 'Changing the due after receiving a payment must only recalculate the outstanding amount').toBe(8000);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  test('VC-12 Record Payment form hidden when Paid', async ({ caseDetailPage }) => {
    const fixture = await seedPaymentCaseFixture({ prefix: 'VC12', receivePayment: true });

    try {
      await caseDetailPage.navigate(fixture.caseId);
      await caseDetailPage.updateTotalDue('10000');
      await caseDetailPage.recordPayment({ amount: '10000', note: 'Full settlement' });
      await caseDetailPage.expectRecordPaymentFormHidden();
      await caseDetailPage.expectReopenPaymentVisible();
    } finally {
      await cleanupFixture(fixture);
    }
  });

  test('VC-13 Record Payment form hidden when WrittenOff', async ({ caseDetailPage }) => {
    const fixture = await seedPaymentCaseFixture({ prefix: 'VC13', receivePayment: true, closeCase: true });

    try {
      await caseDetailPage.navigate(fixture.caseId);
      await caseDetailPage.updateTotalDue('6000');
      await caseDetailPage.writeOff('Unable to collect the outstanding amount');
      await caseDetailPage.expectRecordPaymentFormHidden();
      await caseDetailPage.expectReverseWriteOffVisible();
    } finally {
      await cleanupFixture(fixture);
    }
  });

  test('VC-14 Reopen Payment', async ({ caseDetailPage }) => {
    test.skip(!process.env.TEST_DB_URL, 'TEST_DB_URL must be set to verify reopened payment state');

    const fixture = await seedPaymentCaseFixture({ prefix: 'VC14', receivePayment: true });

    try {
      await caseDetailPage.navigate(fixture.caseId);
      await caseDetailPage.updateTotalDue('4000');
      await caseDetailPage.recordPayment({ amount: '4000', note: 'Initial full settlement' });
      await caseDetailPage.expectReopenPaymentVisible();
      await caseDetailPage.reopenPayment();
      await caseDetailPage.expectRecordPaymentFormVisible();

      const state = await getCaseState(fixture.caseId);
      expect(state.paymentStatus, 'Reopening a paid payment must move the current payment status back to Partial for further edits').toBe('Partial');
    } finally {
      await cleanupFixture(fixture);
    }
  });

  test('VC-15 Receipt upload', async ({ caseDetailPage }) => {
    test.skip(!process.env.TEST_DB_URL, 'TEST_DB_URL must be set to verify receipt metadata after upload');

    const fixture = await seedPaymentCaseFixture({ prefix: 'VC15', receivePayment: true });
    const receiptName = `vc15-receipt-${Date.now()}.txt`;

    try {
      await caseDetailPage.navigate(fixture.caseId);
      await caseDetailPage.updateTotalDue('1500');
      await caseDetailPage.recordPayment({
        amount: '500',
        note: 'Receipt upload test',
        receipt: {
          name: receiptName,
          mimeType: 'text/plain',
          buffer: Buffer.from('payment receipt fixture', 'utf8'),
        },
      });

      const history = await getCasePaymentHistory(fixture.caseId);
      expect(history[0]?.receiptDocumentId, 'Recording a payment with a receipt must persist the uploaded receipt reference').toBeTruthy();
      expect(history[0]?.receiptDocumentName, 'Recording a payment with a receipt must persist the original filename').toBe(receiptName);

      await caseDetailPage.expectPaymentReceiptNamed(receiptName);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  test('VC-16 Payment status badge separate from Case status', async ({ caseDetailPage }) => {
    const fixture = await seedPaymentCaseFixture({ prefix: 'VC16', receivePayment: true, closeCase: true });

    try {
      await caseDetailPage.navigate(fixture.caseId);
      await caseDetailPage.updateTotalDue('10000');
      await caseDetailPage.recordPayment({ amount: '4000', note: 'Partial after case close' });
      await caseDetailPage.expectSeparateStatusBadges('Closed', /Partial/i);
    } finally {
      await cleanupFixture(fixture);
    }
  });
});

test.describe('Payment Calculations and Ledger Math', () => {
  test('PC-01 Outstanding = Total Due − Total Received', async () => {
    test.skip(!process.env.TEST_DB_URL, 'TEST_DB_URL must be set to verify payment arithmetic');

    const fixture = await seedPaymentCaseFixture({ prefix: 'PC01', receivePayment: true });

    try {
      await seedDue(fixture.caseId, 10000);
      await seedPayment(fixture.caseId, 10000, 4000);
      const state = await getCaseState(fixture.caseId);
      expect(state.paymentOutstanding).toBe(6000);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  test('PC-02 Multiple payments accumulate correctly', async () => {
    test.skip(!process.env.TEST_DB_URL, 'TEST_DB_URL must be set to verify payment arithmetic');

    const fixture = await seedPaymentCaseFixture({ prefix: 'PC02', receivePayment: true });

    try {
      await seedDue(fixture.caseId, 10000);
      await seedPayment(fixture.caseId, 10000, 2000);
      await seedPayment(fixture.caseId, 10000, 2000);
      await seedPayment(fixture.caseId, 10000, 2000);
      const state = await getCaseState(fixture.caseId);
      expect(state.paymentTotalReceived).toBe(6000);
      expect(state.paymentOutstanding).toBe(4000);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  test('PC-03 Total Due update recalculates outstanding', async () => {
    test.skip(!process.env.TEST_DB_URL, 'TEST_DB_URL must be set to verify payment arithmetic');

    const fixture = await seedPaymentCaseFixture({ prefix: 'PC03', receivePayment: true });

    try {
      await seedDue(fixture.caseId, 10000);
      await seedPayment(fixture.caseId, 10000, 4000);
      await seedDue(fixture.caseId, 8000, 'Reduced due after partial payment');
      const state = await getCaseState(fixture.caseId);
      expect(state.paymentTotalReceived).toBe(4000);
      expect(state.paymentOutstanding).toBe(4000);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  test('PC-04 Cannot overpay', async () => {
    const fixture = await seedPaymentCaseFixture({ prefix: 'PC04', receivePayment: true });

    try {
      await seedDue(fixture.caseId, 10000);
      const response = await addCasePayment(token, fixture.caseId, {
        totalDue: 10000,
        amountReceived: 11000,
        note: 'Overpayment should fail',
      });
      expect(response.status, 'The API must reject payments greater than the total due').toBe(400);
      expect(response.text).toMatch(/cannot exceed total due/i);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  test('PC-05 Correction voids wrong entry, recalculates', async () => {
    test.skip(!process.env.TEST_DB_URL, 'TEST_DB_URL must be set to verify payment correction math');

    const fixture = await seedPaymentCaseFixture({ prefix: 'PC05', receivePayment: true });

    try {
      await seedDue(fixture.caseId, 10000);
      await seedPayment(fixture.caseId, 10000, 5000, 'Wrong payment amount');
      const wrongEntry = (await getCasePaymentHistory(fixture.caseId)).find((row) => row.entryType === 'payment' && row.amountReceived === 5000);
      expect(wrongEntry, 'The original incorrect payment entry must exist before it can be corrected').toBeTruthy();
      if (!wrongEntry) return;

      const correction = await correctCasePayment(token, fixture.caseId, wrongEntry.paymentId, {
        correctedAmount: 500,
        reason: 'Entered an extra zero',
        note: 'Corrected amount',
      });
      expect(correction.status, 'Correcting a payment entry must succeed').toBe(200);

      const state = await getCaseState(fixture.caseId);
      const history = await getCasePaymentHistory(fixture.caseId);
      expect(state.paymentTotalReceived).toBe(500);
      expect(state.paymentOutstanding).toBe(9500);
      expect(history.some((row) => row.isVoided && row.paymentId === wrongEntry.paymentId), 'The original incorrect entry must be voided after correction').toBe(true);
      expect(history.some((row) => row.entryType === 'correction' && row.amountReceived === 500), 'A replacement correction entry with the corrected amount must be added').toBe(true);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  test('PC-06 Correction on second of three entries', async () => {
    test.skip(!process.env.TEST_DB_URL, 'TEST_DB_URL must be set to verify payment correction math');

    const fixture = await seedPaymentCaseFixture({ prefix: 'PC06', receivePayment: true });

    try {
      await seedDue(fixture.caseId, 10000);
      await seedPayment(fixture.caseId, 10000, 2000, 'Payment 1');
      await seedPayment(fixture.caseId, 10000, 3000, 'Payment 2');
      await seedPayment(fixture.caseId, 10000, 1000, 'Payment 3');

      const secondEntry = (await getCasePaymentHistory(fixture.caseId)).find((row) => row.entryType === 'payment' && row.amountReceived === 3000);
      expect(secondEntry, 'The second payment entry must exist before it can be corrected').toBeTruthy();
      if (!secondEntry) return;

      const correction = await correctCasePayment(token, fixture.caseId, secondEntry.paymentId, {
        correctedAmount: 1000,
        reason: 'Second payment corrected',
        note: 'Adjusted middle payment',
      });
      expect(correction.status, 'Correcting the second of three payment entries must succeed').toBe(200);

      const state = await getCaseState(fixture.caseId);
      expect(state.paymentTotalReceived).toBe(4000);
      expect(state.paymentOutstanding).toBe(6000);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  test('PC-07 Write-off clears outstanding to zero', async () => {
    test.skip(!process.env.TEST_DB_URL, 'TEST_DB_URL must be set to verify write-off math');

    const fixture = await seedPaymentCaseFixture({ prefix: 'PC07', receivePayment: true });

    try {
      await seedDue(fixture.caseId, 6000);
      const response = await writeOffCasePayment(token, fixture.caseId, 'Write off remaining receivable');
      expect(response.status, 'Writing off a case payment must succeed').toBe(200);
      const state = await getCaseState(fixture.caseId);
      expect(state.paymentStatus).toBe('WrittenOff');
      expect(state.paymentOutstanding).toBe(0);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  test('PC-08 Reverse write-off restores outstanding', async () => {
    test.skip(!process.env.TEST_DB_URL, 'TEST_DB_URL must be set to verify write-off reversal math');

    const fixture = await seedPaymentCaseFixture({ prefix: 'PC08', receivePayment: true });

    try {
      await seedDue(fixture.caseId, 6000);
      await writeOffCasePayment(token, fixture.caseId, 'Initial write off');
      const reverse = await reverseWriteOffCasePayment(token, fixture.caseId);
      expect(reverse.status, 'Reversing a write-off must succeed').toBe(200);
      const state = await getCaseState(fixture.caseId);
      expect(state.paymentStatus).toBe('Pending');
      expect(state.paymentOutstanding).toBe(6000);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  test('PC-10 Voided entries excluded from all totals', async () => {
    test.skip(!process.env.TEST_DB_URL, 'TEST_DB_URL must be set to verify correction totals');

    const fixture = await seedPaymentCaseFixture({ prefix: 'PC10', receivePayment: true });

    try {
      await seedDue(fixture.caseId, 10000);
      await seedPayment(fixture.caseId, 10000, 4000, 'Original amount');
      const original = (await getCasePaymentHistory(fixture.caseId)).find((row) => row.entryType === 'payment' && row.amountReceived === 4000);
      expect(original, 'The original payment entry must exist before it can be corrected').toBeTruthy();
      if (!original) return;

      await correctCasePayment(token, fixture.caseId, original.paymentId, {
        correctedAmount: 1000,
        reason: 'Correcting original amount',
        note: 'Corrected to 1000',
      });

      const state = await getCaseState(fixture.caseId);
      expect(state.paymentTotalReceived, 'Only the non-voided replacement entry must contribute to the running totals').toBe(1000);
      expect(state.paymentOutstanding, 'Only the non-voided replacement entry must affect the outstanding amount').toBe(9000);
    } finally {
      await cleanupFixture(fixture);
    }
  });
});

test.describe('Payment History Ledger', () => {
  test('PH-01 History sorted newest first', async ({ caseDetailPage }) => {
    test.skip(!process.env.TEST_DB_URL, 'TEST_DB_URL must be set to verify payment history ordering');

    const fixture = await seedPaymentCaseFixture({ prefix: 'PH01', receivePayment: true });

    try {
      await seedDue(fixture.caseId, 10000, 'one');
      await seedPayment(fixture.caseId, 10000, 2000, 'two');
      await seedPayment(fixture.caseId, 10000, 1000, 'three');
      const history = await getCasePaymentHistory(fixture.caseId);

      const newest = new Date('2026-05-03T12:00:00.000Z');
      const middle = new Date('2026-05-02T12:00:00.000Z');
      const oldest = new Date('2026-05-01T12:00:00.000Z');
      await updatePaymentEntryCreatedAt(history[0].paymentId, newest);
      await updatePaymentEntryCreatedAt(history[1].paymentId, middle);
      await updatePaymentEntryCreatedAt(history[2].paymentId, oldest);

      await caseDetailPage.navigate(fixture.caseId);
      await caseDetailPage.expectPaymentHistoryNewestFirst([/thr/i, /two/i, /one/i]);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  test('PH-02 Entry types labelled correctly', async ({ caseDetailPage }) => {
    const fixture = await seedPaymentCaseFixture({ prefix: 'PH02', receivePayment: true });

    try {
      await seedDue(fixture.caseId, 10000, 'due');
      await seedPayment(fixture.caseId, 10000, 3000, 'pay');
      const paymentEntry = (await getCasePaymentHistory(fixture.caseId)).find((row) => row.entryType === 'payment' && row.amountReceived === 3000);
      expect(paymentEntry).toBeTruthy();
      if (!paymentEntry) return;
      await correctCasePayment(token, fixture.caseId, paymentEntry.paymentId, {
        correctedAmount: 2000,
        reason: 'Correction reason',
        note: 'corr',
      });

      await caseDetailPage.navigate(fixture.caseId);
      await caseDetailPage.expectPaymentHistoryContains(/Due Upd\./i);
      await caseDetailPage.expectPaymentHistoryContains(/Payment/i);
      await caseDetailPage.expectPaymentHistoryContains(/Correction/i);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  test('PH-03 Voided entries show strikethrough', async ({ caseDetailPage }) => {
    const fixture = await seedPaymentCaseFixture({ prefix: 'PH03', receivePayment: true });

    try {
      await seedDue(fixture.caseId, 10000);
      await seedPayment(fixture.caseId, 10000, 5000, 'wrong');
      const wrong = (await getCasePaymentHistory(fixture.caseId)).find((row) => row.entryType === 'payment' && row.amountReceived === 5000);
      expect(wrong).toBeTruthy();
      if (!wrong) return;
      await correctCasePayment(token, fixture.caseId, wrong.paymentId, {
        correctedAmount: 500,
        reason: 'Wrong amount',
        note: 'fix',
      });

      await caseDetailPage.navigate(fixture.caseId);
      await caseDetailPage.expectPaymentHistoryVoided(1);
      await caseDetailPage.expectPaymentHistoryStruckThrough(1);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  test('PH-04 Write-off entry labelled', async ({ caseDetailPage }) => {
    const fixture = await seedPaymentCaseFixture({ prefix: 'PH04', receivePayment: true });

    try {
      await seedDue(fixture.caseId, 6000);
      await writeOffCasePayment(token, fixture.caseId, 'Write-off history label');
      await caseDetailPage.navigate(fixture.caseId);
      await caseDetailPage.expectPaymentHistoryContains(/Written Off/i);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  test('PH-05 Note tooltip shows full text', async ({ caseDetailPage }) => {
    const fixture = await seedPaymentCaseFixture({ prefix: 'PH05', receivePayment: true });
    const note = 'This is a long note explaining the payment collection details.';

    try {
      await seedDue(fixture.caseId, 10000);
      await seedPayment(fixture.caseId, 10000, 3000, note);
      await caseDetailPage.navigate(fixture.caseId);
      await caseDetailPage.expectPaymentHistoryTooltip(note);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  test('PH-06 Receipt icon clickable', async ({ caseDetailPage }) => {
    const fixture = await seedPaymentCaseFixture({ prefix: 'PH06', receivePayment: true });
    const receiptName = `ph06-${Date.now()}.txt`;

    try {
      await caseDetailPage.navigate(fixture.caseId);
      await caseDetailPage.updateTotalDue('1000');
      await caseDetailPage.recordPayment({
        amount: '500',
        note: 'Receipt history test',
        receipt: {
          name: receiptName,
          mimeType: 'text/plain',
          buffer: Buffer.from('receipt-clickable', 'utf8'),
        },
      });
      await caseDetailPage.expectPaymentReceiptNamed(receiptName);
      const popup = await caseDetailPage.openPaymentReceipt(0);
      expect(popup.url(), 'Clicking the payment-history receipt icon must open the receipt in a new tab').toMatch(/^https?:\/\//i);
      await popup.close().catch(() => {});
    } finally {
      await cleanupFixture(fixture);
    }
  });
});

test.describe('Write Off', () => {
  test('WO-01 Write Off button visible — outstanding case', async ({ caseDetailPage }) => {
    const fixture = await seedPaymentCaseFixture({ prefix: 'WO01', receivePayment: true });

    try {
      await caseDetailPage.navigate(fixture.caseId);
      await caseDetailPage.updateTotalDue('10000');
      await caseDetailPage.expectWriteOffVisible();
    } finally {
      await cleanupFixture(fixture);
    }
  });

  test('WO-02 Write Off button hidden — Paid case', async ({ caseDetailPage }) => {
    const fixture = await seedPaymentCaseFixture({ prefix: 'WO02', receivePayment: true });

    try {
      await caseDetailPage.navigate(fixture.caseId);
      await caseDetailPage.updateTotalDue('10000');
      await caseDetailPage.recordPayment({ amount: '10000', note: 'Paid before write-off visibility check' });
      await caseDetailPage.expectWriteOffHidden();
    } finally {
      await cleanupFixture(fixture);
    }
  });

  test('WO-03 Write Off requires reason', async ({ caseDetailPage, page }) => {
    const fixture = await seedPaymentCaseFixture({ prefix: 'WO03', receivePayment: true });

    try {
      await caseDetailPage.navigate(fixture.caseId);
      await caseDetailPage.updateTotalDue('6000');
      await caseDetailPage.openWriteOffModal();
      await expect(
        page.getByRole('dialog').getByRole('button', { name: /Confirm Write Off/i }),
        'Confirm Write Off must stay disabled until a reason is entered',
      ).toBeDisabled();
    } finally {
      await cleanupFixture(fixture);
    }
  });

  test('WO-04 Write Off sets status and zeroes outstanding', async ({ caseDetailPage }) => {
    test.skip(!process.env.TEST_DB_URL, 'TEST_DB_URL must be set to verify write-off state changes');

    const fixture = await seedPaymentCaseFixture({ prefix: 'WO04', receivePayment: true });

    try {
      await caseDetailPage.navigate(fixture.caseId);
      await caseDetailPage.updateTotalDue('6000');
      await caseDetailPage.writeOff('Bad debt');
      await caseDetailPage.expectPaymentStatusBadge(/WrittenOff/i);

      const state = await getCaseState(fixture.caseId);
      expect(state.paymentStatus).toBe('WrittenOff');
      expect(state.paymentOutstanding).toBe(0);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  test('WO-05 Write Off adds ledger entry', async () => {
    test.skip(!process.env.TEST_DB_URL, 'TEST_DB_URL must be set to verify write-off ledger entries');

    const fixture = await seedPaymentCaseFixture({ prefix: 'WO05', receivePayment: true });

    try {
      await seedDue(fixture.caseId, 6000);
      await writeOffCasePayment(token, fixture.caseId, 'Ledger write-off');
      const history = await getCasePaymentHistory(fixture.caseId);
      expect(history[0]?.entryType, 'Writing off a case must add a write_off ledger entry at the top of the history').toBe('write_off');
    } finally {
      await cleanupFixture(fixture);
    }
  });

  test('WO-06 Reverse Write-Off restores status', async () => {
    test.skip(!process.env.TEST_DB_URL, 'TEST_DB_URL must be set to verify write-off reversal state');

    const fixture = await seedPaymentCaseFixture({ prefix: 'WO06', receivePayment: true });

    try {
      await seedDue(fixture.caseId, 6000);
      await writeOffCasePayment(token, fixture.caseId, 'Write off before reversal');
      await reverseWriteOffCasePayment(token, fixture.caseId);
      const state = await getCaseState(fixture.caseId);
      expect(state.paymentStatus).toBe('Pending');
      expect(state.paymentOutstanding).toBe(6000);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  test('WO-07 Reversed write-off entry marked voided', async ({ caseDetailPage }) => {
    test.skip(!process.env.TEST_DB_URL, 'TEST_DB_URL must be set to verify write-off reversal history');

    const fixture = await seedPaymentCaseFixture({ prefix: 'WO07', receivePayment: true });

    try {
      await seedDue(fixture.caseId, 6000);
      await writeOffCasePayment(token, fixture.caseId, 'Write off to reverse');
      await reverseWriteOffCasePayment(token, fixture.caseId);
      await caseDetailPage.navigate(fixture.caseId);
      await caseDetailPage.expectPaymentHistoryContains(/Voided/i);
      const history = await getCasePaymentHistory(fixture.caseId);
      expect(history.some((row) => row.entryType === 'write_off' && row.isVoided), 'Reversing the write-off must void the most recent write_off entry').toBe(true);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  test('WO-10 Write-off amount correctly captured', async () => {
    test.skip(!process.env.TEST_DB_URL, 'TEST_DB_URL must be set to verify write-off ledger amounts');

    const fixture = await seedPaymentCaseFixture({ prefix: 'WO10', receivePayment: true });

    try {
      await seedDue(fixture.caseId, 6000);
      await writeOffCasePayment(token, fixture.caseId, 'Capture written-off amount');
      const history = await getCasePaymentHistory(fixture.caseId);
      const writeOffEntry = history.find((row) => row.entryType === 'write_off' && !row.isVoided);
      expect(writeOffEntry, 'The write-off ledger entry must exist after writing off the case').toBeTruthy();
      expect(writeOffEntry?.outstanding, 'The write-off ledger entry must preserve the forgiven outstanding amount for reporting').toBe(6000);
    } finally {
      await cleanupFixture(fixture);
    }
  });
});
