import { Page, expect } from '@playwright/test';
import { BasePage } from '../base.page';

export class ComplianceListPage extends BasePage {
  constructor(page: Page) { super(page); }

  async navigate() {
    const table = this.page.getByTestId('compliance-table');
    const addButton = this.page.getByTestId('button-add-compliance');
    const emptyState = this.page.getByText(/No compliance types yet/i);
    if (
      await table.isVisible().catch(() => false) ||
      await addButton.isVisible().catch(() => false) ||
      await emptyState.isVisible().catch(() => false)
    ) {
      await this.waitForLoadingDone();
      return;
    }

    const complianceNav = this.page.locator('[data-testid="nav-compliance"]:visible').first();
    if (!await complianceNav.isVisible().catch(() => false)) {
      const settingsButton = this.page.locator('[data-testid="nav-settings"]:visible').first();
      if (await settingsButton.isVisible().catch(() => false)) {
        await settingsButton.click();
      }
    }

    await expect(complianceNav, 'Compliance nav link must be visible to navigate in-app').toBeVisible();
    await complianceNav.click();
    await this.waitForLoadingDone();
    await this.recoverFromRateLimit(async () => {
      await this.page.goto('/compliance');
      await this.page.waitForLoadState('domcontentloaded');
    }, 'Compliance list page');
    await Promise.race([
      table.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {}),
      addButton.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {}),
      emptyState.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {}),
    ]);
    await expect(
      this.page.locator('body'),
      'Compliance list must render a table, empty state, or create action',
    ).not.toContainText('Failed to load compliance types.');
  }

  async openCreateModal() {
    const addButton = this.page.getByTestId('button-add-compliance');
    await expect(addButton, 'Add Compliance button must be visible').toBeVisible();
    await expect(addButton, 'Add Compliance button must be enabled').toBeEnabled();
    await addButton.click();
    await expect(
      this.page.getByRole('dialog').getByText('Add Compliance Type'),
      'Create compliance dialog must open',
    ).toBeVisible();
  }

  async fillCreateForm(data: {
    name: string;
    frequency: 'Monthly' | 'Quarterly' | 'Yearly';
    needsWorkAllocation?: boolean;
    receivePayment?: boolean;
  }) {
    const dialog = this.page.getByRole('dialog');
    await expect(dialog, 'Create compliance dialog must be open before filling').toBeVisible();

    await dialog.getByPlaceholder(/e\.g\. Income Tax|e\.g\. GST/i).fill(data.name);
    await dialog.getByLabel(data.frequency, { exact: true }).check();

    if (data.needsWorkAllocation !== undefined) {
      const label = data.needsWorkAllocation
        ? 'Needs Work Allocation'
        : 'No Work Allocation Needed';
      await dialog.getByLabel(label, { exact: true }).check();
    }

    if (data.receivePayment !== undefined) {
      const toggle = dialog
        .locator('p', { hasText: /^Receive Payment$/i })
        .locator('..')
        .locator('input[type="checkbox"]')
        .first();
      const checked = await toggle.isChecked();
      if (checked !== data.receivePayment) {
        await toggle.click();
      }
    }
  }

  async submitCreate() {
    const dialog = this.page.getByRole('dialog');
    const submitButton = dialog.getByRole('button', { name: /Create Compliance Type/i });
    const detailUrlPattern = /\/compliance\/[0-9a-f-]{36}(?:\?.*)?$/;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await submitButton.click();

      await Promise.race([
        this.page.waitForURL(detailUrlPattern, { timeout: 6_000 }).catch(() => {}),
        this.waitForLoadingDone().catch(() => {}),
      ]);

      if (detailUrlPattern.test(this.page.url())) {
        return;
      }

      if (!await dialog.isVisible().catch(() => false)) {
        return;
      }

      if (!await this.hasRateLimitBanner()) {
        return;
      }

      const retryButton = this.page.getByRole('button', { name: /retry/i }).first();
      if (await retryButton.isVisible().catch(() => false)) {
        await retryButton.click();
        await this.waitForLoadingDone();
      } else {
        await this.page.waitForTimeout(1_500 * (attempt + 1));
      }
    }
  }

  async expectComplianceVisible(name: string) {
    await expect(
      this.page.getByText(name),
      `Compliance type "${name}" must appear in the list`,
    ).toBeVisible();
  }

  async expectComplianceHidden(name: string) {
    await expect(
      this.page.getByText(name),
      `Compliance type "${name}" must be hidden from the list`,
    ).not.toBeVisible();
  }

  async clickCompliance(name: string) {
    await this.page.getByText(name).click();
    await this.waitForLoadingDone();
  }

  async expectCreateError(text: string | RegExp) {
    const dialog = this.page.locator('[role="dialog"]:visible').last();
    const alert = dialog
      .locator('[role="alert"], [data-testid^="alert-"]')
      .filter({ hasText: text })
      .first();

    await expect(
      alert,
      `Create error "${text}" must be visible in dialog`,
    ).toBeVisible();
  }
}
