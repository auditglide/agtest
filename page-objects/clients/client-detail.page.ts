import { Page, expect } from '@playwright/test';
import { BasePage } from '../base.page';

export class ClientDetailPage extends BasePage {
  constructor(page: Page) { super(page); }

  async navigate(clientId: string, clientName?: string) {
    await this.goto(`/clients/${clientId}`);
    const nameInput = this.byTestId('input-name');
    if (await nameInput.isVisible().catch(() => false)) {
      await this.waitForLoadingDone();
      return;
    }

    const searchInput = this.page.getByTestId('input-search');
    if (!await searchInput.isVisible().catch(() => false)) {
      const clientsNav = this.page.locator('[data-testid="nav-clients"]:visible').first();
      if (!await clientsNav.isVisible().catch(() => false)) {
        const settingsButton = this.page.locator('[data-testid="nav-settings"]:visible').first();
        if (await settingsButton.isVisible().catch(() => false)) {
          await settingsButton.click();
        }
      }
      await expect(clientsNav, 'Clients nav link must be visible to open a client detail page').toBeVisible();
      await clientsNav.click();
      await expect(searchInput, 'Clients list must load before opening a client row').toBeVisible();
    }

    if (clientName) {
      const row = this.page.getByTestId(`client-row-${clientId}`);

      await searchInput.fill(clientName);
      await this.page.waitForTimeout(500);

      try {
        await expect(
          row,
          `Client row for "${clientName}" must appear in filtered results`,
        ).toBeVisible({ timeout: 5_000 });
      } catch {
        const showInactiveToggle = this.page.getByTestId('toggle-show-inactive');
        if (await showInactiveToggle.isVisible().catch(() => false)) {
          const isChecked = await showInactiveToggle.isChecked().catch(() => false);
          if (!isChecked) {
            await showInactiveToggle.click();
            await this.waitForLoadingDone();
          }
        }

        await searchInput.fill(clientName);
        await this.page.waitForTimeout(500);
        await expect(
          row,
          `Client row for "${clientName}" must appear in filtered results`,
        ).toBeVisible({ timeout: 10_000 });
      }
    }

    await this.page.getByTestId(`client-row-${clientId}`).click();
    await expect(this.page, 'Must navigate to the requested client detail page').toHaveURL(new RegExp(`/clients/${clientId}(?:\\?.*)?$`));
    await this.waitForLoadingDone();
  }

  // ─── Profile form ─────────────────────────────────────────────────────────

  async editName(name: string)    { await this.fill('input-name', name); }
  async editPan(pan: string)      { await this.fill('input-pan', pan); }
  async editGstn(gstn: string)    { await this.fill('input-gstn', gstn); }
  async editEmail(email: string)  { await this.fill('input-email', email); }
  async editPhone(phone: string)  { await this.fill('input-phone', phone); }
  async editAddress(addr: string) { await this.fill('input-address', addr); }

  async saveChanges() {
    await this.click('button-save');
    await this.waitForLoadingDone();
  }

  async expectSaveSuccess() {
    await this.expectToast(/updated|saved/i);
  }

  async expectSaveNoChanges() {
    await this.expectToast(/no changes/i);
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

  // ─── Inactive toggle ──────────────────────────────────────────────────────

  async getIsActiveState(): Promise<boolean> {
    return this.byTestId('toggle-client-active').isChecked();
  }

  async toggleActive(active: boolean) {
    const toggle = this.byTestId('toggle-client-active');
    const current = await toggle.isChecked();
    if (current !== active) await toggle.click();
  }

  /** Save with inactive toggle — handles the deactivation modal automatically. */
  async saveAndDeactivate(deleteCases: 'yes' | 'no' | 'cancel') {
    await this.saveChanges();
    await this.expectDialogVisible(/Deactivate Client/);

    if (deleteCases === 'cancel') {
      await this.clickDialogButton(/Cancel/);
    } else if (deleteCases === 'yes') {
      await this.clickDialogButton(/Yes.*Delete/i);
      await this.waitForLoadingDone();
    } else {
      await this.clickDialogButton(/No.*Keep/i);
      await this.waitForLoadingDone();
    }
  }

  async expectInactiveLabelVisible() {
    await expect(
      this.page.getByText('Inactive'),
      'Inactive label must be shown when toggle is off',
    ).toBeVisible();
  }

  async expectActiveLabelVisible() {
    await expect(
      this.page.getByText('Active'),
      'Active label must be shown when toggle is on',
    ).toBeVisible();
  }

  // ─── Compliance types section ─────────────────────────────────────────────

  async addComplianceType(ctType: string) {
    await this.selectOption('select-add-compliance-type', ctType);
    await this.click('button-add-compliance-type');
    await this.waitForLoadingDone();
  }

  async expectComplianceTypeVisible(type: string) {
    await expect(
      this.page.locator('section, div').filter({ hasText: 'Compliance Types' }).getByText(type),
      `Compliance type "${type}" must appear in client detail`,
    ).toBeVisible();
  }

  async removeComplianceType(ctId: string, deleteCases: 'yes-delete' | 'no-keep') {
    await this.page.getByTestId(`btn-remove-ct-${ctId}`).click();
    await this.expectDialogVisible(/Remove Compliance Type/);

    if (deleteCases === 'yes-delete') {
      await this.clickDialogButton(/Yes.*Delete/i);
    } else {
      await this.clickDialogButton(/No.*Keep/i);
    }
    await this.waitForLoadingDone();
  }

  async expectComplianceTypeHidden(type: string) {
    await expect(
      this.page.locator('section, div').filter({ hasText: 'Compliance Types' }).getByText(type),
      `Compliance type "${type}" must NOT appear after removal`,
    ).not.toBeVisible();
  }
}
