import { Page, expect } from '@playwright/test';
import { BasePage } from '../base.page';

export class ClientListPage extends BasePage {
  constructor(page: Page) { super(page); }

  async navigate() {
    const searchInput = this.byTestId('input-search');
    if (await searchInput.isVisible().catch(() => false)) {
      await this.waitForLoadingDone();
      return;
    }

    const clientsNav = this.page.locator('[data-testid="nav-clients"]:visible').first();
    if (!await clientsNav.isVisible().catch(() => false)) {
      const settingsButton = this.page.locator('[data-testid="nav-settings"]:visible').first();
      if (await settingsButton.isVisible().catch(() => false)) {
        await settingsButton.click();
      }
    }
    await expect(clientsNav, 'Clients nav link must be visible to navigate in-app').toBeVisible();
    await clientsNav.click();
    await this.waitForLoadingDone();
    await expect(searchInput, 'Clients search input must be visible').toBeVisible();
  }

  // ─── Toolbar ──────────────────────────────────────────────────────────────

  async search(query: string) {
    await this.fill('input-search', query);
    await this.waitForLoadingDone();
  }

  async toggleShowInactive(on: boolean) {
    const toggle = this.byTestId('toggle-show-inactive');
    const isChecked = await toggle.isChecked();
    if (isChecked !== on) await toggle.click();
    await this.waitForLoadingDone();
  }

  async openAddClientModal() {
    const addButton = this.byTestId('button-add-client');
    if (!await addButton.isVisible().catch(() => false)) {
      await this.navigate();
    }
    await expect(addButton, 'Add Client button must be visible on the Clients page').toBeVisible();
    await expect(addButton, 'Add Client button must be enabled').toBeEnabled();
    await addButton.click();
    await expect(this.page.getByRole('dialog'), 'Add Client dialog must open').toBeVisible();
  }

  async openBulkUploadModal() {
    const bulkButton = this.byTestId('button-bulk-upload');
    await expect(bulkButton, 'Bulk Upload button must be visible on the Clients page').toBeVisible();
    await expect(bulkButton, 'Bulk Upload button must be enabled').toBeEnabled();
    await bulkButton.click();
    await expect(this.page.getByRole('dialog'), 'Bulk Upload dialog must open').toBeVisible();
  }

  // ─── Table ────────────────────────────────────────────────────────────────

  async getRowCount(): Promise<number> {
    return this.page.locator('[data-testid="clients-table"] tbody tr').count();
  }

  async expectClientVisible(name: string) {
    await expect(
      this.page.locator('[data-testid="clients-table"]').getByText(name),
      `Client "${name}" must appear in the list`,
    ).toBeVisible();
  }

  async expectClientHidden(name: string) {
    await expect(
      this.page.locator('[data-testid="clients-table"]').getByText(name),
      `Client "${name}" must NOT appear in the list`,
    ).not.toBeVisible();
  }

  async expectInactiveBadgeVisible(clientName: string) {
    const row = this.page.locator(`tr:has-text("${clientName}")`);
    await expect(
      row.getByText('Inactive'),
      `Inactive badge must be visible for "${clientName}"`,
    ).toBeVisible();
  }

  async expectDeleteIconVisible(clientId: string) {
    await expect(
      this.page.locator(`[data-testid="client-row-${clientId}"] [class*="trash"], [data-testid="client-row-${clientId}"] button[class*="red"]`),
      `Delete icon must be visible for client ${clientId}`,
    ).toBeVisible();
  }

  async expectDeleteIconHidden(clientId: string) {
    await expect(
      this.page.locator(`[data-testid="client-row-${clientId}"] [class*="trash"], [data-testid="client-row-${clientId}"] button[class*="red"]`),
      `Delete icon must be HIDDEN for client ${clientId} (has cases)`,
    ).not.toBeVisible();
  }

  async clickClientRow(clientId: string) {
    await this.page.getByTestId(`client-row-${clientId}`).click();
  }

  async deleteClient(name: string) {
    const row = this.page.locator(`tr:has-text("${name}")`);
    await row.getByRole('button').filter({ has: this.page.locator('[class*="trash"]') }).click();
    await this.expectDialogVisible(/Delete Client/);
    await this.clickDialogButton(/Delete/);
    await this.waitForLoadingDone();
  }

  // ─── Create client form (inside modal) ────────────────────────────────────

  async fillCreateForm(data: {
    name: string;
    pan?: string;
    gstn?: string;
    email?: string;
    phone?: string;
    address?: string;
    state?: string;
    pincode?: string;
    complianceTypeIds?: string[];
  }) {
    await this.fill('input-client-name', data.name);
    if (data.pan)   await this.fill('input-pan', data.pan);
    if (data.gstn)  await this.fill('input-gstn', data.gstn);
    if (data.email) await this.fill('input-email', data.email);
    if (data.phone) await this.fill('input-phone', data.phone);

    if (data.complianceTypeIds?.length) {
      for (const ctId of data.complianceTypeIds) {
        await this.page.locator(`[id="ct-cb-${ctId}"]`).check();
      }
    }
  }

  async selectFirstComplianceType() {
    const firstCompliance = this.page.locator('[id^="ct-cb-"]').first();
    await expect(firstCompliance, 'At least one compliance type must be available').toBeVisible();
    await firstCompliance.check();
  }

  async submitCreateForm() {
    await this.click('button-create-client');
  }

  async expectFormError(text: string | RegExp) {
    const matches = this.page.locator('form').getByText(text);
    await expect(
      matches.first(),
      `Form error "${text}" must be visible`,
    ).toBeVisible();
  }

  async expectInputValidationMessage(testId: string, text: string | RegExp) {
    const input = this.byTestId(testId);
    await expect(input, `Input [data-testid="${testId}"] must be visible`).toBeVisible();

    await expect
      .poll(
        async () => input.evaluate((el) => (el as HTMLInputElement).validationMessage),
        { message: `Native validation message for "${testId}" must match "${text}"` },
      )
      .toMatch(text);
  }

  // ─── Pagination ──────────────────────────────────────────────────────────

  async goToNextPage() {
    await this.page.getByRole('button', { name: /Next/i }).click();
    await this.waitForLoadingDone();
  }

  async goToPrevPage() {
    await this.page.getByRole('button', { name: /Prev/i }).click();
    await this.waitForLoadingDone();
  }

  async getPaginationText(): Promise<string> {
    return (await this.page.locator('text=/Showing \\d+/').textContent()) ?? '';
  }
}
