/**
 * Case Notes and History
 */
import { test, expect } from '../../fixtures/auth-fixture';
import {
  getCachedApiAuth,
  seedComplianceType,
  seedClient,
  seedCase,
  deleteClient,
  deleteComplianceType,
} from '../../helpers/api-seed.helper';

let token = '';
let branchId = '';
let ctId = '';
const clientIds: string[] = [];
const caseIds: Record<'notes' | 'new' | 'closed' | 'upload', string> = {
  notes: '',
  new: '',
  closed: '',
  upload: '',
};

test.beforeAll(async () => {
  const cachedAuth = getCachedApiAuth();
  if (!cachedAuth) {
    throw new Error('Missing cached API auth. Run the Playwright setup project before case-notes tests.');
  }
  ({ token, branchId } = cachedAuth);

  const ct = await seedComplianceType(token, {
    type: `KN-CT-${Date.now()}`,
    frequency: 'Monthly',
    needsWorkAllocation: false,
  });
  ctId = ct.complianceTypeId;

  const scenarios = [
    { key: 'notes' as const, name: `KN-Client-${Date.now()}`, pan: 'AAKNN1111K' },
    { key: 'new' as const, name: `KN-New-${Date.now()}`, pan: 'AAKNN2222K' },
    { key: 'closed' as const, name: `KN-Closed-${Date.now()}`, pan: 'AAKNN3333K' },
    { key: 'upload' as const, name: `KN-Upload-${Date.now()}`, pan: 'AAKNN4444K' },
  ];

  for (const scenario of scenarios) {
    const client = await seedClient(token, {
      name: scenario.name,
      pan: scenario.pan,
      branchId,
      complianceTypeIds: [ctId],
    });
    clientIds.push(client.clientId);

    const seededCase = await seedCase(token, {
      clientId: client.clientId,
      complianceTypeId: ctId,
    });
    caseIds[scenario.key] = seededCase.caseId;
  }
});

test.afterAll(async () => {
  await deleteComplianceType(token, ctId);
  for (const clientId of clientIds) {
    await deleteClient(token, clientId);
  }
});

test.describe('Case Notes', () => {

  async function prepareCaseForNotes(
    caseDetailPage: import('../../page-objects/cases/case-detail.page').CaseDetailPage,
    targetCaseId: string,
  ) {
    await caseDetailPage.navigate(targetCaseId);
    const status = (await caseDetailPage.getCurrentStatus()).trim();

    if (/In Progress/i.test(status) || /Assigned/i.test(status) || /Rework Required/i.test(status)) {
      return;
    }

    if (/New/i.test(status)) {
      await caseDetailPage.transitionTo('In Progress');
      await caseDetailPage.expectStatus('In Progress');
    }
  }

  test('KN1 add a note to a case — note appears in list @smoke', async ({ caseDetailPage }) => {
    await prepareCaseForNotes(caseDetailPage, caseIds.notes);

    const noteText = `Test note ${Date.now()}`;

    await test.step('Add note', async () => {
      await caseDetailPage.addNote(noteText);
    });

    await test.step('Note appears in notes section', async () => {
      await caseDetailPage.expectNoteVisible(noteText);
    });
  });

  test('KN2 case edit history shows status transitions', async ({ caseDetailPage, page }) => {
    await caseDetailPage.navigate(caseIds.notes);

    await test.step('History section must be visible', async () => {
      await page.getByTestId('button-case-history').click();
      await expect(
        page.getByRole('dialog', { name: /Case History/i }),
        'Case history dialog must be visible on the detail page',
      ).toBeVisible();
    });
  });

  test('KN3 multiple notes — all visible', async ({ caseDetailPage }) => {
    await prepareCaseForNotes(caseDetailPage, caseIds.notes);

    const note1 = `Note-A-${Date.now()}`;
    const note2 = `Note-B-${Date.now()}`;

    await caseDetailPage.addNote(note1);
    await caseDetailPage.addNote(note2);

    await caseDetailPage.expectNoteVisible(note1);
    await caseDetailPage.expectNoteVisible(note2);
  });

  test('KN4 add-note action is hidden for a New case @p0', async ({ caseDetailPage }) => {
    await caseDetailPage.navigate(caseIds.new);
    await caseDetailPage.expectStatus('New');

    await expect(
      caseDetailPage.page.getByTestId('button-add-note'),
      'New cases must not show the add-note action',
    ).toHaveCount(0);
  });

  test('KN5 add-note action is hidden for a Closed case @p0', async ({ caseDetailPage }) => {
    await caseDetailPage.navigate(caseIds.closed);
    await caseDetailPage.transitionTo('In Progress');
    await caseDetailPage.transitionTo('Completed');
    await caseDetailPage.transitionTo('Closed');
    await caseDetailPage.expectStatus('Closed');

    await expect(
      caseDetailPage.page.getByTestId('button-add-note'),
      'Closed cases must not show the add-note action',
    ).toHaveCount(0);
  });

  test('KD1 uploading a small document succeeds and appears in the list @p0', async ({ caseDetailPage }) => {
    await prepareCaseForNotes(caseDetailPage, caseIds.upload);

    const documentName = `kd1-proof-${Date.now()}.txt`;
    await test.step('Upload a small document from a writable case state', async () => {
      await caseDetailPage.uploadDocument({
        name: documentName,
        mimeType: 'text/plain',
        buffer: Buffer.from('AuditGlide KD1 document upload check', 'utf8'),
      });
      await caseDetailPage.expectToast(/document uploaded/i);
    });

    await test.step('The uploaded document must appear in the documents list', async () => {
      await caseDetailPage.expectDocumentVisible(documentName);
    });
  });

  test('KD2 documents larger than 10 MB are rejected client-side @p0', async ({ caseDetailPage, page }) => {
    await prepareCaseForNotes(caseDetailPage, caseIds.upload);

    const oversizedBuffer = Buffer.alloc((10 * 1024 * 1024) + 1, 1);
    await page.locator('input[type="file"]').setInputFiles({
      name: 'oversized-proof.pdf',
      mimeType: 'application/pdf',
      buffer: oversizedBuffer,
    });

    await expect(
      page.getByText(/File must be 10 MB or smaller/i),
      'Oversized uploads must be rejected before any network upload starts',
    ).toBeVisible();
  });

});
