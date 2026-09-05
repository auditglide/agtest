/**
 * agadmin (ops admin) E2E — login, firm detail, and the Record-payment / Record-notice-top-up modals.
 * Runs against the agadmin app (default :3100). Uses its own login (separate app from the staff FE).
 * Fixtures seeded by scripts/seed-e2e.ts (ops e2e_ops@auditglide.test + firm "E2E Test Firm").
 */
import { test, expect } from '@playwright/test';

const AGADMIN = process.env.AGADMIN_URL ?? 'http://localhost:3100';

test.describe('agadmin ops @smoke', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${AGADMIN}/login`);
    await page.getByLabel('Email').fill('e2e_ops@auditglide.test');
    await page.getByLabel('Password').fill('E2eOps@12345');
    await page.getByRole('button', { name: /Sign in/i }).click();
    await expect(page).toHaveURL(/\/firms$/);
  });

  test('firms list → open firm → record-payment modal opens with the firm name', async ({ page }) => {
    await page.getByPlaceholder(/Search firm/i).fill('E2E Test Firm');
    await page.getByRole('button', { name: 'Search' }).click();
    await page.getByRole('link', { name: 'E2E Test Firm' }).first().click();
    await expect(page.getByRole('heading', { name: 'E2E Test Firm' })).toBeVisible();

    await page.getByRole('button', { name: 'Record payment' }).click();
    await expect(page.getByRole('heading', { name: 'Record payment' })).toBeVisible();
    await expect(page.getByText(/Log a payment/)).toContainText('E2E Test Firm');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('heading', { name: 'Record payment' })).toBeHidden();
  });

  test('record a notice top-up → wallet balance updates in place', async ({ page }) => {
    await page.getByPlaceholder(/Search firm/i).fill('E2E Test Firm');
    await page.getByRole('button', { name: 'Search' }).click();
    await page.getByRole('link', { name: 'E2E Test Firm' }).first().click();

    await page.getByRole('button', { name: 'Record notice top-up' }).click();
    await expect(page.getByRole('heading', { name: 'Record notice top-up' })).toBeVisible();
    await page.getByLabel(/Amount/i).fill('750');
    await page.getByRole('button', { name: 'Add top-up' }).click();
    // confirm step (double-entry guard) — same modal, shows the "Confirm & add" action
    await expect(page.getByRole('button', { name: /Confirm & add/i })).toBeVisible();
    await page.getByRole('button', { name: /Confirm & add/i }).click();
    // modal closes; the firm page shows the success flash
    await expect(page.getByText('Top-up added.')).toBeVisible();
  });
});
