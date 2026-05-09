import { Page, expect } from '@playwright/test';
import { BasePage } from '../base.page';

export class ComplianceDetailPage extends BasePage {
  constructor(page: Page) { super(page); }

  private periodLabelForIndex(period: number, frequency: 'Monthly' | 'Quarterly' | 'Yearly'): string {
    if (frequency === 'Monthly') {
      return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][period] ?? 'Jan';
    }
    if (frequency === 'Quarterly') {
      return ['Q1 Apr – Jun', 'Q2 Jul – Sep', 'Q3 Oct – Dec', 'Q4 Jan – Mar'][period] ?? 'Q1 Apr – Jun';
    }
    return 'Financial Year  (Apr – Mar)';
  }

  private scheduleRoot() {
    return this.page.locator(
      'xpath=(//h3[normalize-space()="Schedule"]/ancestor::div[contains(@class,"bg-white")][1])[last()]',
    );
  }

  private scheduleTile(period: number, frequency: 'Monthly' | 'Quarterly' | 'Yearly') {
    const label = this.periodLabelForIndex(period, frequency);
    return this.scheduleRoot().locator(
      `xpath=.//p[normalize-space()="${label}"]/ancestor::div[contains(@class,"rounded-xl")][1]`,
    );
  }

  private subtypeRow(name: string) {
    return this.page.getByTestId('subtypes-table').locator('tbody tr').filter({
      has: this.page.getByRole('cell', { name, exact: true }),
    });
  }

  async navigate(ctId: string) {
    const complianceNameInput = this.byTestId('input-type');
    const onTargetDetailPage = await this.page
      .url()
      .match(new RegExp(`/compliance/${ctId}(?:\\?.*)?$`));
    const detailInputVisible = await complianceNameInput.isVisible().catch(() => false);

    if (onTargetDetailPage && !detailInputVisible) {
      await this.page.reload();
      await this.page.waitForLoadState('domcontentloaded');
      await this.waitForLoadingDone();
      await this.recoverFromRateLimit(async () => {
        await this.page.reload();
        await this.page.waitForLoadState('domcontentloaded');
      }, 'Compliance detail page');
      return;
    }

    if (!onTargetDetailPage || !detailInputVisible) {
      await this.page.goto(`/compliance/${ctId}`);
      await this.page.waitForLoadState('domcontentloaded');
      await expect(this.page, 'Must navigate to the requested compliance detail page').toHaveURL(
        new RegExp(`/compliance/${ctId}(?:\\?.*)?$`),
      );
    }

    await this.waitForLoadingDone();
    await this.recoverFromRateLimit(async () => {
      await this.page.reload();
      await this.page.waitForLoadState('domcontentloaded');
    }, 'Compliance detail page');
  }

  // ─── CT header / status ───────────────────────────────────────────────────

  async editName(name: string) {
    await this.fill('input-type', name);
  }

  async saveChanges() {
    await this.click('button-save');
    await this.waitForLoadingDone();
  }

  async toggleActive(active: boolean) {
    const toggle = this.page.locator('label:has-text("Active") input[type="checkbox"]').first();
    await expect(toggle, 'Active checkbox must be visible on the compliance detail page').toBeVisible();
    const current = await toggle.isChecked();
    if (current !== active) await toggle.click();
  }

  async setNeedsWorkAllocation(needsWorkAllocation: boolean) {
    const label = needsWorkAllocation ? 'Needs Work Allocation' : 'No Work Allocation Needed';
    const radio = this.page
      .locator('label')
      .filter({ hasText: label })
      .locator('input[type="radio"]')
      .first();

    await expect(
      radio,
      `Work allocation radio "${label}" must be visible on the compliance detail page`,
    ).toBeVisible();

    if (!(await radio.isChecked())) {
      await radio.click();
    }
  }

  async expectNeedsWorkAllocation(needsWorkAllocation: boolean) {
    const label = needsWorkAllocation ? 'Needs Work Allocation' : 'No Work Allocation Needed';
    const radio = this.page
      .locator('label')
      .filter({ hasText: label })
      .locator('input[type="radio"]')
      .first();

    await expect(
      radio,
      `Work allocation radio "${label}" must stay selected after saving`,
    ).toBeChecked();
  }

  async saveAndHandleInactiveModal(choice: 'keep' | 'delete' | 'cancel') {
    await this.saveChanges();
    await this.expectDialogVisible(/inactive|deactivate/i);
    if (choice === 'cancel') {
      await this.clickDialogButton(/Cancel/);
    } else if (choice === 'delete') {
      await this.clickDialogButton(/Proceed with removing current cases/i);
      await this.waitForLoadingDone();
    } else {
      await this.clickDialogButton(/Proceed without removing current cases/i);
      await this.waitForLoadingDone();
    }
  }

  // ─── Schedule editor ──────────────────────────────────────────────────────

  /**
   * Fill a schedule row in the schedule editor.
   * period: 0-based index matching the period selector.
   */
  async fillScheduleRow(period: number, data: {
    creationMonthOffset: number;
    creationDay: number;
    deadlineMonthOffset: number;
    deadlineDay: number;
  }, frequency: 'Monthly' | 'Quarterly' | 'Yearly' = 'Monthly') {
    const tile = this.scheduleTile(period, frequency);
    const editButton = tile.getByTitle('Edit this period');
    if (await editButton.isVisible().catch(() => false)) {
      await editButton.scrollIntoViewIfNeeded();
      await editButton.click();
    }

    const creationRow = tile.locator('xpath=.//p[normalize-space()="Case creation date"]/following-sibling::div[1]');
    const deadlineRow = tile.locator('xpath=.//p[normalize-space()="Deadline date"]/following-sibling::div[1]');
    await expect(
      creationRow.locator('select'),
      `Schedule row ${period} must enter edit mode before selecting dates`,
    ).toBeVisible({ timeout: 10_000 });

    await creationRow.locator('select').selectOption(String(data.creationMonthOffset));
    await creationRow.locator('input[type="number"]').fill(String(data.creationDay));
    await deadlineRow.locator('select').selectOption(String(data.deadlineMonthOffset));
    await deadlineRow.locator('input[type="number"]').fill(String(data.deadlineDay));

    const saveButton = tile.getByRole('button', { name: /save/i });
    if (await saveButton.isEnabled().catch(() => false)) {
      await saveButton.click();
    }
  }

  /** Fill all rows of a schedule with the same offsets (for schedule combo tests). */
  async fillAllScheduleRows(
    frequency: 'Monthly' | 'Quarterly' | 'Yearly',
    data: { creationMonthOffset: number; creationDay: number; deadlineMonthOffset: number; deadlineDay: number },
  ) {
    if (frequency === 'Monthly') {
      const root = this.scheduleRoot();
      const seedPanel = root.locator('xpath=.//*[contains(text(),"Set date pattern")]/ancestor::div[contains(@class,"rounded-xl")][1]');
      const creationRow = seedPanel.locator('div.space-y-1').nth(0);
      const deadlineRow = seedPanel.locator('div.space-y-1').nth(1);

      await creationRow.locator('select').selectOption(String(data.creationMonthOffset));
      await creationRow.locator('input[type="number"]').fill(String(data.creationDay));
      await deadlineRow.locator('select').selectOption(String(data.deadlineMonthOffset));
      await deadlineRow.locator('input[type="number"]').fill(String(data.deadlineDay));

      const applyButton = seedPanel.getByRole('button', { name: /Apply to all 12 months/i });
      if (await applyButton.isEnabled().catch(() => false)) {
        await applyButton.click();
      }
      return;
    }

    const count = frequency === 'Quarterly' ? 4 : 1;
    for (let i = 0; i < count; i += 1) {
      await this.fillScheduleRow(i, data, frequency);
    }
  }

  async clickAnalyzeSchedule() {
    await this.saveChanges();
  }

  async expectScheduleImpactDialog() {
    await this.expectDialogVisible(/schedule change|impact/i);
  }

  async expectScenario1Impact(casesCount: number) {
    await expect(
      this.page.locator('[role="dialog"]').getByText(new RegExp(`${casesCount}.*case`, 'i')),
      `Scenario 1 impact dialog must mention ${casesCount} case(s) to create`,
    ).toBeVisible();
  }

  async expectScenario2Impact() {
    await expect(
      this.page.locator('[role="dialog"]').getByText(/existing cases will be deleted/i),
      'Scenario 2 impact dialog must mention deletion of cases',
    ).toBeVisible();
  }

  async confirmScheduleImpact() {
    await this.clickDialogButton(/confirm|apply/i);
    await this.waitForLoadingDone();
  }

  async expectScheduleInvalidError() {
    await expect(
      this.page.getByText(/invalid.*schedule|deadline.*after.*creation/i),
      'Schedule validation error must be shown',
    ).toBeVisible();
  }

  // ─── Subtypes ─────────────────────────────────────────────────────────────

  async openAddSubtypeModal() {
    await this.click('button-add-subtype');
    await expect(this.page.getByRole('dialog'), 'Add subtype dialog must open').toBeVisible();
  }

  async fillSubtypeForm(name: string) {
    await this.fill('input-subtype-name', name);
  }

  async submitSubtype() {
    await this.click('button-subtype-submit');
    await this.waitForLoadingDone();
  }

  async expectSubtypeVisible(name: string) {
    await expect(
      this.subtypeRow(name),
      `Subtype "${name}" must appear on the CT detail page`,
    ).toBeVisible();
  }

  async expectSubtypeHidden(name: string) {
    await expect(
      this.subtypeRow(name),
      `Subtype "${name}" must not appear on the CT detail page`,
    ).toHaveCount(0);
  }

  async editSubtype(subtypeId: string) {
    await this.page.getByTestId(`button-edit-subtype-${subtypeId}`).click();
    await expect(this.page.getByRole('dialog')).toBeVisible();
  }

  async deleteSubtype(subtypeId: string) {
    await this.page.getByTestId(`button-delete-subtype-${subtypeId}`).click();
    await this.expectDialogVisible(/delete.*sub/i);
    await this.clickDialogButton(/Delete/i);
    await this.waitForLoadingDone();
  }

  async toggleSubtypeActive(subtypeId: string, active: boolean) {
    const toggle = this.page.getByTestId(`toggle-subtype-active-${subtypeId}`);
    const current = await toggle.isChecked();
    if (current !== active) await toggle.click();
  }

  // ─── Assigned clients ─────────────────────────────────────────────────────

  async toggleShowInactiveClients(on: boolean) {
    const toggle = this.byTestId('toggle-show-inactive-clients');
    const isChecked = await toggle.isChecked();
    if (isChecked !== on) await toggle.click();
    await this.waitForLoadingDone();
  }

  async expectClientInList(name: string) {
    await expect(
      this.page.locator('table').getByText(name),
      `Client "${name}" must appear in assigned clients list`,
    ).toBeVisible();
  }

  async expectClientNotInList(name: string) {
    await expect(
      this.page.locator('table').getByText(name),
      `Client "${name}" must NOT appear in assigned clients list`,
    ).not.toBeVisible();
  }

  async expectInactiveBadgeForClient(name: string) {
    const row = this.page.locator(`tr:has-text("${name}")`);
    await expect(
      row.getByText('Inactive'),
      `Inactive badge must appear for "${name}" in the assigned clients list`,
    ).toBeVisible();
  }

  async openAssignClientsModal() {
    await this.click('button-assign-clients');
    await expect(this.page.getByRole('dialog'), 'Assign clients dialog must open').toBeVisible();
  }

  async selectClientInModal(name: string) {
    const item = this.page.locator('[role="dialog"]').getByText(name);
    await expect(item, `Client "${name}" must appear in assign modal`).toBeVisible();
    await item.click();
  }

  async searchAssignClientsModal(query: string) {
    const search = this.page.locator('[role="dialog"]').getByPlaceholder('Search by name, PAN, or GSTN…');
    await expect(search, 'Assign clients modal search input must be visible').toBeVisible();
    await search.fill(query);
  }

  async expectAssignModalClientVisible(name: string) {
    await expect(
      this.page.locator('[role="dialog"]').locator('label').filter({ hasText: name }).first(),
      `Client "${name}" must be visible in the assign clients modal`,
    ).toBeVisible();
  }

  async expectAssignModalClientHidden(name: string) {
    await expect(
      this.page.locator('[role="dialog"]').locator('label').filter({ hasText: name }),
      `Client "${name}" must not be visible in the assign clients modal`,
    ).toHaveCount(0);
  }

  async confirmAssign() {
    await this.page.locator('[role="dialog"]').getByRole('button', { name: /assign/i }).click();
    await this.waitForLoadingDone();
  }

  async unassignClients(names: string[], deleteCases: boolean) {
    for (const name of names) {
      const row = this.page.locator(`tr:has-text("${name}")`);
      await row.locator('input[type="checkbox"]').check();
    }
    await this.click('button-unassign-clients');
    await this.expectDialogVisible(/unassign/i);
    if (deleteCases) {
      await this.clickDialogButton(/Yes.*unassign.*delete/i);
    } else {
      await this.clickDialogButton(/No.*just unassign/i);
    }
    await this.waitForLoadingDone();
  }
}
