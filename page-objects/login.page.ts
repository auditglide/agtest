import { Page, expect } from '@playwright/test';
import { BasePage } from './base.page';
import { waitForAuthRequestSlot } from '../helpers/auth-rate-limit.helper';

export class LoginPage extends BasePage {
  constructor(page: Page) { super(page); }

  private readonly protectedRoutePattern = /\/(dashboard|clients|compliance|cases)/;

  async navigate() {
    await this.goto('/login');
    await expect(this.byTestId('input-email'), 'Login page must load').toBeVisible();
  }

  async login(email: string, password: string) {
    await this.fill('input-email', email);
    await this.fill('input-password', password);
    await waitForAuthRequestSlot();
    await this.click('button-submit-login');
  }

  async loginAndExpectSuccess(email: string, password: string) {
    const rateLimitBanner = this.page
      .locator('[class*="error"], [role="alert"], [data-testid*="error"]')
      .filter({ hasText: /too many requests|please slow down/i })
      .first();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await this.login(email, password);

      try {
        await expect(
          this.page,
          'Login must land on a protected route',
        ).toHaveURL(this.protectedRoutePattern, {
          timeout: 15_000,
        });
        return;
      } catch (error) {
        const isRateLimited = await rateLimitBanner.isVisible().catch(() => false);
        if (!isRateLimited || attempt === 2) {
          throw error;
        }

        const backoffMs = attempt === 0 ? 20_000 : 45_000;
        await this.page.waitForTimeout(backoffMs);
      }
    }
  }

  async loginAndExpectError(email: string, password: string, errorText: string | RegExp) {
    await this.login(email, password);
    const errorEl = this.page.locator('[class*="error"], [role="alert"], [data-testid*="error"]').filter({ hasText: errorText });
    await expect(errorEl.first(), `Login error banner must show: "${errorText}"`).toBeVisible({ timeout: 5_000 });
    // Must stay on login page
    await expect(this.page, 'Must remain on /login after failed login').toHaveURL(/\/login/);
  }

  async expectFirstLoginRedirect() {
    await this.page.waitForURL(/change-password|first-login/, { timeout: 10_000 });
  }

  async changePassword(current: string, next: string) {
    await this.fill('input-current-password', current);
    await this.fill('input-new-password', next);
    await this.fill('input-confirm-password', next);
    await this.click('button-change-password');
  }
}
