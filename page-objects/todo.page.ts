import { Page, expect } from '@playwright/test';
import { BasePage } from './base.page';

export class TodoPage extends BasePage {
  constructor(page: Page) { super(page); }

  async navigate() {
    await this.goto('/todo');
    await this.waitForLoadingDone();
  }

  private section(title: string) {
    return this.page.locator('section, div').filter({
      has: this.page.getByRole('heading', { name: title }),
    }).first();
  }

  async expectPaymentsDueVisible() {
    await expect(
      this.page.getByRole('heading', { name: 'Payments Due' }),
      'Payments Due section must be visible in My To-Do',
    ).toBeVisible();
  }

  async expectPaymentsDueHidden() {
    await expect(
      this.page.getByRole('heading', { name: 'Payments Due' }),
      'Payments Due section must be hidden in My To-Do',
    ).not.toBeVisible();
  }

  async expectPaymentsDueCaseVisible(clientName: string) {
    await expect(
      this.section('Payments Due').getByText(clientName),
      `Payments Due must include client "${clientName}"`,
    ).toBeVisible();
  }

  async expectPaymentsDueCaseHidden(clientName: string) {
    await expect(
      this.section('Payments Due').getByText(clientName),
      `Payments Due must not include client "${clientName}"`,
    ).not.toBeVisible();
  }

  async toggleShowWrittenOff(on: boolean) {
    const label = this.page.getByText(/Show written off/i).locator('..');
    const checkbox = label.locator('input[type="checkbox"]').first();
    await expect(checkbox, 'Show written off toggle must be visible').toBeVisible();
    const checked = await checkbox.isChecked();
    if (checked !== on) {
      await checkbox.click();
    }
    await this.waitForLoadingDone();
  }

  async selectPeriod(value: 'current_month' | 'last_month' | 'last_3_months' | 'custom') {
    await this.page.getByTestId(`period-${value}`).click();
    await this.waitForLoadingDone();
  }

  async setCustomRange(from: string, to: string) {
    await this.byTestId('input-date-from').fill(from);
    await this.byTestId('input-date-to').fill(to);
    await this.waitForLoadingDone();
  }

  async selectClient(clientName: string) {
    await this.page.getByRole('button', { name: /Select clients/i }).click();
    const search = this.page.getByPlaceholder('Search clients…');
    await expect(search, 'Client filter search input must be visible in My To-Do').toBeVisible();
    await search.fill(clientName);
    await this.page.getByRole('checkbox').locator('..').filter({ hasText: clientName }).first().click();
    await this.page.keyboard.press('Escape');
    await this.waitForLoadingDone();
  }

  async clearClientFilter() {
    const clearAll = this.page.getByRole('button', { name: /Clear all/i });
    if (await clearAll.isVisible().catch(() => false)) {
      await clearAll.click();
      await this.waitForLoadingDone();
      return;
    }

    const removeButtons = this.page.locator('button[aria-label^="Remove "]');
    const count = await removeButtons.count();
    for (let i = 0; i < count; i += 1) {
      await removeButtons.first().click();
    }
    await this.waitForLoadingDone();
  }

  async clickPaymentsDueCase(clientName: string) {
    await this.section('Payments Due').getByText(clientName).click();
    await this.waitForLoadingDone();
  }
}
