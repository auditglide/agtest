/**
 * T4 — entitlements E2E (nav gating, deep-link upsell, Plan & Usage meters, trial banner).
 *
 * These mutate the SHARED admin firm, so they run SERIALLY and restore state in afterEach.
 * Run on their own:  npm run test:entitlements   (do NOT run concurrently with the full suite).
 * Requires the stack up (FE on BASE_URL, API, DB) + TEST_ADMIN_EMAIL/PASSWORD + TEST_DB_URL.
 */
import { test, expect } from '../../fixtures/auth-fixture';
import type { Page } from '@playwright/test';
import { LoginPage } from '../../page-objects/login.page';
import { adminFirmId, setModule, setPlan, setPlanExpiry, clearEntitlements } from '../../helpers/entitlement.helper';

const EMAIL = process.env.TEST_ADMIN_EMAIL ?? '';
const PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? '';

test.describe.configure({ mode: 'serial' });

test.describe('Entitlements gating @entitlements', () => {
  let firmId: string;

  test.beforeAll(async () => { firmId = await adminFirmId(); });
  test.afterEach(async () => { await clearEntitlements(firmId); });   // restore the admin firm

  // Re-fetch entitlements after seeding. The FE caches them in sessionStorage AND keeps the
  // access token in memory only — a plain reload drops the token and (on local cross-origin
  // http) can't restore the session. So we do a clean re-login: the fresh app mount then
  // fetches entitlements with the just-seeded DB state.
  async function refresh(page: Page, path = '/clients') {
    await page.context().clearCookies();
    await page.goto('/login');
    await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* ignore */ } });
    const loginPage = new LoginPage(page);
    await loginPage.navigate();
    await loginPage.loginAndExpectSuccess(EMAIL, PASSWORD);
    if (path !== '/clients' && !page.url().includes(path)) await page.goto(path);
    await page.getByTestId('button-user-menu').waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
  }

  // Nav items render in both the desktop sidebar and the mobile drawer → match by .first().
  test('nav hides a pack when not entitled and shows it when entitled', async ({ page }) => {
    await setModule(firmId, 'billing', false);
    await refresh(page);
    await expect(page.getByTestId('nav-invoices')).toHaveCount(0);

    await setModule(firmId, 'billing', true);
    await refresh(page);
    await expect(page.getByTestId('nav-invoices').first()).toBeVisible();
  });

  test('deep-linking to a non-entitled route shows the upsell, not the feature', async ({ page }) => {
    await setModule(firmId, 'billing', false);
    await refresh(page);
    await page.goto('/invoices');
    await expect(page.getByTestId('not-entitled').first()).toBeVisible();
  });

  test('Plan & Usage shows the plan name and a finite usage meter', async ({ page }) => {
    await setPlan(firmId, 'plan2');                 // Growth — clients limit 200 (finite → meter shown)
    await refresh(page, '/plan');
    await expect(page.getByTestId('plan-name').first()).toHaveText(/Growth/);
    await expect(page.getByTestId('meter-clients').first()).toBeVisible();
  });

  test('trial banner appears when the plan is near expiry', async ({ page }) => {
    await setPlan(firmId, 'plan2');
    await setPlanExpiry(firmId, new Date(Date.now() + 5 * 24 * 60 * 60 * 1000));   // 5 days out
    await refresh(page);
    const banner = page.getByTestId('trial-banner').first();
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute('data-tone', 'amber');
  });
});
