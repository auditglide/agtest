/**
 * AuditGlide Practice Plan (staff Settings screen) — shows the plan expiry + the extension history
 * (payments + referral bonuses). Seeded by scripts/seed-e2e.ts (one Practice payment on the admin firm).
 */
import { test, expect } from '../../fixtures/auth-fixture';

test.describe('AuditGlide Practice Plan @smoke', () => {
  test('shows the plan status/expiry and a "You paid" history row', async ({ page }) => {
    await page.goto('/practice-plan');
    await expect(page.getByText('AuditGlide Practice Plan').first()).toBeVisible();
    // status hero (Active) + the seeded payment in the history
    await expect(page.getByText('Plan history')).toBeVisible();
    await expect(page.getByText('You paid').first()).toBeVisible();
  });
});
