/**
 * Client Bulk Upload
 */
import * as path from 'path';
import * as fs   from 'fs';
import { test, expect } from '../../fixtures/auth-fixture';
import {
  getCachedApiAuth,
  seedComplianceType,
  seedClient,
  deleteClient,
  deleteComplianceType,
} from '../../helpers/api-seed.helper';

const FIXTURES_DIR = path.join(__dirname, '..', '..', 'fixtures', 'files');
let token = '';
let branchId = '';
let bulkCtId = '';
let bulkCtType = '';
const createdComplianceIds: string[] = [];
const createdClientIds: string[] = [];

/** Create a minimal valid Excel buffer for testing (uses CSV-in-xlsx trick). */
function validExcelBuffer(): Buffer {
  // We'll use a pre-built fixture file if available, otherwise create a simple one
  const fixturePath = path.join(FIXTURES_DIR, 'clients_valid.xlsx');
  if (fs.existsSync(fixturePath)) return fs.readFileSync(fixturePath);
  // Fallback: return empty buffer — tests that need real Excel will skip
  return Buffer.alloc(0);
}

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

test.beforeAll(async () => {
  const cachedAuth = getCachedApiAuth();
  if (!cachedAuth) {
    throw new Error('Missing cached API auth. Run the Playwright setup project before bulk-upload tests.');
  }
  ({ token, branchId } = cachedAuth);

  const compliance = await seedComplianceType(token, {
    type: `BU4-CT-${Date.now()}`,
    frequency: 'Monthly',
  });
  bulkCtId = compliance.complianceTypeId;
  bulkCtType = compliance.type;
});

test.afterAll(async () => {
  for (const clientId of createdClientIds) {
    await deleteClient(token, clientId);
  }
  for (const complianceTypeId of createdComplianceIds) {
    await deleteComplianceType(token, complianceTypeId);
  }
  if (bulkCtId) {
    await deleteComplianceType(token, bulkCtId);
  }
});

test.describe('Bulk Upload', () => {

  test('BU1 download template creates an Excel file', async ({ page }) => {
    await page.goto('/clients');

    await page.evaluate(() => {
      const capture = {
        filename: '',
        href: '',
        blobType: '',
        blobSize: 0,
      };
      (window as Window & { __downloadCapture?: typeof capture }).__downloadCapture = capture;

      const originalCreateObjectURL = URL.createObjectURL.bind(URL);
      URL.createObjectURL = ((blob: Blob | MediaSource) => {
        if (blob instanceof Blob) {
          capture.blobType = blob.type;
          capture.blobSize = blob.size;
        }
        return originalCreateObjectURL(blob);
      }) as typeof URL.createObjectURL;

      const originalAnchorClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function clickPatched(this: HTMLAnchorElement) {
        capture.filename = this.download;
        capture.href = this.href;
        return originalAnchorClick.call(this);
      };
    });

    await test.step('Click Download Template', async () => {
      const [response] = await Promise.all([
        page.waitForResponse(
          (resp) =>
            resp.url().includes('/clients/upload/template') && resp.ok(),
          { timeout: 15_000 },
        ),
        page.getByTestId('button-download-template').click(),
      ]);

      await test.step('Verify file downloaded with .xlsx extension', async () => {
        expect(response.ok(), 'Template request must succeed').toBe(true);

        const capture = await page.evaluate(() => {
          return (window as Window & {
            __downloadCapture?: {
              filename: string;
              href: string;
              blobType: string;
              blobSize: number;
            };
          }).__downloadCapture;
        });

        expect(
          capture?.filename,
          'Downloaded file must have .xlsx extension',
        ).toMatch(/\.xlsx$/);
        expect(capture?.blobSize, 'Downloaded blob must not be empty').toBeGreaterThan(0);
      });
    });
  });

  test('BU2 bulk upload modal opens and shows branch + compliance selectors', async ({ page, clientListPage }) => {
    await clientListPage.navigate();
    await clientListPage.openBulkUploadModal();

    await test.step('Modal must be visible', async () => {
      await expect(page.getByRole('dialog'), 'Bulk upload dialog must open').toBeVisible();
    });

    await test.step('Branch selector exists', async () => {
      await expect(page.getByTestId('select-bulk-branch'), 'Branch selector must be in the modal').toBeVisible();
    });

    await test.step('Compliance type selector exists', async () => {
      await expect(page.getByTestId('select-bulk-compliance'), 'Compliance type selector must be in the modal').toBeVisible();
    });

    await test.step('Upload button disabled until all fields filled', async () => {
      await expect(page.getByTestId('button-upload'), 'Upload button must be disabled without selections').toBeDisabled();
    });
  });

  test('BU3 uploading an empty file shows validation error', async ({ page, clientListPage }) => {
    await clientListPage.navigate();
    await clientListPage.openBulkUploadModal();

    // Upload an empty buffer as file
    const emptyFile = {
      name:     'empty.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer:   Buffer.alloc(0),
    };

    await page.getByTestId('input-bulk-file').setInputFiles({
      name:     emptyFile.name,
      mimeType: emptyFile.mimeType,
      buffer:   emptyFile.buffer,
    });

    await test.step('Select branch and compliance type, then submit upload', async () => {
      await page.getByTestId('select-bulk-branch').click();
      await page.getByRole('option').first().click();

      await page.getByTestId('select-bulk-compliance').click();
      await page.getByRole('option').first().click();

      await page.getByTestId('button-upload').click();
    });

    await expect(
      page.getByText(/no file uploaded|file is empty/i),
      'Error must appear for empty file upload',
    ).toBeVisible({ timeout: 8_000 });
  });

  test('BU4 mixed upload shows successes, duplicates, and failures together @p0', async ({ page, clientListPage }) => {
    const duplicatePan = `AACBU${String(Date.now()).slice(-4)}D`;
    const existingPan = `AACBU${String(Date.now() + 1).slice(-4)}E`;
    const alternateCompliance = await seedComplianceType(token, {
      type: `BU4-Alt-CT-${Date.now()}`,
      frequency: 'Monthly',
    });
    createdComplianceIds.push(alternateCompliance.complianceTypeId);

    const alreadyMappedClient = await seedClient(token, {
      name: `BU4-Duplicate-${Date.now()}`,
      pan: duplicatePan,
      branchId,
      complianceTypeIds: [bulkCtId],
    });
    const existingButUnmappedClient = await seedClient(token, {
      name: `BU4-Existing-${Date.now()}`,
      pan: existingPan,
      branchId,
      complianceTypeIds: [alternateCompliance.complianceTypeId],
    });
    createdClientIds.push(alreadyMappedClient.clientId, existingButUnmappedClient.clientId);

    const file = {
      name: 'clients-mixed.csv',
      mimeType: 'text/csv',
      buffer: csvBuffer([
        ['name', 'pan', 'emailid', 'phone', 'address', 'state', 'pincode'],
        [alreadyMappedClient.name, duplicatePan, 'dup@example.com', '9876543210', 'Addr 1', 'MH', '400001'],
        [existingButUnmappedClient.name, existingPan, 'existing@example.com', '9876543211', 'Addr 2', 'MH', '400002'],
        [`BU4-New-${Date.now()}`, `AACBU${String(Date.now() + 2).slice(-4)}F`, 'new@example.com', '9876543212', 'Addr 3', 'MH', '400003'],
        ['', '', 'broken@example.com', '9876543213', 'Addr 4', 'MH', '400004'],
      ]),
    };

    await clientListPage.navigate();
    await clientListPage.openBulkUploadModal();

    await page.getByTestId('select-bulk-branch').click();
    await chooseVisibleOption(page, /.*/);

    await page.getByTestId('select-bulk-compliance').click();
    await chooseVisibleOption(
      page,
      new RegExp(`^${bulkCtType.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
    );

    await page.getByTestId('input-bulk-file').setInputFiles(file);
    await page.getByTestId('button-upload').click();

    await expect(
      page.getByText(/2 of 4 rows processed successfully/i),
      'Mixed bulk upload must report the successful row count',
    ).toBeVisible({ timeout: 12_000 });
    await expect(
      page.getByText(/Already Exists\s+—\s+Skipped \(1 row\)/i),
      'Mixed bulk upload must show duplicate rows separately',
    ).toBeVisible();
    await expect(
      page.getByText(/Failed \(1 row\)/i),
      'Mixed bulk upload must show failed rows separately',
    ).toBeVisible();
    const duplicateSection = page.locator('div').filter({
      has: page.getByText(/Already Exists\s+—\s+Skipped \(1 row\)/i),
    }).first();
    await expect(
      duplicateSection.getByRole('cell', { name: alreadyMappedClient.name, exact: true }),
      'The duplicate client must appear in the skipped section',
    ).toBeVisible();
    await expect(
      page.getByText(/Missing name/i),
      'The failed row must explain the parsing error',
    ).toBeVisible();
  });

});
