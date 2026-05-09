import { Page, expect } from '@playwright/test';
import { BasePage } from './base.page';

export class OnboardingPage extends BasePage {
  constructor(page: Page) { super(page); }

  async navigate() {
    await this.goto('/onboarding');
    await this.waitForLoadingDone();
  }

  // Step 1 — Enter email
  async enterEmail(email: string) {
    await this.fill('input-onboarding-email', email);
    await this.click('button-send-code');
  }

  /**
   * Step 2 — Enter the verification code received by email.
   *
   * If ONBOARDING_VERIFICATION_CODE is not set, the test pauses so you can
   * manually enter the code in the browser. After entering it, resume the
   * test run in the terminal (press Enter or click the Resume button in the
   * Playwright Inspector).
   */
  async enterVerificationCode(code?: string) {
    const resolvedCode = code ?? process.env.ONBOARDING_VERIFICATION_CODE;

    if (!resolvedCode) {
      console.log('\n⚠️  Verification code not set. Pausing test.');
      console.log('   Enter the code in the browser, then resume the Playwright Inspector.\n');
      await this.page.pause();
    } else {
      // The code may be a single 6-digit input or 6 individual digit inputs
      const singleInput = this.page.getByTestId('input-verification-code');
      const digitInputs = this.page.getByTestId(/input-code-digit-/);

      if (await singleInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await singleInput.fill(resolvedCode);
      } else if (await digitInputs.first().isVisible({ timeout: 3_000 }).catch(() => false)) {
        const digits = resolvedCode.split('');
        for (let i = 0; i < digits.length; i++) {
          await this.page.getByTestId(`input-code-digit-${i}`).fill(digits[i]);
        }
      } else {
        throw new Error(
          'Cannot find verification code input. ' +
          'Expected [data-testid="input-verification-code"] or [data-testid="input-code-digit-N"].',
        );
      }

      await this.click('button-verify-code');
    }
  }

  // Step 3 — Firm & admin details
  async fillFirmDetails(details: {
    firmName: string;
    adminName: string;
    password: string;
  }) {
    await this.fill('input-firm-name', details.firmName);
    await this.fill('input-admin-name', details.adminName);
    await this.fill('input-password',   details.password);
    await this.fill('input-confirm-password', details.password);
  }

  async submitOnboarding() {
    await this.click('button-complete-onboarding');
  }

  async expectOnboardingSuccess() {
    // After successful onboarding the user lands on login or dashboard
    await expect(this.page, 'Must redirect after successful onboarding').toHaveURL(
      /login|dashboard|clients/, { timeout: 15_000 },
    );
  }

  async expectStepVisible(stepLabel: string | RegExp) {
    await expect(
      this.page.getByText(stepLabel),
      `Onboarding step "${stepLabel}" must be visible`,
    ).toBeVisible();
  }
}
