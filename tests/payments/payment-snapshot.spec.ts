import { Buffer } from 'node:buffer';
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
import { createSubtype, runCaseGenerationForDate } from '../../helpers/payment.helper';
import {
  createClientComplianceMap,
  disconnectTestDb,
  getCaseState,
  getClientByName,
  getClientComplianceSubtypeCases,
  listCasesForCompliance,
} from '../../helpers/test-db.helper';
import { validPan } from '../../helpers/payment-test-utils';

let token = '';
let branchId = '';

function csvBuffer(rows: string[][]): Buffer {
  return Buffer.from(rows.map((row) => row.join(',')).join('\n'), 'utf8');
}

async function chooseVisibleOption(
  page: import('@playwright/test').Page,
  name: string | RegExp,
) {
  const option = page.getByRole('option', { name }).last();
  await expect(option, `Dropdown option "${name}" must be visible before selecting it`).toBeVisible();
  await option.evaluate((el) => {
    (el as HTMLElement).scrollIntoView({ block: 'nearest' });
    (el as HTMLElement).click();
  });
}

async function waitForCasesForClient(complianceTypeId: string, clientId: string, minimum = 1) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const rows = await listCasesForCompliance({ complianceTypeId, includeClosed: true });
    const matching = rows.filter((row) => row.clientId === clientId);
    if (matching.length >= minimum) {
      return matching;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return [];
}

test.beforeAll(async () => {
  const cachedAuth = getCachedApiAuth();
  if (!cachedAuth) {
    throw new Error('Missing cached API auth. Run the Playwright setup project before payment snapshot tests.');
  }
  ({ token, branchId } = cachedAuth);
});

test.afterAll(async () => {
  await disconnectTestDb();
});

test.describe('Payment Snapshot — Case Creation Paths', () => {
  test('CC-01 Assign clients via Compliance page — CT with receive_payment=true', async ({ complianceDetailPage }) => {
    test.skip(!process.env.TEST_DB_URL, 'TEST_DB_URL must be set to verify case payment snapshots');

    const runId = Date.now();
    const baseCt = await seedComplianceType(token, { type: `CC01-Base-${runId}`, frequency: 'Monthly' });
    const paymentCt = await seedComplianceType(token, { type: `CC01-Pay-${runId}`, frequency: 'Monthly', receivePayment: true });
    const client = await seedClient(token, {
      name: `CC01-Client-${runId}`,
      pan: validPan('CCONE', 1),
      branchId,
      complianceTypeIds: [baseCt.complianceTypeId],
    });

    try {
      await complianceDetailPage.navigate(paymentCt.complianceTypeId);
      await complianceDetailPage.openAssignClientsModal();
      await complianceDetailPage.searchAssignClientsModal(client.name);
      await complianceDetailPage.selectClientInModal(client.name);
      await complianceDetailPage.confirmAssign();

      const cases = await waitForCasesForClient(paymentCt.complianceTypeId, client.clientId);
      expect(cases.length, 'Assigning the client from the compliance page must generate at least one case for that compliance type').toBeGreaterThan(0);

      for (const row of cases) {
        const state = await getCaseState(row.caseId);
        expect(state.paymentRequired, 'Cases created through the compliance assignment flow must snapshot receive_payment=true').toBe(true);
        expect(state.paymentStatus, 'Cases created through the compliance assignment flow must start in Pending payment state').toBe('Pending');
      }
    } finally {
      await deleteClient(token, client.clientId);
      await deleteComplianceType(token, paymentCt.complianceTypeId);
      await deleteComplianceType(token, baseCt.complianceTypeId);
    }
  });

  test('CC-02 Assign clients via Compliance page — CT with receive_payment=false', async ({ complianceDetailPage }) => {
    test.skip(!process.env.TEST_DB_URL, 'TEST_DB_URL must be set to verify case payment snapshots');

    const runId = Date.now();
    const baseCt = await seedComplianceType(token, { type: `CC02-Base-${runId}`, frequency: 'Monthly' });
    const regularCt = await seedComplianceType(token, { type: `CC02-Regular-${runId}`, frequency: 'Monthly', receivePayment: false });
    const client = await seedClient(token, {
      name: `CC02-Client-${runId}`,
      pan: validPan('CCTWO', 2),
      branchId,
      complianceTypeIds: [baseCt.complianceTypeId],
    });

    try {
      await complianceDetailPage.navigate(regularCt.complianceTypeId);
      await complianceDetailPage.openAssignClientsModal();
      await complianceDetailPage.searchAssignClientsModal(client.name);
      await complianceDetailPage.selectClientInModal(client.name);
      await complianceDetailPage.confirmAssign();

      const cases = await waitForCasesForClient(regularCt.complianceTypeId, client.clientId);
      expect(cases.length, 'Assigning the client from the compliance page must generate at least one case for the non-payment compliance type').toBeGreaterThan(0);

      for (const row of cases) {
        const state = await getCaseState(row.caseId);
        expect(state.paymentRequired, 'Cases created through the compliance assignment flow must snapshot receive_payment=false').toBe(false);
        expect(state.paymentStatus, 'Cases created through the compliance assignment flow must start as NotRequired when payment is disabled').toBe('NotRequired');
      }
    } finally {
      await deleteClient(token, client.clientId);
      await deleteComplianceType(token, regularCt.complianceTypeId);
      await deleteComplianceType(token, baseCt.complianceTypeId);
    }
  });

  test('CC-03 Add compliance type to client from Client page', async ({ clientDetailPage }) => {
    test.skip(!process.env.TEST_DB_URL, 'TEST_DB_URL must be set to verify case payment snapshots');

    const runId = Date.now();
    const baseCt = await seedComplianceType(token, { type: `CC03-Base-${runId}`, frequency: 'Monthly' });
    const paymentCt = await seedComplianceType(token, { type: `CC03-Pay-${runId}`, frequency: 'Monthly', receivePayment: true });
    const client = await seedClient(token, {
      name: `CC03-Client-${runId}`,
      pan: validPan('CCTHR', 3),
      branchId,
      complianceTypeIds: [baseCt.complianceTypeId],
    });

    try {
      await clientDetailPage.navigate(client.clientId, client.name);
      await clientDetailPage.addComplianceType(paymentCt.type);
      await clientDetailPage.expectComplianceTypeVisible(paymentCt.type);

      const cases = await waitForCasesForClient(paymentCt.complianceTypeId, client.clientId);
      expect(cases.length, 'Adding the compliance type from the client page must generate a case for the added payment-enabled compliance').toBeGreaterThan(0);

      const state = await getCaseState(cases[0].caseId);
      expect(state.paymentRequired, 'Client-page compliance assignment must snapshot receive_payment=true onto the created case').toBe(true);
      expect(state.paymentStatus, 'Client-page compliance assignment must snapshot Pending payment status').toBe('Pending');
    } finally {
      await deleteClient(token, client.clientId);
      await deleteComplianceType(token, paymentCt.complianceTypeId);
      await deleteComplianceType(token, baseCt.complianceTypeId);
    }
  });

  test('CC-04 Bulk upload new clients — CT with receive_payment=true', async ({ page, clientListPage }) => {
    test.skip(!process.env.TEST_DB_URL, 'TEST_DB_URL must be set to verify case payment snapshots');

    const runId = Date.now();
    const paymentCt = await seedComplianceType(token, {
      type: `CC04-Pay-${runId}`,
      frequency: 'Monthly',
      receivePayment: true,
    });
    const names = [`CC04-Client-A-${runId}`, `CC04-Client-B-${runId}`];

    try {
      await clientListPage.navigate();
      await clientListPage.openBulkUploadModal();
      await page.getByTestId('select-bulk-branch').click();
      await chooseVisibleOption(page, /.*/);
      await page.getByTestId('select-bulk-compliance').click();
      await chooseVisibleOption(page, new RegExp(`^${paymentCt.type.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
      await page.getByTestId('input-bulk-file').setInputFiles({
        name: 'cc04.csv',
        mimeType: 'text/csv',
        buffer: csvBuffer([
          ['name', 'pan', 'emailid', 'phone', 'address', 'state', 'pincode'],
          [names[0], validPan('CCFOU', 41), 'cc04a@example.com', '9876543210', 'Addr 1', 'MH', '400001'],
          [names[1], validPan('CCFOU', 42), 'cc04b@example.com', '9876543211', 'Addr 2', 'MH', '400002'],
        ]),
      });
      await page.getByTestId('button-upload').click();
      await expect(page.getByText(/2 of 2 rows processed successfully/i)).toBeVisible({ timeout: 15_000 });

      for (const name of names) {
        const client = await getClientByName(name);
        expect(client, `Bulk upload must create client "${name}"`).not.toBeNull();
        if (!client) continue;

        const caseId = await findCaseIdForClient(token, branchId, client.clientid);
        expect(caseId, `Bulk-uploaded client "${name}" must have a generated case`).toBeTruthy();
        const state = await getCaseState(caseId);
        expect(state.paymentRequired, 'Bulk-upload-generated cases must snapshot receive_payment=true').toBe(true);
        expect(state.paymentStatus, 'Bulk-upload-generated cases must start in Pending').toBe('Pending');
        await deleteClient(token, client.clientid);
      }
    } finally {
      await deleteComplianceType(token, paymentCt.complianceTypeId);
    }
  });

  test('CC-05 Bulk upload existing clients', async ({ page, clientListPage }) => {
    test.skip(!process.env.TEST_DB_URL, 'TEST_DB_URL must be set to verify case payment snapshots');

    const runId = Date.now();
    const baseCt = await seedComplianceType(token, { type: `CC05-Base-${runId}`, frequency: 'Monthly' });
    const paymentCt = await seedComplianceType(token, {
      type: `CC05-Pay-${runId}`,
      frequency: 'Monthly',
      receivePayment: true,
    });
    const existingClient = await seedClient(token, {
      name: `CC05-Existing-${runId}`,
      pan: validPan('CCFIV', 5),
      branchId,
      complianceTypeIds: [baseCt.complianceTypeId],
    });

    try {
      await clientListPage.navigate();
      await clientListPage.openBulkUploadModal();
      await page.getByTestId('select-bulk-branch').click();
      await chooseVisibleOption(page, /.*/);
      await page.getByTestId('select-bulk-compliance').click();
      await chooseVisibleOption(page, new RegExp(`^${paymentCt.type.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
      await page.getByTestId('input-bulk-file').setInputFiles({
        name: 'cc05.csv',
        mimeType: 'text/csv',
        buffer: csvBuffer([
          ['name', 'pan', 'emailid', 'phone', 'address', 'state', 'pincode'],
          [existingClient.name, validPan('CCFIV', 5), 'cc05@example.com', '9876543212', 'Addr 3', 'MH', '400003'],
        ]),
      });
      await page.getByTestId('button-upload').click();
      await expect(page.getByText(/1 of 1 rows processed successfully/i)).toBeVisible({ timeout: 15_000 });

      const cases = await waitForCasesForClient(paymentCt.complianceTypeId, existingClient.clientId);
      expect(cases.length, 'Bulk upload of an existing client must still generate a case for the newly assigned payment compliance').toBeGreaterThan(0);

      const state = await getCaseState(cases[0].caseId);
      expect(state.paymentRequired, 'Bulk upload for an existing client must snapshot the current receive_payment flag').toBe(true);
      expect(state.paymentStatus, 'Bulk upload for an existing client must snapshot Pending payment status').toBe('Pending');
    } finally {
      await deleteClient(token, existingClient.clientId);
      await deleteComplianceType(token, paymentCt.complianceTypeId);
      await deleteComplianceType(token, baseCt.complianceTypeId);
    }
  });

  test('CC-06 Create client with compliance type at creation time', async () => {
    test.skip(!process.env.TEST_DB_URL, 'TEST_DB_URL must be set to verify case payment snapshots');

    const runId = Date.now();
    const paymentCt = await seedComplianceType(token, {
      type: `CC06-Pay-${runId}`,
      frequency: 'Monthly',
      receivePayment: true,
    });

    const client = await seedClient(token, {
      name: `CC06-Client-${runId}`,
      pan: validPan('CCSIX', 6),
      branchId,
      complianceTypeIds: [paymentCt.complianceTypeId],
    });

    try {
      const caseId = await findCaseIdForClient(token, branchId, client.clientId);
      expect(caseId, 'Creating the client with the payment-enabled compliance type must generate a case').toBeTruthy();
      const state = await getCaseState(caseId);
      expect(state.paymentRequired, 'Client creation must snapshot receive_payment=true when the compliance type is selected at creation time').toBe(true);
      expect(state.paymentStatus, 'Client creation must snapshot Pending payment status').toBe('Pending');
    } finally {
      await deleteClient(token, client.clientId);
      await deleteComplianceType(token, paymentCt.complianceTypeId);
    }
  });

  test('CC-07 Subtype — receive_payment=true, parent=false', async () => {
    test.skip(!process.env.TEST_DB_URL, 'TEST_DB_URL must be set to verify subtype case snapshots');

    const runId = Date.now();
    const parentCt = await seedComplianceType(token, {
      type: `CC07-Parent-${runId}`,
      frequency: 'Monthly',
      receivePayment: false,
    });
    const paidSubtype = await createSubtype(token, parentCt.complianceTypeId, {
      name: `CC07-Paid-${runId}`,
      receivePayment: true,
    });
    const regularSubtype = await createSubtype(token, parentCt.complianceTypeId, {
      name: `CC07-Regular-${runId}`,
      receivePayment: false,
    });
    const client = await seedClient(token, {
      name: `CC07-Client-${runId}`,
      pan: validPan('CCSEV', 7),
      branchId,
      complianceTypeIds: [parentCt.complianceTypeId],
    });

    try {
      expect(paidSubtype.status).toBe(201);
      expect(regularSubtype.status).toBe(201);

      const cases = await getClientComplianceSubtypeCases(client.clientId, parentCt.complianceTypeId);
      expect(cases.length, 'Subtype-enabled compliance types must create subtype-linked cases when the client is assigned').toBeGreaterThan(0);

      const paidCases = cases.filter((row) => row.complianceSubtypeId === paidSubtype.data.subtypeId);
      const regularCases = cases.filter((row) => row.complianceSubtypeId === regularSubtype.data.subtypeId);
      const parentCases = cases.filter((row) => row.complianceSubtypeId === null);

      expect(paidCases.length, 'The payment-enabled subtype must have at least one generated case').toBeGreaterThan(0);
      paidCases.forEach((row) => {
        expect(row.paymentRequired, 'Subtype cases must snapshot receive_payment from the subtype when it is enabled').toBe(true);
        expect(row.paymentStatus, 'Subtype cases with receive_payment=true must start as Pending').toBe('Pending');
      });
      regularCases.forEach((row) => {
        expect(row.paymentRequired, 'Sibling subtypes with receive_payment=false must not require payment').toBe(false);
        expect(row.paymentStatus, 'Sibling subtype cases with receive_payment=false must be NotRequired').toBe('NotRequired');
      });
      parentCases.forEach((row) => {
        expect(row.paymentRequired, 'Any parent-level cases must continue to snapshot the parent flag').toBe(false);
        expect(row.paymentStatus, 'Any parent-level cases must stay NotRequired when the parent flag is false').toBe('NotRequired');
      });
    } finally {
      await deleteClient(token, client.clientId);
      await deleteComplianceType(token, parentCt.complianceTypeId);
    }
  });

  test('CC-08 Cron job case generation', async () => {
    test.skip(!process.env.TEST_DB_URL, 'TEST_DB_URL must be set to run the DB-backed cron snapshot fixture');

    const runId = Date.now();
    const baseCt = await seedComplianceType(token, { type: `CC08-Base-${runId}`, frequency: 'Monthly' });
    const cronCt = await seedComplianceType(token, {
      type: `CC08-Cron-${runId}`,
      frequency: 'Yearly',
      receivePayment: true,
      schedule: [{
        period_index: 0,
        creation_month_offset: 0,
        creation_day: 1,
        deadline_month_offset: 0,
        deadline_day: 31,
      }],
    });
    const client = await seedClient(token, {
      name: `CC08-Client-${runId}`,
      pan: validPan('CCEIG', 8),
      branchId,
      complianceTypeIds: [baseCt.complianceTypeId],
    });

    try {
      await createClientComplianceMap(client.clientId, cronCt.complianceTypeId);
      const before = await listCasesForCompliance({ complianceTypeId: cronCt.complianceTypeId, includeClosed: true });
      expect(before.filter((row) => row.clientId === client.clientId).length, 'The raw client-compliance mapping for the cron fixture must not create a case before the job runs').toBe(0);

      await runCaseGenerationForDate(new Date('2026-03-01T06:00:00.000Z'));

      const after = await waitForCasesForClient(cronCt.complianceTypeId, client.clientId);
      expect(after.length, 'Running the case-generation job on the scheduled date must create a case for the mapped client').toBeGreaterThan(0);

      const state = await getCaseState(after[0].caseId);
      expect(state.paymentRequired, 'Cases generated by the cron job must snapshot receive_payment=true').toBe(true);
      expect(state.paymentStatus, 'Cases generated by the cron job must start with Pending payment status').toBe('Pending');
    } finally {
      await deleteClient(token, client.clientId);
      await deleteComplianceType(token, cronCt.complianceTypeId);
      await deleteComplianceType(token, baseCt.complianceTypeId);
    }
  });

  test('CC-09 Changing receive_payment on CT does NOT affect historical closed cases', async ({ complianceDetailPage }) => {
    test.skip(!process.env.TEST_DB_URL, 'TEST_DB_URL must be set to verify closed-case snapshot preservation');

    const runId = Date.now();
    const ct = await seedComplianceType(token, {
      type: `CC09-${runId}`,
      frequency: 'Monthly',
      receivePayment: false,
    });
    const client = await seedClient(token, {
      name: `CC09-Client-${runId}`,
      pan: validPan('CCNIN', 9),
      branchId,
      complianceTypeIds: [ct.complianceTypeId],
    });

    try {
      const historicalCase = await seedCase(token, {
        clientId: client.clientId,
        complianceTypeId: ct.complianceTypeId,
      });
      const closeResponse = await fetch(`${process.env.API_URL ?? 'https://devapi.auditglide.com'}/cases/${historicalCase.caseId}/assign`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userId: JSON.parse(Buffer.from(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')).sub }),
      });
      expect(closeResponse.status, 'The historical case fixture must be assignable before it is closed').toBe(200);
      await fetch(`${process.env.API_URL ?? 'https://devapi.auditglide.com'}/cases/${historicalCase.caseId}/status`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'In Progress' }),
      });
      await fetch(`${process.env.API_URL ?? 'https://devapi.auditglide.com'}/cases/${historicalCase.caseId}/status`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'Closed' }),
      });

      await complianceDetailPage.navigate(ct.complianceTypeId);
      await complianceDetailPage.setReceivePayment(true);
      await complianceDetailPage.saveAndHandleReceivePaymentModal('apply');

      const state = await getCaseState(historicalCase.caseId);
      expect(state.status, 'The preserved historical case must remain Closed').toBe('Closed');
      expect(state.paymentRequired, 'Closed historical cases must not be backfilled when Receive Payment is applied only to open cases').toBe(false);
      expect(state.paymentStatus, 'Closed historical cases must keep their original NotRequired snapshot').toBe('NotRequired');
    } finally {
      await deleteClient(token, client.clientId);
      await deleteComplianceType(token, ct.complianceTypeId);
    }
  });
});
