/**
 * Firm Referral (staff Settings screen) — shows the firm's referral code, invite link, and the funnel of
 * referred firms with a claimable bonus. Seeded by scripts/seed-e2e.ts (code 910001 + one referred firm
 * that has paid → claimable ₹500).
 */
import { test, expect } from '../../fixtures/auth-fixture';

test.describe('Firm Referral @smoke', () => {
  test('shows the referral code and a claimable referred firm', async ({ page }) => {
    await page.goto('/firm-referral');
    await expect(page.getByText('910001').first()).toBeVisible();       // the firm's referral code
    await expect(page.getByText('E2E Referred Firm')).toBeVisible();     // the referred firm row
    await expect(page.getByRole('button', { name: /Claim your referral/i })).toBeVisible();
  });
});
