import { Page, expect } from '@playwright/test';
import { BasePage } from '../base.page';

export class CaseDetailPage extends BasePage {
  constructor(page: Page) { super(page); }

  private escapeRegex(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  async navigate(caseId: string) {
    await this.goto(`/cases/${caseId}`);
    await this.waitForLoadingDone();
  }

  private statusCard() {
    return this.page.locator('div.bg-white.rounded-xl.border').filter({
      has: this.page.getByRole('heading', { name: 'Status' }),
    }).first();
  }

  private statusBadge() {
    return this.statusCard().locator('span.inline-flex.rounded-full.border').first();
  }

  private paymentCard() {
    return this.page.locator('div.bg-white.rounded-xl.border').filter({
      has: this.page.getByRole('heading', { name: 'Payment' }),
    }).first();
  }

  private paymentHistoryTable() {
    return this.paymentCard().locator('table').first();
  }

  private paymentHistoryRows() {
    return this.paymentHistoryTable().locator('tbody tr');
  }

  private async getLoggedInUserName(): Promise<string> {
    const sessionUserName = await this.page.evaluate(() => {
      try {
        const raw = sessionStorage.getItem('user');
        if (!raw) return '';
        const parsed = JSON.parse(raw) as { name?: string };
        return parsed.name?.trim() ?? '';
      } catch {
        return '';
      }
    });

    if (sessionUserName) {
      return sessionUserName;
    }

    return (await this.page.getByTestId('text-user-name').first().textContent())?.trim() ?? '';
  }

  // ─── Status ───────────────────────────────────────────────────────────────

  async getCurrentStatus(): Promise<string> {
    const badge = this.statusBadge();
    return (await badge.textContent()) ?? '';
  }

  async expectStatus(status: string | RegExp) {
    await expect(
      this.statusBadge(),
      `Case status must match "${status}"`,
    ).toContainText(status);
  }

  async expectAssignedTo(name: string | RegExp) {
    await expect(
      this.page.locator('div.bg-white.rounded-xl.border').filter({
        has: this.page.getByRole('heading', { name: 'Assignment' }),
      }).getByText(name),
      `Case assignment card must mention "${name}"`,
    ).toBeVisible();
  }

  // ─── Payment ─────────────────────────────────────────────────────────────

  async expectPaymentSectionVisible() {
    await expect(
      this.page.getByRole('heading', { name: 'Payment' }),
      'Payment section must be visible on the case detail page',
    ).toBeVisible();
  }

  async expectPaymentSectionHidden() {
    await expect(
      this.page.getByRole('heading', { name: 'Payment' }),
      'Payment section must not be visible on the case detail page',
    ).not.toBeVisible();
  }

  async expectPaymentSummary(input: {
    totalDue?: string | RegExp;
    totalReceived?: string | RegExp;
    outstanding?: string | RegExp;
    paymentStatus?: string | RegExp;
  }) {
    const card = this.paymentCard();
    await expect(card, 'Payment card must be visible before verifying the payment summary').toBeVisible();

    if (input.totalDue !== undefined) {
      await expect(card, 'Total Due summary must match').toContainText(input.totalDue);
    }
    if (input.totalReceived !== undefined) {
      await expect(card, 'Total Received summary must match').toContainText(input.totalReceived);
    }
    if (input.outstanding !== undefined) {
      await expect(card, 'Outstanding summary must match').toContainText(input.outstanding);
    }
    if (input.paymentStatus !== undefined) {
      await expect(card, 'Payment status badge must match').toContainText(input.paymentStatus);
    }
  }

  async expectPaymentStatusBadge(status: string | RegExp) {
    await expect(
      this.paymentCard().locator('span.inline-flex.rounded-full').first(),
      'Payment status badge must be visible inside the payment card',
    ).toContainText(status);
  }

  async openEditTotalDueModal() {
    await this.paymentCard().locator('button[title="Edit total due"]').click();
    await expect(
      this.page.getByRole('dialog').getByText(/Edit Total Amount Due/i),
      'Edit Total Amount Due modal must open',
    ).toBeVisible();
  }

  async updateTotalDue(amount: string) {
    await this.openEditTotalDueModal();
    const dialog = this.page.getByRole('dialog');
    await dialog.locator('input[type="number"]').fill(amount);
    await dialog.getByRole('button', { name: /^Update$/i }).click();
    await this.waitForLoadingDone();
  }

  async enterPaymentAmount(amount: string) {
    const amountInput = this.paymentCard().locator('input[type="number"]').first();
    await expect(amountInput, 'Amount Received input must be visible before editing the payment preview').toBeVisible();
    await amountInput.fill(amount);
  }

  async enterPaymentNote(note: string) {
    const noteInput = this.paymentCard().locator('input[type="text"]').first();
    await expect(noteInput, 'Payment note input must be visible before editing the payment preview').toBeVisible();
    await noteInput.fill(note);
  }

  async recordPayment(input: {
    amount: string;
    note?: string;
    receipt?: { name: string; mimeType: string; buffer: Buffer };
  }) {
    const card = this.paymentCard();
    await this.enterPaymentAmount(input.amount);

    if (input.note !== undefined) {
      await this.enterPaymentNote(input.note);
    }

    if (input.receipt) {
      await card.locator('input[type="file"]').setInputFiles(input.receipt);
      await expect(
        card.getByText(input.receipt.name),
        `Uploaded receipt "${input.receipt.name}" must appear before payment submission`,
      ).toBeVisible();
    }

    await card.getByRole('button', { name: /Record Payment/i }).click();
    await this.waitForLoadingDone();
  }

  async expectPaymentPreview(input: {
    totalReceivedAfter: string | RegExp;
    outstandingAfter: string | RegExp;
    status: string | RegExp;
  }) {
    const card = this.paymentCard();
    await expect(card, 'Payment card must be visible before verifying the payment preview').toBeVisible();
    await expect(card, 'The payment preview must show the total received after recording').toContainText(input.totalReceivedAfter);
    await expect(card, 'The payment preview must show the outstanding amount after recording').toContainText(input.outstandingAfter);
    await expect(card, 'The payment preview must show the derived status').toContainText(input.status);
  }

  async expectPaymentFormError(text: string | RegExp) {
    await expect(
      this.paymentCard().getByText(text),
      `Payment form error "${text}" must be visible`,
    ).toBeVisible();
  }

  async expectRecordPaymentFormVisible() {
    await expect(
      this.paymentCard().getByRole('button', { name: /Record Payment/i }),
      'Record Payment form must be visible for editable payment states',
    ).toBeVisible();
  }

  async expectRecordPaymentFormHidden() {
    await expect(
      this.paymentCard().getByRole('button', { name: /Record Payment/i }),
      'Record Payment form must be hidden for finalised payment states',
    ).not.toBeVisible();
  }

  async expectReopenPaymentVisible() {
    await expect(
      this.paymentCard().getByRole('button', { name: /Reopen Payment/i }),
      'Reopen Payment button must be visible for fully paid cases',
    ).toBeVisible();
  }

  async expectReverseWriteOffVisible() {
    await expect(
      this.paymentCard().getByRole('button', { name: /Reverse Write-Off/i }),
      'Reverse Write-Off button must be visible for written-off cases',
    ).toBeVisible();
  }

  async expectWriteOffVisible() {
    await expect(
      this.paymentCard().getByRole('button', { name: /^Write Off$/i }),
      'Write Off button must be visible for unpaid payment states',
    ).toBeVisible();
  }

  async expectWriteOffHidden() {
    await expect(
      this.paymentCard().getByRole('button', { name: /^Write Off$/i }),
      'Write Off button must be hidden when the payment state should not allow write-off',
    ).not.toBeVisible();
  }

  async reopenPayment() {
    await this.paymentCard().getByRole('button', { name: /Reopen Payment/i }).click();
    await this.waitForLoadingDone();
  }

  async openWriteOffModal() {
    await this.paymentCard().getByRole('button', { name: /^Write Off$/i }).click();
    await expect(
      this.page.getByRole('dialog').getByText(/Write Off Payment/i),
      'Write Off modal must open',
    ).toBeVisible();
  }

  async writeOff(reason: string) {
    await this.openWriteOffModal();
    const dialog = this.page.getByRole('dialog');
    await dialog.locator('input[type="text"]').fill(reason);
    await dialog.getByRole('button', { name: /Confirm Write Off/i }).click();
    await this.waitForLoadingDone();
  }

  async reverseWriteOff() {
    await this.paymentCard().getByRole('button', { name: /Reverse Write-Off/i }).click();
    await this.waitForLoadingDone();
  }

  async clickCorrectPaymentEntryAt(index = 0) {
    await this.paymentHistoryTable().locator('tbody tr').nth(index).locator('button[title="Correct this entry"]').click();
    await expect(
      this.page.getByRole('dialog').getByText(/Correct Payment Entry/i),
      'Correct Payment Entry modal must open',
    ).toBeVisible();
  }

  async correctPaymentEntry(input: {
    correctedAmount: string;
    reason: string;
    note?: string;
    rowIndex?: number;
  }) {
    await this.clickCorrectPaymentEntryAt(input.rowIndex ?? 0);
    const dialog = this.page.getByRole('dialog');
    await dialog.locator('input[type="number"]').fill(input.correctedAmount);
    await dialog.locator('input[type="text"]').nth(0).fill(input.reason);
    if (input.note !== undefined) {
      await dialog.locator('input[type="text"]').nth(1).fill(input.note);
    }
    await dialog.getByRole('button', { name: /Apply Correction/i }).click();
    await this.waitForLoadingDone();
  }

  async expectPaymentHistoryRowCount(count: number) {
    await expect(
      this.paymentHistoryRows(),
      `Payment history must contain ${count} row(s)`,
    ).toHaveCount(count);
  }

  async expectPaymentHistoryContains(text: string | RegExp) {
    await expect(
      this.paymentHistoryTable().getByText(text),
      `Payment history must contain "${text}"`,
    ).toBeVisible();
  }

  async expectPaymentHistoryRowVisible(index: number, text: string | RegExp) {
    await expect(
      this.paymentHistoryRows().nth(index).getByText(text),
      `Payment history row ${index} must contain "${text}"`,
    ).toBeVisible();
  }

  async expectPaymentHistoryNewestFirst(values: Array<string | RegExp>) {
    for (let i = 0; i < values.length; i += 1) {
      await this.expectPaymentHistoryRowVisible(i, values[i]);
    }
  }

  async expectPaymentHistoryVoided(index = 0) {
    await expect(
      this.paymentHistoryRows().nth(index).getByText(/Voided/i),
      `Payment history row ${index} must show the Voided label`,
    ).toBeVisible();
  }

  async expectPaymentHistoryStruckThrough(index = 0) {
    await expect(
      this.paymentHistoryRows().nth(index).locator('.line-through').first(),
      `Payment history row ${index} must render the corrected values with strikethrough styling`,
    ).toBeVisible();
  }

  async expectPaymentHistoryTooltip(text: string | RegExp) {
    const noteCell = this.paymentHistoryRows().first().locator('[title]').first();
    await expect(noteCell, 'Payment history tooltip cell must exist').toBeVisible();
    await expect(noteCell, 'Payment history tooltip must expose the full note/reason').toHaveAttribute('title', text);
  }

  async expectPaymentReceiptIconVisible() {
    await expect(
      this.paymentHistoryRows().first().locator('button[title]').first(),
      'Payment history row must show a clickable receipt icon',
    ).toBeVisible();
  }

  async expectPaymentReceiptNamed(filename: string) {
    await expect(
      this.paymentHistoryTable().locator(`button[title="${filename}"]`).first(),
      `Payment history must include a receipt icon titled "${filename}"`,
    ).toBeVisible();
  }

  async openPaymentReceipt(index = 0) {
    const [popup] = await Promise.all([
      this.page.waitForEvent('popup'),
      this.paymentHistoryRows().nth(index).locator('button[title]').first().click(),
    ]);
    await popup.waitForLoadState('domcontentloaded').catch(() => {});
    return popup;
  }

  async expectSeparateStatusBadges(caseStatus: string | RegExp, paymentStatus: string | RegExp) {
    await this.expectStatus(caseStatus);
    await this.expectPaymentStatusBadge(paymentStatus);
  }

  // ─── Transitions ─────────────────────────────────────────────────────────

  async transitionTo(status: string) {
    const normalizedStatus =
      status === 'Completed' ? 'Completed - Pending Verification' : status;

    if (normalizedStatus === 'Assigned') {
      const assignTrigger = this.page.getByTestId('select-assign-user');
      await expect(assignTrigger, 'Assignment selector must be visible for New → Assigned').toBeVisible();
      await assignTrigger.click();

      const currentUserName = await this.getLoggedInUserName();
      const currentUserOption = currentUserName
        ? this.page.getByRole('option', { name: new RegExp(`^${this.escapeRegex(currentUserName)}\\b`, 'i') }).first()
        : null;

      if (currentUserOption && await currentUserOption.isVisible().catch(() => false)) {
        await currentUserOption.click();
      } else {
        await this.page.getByRole('option').first().click();
      }

      await this.click('button-assign');
      await this.waitForLoadingDone();
      return;
    }

    const trigger = this.page.getByTestId('select-next-status');
    await expect(trigger, `Status selector must be visible for transition to "${normalizedStatus}"`).toBeVisible();
    await this.selectOption('select-next-status', normalizedStatus);

    if (normalizedStatus === 'Rework Required') {
      const reworkAssignTrigger = this.page.getByTestId('select-rework-assign');
      await expect(
        reworkAssignTrigger,
        'Rework assignee selector must be visible when sending a case to Rework Required',
      ).toBeVisible();
      await reworkAssignTrigger.click();

      const currentUserName = await this.getLoggedInUserName();
      const currentUserOption = currentUserName
        ? this.page.getByRole('option', { name: new RegExp(`^${this.escapeRegex(currentUserName)}\\b`, 'i') }).first()
        : null;

      if (currentUserOption && await currentUserOption.isVisible().catch(() => false)) {
        await currentUserOption.click();
      } else {
        await this.page.getByRole('option').first().click();
      }
    }

    await this.click('button-update-status');
    await this.waitForLoadingDone();
  }

  async expectTransitionButtonAbsent(status: string) {
    const trigger = this.page.getByTestId('select-next-status');
    if (!(await trigger.isVisible().catch(() => false))) {
      return;
    }

    await trigger.click();
    await expect(
      this.page.getByRole('option', { name: new RegExp(status, 'i') }),
      `Transition option "${status}" must NOT be present (invalid transition)`,
    ).not.toBeVisible();
  }

  async flagCase() {
    await this.click('button-flag-case');
    await this.waitForLoadingDone();
  }

  async reopenOwnCase() {
    await this.page.getByRole('button', { name: /Reopen Case/i }).click();
    await this.clickDialogButton(/Reopen/i);
    await this.waitForLoadingDone();
  }

  // ─── Notes ───────────────────────────────────────────────────────────────

  async addNote(text: string) {
    await this.click('button-add-note');
    await this.fill('input-note', text);
    await this.click('button-submit-note');
    await this.waitForLoadingDone();
  }

  async expectNoteVisible(text: string) {
    await expect(
      this.page.locator('div.bg-white.rounded-xl.border').filter({
        has: this.page.getByRole('heading', { name: 'Notes' }),
      }).getByText(text),
      `Note "${text}" must appear in case notes`,
    ).toBeVisible();
  }

  async getNoteCount(): Promise<number> {
    return this.page.locator('div.bg-white.rounded-xl.border').filter({
      has: this.page.getByRole('heading', { name: 'Notes' }),
    }).locator('div.flex.gap-3').count();
  }

  // ─── Documents ───────────────────────────────────────────────────────────

  async uploadDocument(file: { name: string; mimeType: string; buffer: Buffer }) {
    await this.page.locator('input[type="file"]').setInputFiles(file);
  }

  async expectDocumentVisible(name: string) {
    await expect(
      this.page.locator('div.bg-white.rounded-xl.border').filter({
        has: this.page.getByRole('heading', { name: 'Documents' }),
      }).getByText(name),
      `Document "${name}" must appear in the documents list`,
    ).toBeVisible();
  }

  // ─── History ─────────────────────────────────────────────────────────────

  async expectHistoryEntry(oldStatus: string, newStatus: string) {
    const historyButton = this.byTestId('button-case-history');
    if (await historyButton.isVisible().catch(() => false)) {
      await historyButton.click();
    }
    const history = this.page.locator('[role="dialog"]').filter({
      has: this.page.getByRole('heading', { name: /Case History/i }),
    });
    await expect(
      history.getByText(new RegExp(`${oldStatus}.*${newStatus}|${newStatus}`, 'i')),
      `History must show transition from "${oldStatus}" to "${newStatus}"`,
    ).toBeVisible();
  }
}
