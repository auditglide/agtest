import { Buffer } from 'node:buffer';
import { test, expect } from '../../fixtures/auth-fixture';
import {
  assignClientToCompliance,
  deleteClient,
  deleteComplianceType,
  findCaseIdForClient,
  getCachedApiAuth,
  seedClient,
  seedComplianceType,
} from '../../helpers/api-seed.helper';
import {
  addCasePayment,
  uploadPaymentReceipt,
} from '../../helpers/payment.helper';
import { getClientPaymentHistory } from '../../helpers/payment.helper';
import { disconnectTestDb, listCasesForCompliance } from '../../helpers/test-db.helper';
import { validPan } from '../../helpers/payment-test-utils';

let token = '';
let branchId = '';

async function seedClientPaymentHistoryFixture(prefix: string) {
  const runId = Date.now();
  const ctA = await seedComplianceType(token, {
    type: `${prefix}-CT-A-${runId}`,
    frequency: 'Monthly',
    receivePayment: true,
  });
  const ctB = await seedComplianceType(token, {
    type: `${prefix}-CT-B-${runId}`,
    frequency: 'Monthly',
    receivePayment: true,
  });
  const client = await seedClient(token, {
    name: `${prefix}-Client-${runId}`,
    pan: validPan(prefix, runId % 999),
    branchId,
    complianceTypeIds: [ctA.complianceTypeId],
  });
  await assignClientToCompliance(token, ctB.complianceTypeId, [client.clientId]);

  const caseA = await findCaseIdForClient(token, branchId, client.clientId);
  expect(caseA, `The ${prefix} fixture must create at least one case for the client payment history tests`).toBeTruthy();

  // Seed the first case, then look up the second case directly from the compliance-backed case list.
  const dueA = await addCasePayment(token, caseA, {
    totalDue: 5000,
    amountReceived: 0,
    note: `${prefix} first due`,
  });
  expect(dueA.status).toBe(200);
  const payA = await addCasePayment(token, caseA, {
    totalDue: 5000,
    amountReceived: 2000,
    note: `${prefix} first payment`,
  });
  expect(payA.status).toBe(200);

  const ctBCases = await listCasesForCompliance({ complianceTypeId: ctB.complianceTypeId, includeClosed: true });
  const caseB = ctBCases.find((row) => row.clientId === client.clientId)?.caseId ?? '';
  expect(caseB, 'The second compliance type assignment must yield a distinct case for client payment history coverage').toBeTruthy();

  const dueB = await addCasePayment(token, caseB, {
    totalDue: 3000,
    amountReceived: 0,
    note: `${prefix} second due`,
  });
  expect(dueB.status).toBe(200);
  const payB = await addCasePayment(token, caseB, {
    totalDue: 3000,
    amountReceived: 3000,
    note: `${prefix} second payment`,
  });
  expect(payB.status).toBe(200);

  return {
    clientId: client.clientId,
    clientName: client.name,
    ctA,
    ctB,
    caseA,
    caseB,
  };
}

test.beforeAll(async () => {
  const cachedAuth = getCachedApiAuth();
  if (!cachedAuth) {
    throw new Error('Missing cached API auth. Run the Playwright setup project before client payment history tests.');
  }
  ({ token, branchId } = cachedAuth);
});

test.afterAll(async () => {
  await disconnectTestDb();
});

test.describe('Client Detail — Payment History', () => {
  test('CH-01 Payment history section visible', async ({ clientDetailPage }) => {
    const fixture = await seedClientPaymentHistoryFixture('CH01');

    try {
      await clientDetailPage.navigate(fixture.clientId, fixture.clientName);
      await clientDetailPage.expectPaymentHistoryVisible();
    } finally {
      await deleteClient(token, fixture.clientId);
      await deleteComplianceType(token, fixture.ctA.complianceTypeId);
      await deleteComplianceType(token, fixture.ctB.complianceTypeId);
    }
  });

  test('CH-02 Shows all payment entries across cases', async ({ clientDetailPage }) => {
    const fixture = await seedClientPaymentHistoryFixture('CH02');

    try {
      await clientDetailPage.navigate(fixture.clientId, fixture.clientName);
      await clientDetailPage.expectPaymentHistoryRowVisible(fixture.ctA.type);
      await clientDetailPage.expectPaymentHistoryRowVisible(fixture.ctB.type);
      await clientDetailPage.expectPaymentHistoryRowVisible(/₹2,000/);
      await clientDetailPage.expectPaymentHistoryRowVisible(/₹3,000/);
    } finally {
      await deleteClient(token, fixture.clientId);
      await deleteComplianceType(token, fixture.ctA.complianceTypeId);
      await deleteComplianceType(token, fixture.ctB.complianceTypeId);
    }
  });

  test('CH-03 Receipt icon clickable', async ({ clientDetailPage }) => {
    const fixture = await seedClientPaymentHistoryFixture('CH03');
    const receiptName = `ch03-receipt-${Date.now()}.txt`;

    try {
      const uploaded = await uploadPaymentReceipt(token, fixture.caseA, {
        name: receiptName,
        mimeType: 'text/plain',
        buffer: Buffer.from('client history receipt', 'utf8'),
      });
      const receiptPayment = await addCasePayment(token, fixture.caseA, {
        totalDue: 5000,
        amountReceived: 500,
        note: 'Receipt entry for client history',
        receiptS3Key: uploaded.s3Key,
        receiptFilename: uploaded.filename,
      });
      expect(receiptPayment.status).toBe(200);

      await clientDetailPage.navigate(fixture.clientId, fixture.clientName);
      await clientDetailPage.expectPaymentHistoryReceiptVisible(receiptName);
      const popup = await clientDetailPage.openPaymentHistoryReceipt(0);
      expect(popup.url(), 'Clicking the client-history receipt icon must open the stored receipt in a new tab').toMatch(/^https?:\/\//i);
      await popup.close().catch(() => {});
    } finally {
      await deleteClient(token, fixture.clientId);
      await deleteComplianceType(token, fixture.ctA.complianceTypeId);
      await deleteComplianceType(token, fixture.ctB.complianceTypeId);
    }
  });

  test('CH-04 Compliance and period shown per entry', async ({ clientDetailPage }) => {
    const fixture = await seedClientPaymentHistoryFixture('CH04');

    try {
      const history = await getClientPaymentHistory(token, fixture.clientId, { page: 1, limit: 20 }) as {
        data: {
          data: Array<{ periodLabel: string | null }>;
        };
      };
      const firstPeriod = history.data.data.find((row: { periodLabel: string | null }) => row.periodLabel)?.periodLabel ?? null;

      await clientDetailPage.navigate(fixture.clientId, fixture.clientName);
      await clientDetailPage.expectPaymentHistoryRowVisible(fixture.ctA.type);
      await clientDetailPage.expectPaymentHistoryRowVisible(fixture.ctB.type);
      if (firstPeriod) {
        await clientDetailPage.expectPaymentHistoryRowVisible(firstPeriod);
      }
    } finally {
      await deleteClient(token, fixture.clientId);
      await deleteComplianceType(token, fixture.ctA.complianceTypeId);
      await deleteComplianceType(token, fixture.ctB.complianceTypeId);
    }
  });
});
