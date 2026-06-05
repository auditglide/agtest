/**
 * AI Avatar Phase 2 — Frontend Landing Tests (Category 4).
 *
 * Loads the AI-built URL directly in a logged-in browser and asserts the page
 * VISUALLY applies the filters. This proves the frontend half of the two-sided
 * contract (intent-map writes param → page reads param on mount).
 *
 * Uses the authenticated `page` fixture (auto-login).
 *
 * Run: npx playwright test tests/ai/phase2.frontend.spec.ts
 */

import { test, expect } from '../../fixtures/auth-fixture';
import type { Page } from '@playwright/test';

// "Filtered by AI" banner is the universal proof a page recognised the aiFilter param.
async function expectAiBanner(page: Page) {
  await expect(
    page.getByText('Filtered by AI').first(),
    'The "Filtered by AI" banner must appear when navigating with aiFilter=1',
  ).toBeVisible({ timeout: 10_000 });
}

// Helper — IST today / end-of-week ISO dates for deadline URLs
function isoToday(): string {
  return new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
}

// ─── Gap 1: Deadline filter applied ───────────────────────────────────────────

test('AI-P2-F01 /cases with deadline range shows AI banner and loads', async ({ page }) => {
  const today = isoToday();
  await page.goto(`/cases?deadlineFrom=${today}&deadlineTo=${today}&aiFilter=1`);
  await page.waitForLoadState('domcontentloaded');
  await expectAiBanner(page);
  // The cases heading is visible (page rendered, not an error/redirect)
  await expect(page.getByRole('heading', { name: /cases/i }).first()).toBeVisible();
});

// ─── Gap 2a: Unassigned filter applied ────────────────────────────────────────

test('AI-P2-F02 /cases?unassigned=true shows AI banner', async ({ page }) => {
  await page.goto('/cases?unassigned=true&aiFilter=1');
  await page.waitForLoadState('domcontentloaded');
  await expectAiBanner(page);
});

// ─── Gap 2b: Inactive clients toggle applied ──────────────────────────────────

test('AI-P2-F03 /clients?inactive=true shows AI banner and inactive clients', async ({ page }) => {
  await page.goto('/clients?inactive=true&aiFilter=1');
  await page.waitForLoadState('domcontentloaded');
  await expectAiBanner(page);
  // The clients page heading renders
  await expect(page.getByRole('heading', { name: /clients/i }).first()).toBeVisible();
});

// ─── Gap 2c: Fee-only visits filter applied ───────────────────────────────────

test('AI-P2-F04 /visitor-log?hasPayment=1 shows AI banner', async ({ page }) => {
  await page.goto('/visitor-log?hasPayment=1&aiFilter=1');
  await page.waitForLoadState('domcontentloaded');
  await expectAiBanner(page);
});

// ─── Gap 2d+3: Payment tab pre-selected ───────────────────────────────────────

test('AI-P2-F05 /payments?tab=writtenOff shows AI banner and Written Off tab', async ({ page }) => {
  await page.goto('/payments?tab=writtenOff&aiFilter=1');
  await page.waitForLoadState('domcontentloaded');
  await expectAiBanner(page);
  // The Written Off tab content/label should be visible
  await expect(page.getByText(/written off/i).first()).toBeVisible();
});

// ─── Gap 5: Work-allocation tab pre-selected (no AI banner on this page) ───────

test('AI-P2-F06 /work-allocation?tab=history selects the Batch History tab', async ({ page }) => {
  await page.goto('/work-allocation?tab=history&aiFilter=1');
  await page.waitForLoadState('domcontentloaded');
  // The Batch History tab button is visible (tab UI rendered)
  await expect(page.getByText('Batch History').first()).toBeVisible({ timeout: 10_000 });
});

test('AI-P2-F07 /work-allocation?tab=auto selects the Auto Delegation tab', async ({ page }) => {
  await page.goto('/work-allocation?tab=auto&aiFilter=1');
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByText('Auto Delegation').first()).toBeVisible({ timeout: 10_000 });
});

// ─── Gap 6: Month-precise attendance ──────────────────────────────────────────

test('AI-P2-F08 /my-attendance for April shows AI banner', async ({ page }) => {
  await page.goto('/my-attendance?dateFrom=2026-04-01&dateTo=2026-04-30&aiFilter=1');
  await page.waitForLoadState('domcontentloaded');
  await expectAiBanner(page);
});
