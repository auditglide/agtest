import { Page, expect } from '@playwright/test';
import { BasePage } from '../base.page';

export class CaseListPage extends BasePage {
  constructor(page: Page) { super(page); }

  private filterField(label: string) {
    return this.page.locator(
      `xpath=//label[normalize-space()="${label}"]/following-sibling::*[1]//button[1]`,
    );
  }

  private genericMultiSelectDropdown() {
    return this.page.locator('div').filter({
      has: this.page.getByPlaceholder('Search…'),
    }).last();
  }

  async navigate() {
    await this.goto('/cases');
    await this.waitForLoadingDone();
  }

  async filterByStatus(status: string) {
    await this.filterField('Status').click();
    await this.page.getByRole('checkbox', { name: status, exact: true }).check();
    await this.page.keyboard.press('Escape');
    await this.waitForLoadingDone();
  }

  async filterByStatuses(statuses: string[]) {
    await this.filterField('Status').click();
    for (const status of statuses) {
      const checkbox = this.page.getByRole('checkbox', { name: status, exact: true });
      if (!(await checkbox.isChecked())) {
        await checkbox.check();
      }
    }
    await this.page.keyboard.press('Escape');
    await this.waitForLoadingDone();
  }

  async filterByComplianceType(type: string) {
    await this.filterField('Compliance Type').click();
    await this.page.getByRole('checkbox', { name: type, exact: true }).check();
    await this.page.keyboard.press('Escape');
    await this.waitForLoadingDone();
  }

  async getComplianceFilterOptionCount(): Promise<number> {
    await this.filterField('Compliance Type').click();
    const count = await this.page.getByRole('checkbox').count();
    await this.page.keyboard.press('Escape');
    return count;
  }

  async selectFirstComplianceTypeFilterOption() {
    await this.filterField('Compliance Type').click();
    await this.page.getByRole('checkbox').first().check();
    await this.page.keyboard.press('Escape');
    await this.waitForLoadingDone();
  }

  async isClientFilterEnabled(): Promise<boolean> {
    return this.filterField('Client').isEnabled();
  }

  async searchClientFilter(name: string) {
    await this.filterField('Client').click();
    const search = this.page.getByPlaceholder('Search clients…');
    await expect(search, 'Client filter search input must be visible').toBeVisible();
    await search.fill(name);
  }

  async expectNoClientFilterMatches(name: string) {
    await expect(
      this.page.getByText(`No clients match "${name}"`),
      `Client filter search must show no matches for "${name}"`,
    ).toBeVisible();
  }

  async getCaseCount(): Promise<number> {
    return this.page.locator('[data-testid^="case-row-"]').count();
  }

  async clickCase(caseId: string) {
    await this.page.getByTestId(`case-row-${caseId}`).click();
    await this.waitForLoadingDone();
  }

  async expectCaseVisible(clientName: string) {
    await expect(
      this.page.locator('[data-testid^="case-row-"]').filter({ hasText: clientName }).first(),
      `Case for client "${clientName}" must appear in case list`,
    ).toBeVisible();
  }

  async expectCaseHidden(clientName: string) {
    await expect(
      this.page.locator('[data-testid^="case-row-"]').filter({ hasText: clientName }),
      `Case for client "${clientName}" must not appear in case list`,
    ).toHaveCount(0);
  }

  async expectStatusBadgeVisible(caseId: string, status: string) {
    await expect(
      this.page.getByTestId(`case-row-${caseId}`).getByText(status),
      `Case ${caseId} must show status "${status}"`,
    ).toBeVisible();
  }

  async expectNoCases() {
    await expect(
      this.page.getByText(/no cases|empty/i),
      'Empty state must be shown when no cases match',
    ).toBeVisible();
  }
}
