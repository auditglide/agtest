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
  getPaymentsDue,
  reverseWriteOffCasePayment,
  writeOffCasePayment,
} from '../../helpers/payment.helper';
import {
  createTemporaryUser,
  deleteTemporaryUser,
  disconnectTestDb,
  getAdminTestContext,
} from '../../helpers/test-db.helper';
import {
  closeCaseAsUser,
  decodeJwtSubject,
  relogin,
  validPan,
} from '../../helpers/payment-test-utils';

let token = '';
let branchId = '';
let requesterUserId = '';

async function seedTodoPaymentCase(prefix: string, input?: {
  closeCase?: boolean;
}) {
  const runId = Date.now();
  const compliance = await seedComplianceType(token, {
    type: `${prefix}-CT-${runId}`,
    frequency: 'Monthly',
    receivePayment: true,
  });
  const client = await seedClient(token, {
    name: `${prefix}-Client-${runId}`,
    pan: validPan(prefix, runId % 999),
    branchId,
    complianceTypeIds: [compliance.complianceTypeId],
  });
  const caseId = await findCaseIdForClient(token, branchId, client.clientId);
  expect(caseId, `The ${prefix} fixture must create a case`).toBeTruthy();

  if (input?.closeCase) {
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

async function seedOutstandingBalance(caseId: string, totalDue: number) {
  const dueResponse = await addCasePayment(token, caseId, {
    totalDue,
    amountReceived: 0,
    note: 'Seeded outstanding balance',
  });
  expect(dueResponse.status, 'Seeding an outstanding balance must succeed before verifying Payments Due visibility').toBe(200);
}

test.beforeAll(async () => {
  const cachedAuth = getCachedApiAuth();
  if (!cachedAuth) {
    throw new Error('Missing cached API auth. Run the Playwright setup project before Payments Due tests.');
  }
  ({ token, branchId } = cachedAuth);
  requesterUserId = decodeJwtSubject(token);
  if (!requesterUserId) {
    throw new Error('Could not decode the current user id from the cached API token for Payments Due fixtures.');
  }
});

test.afterAll(async () => {
  await disconnectTestDb();
});

test.describe('My To-Do — Payments Due', () => {
  test('TD-01 Appears for workOnCases users', async ({ page, todoPage }) => {
    test.skip(!process.env.TEST_DB_URL, 'TEST_DB_URL must be set to create a branch-scoped workOnCases user');

    const fixture = await seedTodoPaymentCase('TD01', { closeCase: true });
    const adminContext = await getAdminTestContext(branchId);
    const tempUser = await createTemporaryUser({
      firmId: adminContext.firmId,
      branchId,
      createdByUserId: adminContext.adminUserId,
      email: `td01.${Date.now()}@example.com`,
      password: 'TempPass123!',
      name: 'TD01 Worker',
      access: {
        case_read: true,
        work_on_cases: true,
      },
    });

    try {
      await seedOutstandingBalance(fixture.caseId, 5000);
      await relogin(page, tempUser.email, tempUser.password);
      await todoPage.navigate();
      await todoPage.expectPaymentsDueVisible();
      await todoPage.expectPaymentsDueCaseVisible(fixture.clientName);
    } finally {
      await relogin(page, process.env.TEST_ADMIN_EMAIL ?? '', process.env.TEST_ADMIN_PASSWORD ?? '');
      await deleteTemporaryUser(tempUser.userId);
      await cleanupFixture(fixture);
    }
  });

  test('TD-02 Hidden from non-workOnCases users', async ({ page, todoPage }) => {
    test.skip(!process.env.TEST_DB_URL, 'TEST_DB_URL must be set to create a branch-scoped non-workOnCases user');

    const fixture = await seedTodoPaymentCase('TD02', { closeCase: true });
    const adminContext = await getAdminTestContext(branchId);
    const tempUser = await createTemporaryUser({
      firmId: adminContext.firmId,
      branchId,
      createdByUserId: adminContext.adminUserId,
      email: `td02.${Date.now()}@example.com`,
      password: 'TempPass123!',
      name: 'TD02 Verifier',
      access: {
        case_read: true,
        verify_cases: true,
      },
    });

    try {
      await seedOutstandingBalance(fixture.caseId, 5000);
      await relogin(page, tempUser.email, tempUser.password);
      await todoPage.navigate();
      await todoPage.expectPaymentsDueHidden();
    } finally {
      await relogin(page, process.env.TEST_ADMIN_EMAIL ?? '', process.env.TEST_ADMIN_PASSWORD ?? '');
      await deleteTemporaryUser(tempUser.userId);
      await cleanupFixture(fixture);
    }
  });

  test('TD-03 Shows closed + payment_required + not Paid', async ({ todoPage }) => {
    const fixture = await seedTodoPaymentCase('TD03', { closeCase: true });

    try {
      await seedOutstandingBalance(fixture.caseId, 5000);
      await todoPage.navigate();
      await todoPage.expectPaymentsDueVisible();
      await todoPage.expectPaymentsDueCaseVisible(fixture.clientName);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  test('TD-04 Disappears when fully Paid', async ({ todoPage }) => {
    const fixture = await seedTodoPaymentCase('TD04', { closeCase: true });

    try {
      await seedOutstandingBalance(fixture.caseId, 5000);
      const paidResponse = await addCasePayment(token, fixture.caseId, {
        totalDue: 5000,
        amountReceived: 5000,
        note: 'Paid in full',
      });
      expect(paidResponse.status, 'Recording a full payment must succeed before verifying Payments Due removal').toBe(200);

      await todoPage.navigate();
      await todoPage.expectPaymentsDueCaseHidden(fixture.clientName);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  test('TD-05 Written-off cases hidden by default', async ({ todoPage }) => {
    const fixture = await seedTodoPaymentCase('TD05', { closeCase: true });

    try {
      await seedOutstandingBalance(fixture.caseId, 5000);
      const writeOff = await writeOffCasePayment(token, fixture.caseId, 'Written off before My To-Do visibility check');
      expect(writeOff.status, 'Writing off a case must succeed before it can be hidden from Payments Due').toBe(200);

      await todoPage.navigate();
      await todoPage.expectPaymentsDueVisible();
      await todoPage.expectPaymentsDueCaseHidden(fixture.clientName);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  test('TD-06 Toggle shows written-off cases', async ({ todoPage }) => {
    const fixture = await seedTodoPaymentCase('TD06', { closeCase: true });

    try {
      await seedOutstandingBalance(fixture.caseId, 5000);
      const writeOff = await writeOffCasePayment(token, fixture.caseId, 'Written off for toggle visibility');
      expect(writeOff.status, 'Writing off a case must succeed before it can be revealed via the toggle').toBe(200);

      await todoPage.navigate();
      await todoPage.toggleShowWrittenOff(true);
      await todoPage.expectPaymentsDueCaseVisible(fixture.clientName);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  test('TD-07 Client filter applies to Payments Due', async ({ todoPage }) => {
    const fixtureA = await seedTodoPaymentCase('TD07A', { closeCase: true });
    const fixtureB = await seedTodoPaymentCase('TD07B', { closeCase: true });

    try {
      await seedOutstandingBalance(fixtureA.caseId, 5000);
      await seedOutstandingBalance(fixtureB.caseId, 7000);

      await todoPage.navigate();
      await todoPage.selectClient(fixtureA.clientName);
      await todoPage.expectPaymentsDueCaseVisible(fixtureA.clientName);
      await todoPage.expectPaymentsDueCaseHidden(fixtureB.clientName);
    } finally {
      await cleanupFixture(fixtureA);
      await cleanupFixture(fixtureB);
    }
  });

  test('TD-08 Period filter does NOT apply to Payments Due', async ({ todoPage }) => {
    const fixture = await seedTodoPaymentCase('TD08', { closeCase: true });

    try {
      await seedOutstandingBalance(fixture.caseId, 5000);
      await todoPage.navigate();
      await todoPage.selectPeriod('last_month');
      await todoPage.expectPaymentsDueCaseVisible(fixture.clientName);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  test('TD-09 Open case (not Closed) does NOT appear', async ({ todoPage }) => {
    const fixture = await seedTodoPaymentCase('TD09', { closeCase: false });

    try {
      await seedOutstandingBalance(fixture.caseId, 5000);
      await todoPage.navigate();
      await todoPage.expectPaymentsDueCaseHidden(fixture.clientName);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  test('PC-09 Payments Due only shows non-Paid, non-WrittenOff', async () => {
    const partialCase = await seedTodoPaymentCase('PC09A', { closeCase: true });
    const paidCase = await seedTodoPaymentCase('PC09B', { closeCase: true });
    const writtenOffCase = await seedTodoPaymentCase('PC09C', { closeCase: true });

    try {
      await seedOutstandingBalance(partialCase.caseId, 5000);

      await seedOutstandingBalance(paidCase.caseId, 5000);
      const paid = await addCasePayment(token, paidCase.caseId, {
        totalDue: 5000,
        amountReceived: 5000,
        note: 'Fully paid before list check',
      });
      expect(paid.status).toBe(200);

      await seedOutstandingBalance(writtenOffCase.caseId, 5000);
      const writeOff = await writeOffCasePayment(token, writtenOffCase.caseId, 'Written off before list check');
      expect(writeOff.status).toBe(200);

      const dueResponse = await getPaymentsDue(token, branchId);
      expect(dueResponse.status, 'The Payments Due API must be readable when verifying which closed payment cases remain in the queue').toBe(200);

      const caseIds = (dueResponse.data ?? []).map((row) => row.caseId);
      expect(caseIds).toContain(partialCase.caseId);
      expect(caseIds).not.toContain(paidCase.caseId);
      expect(caseIds).not.toContain(writtenOffCase.caseId);
    } finally {
      await cleanupFixture(partialCase);
      await cleanupFixture(paidCase);
      await cleanupFixture(writtenOffCase);
    }
  });

  test('WO-08 Written-off case leaves Payments Due', async ({ todoPage }) => {
    const fixture = await seedTodoPaymentCase('WO08', { closeCase: true });

    try {
      await seedOutstandingBalance(fixture.caseId, 5000);
      const writeOff = await writeOffCasePayment(token, fixture.caseId, 'Written off from My To-Do');
      expect(writeOff.status).toBe(200);

      await todoPage.navigate();
      await todoPage.expectPaymentsDueCaseHidden(fixture.clientName);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  test('WO-09 Reversed write-off returns to Payments Due', async ({ todoPage }) => {
    const fixture = await seedTodoPaymentCase('WO09', { closeCase: true });

    try {
      await seedOutstandingBalance(fixture.caseId, 5000);
      await writeOffCasePayment(token, fixture.caseId, 'Write off before reversal');
      const reverse = await reverseWriteOffCasePayment(token, fixture.caseId);
      expect(reverse.status).toBe(200);

      await todoPage.navigate();
      await todoPage.expectPaymentsDueCaseVisible(fixture.clientName);
    } finally {
      await cleanupFixture(fixture);
    }
  });
});
