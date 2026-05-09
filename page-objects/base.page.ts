import { Page, Locator, expect } from '@playwright/test';

export class BasePage {
  constructor(readonly page: Page) {}

  private readonly rateLimitPattern = /too many requests\. please slow down\./i;

  // ─── Navigation ───────────────────────────────────────────────────────────

  async goto(path: string) {
    await this.page.goto(path);
  }

  // ─── Wait helpers ─────────────────────────────────────────────────────────

  /** Wait for a visible toast / notification matching the given text. */
  async expectToast(text: string | RegExp) {
    const toast = this.page.locator('[role="status"], [data-testid*="toast"], .toast, [class*="toast"]').filter({ hasText: text });
    await expect(toast.first(), `Expected toast with text: "${text}"`).toBeVisible({ timeout: 8_000 });
  }

  /** Wait until no loading spinner is visible. */
  async waitForLoadingDone() {
    await this.page.waitForFunction(() => {
      const spinners = document.querySelectorAll('[class*="spinner"], [class*="loading"], [aria-label*="loading"]');
      return spinners.length === 0;
    }, { timeout: 20_000 });
  }

  async hasRateLimitBanner(): Promise<boolean> {
    return this.page.getByText(this.rateLimitPattern).first().isVisible().catch(() => false);
  }

  async recoverFromRateLimit(
    retryAction: () => Promise<void>,
    description: string,
    attempts = 3,
  ) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (!await this.hasRateLimitBanner()) {
        return;
      }

      await this.page.waitForTimeout(4_000 * (attempt + 1));
      await retryAction();
      await this.waitForLoadingDone();
    }

    await expect(
      this.page.getByText(this.rateLimitPattern).first(),
      `${description} must recover from rate limiting`,
    ).not.toBeVisible();
  }

  // ─── Form helpers ─────────────────────────────────────────────────────────

  async fill(testId: string, value: string) {
    const el = this.page.getByTestId(testId);
    await expect(el, `Input [data-testid="${testId}"] must be visible`).toBeVisible();
    await el.clear();
    await el.fill(value);
  }

  async click(testId: string) {
    const el = this.page.getByTestId(testId);
    await expect(el, `Button [data-testid="${testId}"] must be visible and enabled`).toBeEnabled();
    await el.click();
  }

  async selectOption(testId: string, label: string) {
    const trigger = this.page.getByTestId(testId);
    await trigger.click();
    await this.page.getByRole('option', { name: label }).click();
  }

  // ─── Assertion helpers ────────────────────────────────────────────────────

  async expectVisible(testId: string, description?: string) {
    await expect(
      this.page.getByTestId(testId),
      description ?? `[data-testid="${testId}"] must be visible`,
    ).toBeVisible();
  }

  async expectHidden(testId: string, description?: string) {
    await expect(
      this.page.getByTestId(testId),
      description ?? `[data-testid="${testId}"] must not be visible`,
    ).not.toBeVisible();
  }

  async expectText(testId: string, text: string | RegExp) {
    await expect(
      this.page.getByTestId(testId),
      `[data-testid="${testId}"] must contain "${text}"`,
    ).toContainText(text);
  }

  async expectUrl(pattern: string | RegExp) {
    await expect(this.page, `URL must match ${pattern}`).toHaveURL(pattern);
  }

  // ─── Dialog helpers ───────────────────────────────────────────────────────

  /** Click a button inside the currently open alert dialog. */
  async clickDialogButton(label: string | RegExp) {
    const dialog = this.page.locator('[role="alertdialog"], [role="dialog"]').last();
    await dialog.getByRole('button', { name: label }).click();
  }

  async expectDialogVisible(titleText?: string | RegExp) {
    const dialog = this.page.locator('[role="alertdialog"], [role="dialog"]').last();
    await expect(dialog, 'Dialog must be open').toBeVisible();
    if (titleText) {
      await expect(dialog, `Dialog must show title: "${titleText}"`).toContainText(titleText);
    }
  }

  // ─── Locator shortcuts ────────────────────────────────────────────────────

  byTestId(id: string): Locator { return this.page.getByTestId(id); }
  byText(text: string | RegExp): Locator { return this.page.getByText(text); }
  byRole(role: Parameters<Page['getByRole']>[0], options?: Parameters<Page['getByRole']>[1]): Locator {
    return this.page.getByRole(role, options);
  }
}
