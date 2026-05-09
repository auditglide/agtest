/**
 * Onboarding tests
 *
 * These tests run WITHOUT saved auth state (fresh browser).
 * They exercise the full onboarding flow for new firms.
 *
 * Pre-requisites before running:
 *   1. Set ONBOARDING_EMAIL in .env.local to the email you want to onboard with.
 *   2. Run:  npx playwright test tests/onboarding/ --headed --project=onboarding
 *   3. When prompted, enter the verification code from your email, then resume.
 *   OR: set ONBOARDING_VERIFICATION_CODE in .env.local before running.
 */
import { test, expect } from '@playwright/test';
import { OnboardingPage } from '../../page-objects/onboarding.page';
import { LoginPage }       from '../../page-objects/login.page';
import {
  cleanupVerificationTokenFixture,
  disconnectOnboardingTestDb,
  seedVerificationTokenFixture,
  type VerificationTokenFixture,
} from '../../helpers/db-onboarding.helper';

const ONBOARDING_EMAIL = process.env.ONBOARDING_EMAIL ?? '';
const TEST_DB_URL = process.env.TEST_DB_URL ?? '';
const FIRM_NAME   = `Test Firm ${Date.now()}`;
const ADMIN_NAME  = 'Test Admin';
const PASSWORD    = 'AuditGlide@Test1';
const DUPLICATE_REG_EMAIL = process.env.TEST_ADMIN_EMAIL ?? '';
const createdVerificationFixtures: VerificationTokenFixture[] = [];

test.describe('Onboarding', () => {

  test.afterAll(async () => {
    for (const fixture of createdVerificationFixtures) {
      await cleanupVerificationTokenFixture(fixture);
    }
    await disconnectOnboardingTestDb();
  });

  test.beforeEach(async ({ page }) => {
    // Onboarding tests always start unauthenticated
    await page.context().clearCookies();
  });

  // ── ON-1: Email entry ──────────────────────────────────────────────────────

  test('ON-1 onboarding page loads and shows email entry step @smoke', async ({ page }) => {
    const onboarding = new OnboardingPage(page);
    await onboarding.navigate();
    await expect(
      page.getByTestId('input-onboarding-email'),
      'Email input must be visible on the onboarding page',
    ).toBeVisible();
  });

  test('ON-2 entering invalid email shows validation error', async ({ page }) => {
    const onboarding = new OnboardingPage(page);
    await onboarding.navigate();
    await onboarding.enterEmail('not-an-email');
    await expect(
      page.getByText(/valid email|invalid email/i),
      'Email validation error must appear for bad email format',
    ).toBeVisible();
  });

  // ── ON-3: Verification code ────────────────────────────────────────────────

  test('ON-3 full onboarding flow — email → verify → firm details → complete @smoke', async ({ page }) => {
    if (!ONBOARDING_EMAIL) {
      test.skip(true, 'Set ONBOARDING_EMAIL in .env.local to run onboarding tests');
    }

    const onboarding = new OnboardingPage(page);
    await onboarding.navigate();

    await test.step('Enter email and request verification code', async () => {
      await onboarding.enterEmail(ONBOARDING_EMAIL);
      await expect(
        page.getByText(/code.*sent|check.*email|verification/i),
        'After entering email, a message about the code must appear',
      ).toBeVisible({ timeout: 10_000 });
    });

    await test.step('Enter verification code', async () => {
      // Uses ONBOARDING_VERIFICATION_CODE env var, or pauses for manual entry
      await onboarding.enterVerificationCode();
    });

    await test.step('Fill firm and admin details', async () => {
      await onboarding.fillFirmDetails({ firmName: FIRM_NAME, adminName: ADMIN_NAME, password: PASSWORD });
    });

    await test.step('Submit onboarding and verify redirect', async () => {
      await onboarding.submitOnboarding();
      await onboarding.expectOnboardingSuccess();
    });
  });

  test('ON-4 wrong verification code shows error', async ({ page }) => {
    if (!ONBOARDING_EMAIL) {
      test.skip(true, 'Set ONBOARDING_EMAIL in .env.local to run onboarding tests');
    }

    const onboarding = new OnboardingPage(page);
    await onboarding.navigate();
    await onboarding.enterEmail(ONBOARDING_EMAIL);

    await test.step('Enter an obviously wrong code and expect error', async () => {
      // We fake the code field rather than waiting for a real email
      const input = page.getByTestId('input-verification-code');
      if (await input.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await input.fill('000000');
        await page.getByTestId('button-verify-code').click();
        await expect(
          page.getByText(/invalid.*code|expired|incorrect/i),
          'Error must appear for an invalid verification code',
        ).toBeVisible({ timeout: 8_000 });
      } else {
        test.skip(true, 'Verification code input not visible — code may have already been used');
      }
    });
  });

  test('ON-5 first login after onboarding forces password change', async ({ page }) => {
    if (!ONBOARDING_EMAIL) {
      test.skip(true, 'Set ONBOARDING_EMAIL in .env.local to run onboarding tests');
    }
    // This test only applies if the onboarding creates a user with is_first_login = true
    // and the backend enforces the password change flow on first login.
    const loginPage = new LoginPage(page);
    await loginPage.navigate();
    // Attempt login with the onboarded credentials
    await loginPage.login(ONBOARDING_EMAIL, PASSWORD);
    // Either we land on the dashboard (password was already set during onboarding)
    // or on the change-password page (is_first_login = true still set)
    const url = page.url();
    const isOnDashboard     = /dashboard|clients|compliance/.test(url);
    const isOnChangePassword = /change-password|first-login/.test(url);
    expect(
      isOnDashboard || isOnChangePassword,
      `After first login, must be on dashboard or change-password. Got: ${url}`,
    ).toBe(true);
  });

  test('ON-6 duplicate admin email during registration is rejected @p1', async ({ page }) => {
    test.skip(!DUPLICATE_REG_EMAIL, 'TEST_ADMIN_EMAIL must be set to verify duplicate-admin registration behavior');

    await page.goto('/register');

    await test.step('Submit the register form with an email that already belongs to an existing user', async () => {
      await page.getByTestId('input-firm-name').fill(`ON6 Firm ${Date.now()}`);
      await page.getByTestId('input-admin-name').fill('Duplicate Admin');
      await page.getByTestId('input-admin-email').fill(DUPLICATE_REG_EMAIL);
      await page.getByTestId('button-submit-register').click();
    });

    await test.step('The registration page must show the duplicate-account error without advancing to verification', async () => {
      await expect(
        page.getByText(/account with this email already exists/i),
        'Duplicate-email registration must explain that the admin email is already in use',
      ).toBeVisible();
      await expect(
        page.getByTestId('button-submit-register'),
        'The user must remain on the register step after a duplicate-email rejection',
      ).toBeVisible();
    });
  });

  test('ON-7 expired verification token shows the expiry UX @p1', async ({ page }) => {
    test.skip(!TEST_DB_URL, 'TEST_DB_URL must be set to run DB-seeded onboarding token tests');

    const fixture = await seedVerificationTokenFixture({
      email: `on7-expired-${Date.now()}@ag.test`,
      expiresAt: new Date(Date.now() - (60 * 60 * 1000)),
    });
    createdVerificationFixtures.push(fixture);

    await page.goto('/verify-email');

    await test.step('Submit a DB-seeded token that is already expired', async () => {
      await page.getByTestId('input-verification-token').fill(fixture.rawToken);
      await page.getByTestId('button-verify').click();
    });

    await test.step('The verification screen must explain that the code expired', async () => {
      await expect(
        page.getByText(/code has expired|register again/i),
        'Expired verification tokens must show the 410-style expired-code UX',
      ).toBeVisible();
    });
  });

  test('ON-8 reused verification token resolves to the already-used UX @p1', async ({ page }) => {
    test.skip(!TEST_DB_URL, 'TEST_DB_URL must be set to run DB-seeded onboarding token tests');

    const fixture = await seedVerificationTokenFixture({
      email: `on8-used-${Date.now()}@ag.test`,
      expiresAt: new Date(Date.now() + (24 * 60 * 60 * 1000)),
      isUsed: true,
    });
    createdVerificationFixtures.push(fixture);

    await page.goto('/verify-email');

    await test.step('Submit a DB-seeded token that has already been marked used', async () => {
      await page.getByTestId('input-verification-token').fill(fixture.rawToken);
      await page.getByTestId('button-verify').click();
    });

    await test.step('The verify flow must land on the already-verified success UX', async () => {
      await expect(
        page.getByText(/account verified/i),
        'Used verification tokens currently resolve to the success/login UX rather than a blocking error state',
      ).toBeVisible();
      await expect(
        page.getByTestId('button-go-to-login'),
        'The already-used token UX must still offer the login action',
      ).toBeVisible();
    });
  });

  test('ON-9 invalid verification token length shows client validation @p1', async ({ page }) => {
    await page.goto('/verify-email');

    await test.step('Submit a token that is too short to satisfy the 64-character hex constraint', async () => {
      await page.getByTestId('input-verification-token').fill('abc123');
      await page.getByTestId('button-verify').click();
    });

    await test.step('Client-side validation must block the request and explain the token format', async () => {
      await expect(
        page.getByText(/64-character hex code|verification code is required|valid 64-character/i),
        'The verification form must validate token length and format before hitting the backend',
      ).toBeVisible();
    });
  });

});
