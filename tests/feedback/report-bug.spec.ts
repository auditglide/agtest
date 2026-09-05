/**
 * Feedback / bug reporting (staff app) — submit a bug from the user menu and see it in My submissions.
 * Uses the authenticated staff fixture (e2e_admin@auditglide.test). See docs/feedback-and-bugs.md.
 */
import { test, expect } from '../../fixtures/auth-fixture';

test.describe('Feedback — report a bug @smoke', () => {
  test('submit a bug from the menu → it appears under My submissions', async ({ page }) => {
    // The fixture leaves us authenticated on /clients. Dismiss the attendance check-in modal if it's up
    // (it overlays the page and would intercept clicks).
    const skip = page.getByText('Skip for now', { exact: false }).first();
    if (await skip.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await skip.click().catch(() => {});
      await skip.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
    }

    // Kill CSS animations so the dialog is immediately "stable" for Playwright's actionability checks.
    await page.addStyleTag({ content: '*,*::before,*::after{animation-duration:.01ms!important;animation-delay:0s!important;transition-duration:.01ms!important}' });

    const unique = `E2E bug ${Date.now()}`;

    // Open the user menu and start a bug report.
    await page.locator('[data-testid="button-user-menu"]:visible').first().click();
    await page.getByTestId('menu-report-bug').click();

    // Fill and submit the dialog.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await page.getByTestId('feedback-message').fill(unique);
    const submit = dialog.getByTestId('feedback-submit');
    await expect(submit).toBeEnabled();
    await submit.click();

    // Success toast.
    await expect(page.getByText(/we've logged this/i).first()).toBeVisible();

    // The report shows up in My submissions.
    await page.goto('/feedback/mine');
    await expect(page.getByText(unique)).toBeVisible();
  });
});
