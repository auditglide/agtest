import { test, expect } from '../../fixtures/auth-fixture';
import {
  deleteBranch,
  deleteClient,
  deleteComplianceType,
  getCachedApiAuth,
  seedBranch,
  seedClient,
  seedComplianceType,
} from '../../helpers/api-seed.helper';
import {
  addCasePayment,
  correctCasePayment,
  writeOffCasePayment,
} from '../../helpers/payment.helper';
import {
  createTemporaryUser,
  deleteTemporaryUser,
  disconnectTestDb,
  getAdminTestContext,
  getCasePaymentHistory,
  getCaseState,
  updatePaymentEntryCreatedAt,
} from '../../helpers/test-db.helper';
import {
  closeCaseAsUser,
  decodeJwtSubject,
  inr,
  relogin,
  validPan,
} from '../../helpers/payment-test-utils';

let token = '';
let branchId = '';
let requesterUserId = '';

async function seedPaymentsBranchFixture(input: {
  prefix: string;
  branchId: string;
  amountDue: number;
  amountReceived?: number;
  writeOff?: boolean;
  complianceTypeName?: string;
  clientName?: string;
}) {
  const runId = Date.now();
  const compliance = await seedComplianceType(token, {
    type: input.complianceTypeName ?? `${input.prefix}-CT-${runId}`,
    frequency: 'Monthly',
    receivePayment: true,
  });
  const client = await seedClient(token, {
    name: input.clientName ?? `${input.prefix}-Client-${runId}`,
    pan: validPan(input.prefix, runId % 999),
    branchId: input.branchId,
    complianceTypeIds: [compliance.complianceTypeId],
  });

  const caseId = await import('../../helpers/api-seed.helper').then(({ findCaseIdForClient }) =>
    findCaseIdForClient(token, input.branchId, client.clientId));
  expect(caseId, `The ${input.prefix} fixture must create a case before the payments-page assertions run`).toBeTruthy();

  await closeCaseAsUser(token, caseId, requesterUserId);
  const due = await addCasePayment(token, caseId, {
    totalDue: input.amountDue,
    amountReceived: 0,
    note: `${input.prefix} due`,
  });
  expect(due.status, `The ${input.prefix} fixture must seed the initial outstanding balance`).toBe(200);

  if ((input.amountReceived ?? 0) > 0) {
    const payment = await addCasePayment(token, caseId, {
      totalDue: input.amountDue,
      amountReceived: input.amountReceived ?? 0,
      note: `${input.prefix} payment`,
    });
    expect(payment.status, `The ${input.prefix} fixture must seed the received amount before the payments-page assertions run`).toBe(200);
  }

  if (input.writeOff) {
    const writeOff = await writeOffCasePayment(token, caseId, `${input.prefix} written off`);
    expect(writeOff.status, `The ${input.prefix} fixture must be writable off for payments-page assertions`).toBe(200);
  }

  return {
    branchId: input.branchId,
    ctId: compliance.complianceTypeId,
    ctName: compliance.type,
    clientId: client.clientId,
    clientName: client.name,
    caseId,
  };
}

async function cleanupBranchFixture(
  fixture: { clientId: string; ctId: string },
  extra?: { branchId?: string },
) {
  await deleteClient(token, fixture.clientId);
  await deleteComplianceType(token, fixture.ctId);
  if (extra?.branchId) {
    await deleteBranch(token, extra.branchId);
  }
}

test.beforeAll(async () => {
  const cachedAuth = getCachedApiAuth();
  if (!cachedAuth) {
    throw new Error('Missing cached API auth. Run the Playwright setup project before payments-page tests.');
  }
  ({ token, branchId } = cachedAuth);
  requesterUserId = decodeJwtSubject(token);
  if (!requesterUserId) {
    throw new Error('Could not decode the current user id from the cached API token for payments-page fixtures.');
  }
});

test.afterAll(async () => {
  await disconnectTestDb();
});

test.describe('Payments Page', () => {
  test('PP-01 Visible only to verifyCases users', async ({ page, paymentsPage }) => {
    test.skip(!process.env.TEST_DB_URL, 'TEST_DB_URL must be set to create a workOnCases-only user for payments-nav checks');

    const adminContext = await getAdminTestContext(branchId);
    const tempUser = await createTemporaryUser({
      firmId: adminContext.firmId,
      branchId,
      createdByUserId: adminContext.adminUserId,
      email: `pp01.${Date.now()}@example.com`,
      password: 'TempPass123!',
      name: 'PP01 Worker',
      access: {
        case_read: true,
        work_on_cases: true,
      },
    });

    try {
      await relogin(page, tempUser.email, tempUser.password);
      await page.goto('/dashboard');
      await paymentsPage.expectNavHidden();
    } finally {
      await relogin(page, process.env.TEST_ADMIN_EMAIL ?? '', process.env.TEST_ADMIN_PASSWORD ?? '');
      await deleteTemporaryUser(tempUser.userId);
    }
  });

  test('PP-02 Visible to verifyCases users', async ({ page, paymentsPage }) => {
    test.skip(!process.env.TEST_DB_URL, 'TEST_DB_URL must be set to create a verifyCases user for payments-nav checks');

    const adminContext = await getAdminTestContext(branchId);
    const tempUser = await createTemporaryUser({
      firmId: adminContext.firmId,
      branchId,
      createdByUserId: adminContext.adminUserId,
      email: `pp02.${Date.now()}@example.com`,
      password: 'TempPass123!',
      name: 'PP02 Verifier',
      access: {
        case_read: true,
        verify_cases: true,
      },
    });

    try {
      await relogin(page, tempUser.email, tempUser.password);
      await page.goto('/dashboard');
      await paymentsPage.expectNavVisible();
      await paymentsPage.navigate();
      await paymentsPage.expectLoaded();
    } finally {
      await relogin(page, process.env.TEST_ADMIN_EMAIL ?? '', process.env.TEST_ADMIN_PASSWORD ?? '');
      await deleteTemporaryUser(tempUser.userId);
    }
  });

  test('PP-03 Summary tiles always current (no date filter)', async ({ paymentsPage }) => {
    await paymentsPage.navigate();
    const before = await paymentsPage.getSummaryCardText('Received This Month');
    await paymentsPage.selectPeriod('Custom Range');
    await paymentsPage.setCustomRange('2025-01-01', '2025-01-31');
    const after = await paymentsPage.getSummaryCardText('Received This Month');
    expect(after, 'Changing the breakdown period filter must not change the always-current summary tiles').toBe(before);
  });

  test('PP-04 Received tiles respect date filter', async ({ paymentsPage }) => {
    test.skip(!process.env.TEST_DB_URL, 'TEST_DB_URL must be set to backdate payment entries for date-filter checks');

    const branch = await seedBranch(token, { name: `PP04-Branch-${Date.now()}` });
    const currentFixture = await seedPaymentsBranchFixture({
      prefix: 'PP04Current',
      branchId: branch.branchId,
      amountDue: 4000,
      amountReceived: 4000,
      complianceTypeName: `PP04-Current-CT-${Date.now()}`,
    });
    const oldFixture = await seedPaymentsBranchFixture({
      prefix: 'PP04Old',
      branchId: branch.branchId,
      amountDue: 5000,
      amountReceived: 5000,
      complianceTypeName: `PP04-Old-CT-${Date.now()}`,
    });

    try {
      const oldPayment = (await getCasePaymentHistory(oldFixture.caseId)).find((row) => row.entryType === 'payment' && !row.isVoided);
      expect(oldPayment, 'The older fixture must have a payment entry to backdate out of the current month').toBeTruthy();
      if (!oldPayment) return;
      await updatePaymentEntryCreatedAt(oldPayment.paymentId, new Date('2025-01-15T10:00:00.000Z'));

      await paymentsPage.navigate();
      await paymentsPage.switchBranch(branch.branchId);
      await paymentsPage.switchTab('By Compliance');
      await paymentsPage.expectTableRowVisible(currentFixture.ctName);
      await paymentsPage.expectTableRowHidden(oldFixture.ctName);

      await paymentsPage.selectPeriod('Custom Range');
      await paymentsPage.setCustomRange('2025-01-01', '2025-01-31');
      await paymentsPage.expectTableRowVisible(oldFixture.ctName);
      await paymentsPage.expectTableRowHidden(currentFixture.ctName);
    } finally {
      await cleanupBranchFixture(currentFixture);
      await cleanupBranchFixture(oldFixture, { branchId: branch.branchId });
    }
  });

  test('PP-05 Total Outstanding excludes Paid and WrittenOff', async ({ paymentsPage }) => {
    const branch = await seedBranch(token, { name: `PP05-Branch-${Date.now()}` });
    const partial = await seedPaymentsBranchFixture({ prefix: 'PP05Partial', branchId: branch.branchId, amountDue: 5000, amountReceived: 3000 });
    const pending = await seedPaymentsBranchFixture({ prefix: 'PP05Pending', branchId: branch.branchId, amountDue: 2000 });
    const paid = await seedPaymentsBranchFixture({ prefix: 'PP05Paid', branchId: branch.branchId, amountDue: 4000, amountReceived: 4000 });
    const writtenOff = await seedPaymentsBranchFixture({ prefix: 'PP05WO', branchId: branch.branchId, amountDue: 6000, writeOff: true });

    try {
      await paymentsPage.navigate();
      await paymentsPage.switchBranch(branch.branchId);
      await paymentsPage.expectSummaryCard('Total Outstanding', inr(4000));
    } finally {
      await cleanupBranchFixture(partial);
      await cleanupBranchFixture(pending);
      await cleanupBranchFixture(paid);
      await cleanupBranchFixture(writtenOff, { branchId: branch.branchId });
    }
  });

  test('PP-06 Written Off tile shows total forgiven amount + case count', async ({ paymentsPage }) => {
    const branch = await seedBranch(token, { name: `PP06-Branch-${Date.now()}` });
    const caseA = await seedPaymentsBranchFixture({ prefix: 'PP06A', branchId: branch.branchId, amountDue: 3000, writeOff: true });
    const caseB = await seedPaymentsBranchFixture({ prefix: 'PP06B', branchId: branch.branchId, amountDue: 5000, writeOff: true });

    try {
      await paymentsPage.navigate();
      await paymentsPage.switchBranch(branch.branchId);
      await paymentsPage.expectSummaryCard('Written Off', inr(8000), /2 case/i);
    } finally {
      await cleanupBranchFixture(caseA);
      await cleanupBranchFixture(caseB, { branchId: branch.branchId });
    }
  });

  test('PP-07 Branch selector filters all data', async ({ paymentsPage }) => {
    const branchA = await seedBranch(token, { name: `PP07-Branch-A-${Date.now()}` });
    const branchB = await seedBranch(token, { name: `PP07-Branch-B-${Date.now()}` });
    const fixtureA = await seedPaymentsBranchFixture({ prefix: 'PP07A', branchId: branchA.branchId, amountDue: 4000, amountReceived: 4000 });
    const fixtureB = await seedPaymentsBranchFixture({ prefix: 'PP07B', branchId: branchB.branchId, amountDue: 5000, amountReceived: 5000 });

    try {
      await paymentsPage.navigate();
      await paymentsPage.switchTab('By Client');
      await paymentsPage.switchBranch(branchA.branchId);
      await paymentsPage.expectTableRowVisible(fixtureA.clientName);
      await paymentsPage.expectTableRowHidden(fixtureB.clientName);

      await paymentsPage.switchBranch(branchB.branchId);
      await paymentsPage.expectTableRowVisible(fixtureB.clientName);
      await paymentsPage.expectTableRowHidden(fixtureA.clientName);
    } finally {
      await cleanupBranchFixture(fixtureA, { branchId: branchA.branchId });
      await cleanupBranchFixture(fixtureB, { branchId: branchB.branchId });
    }
  });

  test('PP-08 By Compliance groups by compliance type', async ({ paymentsPage }) => {
    const branch = await seedBranch(token, { name: `PP08-Branch-${Date.now()}` });
    const gst = await seedPaymentsBranchFixture({ prefix: 'PP08GST', branchId: branch.branchId, amountDue: 4000, amountReceived: 4000, complianceTypeName: `GST Fees ${Date.now()}` });
    const tds = await seedPaymentsBranchFixture({ prefix: 'PP08TDS', branchId: branch.branchId, amountDue: 6000, amountReceived: 2000, complianceTypeName: `TDS Filing ${Date.now()}` });

    try {
      await paymentsPage.navigate();
      await paymentsPage.switchBranch(branch.branchId);
      await paymentsPage.switchTab('By Compliance');
      await paymentsPage.expectTableRowVisible(gst.ctName);
      await paymentsPage.expectTableRowVisible(tds.ctName);
    } finally {
      await cleanupBranchFixture(gst);
      await cleanupBranchFixture(tds, { branchId: branch.branchId });
    }
  });

  test('PP-09 By Client groups by client', async ({ paymentsPage }) => {
    const branch = await seedBranch(token, { name: `PP09-Branch-${Date.now()}` });
    const clientA = await seedPaymentsBranchFixture({ prefix: 'PP09A', branchId: branch.branchId, amountDue: 4000, amountReceived: 4000, clientName: `PP09 Client A ${Date.now()}` });
    const clientB = await seedPaymentsBranchFixture({ prefix: 'PP09B', branchId: branch.branchId, amountDue: 5000, amountReceived: 2000, clientName: `PP09 Client B ${Date.now()}` });

    try {
      await paymentsPage.navigate();
      await paymentsPage.switchBranch(branch.branchId);
      await paymentsPage.switchTab('By Client');
      await paymentsPage.expectTableRowVisible(clientA.clientName);
      await paymentsPage.expectTableRowVisible(clientB.clientName);
    } finally {
      await cleanupBranchFixture(clientA);
      await cleanupBranchFixture(clientB, { branchId: branch.branchId });
    }
  });

  test('PP-10 Written Off Cases tab', async ({ paymentsPage }) => {
    const branch = await seedBranch(token, { name: `PP10-Branch-${Date.now()}` });
    const cases = await Promise.all([
      seedPaymentsBranchFixture({ prefix: 'PP10A', branchId: branch.branchId, amountDue: 3000, writeOff: true }),
      seedPaymentsBranchFixture({ prefix: 'PP10B', branchId: branch.branchId, amountDue: 5000, writeOff: true }),
      seedPaymentsBranchFixture({ prefix: 'PP10C', branchId: branch.branchId, amountDue: 7000, writeOff: true }),
    ]);

    try {
      await paymentsPage.navigate();
      await paymentsPage.switchBranch(branch.branchId);
      await paymentsPage.switchTab('Written Off Cases');
      for (const item of cases) {
        await paymentsPage.expectTableRowVisible(item.clientName);
      }
    } finally {
      await cleanupBranchFixture(cases[0]);
      await cleanupBranchFixture(cases[1]);
      await cleanupBranchFixture(cases[2], { branchId: branch.branchId });
    }
  });

  test('PP-11 Written Off Cases row navigates to View Case', async ({ paymentsPage, page }) => {
    const branch = await seedBranch(token, { name: `PP11-Branch-${Date.now()}` });
    const fixture = await seedPaymentsBranchFixture({ prefix: 'PP11', branchId: branch.branchId, amountDue: 4500, writeOff: true });

    try {
      await paymentsPage.navigate();
      await paymentsPage.switchBranch(branch.branchId);
      await paymentsPage.switchTab('Written Off Cases');
      await paymentsPage.clickWrittenOffRow(fixture.clientName);
      await expect(page, 'Clicking a Written Off Cases row must navigate to the corresponding case detail page').toHaveURL(new RegExp(`/cases/${fixture.caseId}(?:\\?.*)?$`));
    } finally {
      await cleanupBranchFixture(fixture, { branchId: branch.branchId });
    }
  });

  test('PP-12 Voided payment entries excluded from totals', async ({ paymentsPage, page }) => {
    test.skip(!process.env.TEST_DB_URL, 'TEST_DB_URL must be set to verify correction totals on the payments page');

    const branch = await seedBranch(token, { name: `PP12-Branch-${Date.now()}` });
    const fixture = await seedPaymentsBranchFixture({ prefix: 'PP12', branchId: branch.branchId, amountDue: 10000, amountReceived: 4000, clientName: `PP12 Client ${Date.now()}` });

    try {
      const original = (await getCasePaymentHistory(fixture.caseId)).find((row) => row.entryType === 'payment' && row.amountReceived === 4000);
      expect(original, 'The original payment entry must exist before correction totals can be verified on the payments page').toBeTruthy();
      if (!original) return;
      const correction = await correctCasePayment(token, fixture.caseId, original.paymentId, {
        correctedAmount: 1000,
        reason: 'Correcting the reported amount',
        note: 'Reduced to 1000',
      });
      expect(correction.status, 'Correcting the payment entry must succeed before loading the payments dashboard').toBe(200);

      const state = await getCaseState(fixture.caseId);
      expect(state.paymentTotalReceived, 'The case summary itself must already exclude the voided amount before the dashboard check').toBe(1000);

      await paymentsPage.navigate();
      await paymentsPage.switchBranch(branch.branchId);
      await paymentsPage.switchTab('By Client');
      await paymentsPage.expectTableRowVisible(fixture.clientName);
      await expect(
        page.locator('table tbody tr').filter({ hasText: fixture.clientName }).first(),
        'The By Client table must show the corrected received amount, not the voided original amount',
      ).toContainText(inr(1000));
    } finally {
      await cleanupBranchFixture(fixture, { branchId: branch.branchId });
    }
  });
});
