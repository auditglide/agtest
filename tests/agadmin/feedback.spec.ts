/**
 * agadmin (ops) feedback triage E2E — open the seeded bug report, reply, and resolve it.
 * Runs against the agadmin app (default :3100), its own login. Fixture seeded by scripts/seed-e2e.ts
 * ("E2E: Verify button spins forever" bug on "E2E Test Firm"). See docs/feedback-and-bugs.md.
 */
import { test, expect } from '@playwright/test';

const AGADMIN = process.env.AGADMIN_URL ?? 'http://localhost:3100';
const BUG_TEXT = 'E2E: Verify button spins forever';

test.describe('agadmin feedback triage @smoke', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${AGADMIN}/login`);
    await page.getByLabel('Email').fill('e2e_ops@auditglide.test');
    await page.getByLabel('Password').fill('E2eOps@12345');
    await page.getByRole('button', { name: /Sign in/i }).click();
    await expect(page).toHaveURL(/\/firms$/);
  });

  test('Feedback & Bugs → open the report → reply + resolve', async ({ page }) => {
    await page.getByRole('link', { name: /Feedback & Bugs/i }).click();
    await expect(page).toHaveURL(/\/feedback$/);

    // The seeded bug (status new) is listed; open its detail.
    await expect(page.getByText(BUG_TEXT).first()).toBeVisible();
    await page.getByText(BUG_TEXT).first().click();

    // Detail modal — write a reply and mark resolved.
    await expect(page.getByText(/Reply to firm/i)).toBeVisible();
    await page.getByPlaceholder(/reply the firm will see/i).fill('E2E ops reply: fixed in the latest release.');
    await page.locator('select').last().selectOption('resolved');   // the modal's status select
    await page.getByRole('button', { name: /^Save$/ }).click();

    // Modal closes; with the default "New" filter the resolved item drops out of the list.
    await expect(page.getByText(/Reply to firm/i)).toBeHidden();
    await expect(page.getByText(BUG_TEXT)).toHaveCount(0);
  });
});
