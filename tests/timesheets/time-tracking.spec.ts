/**
 * Time Tracking Feature — comprehensive test suite
 *
 *  MANUAL MODE (default)
 *   TT-01  Time Log section visible on an In Progress case
 *   TT-02  "Log Time" button visible on In Progress case (manual mode)
 *   TT-03  User can add a manual time entry via modal
 *   TT-04  Entry appears in Time Log table with correct duration
 *   TT-05  Total time updates after adding an entry
 *   TT-06  Multiple entries accumulate in total
 *   TT-07  User can edit their own manual entry (within 24 h) via API
 *   TT-08  User can delete their own manual entry (within 24 h) via API
 *   TT-09  Closing a case with ZERO time logged is hard-blocked
 *   TT-10  Closing a case AFTER logging time succeeds
 *   TT-11  "Log Time" visible on Completed-Pending Verification
 *   TT-12  "Log Time" visible on Flagged-Pending Review
 *
 *  SYSTEM CALCULATED MODE
 *   TT-13  Admin can switch mode to system_calculated in Settings
 *   TT-14  Start button visible on In Progress case in system_calculated mode
 *   TT-15  Timer starts and shows running indicator after clicking Start
 *   TT-16  Stop records duration; Running… indicator disappears
 *   TT-17  Stopped auto-session shows "Timer" badge in Time Log
 *   TT-18  Closing case with zero timer sessions is hard-blocked
 *   TT-19  Multiple Start/Stop cycles produce multiple rows
 *   TT-20  "Log Time" button NOT shown in system_calculated mode
 *   TT-21  Reverting to manual mode shows Log Time, hides Start
 *
 *  AUTO-STOP ON STATUS CHANGE
 *   TT-22  Active auto-session is closed when case status leaves eligible statuses
 *
 *  TIMESHEETS PAGE
 *   TT-23  Timesheets page accessible from sidebar under ME
 *   TT-24  Entry logged on a case appears on the Timesheets page
 *   TT-25  Date range filter narrows results to empty state
 *
 *  TAGS: @timesheets @p1
 */

import { test, expect } from '../../fixtures/auth-fixture';
import type { Page } from '@playwright/test';
import {
  apiFetch,
  getCachedApiAuth,
  seedClient,
  findCaseIdForClient,
  deleteClient,
  deleteComplianceType,
  seedComplianceType,
} from '../../helpers/api-seed.helper';

// ─── Shared state ─────────────────────────────────────────────────────────────

let token    = '';
let branchId = '';
let ctId     = '';

const createdClientIds: string[] = [];

/** Extract the logged-in user's ID from the JWT payload (base64url safe). */
function getUserId(): string {
  const part = token.split('.')[1];
  // base64url → base64: replace URL-safe chars and add padding
  const base64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(
    part.length + (4 - (part.length % 4)) % 4, '=',
  );
  const payload = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
  // The AuditGlide JWT stores the user ID in the standard 'sub' claim
  const id = (payload as Record<string, unknown>).sub as string | undefined;
  if (!id) throw new Error(`sub not found in JWT payload. Keys: ${Object.keys(payload).join(', ')}`);
  return id;
}

/**
 * Creates a fresh client (with compliance type mapped) and returns its
 * auto-generated case.  seedClient triggers case auto-generation; we use
 * findCaseIdForClient rather than seedCase to avoid the 409 CONFLICT.
 */
async function makeCase(): Promise<{ caseId: string; clientId: string }> {
  const ts = Date.now();
  const client = await seedClient(token, {
    name: `TT-Client-${ts}`,
    pan:  `AATTS${String(ts).slice(-4)}K`,
    branchId,
    complianceTypeIds: [ctId],
  });
  createdClientIds.push(client.clientId);

  // Use POST /cases/search filtered to New status.
  // The plain search also returns cases ASSIGNED to the test user (regardless of client),
  // so without the status filter old closed cases bleed through.
  // New cases start in 'New' state, so this reliably returns only the fresh case.
  let caseId = '';
  for (let attempt = 0; attempt < 8 && !caseId; attempt++) {
    const res = await apiFetch<{ data: Array<{ caseId: string }> }>(
      'POST', '/cases/search', token,
      { branchId, clientIds: [client.clientId], statuses: ['New'], page: 1, limit: 5 },
    );
    caseId = res.data?.data?.[0]?.caseId ?? '';
    if (!caseId) await new Promise(r => setTimeout(r, 1000));
  }
  if (!caseId) throw new Error(`No New case found for client ${client.clientId} after 8 retries`);
  return { caseId, clientId: client.clientId };
}

/**
 * Transitions a case from New → Assigned → In Progress via the API.
 * Throws immediately if either API call fails so tests fail with a clear message.
 */
async function bringToInProgress(caseId: string): Promise<void> {
  const userId = getUserId();

  const assignRes = await apiFetch('PATCH', `/cases/${caseId}/assign`, token, { userId });
  if (!assignRes.ok) {
    throw new Error(`Assign failed (${assignRes.status}): ${assignRes.text.slice(0, 200)}`);
  }

  const statusRes = await apiFetch('PATCH', `/cases/${caseId}/status`, token, { status: 'In Progress' });
  if (!statusRes.ok) {
    throw new Error(`Status → In Progress failed (${statusRes.status}): ${statusRes.text.slice(0, 200)}`);
  }
}

/** Set firm time tracking mode via the API. */
async function setMode(mode: 'manual' | 'system_calculated'): Promise<void> {
  await apiFetch('PATCH', '/firm/time-tracking-mode', token, { mode });
}

/**
 * Dismisses the attendance punch-in modal ("Where are you working from today?")
 * if it is open.  Radix UI Dialog sets aria-hidden on all background content
 * when open — Playwright's getByRole queries cannot find elements behind it.
 * Call this after every page.goto / caseDetailPage.navigate.
 */
async function dismissPunchInModal(page: Page): Promise<void> {
  try {
    const skip = page.getByRole('button', { name: /Skip for now/i });
    await skip.waitFor({ state: 'visible', timeout: 2500 });
    await skip.click();
    await page.waitForTimeout(400);
  } catch {
    // Modal not present — nothing to do
  }
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

test.beforeAll(async () => {
  const auth = getCachedApiAuth();
  if (!auth) throw new Error('Missing cached API auth — run the setup project first.');
  ({ token, branchId } = auth);

  const ct = await seedComplianceType(token, {
    type: `TT-CT-${Date.now()}`,
    frequency: 'Monthly',
    needsWorkAllocation: true,
    schedule: Array.from({ length: 12 }, (_, i) => ({
      period_index: i,
      creation_month_offset: 0,
      creation_day: 1,
      deadline_month_offset: 1,
      deadline_day: 20,
    })),
  });
  ctId = ct.complianceTypeId;

  // Always start in manual mode
  await setMode('manual');

  // Punch in via API so the "Where are you working from today?" modal
  // never appears in the browser during tests. 409 = already punched in today, ignore.
  await apiFetch('POST', '/attendance/check-in', token, { type: 'main_office' });
});

test.afterAll(async () => {
  await setMode('manual').catch(() => {});
  for (const id of createdClientIds) {
    await deleteClient(token, id).catch(() => {});
  }
  await deleteComplianceType(token, ctId).catch(() => {});
});

// ═════════════════════════════════════════════════════════════════════════════
// MANUAL MODE
// ═════════════════════════════════════════════════════════════════════════════

test('TT-01 Time Log section visible on an In Progress case @timesheets @p1',
  async ({ caseDetailPage }) => {
    const { caseId } = await makeCase();
    await bringToInProgress(caseId);

    await caseDetailPage.navigate(caseId);
    await dismissPunchInModal(caseDetailPage.page);
    await expect(
      caseDetailPage.page.getByRole('heading', { name: /Time Log/i }),
    ).toBeVisible();
  },
);

test('TT-02 "Log Time" button visible on In Progress case in manual mode @timesheets @p1',
  async ({ caseDetailPage }) => {
    const { caseId } = await makeCase();
    await bringToInProgress(caseId);

    await caseDetailPage.navigate(caseId);
    await dismissPunchInModal(caseDetailPage.page);
    await expect(
      caseDetailPage.page.getByRole('button', { name: /Log Time/i }),
    ).toBeVisible();
  },
);

test('TT-03 User can add a manual time entry via modal @timesheets @p1',
  async ({ caseDetailPage }) => {
    const { caseId } = await makeCase();
    await bringToInProgress(caseId);

    await caseDetailPage.navigate(caseId);
    await dismissPunchInModal(caseDetailPage.page);
    await caseDetailPage.page.getByRole('button', { name: /Log Time/i }).click();

    const dialog = caseDetailPage.page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Fill 2 hours 30 minutes
    const numbers = dialog.locator('input[type="number"]');
    await numbers.first().fill('2');
    await numbers.last().fill('30');

    await dialog.getByRole('button', { name: /^Save$/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 8000 });
  },
);

test('TT-04 Entry appears in Time Log table with correct duration @timesheets @p1',
  async ({ caseDetailPage }) => {
    const { caseId } = await makeCase();
    await bringToInProgress(caseId);

    const today = new Date().toISOString().slice(0, 10);
    await apiFetch('POST', `/cases/${caseId}/time-logs`, token, {
      logDate: today, durationHours: 1, durationMinutes: 15,
    });

    await caseDetailPage.navigate(caseId);
    await dismissPunchInModal(caseDetailPage.page);
    await expect(
      caseDetailPage.page.getByRole('cell', { name: /1h 15m/i }).first(),
    ).toBeVisible();
  },
);

test('TT-05 Total time updates after adding an entry @timesheets @p1',
  async ({ caseDetailPage }) => {
    const { caseId } = await makeCase();
    await bringToInProgress(caseId);

    const today = new Date().toISOString().slice(0, 10);
    await apiFetch('POST', `/cases/${caseId}/time-logs`, token, {
      logDate: today, durationHours: 3, durationMinutes: 0,
    });

    await caseDetailPage.navigate(caseId);
    await dismissPunchInModal(caseDetailPage.page);
    await expect(
      caseDetailPage.page.getByText(/Total:/i),
    ).toBeVisible();
    await expect(
      caseDetailPage.page.getByText(/3h/i).first(),
    ).toBeVisible();
  },
);

test('TT-06 Multiple entries accumulate in total @timesheets @p1',
  async ({ caseDetailPage }) => {
    const { caseId } = await makeCase();
    await bringToInProgress(caseId);

    const today = new Date().toISOString().slice(0, 10);
    await apiFetch('POST', `/cases/${caseId}/time-logs`, token, {
      logDate: today, durationHours: 1, durationMinutes: 0,
    });
    await apiFetch('POST', `/cases/${caseId}/time-logs`, token, {
      logDate: today, durationHours: 2, durationMinutes: 30,
    });

    await caseDetailPage.navigate(caseId);
    await dismissPunchInModal(caseDetailPage.page);
    // Total = 3h 30m
    await expect(
      caseDetailPage.page.getByText(/3h 30m/i).first(),
    ).toBeVisible();
  },
);

test('TT-07 User can edit their own manual entry via API (within 24h) @timesheets @p1',
  async ({ caseDetailPage }) => {
    const { caseId } = await makeCase();
    await bringToInProgress(caseId);

    const today = new Date().toISOString().slice(0, 10);
    const createRes = await apiFetch<{ timelogId: string }>(
      'POST', `/cases/${caseId}/time-logs`, token,
      { logDate: today, durationHours: 1, durationMinutes: 0 },
    );
    const timelogId = createRes.data.timelogId;

    // Edit to 2h 0m
    const editRes = await apiFetch(
      'PATCH', `/cases/${caseId}/time-logs/${timelogId}`, token,
      { durationHours: 2, durationMinutes: 0 },
    );
    expect(editRes.status, 'PATCH must return 200').toBe(200);

    // Verify updated value in UI
    await caseDetailPage.navigate(caseId);
    await dismissPunchInModal(caseDetailPage.page);
    await expect(
      caseDetailPage.page.getByRole('cell', { name: /2h/i }).first(),
    ).toBeVisible();
  },
);

test('TT-08 User can delete their own manual entry via API (within 24h) @timesheets @p1',
  async ({ caseDetailPage }) => {
    const { caseId } = await makeCase();
    await bringToInProgress(caseId);

    const today = new Date().toISOString().slice(0, 10);
    const createRes = await apiFetch<{ timelogId: string }>(
      'POST', `/cases/${caseId}/time-logs`, token,
      { logDate: today, durationHours: 1, durationMinutes: 0 },
    );
    const timelogId = createRes.data.timelogId;

    const delRes = await apiFetch('DELETE', `/cases/${caseId}/time-logs/${timelogId}`, token);
    expect(delRes.status, 'DELETE must return 200').toBe(200);

    await caseDetailPage.navigate(caseId);
    await dismissPunchInModal(caseDetailPage.page);
    await expect(
      caseDetailPage.page.getByText(/No time entries yet/i),
    ).toBeVisible();
  },
);

test('TT-09 Closing a case with ZERO time logged is hard-blocked @timesheets @p1',
  async ({ caseDetailPage }) => {
    const { caseId } = await makeCase();
    await bringToInProgress(caseId);

    // Attempt close via API — should get 422/400
    const res = await apiFetch('PATCH', `/cases/${caseId}/status`, token, {
      status: 'Closed',
    });
    expect(
      res.status,
      'Closing with zero time must be rejected (400/422)',
    ).toBeGreaterThanOrEqual(400);
    expect(res.text.toLowerCase()).toMatch(/time/i);

    // Confirm status unchanged in UI
    await caseDetailPage.navigate(caseId);
    await dismissPunchInModal(caseDetailPage.page);
    await caseDetailPage.expectStatus('In Progress');
  },
);

test('TT-10 Closing a case AFTER logging time succeeds @timesheets @p1',
  async ({ caseDetailPage }) => {
    const { caseId } = await makeCase();
    await bringToInProgress(caseId);

    const today = new Date().toISOString().slice(0, 10);
    await apiFetch('POST', `/cases/${caseId}/time-logs`, token, {
      logDate: today, durationHours: 1, durationMinutes: 0,
    });

    await caseDetailPage.navigate(caseId);
    await dismissPunchInModal(caseDetailPage.page);
    await caseDetailPage.transitionTo('Closed');
    await caseDetailPage.expectStatus('Closed');
  },
);

test('TT-11 "Log Time" visible on Completed-Pending Verification status @timesheets @p1',
  async ({ caseDetailPage }) => {
    const { caseId } = await makeCase();
    await bringToInProgress(caseId);

    const today = new Date().toISOString().slice(0, 10);
    await apiFetch('POST', `/cases/${caseId}/time-logs`, token, {
      logDate: today, durationHours: 1, durationMinutes: 0,
    });
    await apiFetch('PATCH', `/cases/${caseId}/status`, token, {
      status: 'Completed - Pending Verification',
    });

    await caseDetailPage.navigate(caseId);
    await dismissPunchInModal(caseDetailPage.page);
    await expect(
      caseDetailPage.page.getByRole('button', { name: /Log Time/i }),
    ).toBeVisible();
  },
);

test('TT-12 "Log Time" visible on Flagged-Pending Review status @timesheets @p1',
  async ({ caseDetailPage }) => {
    const { caseId } = await makeCase();
    await bringToInProgress(caseId);

    const today = new Date().toISOString().slice(0, 10);
    await apiFetch('POST', `/cases/${caseId}/time-logs`, token, {
      logDate: today, durationHours: 1, durationMinutes: 0,
    });
    await apiFetch('PATCH', `/cases/${caseId}/status`, token, {
      status: 'Completed - Pending Verification',
    });
    await apiFetch('PATCH', `/cases/${caseId}/status`, token, {
      status: 'Flagged - Pending Review',
    });

    await caseDetailPage.navigate(caseId);
    await dismissPunchInModal(caseDetailPage.page);
    await expect(
      caseDetailPage.page.getByRole('button', { name: /Log Time/i }),
    ).toBeVisible();
  },
);

// ═════════════════════════════════════════════════════════════════════════════
// SYSTEM CALCULATED MODE
// ═════════════════════════════════════════════════════════════════════════════

test('TT-13 Admin can switch mode to system_calculated in Settings @timesheets @p1',
  async ({ page }) => {
    // Navigate directly to the dedicated Timesheet Settings page
    await page.goto('/timesheet-settings');
    await dismissPunchInModal(page);

    await expect(
      page.getByRole('heading', { name: /Timesheet Settings/i }),
    ).toBeVisible();

    // Switch mode via the Select dropdown
    await page.getByRole('combobox').filter({ hasText: /Manual|System/i }).click();
    await page.getByRole('option', { name: /System Calculated/i }).click();
    await page.waitForTimeout(1500); // allow auto-save

    const res = await apiFetch<{ mode: string }>('GET', '/firm/time-tracking-mode', token);
    expect(res.data.mode).toBe('system_calculated');

    // Reset
    await setMode('manual');
  },
);

test('TT-14 Start button visible on In Progress case in system_calculated mode @timesheets @p1',
  async ({ caseDetailPage }) => {
    await setMode('system_calculated');
    const { caseId } = await makeCase();
    await bringToInProgress(caseId);

    await caseDetailPage.navigate(caseId);
    await dismissPunchInModal(caseDetailPage.page);
    await expect(
      caseDetailPage.page.getByRole('button', { name: /^Start$/i }),
    ).toBeVisible();

    await setMode('manual');
  },
);

test('TT-15 Timer starts and shows running indicator @timesheets @p1',
  async ({ caseDetailPage }) => {
    await setMode('system_calculated');
    const { caseId } = await makeCase();
    await bringToInProgress(caseId);

    await caseDetailPage.navigate(caseId);
    await dismissPunchInModal(caseDetailPage.page);
    await caseDetailPage.page.getByRole('button', { name: /^Start$/i }).click();
    await caseDetailPage.page.waitForTimeout(500);

    await expect(
      caseDetailPage.page.getByRole('button', { name: /^Stop$/i }),
    ).toBeVisible();
    await expect(
      caseDetailPage.page.getByText(/Running…/i).first(),
    ).toBeVisible();

    // Clean up — stop the timer
    await caseDetailPage.page.getByRole('button', { name: /^Stop$/i }).click();
    await caseDetailPage.page.waitForTimeout(500);
    await setMode('manual');
  },
);

test('TT-16 Stop records duration; Running… disappears @timesheets @p1',
  async ({ caseDetailPage }) => {
    await setMode('system_calculated');
    const { caseId } = await makeCase();
    await bringToInProgress(caseId);

    await caseDetailPage.navigate(caseId);
    await dismissPunchInModal(caseDetailPage.page);
    await caseDetailPage.page.getByRole('button', { name: /^Start$/i }).click();
    await caseDetailPage.page.waitForTimeout(3000); // let 3 s elapse

    await caseDetailPage.page.getByRole('button', { name: /^Stop$/i }).click();
    // Wait for Running… to disappear — more reliable than networkidle
    await expect(
      caseDetailPage.page.getByText(/Running…/i),
    ).not.toBeVisible({ timeout: 15000 });

    await setMode('manual');
  },
);

test('TT-17 Stopped auto-session shows "Timer" badge in Time Log @timesheets @p1',
  async ({ caseDetailPage }) => {
    await setMode('system_calculated');
    const { caseId } = await makeCase();
    await bringToInProgress(caseId);

    // Start + stop via API for speed
    const startRes = await apiFetch<{ timelogId: string }>(
      'POST', `/cases/${caseId}/time-logs/start`, token,
    );
    await new Promise(r => setTimeout(r, 1500));
    await apiFetch('POST', `/cases/${caseId}/time-logs/${startRes.data.timelogId}/stop`, token);

    await caseDetailPage.navigate(caseId);
    await dismissPunchInModal(caseDetailPage.page);
    await expect(
      caseDetailPage.page.getByText('Timer').first(),
    ).toBeVisible();

    await setMode('manual');
  },
);

test('TT-18 Closing case with zero timer sessions hard-blocked (system_calculated) @timesheets @p1',
  async () => {
    await setMode('system_calculated');
    const { caseId } = await makeCase();
    await bringToInProgress(caseId);

    const res = await apiFetch('PATCH', `/cases/${caseId}/status`, token, {
      status: 'Closed',
    });
    expect(res.status, 'Close with zero time must be rejected').toBeGreaterThanOrEqual(400);
    expect(res.text.toLowerCase()).toMatch(/time/i);

    await setMode('manual');
  },
);

test('TT-19 Multiple Start/Stop cycles produce multiple time-log rows @timesheets @p1',
  async ({ caseDetailPage }) => {
    await setMode('system_calculated');
    const { caseId } = await makeCase();
    await bringToInProgress(caseId);

    // Two cycles via API
    for (let i = 0; i < 2; i++) {
      const s = await apiFetch<{ timelogId: string }>(
        'POST', `/cases/${caseId}/time-logs/start`, token,
      );
      await new Promise(r => setTimeout(r, 1500));
      await apiFetch('POST', `/cases/${caseId}/time-logs/${s.data.timelogId}/stop`, token);
    }

    await caseDetailPage.navigate(caseId);
    await dismissPunchInModal(caseDetailPage.page);
    const timerBadges = caseDetailPage.page.getByText('Timer');
    await expect(timerBadges).toHaveCount(2, { timeout: 5000 });

    await setMode('manual');
  },
);

test('TT-20 "Log Time" button NOT shown in system_calculated mode @timesheets @p1',
  async ({ caseDetailPage }) => {
    await setMode('system_calculated');
    const { caseId } = await makeCase();
    await bringToInProgress(caseId);

    await caseDetailPage.navigate(caseId);
    await dismissPunchInModal(caseDetailPage.page);
    await expect(
      caseDetailPage.page.getByRole('button', { name: /Log Time/i }),
    ).not.toBeVisible();

    await setMode('manual');
  },
);

test('TT-21 Reverting to manual shows Log Time and hides Start @timesheets @p1',
  async ({ caseDetailPage }) => {
    await setMode('system_calculated');
    const { caseId } = await makeCase();
    await bringToInProgress(caseId);

    await caseDetailPage.navigate(caseId);
    await dismissPunchInModal(caseDetailPage.page);
    await expect(
      caseDetailPage.page.getByRole('button', { name: /^Start$/i }),
    ).toBeVisible();

    await setMode('manual');
    await caseDetailPage.navigate(caseId);
    await dismissPunchInModal(caseDetailPage.page);

    await expect(
      caseDetailPage.page.getByRole('button', { name: /Log Time/i }),
    ).toBeVisible();
    await expect(
      caseDetailPage.page.getByRole('button', { name: /^Start$/i }),
    ).not.toBeVisible();
  },
);

// ═════════════════════════════════════════════════════════════════════════════
// AUTO-STOP ON STATUS CHANGE
// ═════════════════════════════════════════════════════════════════════════════

test('TT-22 Active auto-session is closed when case leaves eligible status @timesheets @p1',
  async () => {
    await setMode('system_calculated');
    const { caseId } = await makeCase();
    await bringToInProgress(caseId);

    // Start a timer
    const startRes = await apiFetch<{ timelogId: string }>(
      'POST', `/cases/${caseId}/time-logs/start`, token,
    );
    expect(startRes.status).toBe(201);

    // Log 1m manually so we can move status (mandatory time check)
    const today = new Date().toISOString().slice(0, 10);
    await apiFetch('POST', `/cases/${caseId}/time-logs`, token, {
      logDate: today, durationHours: 0, durationMinutes: 1,
    });

    // Move to Closed — this is NOT in TIMELOG_ELIGIBLE so auto-stop MUST trigger.
    // (Completed-Pending Verification IS eligible, so it would NOT stop the timer.)
    await new Promise(r => setTimeout(r, 1500));
    const closeRes = await apiFetch('PATCH', `/cases/${caseId}/status`, token, {
      status: 'Closed',
    });
    expect(closeRes.ok, `Close must succeed — got ${closeRes.status}: ${closeRes.text.slice(0, 100)}`).toBe(true);

    // Check via GET that the auto session is now closed
    const logsRes = await apiFetch<{
      entries: Array<{ timelogId: string; endedAt: string | null; source: string }>
    }>('GET', `/cases/${caseId}/time-logs`, token);

    const auto = logsRes.data.entries.find(e => e.source === 'auto');
    expect(auto, 'Auto session must exist').toBeDefined();
    expect(auto!.endedAt, 'Session must be closed (endedAt set) after status → Closed').not.toBeNull();

    await setMode('manual');
  },
);

// ═════════════════════════════════════════════════════════════════════════════
// TIMESHEETS PAGE
// ═════════════════════════════════════════════════════════════════════════════

test('TT-23 Timesheets page accessible from sidebar @timesheets @p1',
  async ({ page }) => {
    await page.goto('/');
    await dismissPunchInModal(page);
    await expect(
      page.getByRole('link', { name: /Timesheets/i }),
    ).toBeVisible();

    await page.getByRole('link', { name: /Timesheets/i }).click();
    await page.waitForURL('**/timesheets**');
    await expect(
      page.getByRole('heading', { name: /Timesheets/i }),
    ).toBeVisible();
  },
);

test('TT-24 Time entry logged on a case appears on the Timesheets page @timesheets @p1',
  async ({ page }) => {
    const { caseId } = await makeCase();
    await bringToInProgress(caseId);

    const today = new Date().toISOString().slice(0, 10);
    await apiFetch('POST', `/cases/${caseId}/time-logs`, token, {
      logDate: today, durationHours: 2, durationMinutes: 0,
    });

    await page.goto('/timesheets');
    await dismissPunchInModal(page);

    await expect(
      page.getByRole('cell', { name: /2h/i }).first(),
    ).toBeVisible({ timeout: 15000 });
  },
);

test('TT-25 Date range filter on Timesheets page returns empty state for no-match range @timesheets @p1',
  async ({ page }) => {
    await page.goto('/timesheets');
    await dismissPunchInModal(page);

    // Wait for the page to be ready before interacting with filters
    await expect(
      page.getByRole('heading', { name: /Timesheets/i }),
    ).toBeVisible({ timeout: 10000 });

    const inputs = page.locator('input[type="date"]');
    await inputs.first().fill('2020-01-01');
    await inputs.last().fill('2020-01-31');
    await page.getByRole('button', { name: /Apply/i }).click();

    await expect(
      page.getByText(/No time entries found/i),
    ).toBeVisible({ timeout: 10000 });
  },
);
