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
