import { Page, expect } from '@playwright/test';
import { BasePage } from './base.page';

export class PaymentsPage extends BasePage {
  constructor(page: Page) { super(page); }

  async navigate() {
    await this.goto('/payments');
    await this.waitForLoadingDone();
  }

  async expectLoaded() {
    await expect(
      this.page.getByRole('heading', { name: 'Payments' }),
      'Payments page heading must be visible',
    ).toBeVisible();
  }

  async expectNavVisible() {
    await expect(
      this.page.getByTestId('nav-payments'),
      'Payments nav item must be visible for the current user',
    ).toBeVisible();
  }

  async expectNavHidden() {
    await expect(
      this.page.getByTestId('nav-payments'),
      'Payments nav item must be hidden for the current user',
    ).not.toBeVisible();
  }

  async expectSummaryCard(label: string, value?: string | RegExp, sub?: string | RegExp) {
    const card = this.page.locator('div.bg-white.rounded-xl.border').filter({
      has: this.page.getByText(label, { exact: true }),
    }).first();

    await expect(card, `Summary card "${label}" must be visible`).toBeVisible();
    if (value !== undefined) {
      await expect(card, `Summary card "${label}" must show the expected value`).toContainText(value);
    }
    if (sub !== undefined) {
      await expect(card, `Summary card "${label}" must show the expected subtext`).toContainText(sub);
    }
  }

  async getSummaryCardText(label: string): Promise<string> {
    const card = this.page.locator('div.bg-white.rounded-xl.border').filter({
      has: this.page.getByText(label, { exact: true }),
    }).first();
    await expect(card, `Summary card "${label}" must be visible before reading its text`).toBeVisible();
    return (await card.textContent())?.trim() ?? '';
  }

  async selectPeriod(label: 'Today' | 'This Month' | 'This Year' | 'Custom Range') {
    await this.page.getByRole('button', { name: label, exact: true }).click();
    await this.waitForLoadingDone();
  }

  async setCustomRange(from: string, to: string) {
    await this.page.locator('input[type="date"]').first().fill(from);
    await this.page.locator('input[type="date"]').nth(1).fill(to);
    await this.waitForLoadingDone();
  }

  async switchTab(label: 'By Compliance' | 'By Client' | 'Written Off Cases') {
    await this.page.getByRole('button', { name: label, exact: true }).click();
    await this.waitForLoadingDone();
  }

  async switchBranch(branchId: string) {
    await this.page.getByTestId('branch-selector-trigger').click();
    await this.page.getByTestId(`branch-option-${branchId}`).click();
    await this.waitForLoadingDone();
  }

  async expectTableRowVisible(text: string | RegExp) {
    await expect(
      this.page.locator('table tbody').getByText(text),
      `Payments table must include row text "${text}"`,
    ).toBeVisible();
  }

  async expectTableRowHidden(text: string | RegExp) {
    await expect(
      this.page.locator('table tbody').getByText(text),
      `Payments table must not include row text "${text}"`,
    ).not.toBeVisible();
  }

  async getTableText(): Promise<string> {
    await expect(
      this.page.locator('table tbody').first(),
      'A payments table body must be visible before reading its text content',
    ).toBeVisible();
    return (await this.page.locator('table tbody').first().textContent())?.trim() ?? '';
  }

  async clickWrittenOffRow(clientName: string) {
    await this.page.locator('table tbody tr').filter({ hasText: clientName }).first().click();
    await this.waitForLoadingDone();
  }
}
