/**
 * Compliance Schedule — exhaustive date combination tests
 *
 * Tests every meaningful combination of creation/deadline offsets:
 *   - Normal dates
 *   - Past creation date (Scenario 1: create cases now)
 *   - Future creation date (Scenario 2: delete existing cases)
 *   - Leap year Feb 29
 *   - End-of-month day 31 clamping
 *   - Invalid schedule (deadline before creation)
 *
 * The test data is driven by SCHEDULE_COMBOS from date.helper.ts.
 */
import { test, expect } from '../../fixtures/auth-fixture';
import {
  apiFetch,
  defaultSchedule,
  findCaseIdForClient,
  getCachedApiAuth,
  seedComplianceType,
  seedClient,
  deleteComplianceType,
  deleteClient,
} from '../../helpers/api-seed.helper';
import { disconnectTestDb, setCaseFixtureState } from '../../helpers/test-db.helper';
import {
  SCHEDULE_COMBOS,
  isLeapYear,
} from '../../helpers/date.helper';

let token = '';
let branchId = '';
const createdCTs: string[]     = [];
const createdClients: string[] = [];

test.beforeAll(async () => {
  const cachedAuth = getCachedApiAuth();
  if (!cachedAuth) {
    throw new Error('Missing cached API auth. Run the Playwright setup project before compliance-schedule tests.');
  }
  ({ token, branchId } = cachedAuth);
});

test.afterAll(async () => {
  for (const id of createdCTs)     await deleteComplianceType(token, id);
  for (const id of createdClients) await deleteClient(token, id);
  await disconnectTestDb();
});

// ─── Part 1: Schedule combination validation (all combos via UI) ──────────────

test.describe('Schedule combinations — validity', () => {

  for (const combo of SCHEDULE_COMBOS) {
    test(`SCH: ${combo.label}`, async ({ complianceListPage, complianceDetailPage, page }) => {
      // Create a new CT for this combo
      await complianceListPage.navigate();
      await complianceListPage.openCreateModal();
      await complianceListPage.fillCreateForm({ name: `SCH-${Date.now()}`, frequency: 'Monthly' });

      await test.step(`Fill schedule: creation offset=${combo.creation_month_offset}, day=${combo.creation_day} / deadline offset=${combo.deadline_month_offset}, day=${combo.deadline_day}`, async () => {
        await complianceDetailPage.fillAllScheduleRows('Monthly', {
          creationMonthOffset: combo.creation_month_offset,
          creationDay:         combo.creation_day,
          deadlineMonthOffset: combo.deadline_month_offset,
          deadlineDay:         combo.deadline_day,
        });
      });

      if (combo.expectValid) {
        await complianceListPage.submitCreate();

        await test.step(`VALID combo "${combo.label}" — must save successfully`, async () => {
          await expect(
            page,
            `"${combo.label}" is a valid schedule — must navigate to CT detail. Notes: ${combo.notes}`,
          ).toHaveURL(/\/compliance\/[0-9a-f-]{36}/, { timeout: 10_000 });
          createdCTs.push(page.url().split('/').pop()!);
        });
      } else {
        await test.step(`INVALID combo "${combo.label}" — must show inline validation in the editor`, async () => {
          await complianceDetailPage.expectScheduleInvalidError();
        });
      }
    });
  }

});

function decodeJwtSubject(accessToken: string): string {
  const [, payload = ''] = accessToken.split('.');
  if (!payload) return '';

  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const decoded = JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as { sub?: string };
    return decoded.sub ?? '';
  } catch {
    return '';
  }
}

test.describe('Schedule validation — API invariants', () => {

  test('SCH-V1 duplicate monthly period_index values are rejected @p0', async () => {
    const invalidSchedule = defaultSchedule('Monthly').map((entry) => ({ ...entry }));
    invalidSchedule[11] = { ...invalidSchedule[11], period_index: 0 };

    const response = await apiFetch<{ error?: string; message?: string }>(
      'POST',
      '/compliance',
      token,
      {
        type: `SCH-V1-${Date.now()}`,
        frequency: 'Monthly',
        needsWorkAllocation: false,
        schedule: invalidSchedule,
      },
    );

    expect(response.status, 'Duplicate period_index values must fail compliance creation').toBe(400);
    expect(
      response.text,
      'The API must explain that the schedule shape is invalid',
    ).toMatch(/invalid schedule/i);
  });

  test('SCH-V2 invalid yearly schedule length is rejected @p0', async () => {
    const response = await apiFetch<{ error?: string; message?: string }>(
      'POST',
      '/compliance',
      token,
      {
        type: `SCH-V2-${Date.now()}`,
        frequency: 'Yearly',
        needsWorkAllocation: false,
        schedule: defaultSchedule('Monthly').slice(0, 2),
      },
    );

    expect(response.status, 'A yearly compliance type must reject more than one schedule entry').toBe(400);
    expect(
      response.text,
      'The API must reject yearly schedules with the wrong number of entries',
    ).toMatch(/invalid schedule/i);
  });

});

// ─── Part 2: Scenario 1 — past creation date triggers immediate case creation ──

test.describe('Schedule change — Scenario 1 (past creation date)', () => {

  test('SCH-S1 changing creation date to past shows Scenario 1 impact dialog', async ({
    complianceDetailPage, page,
  }) => {
    // Seed: CT + client
    const ct = await seedComplianceType(token, { type: `SCH-S1-${Date.now()}`, frequency: 'Monthly' });
    const cl = await seedClient(token, {
      name: `SCH-S1-Client-${Date.now()}`,
      pan: 'AASSS1111S',
      branchId,
      complianceTypeIds: [ct.complianceTypeId],
    });
    createdCTs.push(ct.complianceTypeId);
    createdClients.push(cl.clientId);

    await complianceDetailPage.navigate(ct.complianceTypeId);

    await test.step('Change the schedule to a past creation pattern via the monthly seed editor', async () => {
      await complianceDetailPage.fillAllScheduleRows('Monthly', {
        creationMonthOffset: 0,
        creationDay:         1,
        deadlineMonthOffset: 1,
        deadlineDay:         20,
      });
    });

    await test.step('Click Analyze to preview impact', async () => {
      await complianceDetailPage.clickAnalyzeSchedule();
    });

    await test.step('Impact dialog must appear with Scenario 1 (cases to create)', async () => {
      await complianceDetailPage.expectScheduleImpactDialog();
      await expect(
        page.locator('[role="dialog"]').getByText(/create.*case|case.*creat/i),
        'Scenario 1: impact dialog must mention cases that will be created immediately',
      ).toBeVisible();
    });
  });

});

// ─── Part 3: Scenario 2 — future creation date triggers case deletion ─────────

test.describe('Schedule change — Scenario 2 (future creation date)', () => {

  test('SCH-S2 changing creation date to future shows Scenario 2 impact dialog', async ({
    complianceDetailPage, page,
  }) => {
    const ct = await seedComplianceType(token, {
      type: `SCH-S2-${Date.now()}`,
      frequency: 'Monthly',
      // Use a past creation date so cases already exist
      schedule: Array.from({ length: 12 }, (_, i) => ({
        period_index: i,
        creation_month_offset: 0,
        creation_day: 1,
        deadline_month_offset: 1,
        deadline_day: 20,
      })),
    });
    const seededClient = await seedClient(token, {
      name: `SCH-S2-Client-${Date.now()}`,
      pan: 'AASSS2222S',
      branchId,
      complianceTypeIds: [ct.complianceTypeId],
    });
    createdCTs.push(ct.complianceTypeId);
    createdClients.push(seededClient.clientId);

    await complianceDetailPage.navigate(ct.complianceTypeId);

    await test.step('Change the schedule to the latest supported future pattern in the monthly seed editor', async () => {
      await complianceDetailPage.fillAllScheduleRows('Monthly', {
        creationMonthOffset: 3,
        creationDay:         30,
        deadlineMonthOffset: 3,
        deadlineDay:         31,
      });
    });

    await test.step('Click Analyze', async () => {
      await complianceDetailPage.clickAnalyzeSchedule();
    });

    await test.step('Impact dialog must mention cases that will be deleted', async () => {
      await complianceDetailPage.expectScheduleImpactDialog();
      await complianceDetailPage.expectScenario2Impact();
    });
  });

  test('SCH-S3 Scenario 2 dialog shows protected-case counts that will not be deleted @p1', async ({
    complianceDetailPage, page,
  }) => {
    test.skip(!process.env.TEST_DB_URL, 'TEST_DB_URL must be set to run DB-backed protected-case fixtures');

    const ct = await seedComplianceType(token, {
      type: `SCH-S3-${Date.now()}`,
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

    const protectedClient = await seedClient(token, {
      name: `SCH-S3-Protected-${Date.now()}`,
      pan: 'AASSS3333S',
      branchId,
      complianceTypeIds: [ct.complianceTypeId],
    });
    const deletableClient = await seedClient(token, {
      name: `SCH-S3-Deletable-${Date.now()}`,
      pan: 'AASSS4444S',
      branchId,
      complianceTypeIds: [ct.complianceTypeId],
    });

    createdCTs.push(ct.complianceTypeId);
    createdClients.push(protectedClient.clientId, deletableClient.clientId);

    const protectedCaseId = await findCaseIdForClient(token, branchId, protectedClient.clientId);
    const deletableCaseId = await findCaseIdForClient(token, branchId, deletableClient.clientId);
    expect(protectedCaseId, 'The protected fixture client must have a generated case to protect').toBeTruthy();
    expect(deletableCaseId, 'The deletable fixture client must have a generated case to delete').toBeTruthy();

    await setCaseFixtureState({
      caseId: protectedCaseId,
      status: 'Closed',
      assignedToUserId: null,
      closedByUserId: null,
    });

    await complianceDetailPage.navigate(ct.complianceTypeId);
    await complianceDetailPage.fillAllScheduleRows('Monthly', {
      creationMonthOffset: 3,
      creationDay: 30,
      deadlineMonthOffset: 3,
      deadlineDay: 31,
    });

      await test.step('Analyzing the future schedule shows both deletable and protected case counts', async () => {
        await complianceDetailPage.clickAnalyzeSchedule();
        await complianceDetailPage.expectScheduleImpactDialog();
        await expect(
          page.locator('[role="dialog"]').getByText('Existing cases will be deleted', { exact: true }),
          'Scenario 2 must show the delete-impact header exactly once',
        ).toBeVisible();
        await expect(
          page.locator('[role="dialog"]').getByText(/^1 protected$/i),
          'The impacted period row must surface the protected-case badge count',
        ).toBeVisible();
        await expect(
          page.locator('[role="dialog"]').getByText(/^1 case$/i),
          'The impacted period row must still show the deletable-case count as a separate badge from the protected count',
        ).toBeVisible();
      });
  });

});

// ─── Part 4: Leap year edge cases ─────────────────────────────────────────────

test.describe('Schedule — Leap year Feb 29 handling', () => {

  test('SCH-LY1 schedule targeting Feb 29 in next February is accepted', async ({
    complianceListPage, complianceDetailPage, page,
  }) => {
    // period_index=11 = December (period ends Dec 31)
    // creation_month_offset=2 → February of next year
    // creation_day=29 → Feb 29
    const nextYear = new Date().getUTCFullYear() + 1;

    const leapNote = isLeapYear(nextYear)
      ? `Target year ${nextYear} IS a leap year — Feb 29 is a real date.`
      : `Target year ${nextYear} is NOT a leap year — backend will clamp Feb 29 → Feb 28.`;

    await complianceListPage.navigate();
    await complianceListPage.openCreateModal();
    await complianceListPage.fillCreateForm({ name: `SCH-LY1-${Date.now()}`, frequency: 'Monthly' });

    await complianceDetailPage.fillScheduleRow(11, {
      creationMonthOffset: 2,
      creationDay:         29,
      deadlineMonthOffset: 3,
      deadlineDay:         15,
    });

    await complianceListPage.submitCreate();

      await test.step(`CT with Feb 29 offset must save — ${leapNote}`, async () => {
        await expect(
          page,
          `Feb 29 schedule must be accepted (clamped if needed). ${leapNote}`,
      ).toHaveURL(/\/compliance\/[0-9a-f-]{36}/, { timeout: 10_000 });
      createdCTs.push(page.url().split('/').pop()!);
    });
  });

  test('SCH-LY2 schedule targeting Feb 29 from November via max monthly offset is accepted', async ({
    complianceListPage, complianceDetailPage, page,
  }) => {
    // period_index=10 = November (ends Nov 30)
    // creation_month_offset=3 → February of the next year
    // creation_day=29 → clamps to Feb 28 in non-leap years
    await complianceListPage.navigate();
    await complianceListPage.openCreateModal();
    await complianceListPage.fillCreateForm({ name: `SCH-LY2-${Date.now()}`, frequency: 'Monthly' });

    await complianceDetailPage.fillScheduleRow(10, {
      creationMonthOffset: 3,
      creationDay:         29,
      deadlineMonthOffset: 3,
      deadlineDay:         15,
    });

    await complianceListPage.submitCreate();

    await test.step('CT must save — Feb 29 should be accepted within the monthly offset range', async () => {
      await expect(
        page,
        'February 29 within the supported monthly offset range must be accepted; backend clamps when needed',
      ).toHaveURL(/\/compliance\/[0-9a-f-]{36}/, { timeout: 10_000 });
      createdCTs.push(page.url().split('/').pop()!);
    });
  });

});

// ─── Part 5: End-of-month clamping ────────────────────────────────────────────

test.describe('Schedule — End-of-month day 31 clamping', () => {

  test('SCH-EOM1 day 31 targeting April (30-day month) is accepted and clamped', async ({
    complianceListPage, complianceDetailPage, page,
  }) => {
    // period_index=2 = March (ends Mar 31)
    // creation_month_offset=1 → April
    // April has 30 days — day 31 clamps to 30
    await complianceListPage.navigate();
    await complianceListPage.openCreateModal();
    await complianceListPage.fillCreateForm({ name: `SCH-EOM1-${Date.now()}`, frequency: 'Monthly' });

    await complianceDetailPage.fillScheduleRow(2, {
      creationMonthOffset: 1,
      creationDay:         31,
      deadlineMonthOffset: 2,
      deadlineDay:         15,
    });

    await complianceListPage.submitCreate();

    await test.step('Day 31 in April clamps to 30 — CT must save', async () => {
      await expect(
        page,
        'Day 31 targeting April must be accepted; backend clamps to Apr 30',
      ).toHaveURL(/\/compliance\/[0-9a-f-]{36}/, { timeout: 10_000 });
      createdCTs.push(page.url().split('/').pop()!);
    });
  });

  test('SCH-EOM2 day 31 targeting months with 31 days is valid without clamping', async ({
    complianceListPage, complianceDetailPage, page,
  }) => {
    // period_index=0 = January (ends Jan 31)
    // creation_month_offset=2 → March (31 days) — day 31 is valid
    await complianceListPage.navigate();
    await complianceListPage.openCreateModal();
    await complianceListPage.fillCreateForm({ name: `SCH-EOM2-${Date.now()}`, frequency: 'Monthly' });

    await complianceDetailPage.fillScheduleRow(0, {
      creationMonthOffset: 2,
      creationDay:         31,
      deadlineMonthOffset: 3,
      deadlineDay:         15,
    });

    await complianceListPage.submitCreate();

    await test.step('Day 31 in March (31-day month) is valid — CT must save', async () => {
      await expect(
        page,
        'Day 31 targeting a 31-day month must save without clamping',
      ).toHaveURL(/\/compliance\/[0-9a-f-]{36}/, { timeout: 10_000 });
      createdCTs.push(page.url().split('/').pop()!);
    });
  });

});

// ─── Part 6: Quarterly negative offset ────────────────────────────────────────

test.describe('Schedule — Quarterly with negative month offset', () => {

  test('SCH-Q1 quarterly CT with negative creation offset (inside quarter) is valid', async ({
    complianceListPage, complianceDetailPage, page,
  }) => {
    await complianceListPage.navigate();
    await complianceListPage.openCreateModal();
    await complianceListPage.fillCreateForm({ name: `SCH-Q1-${Date.now()}`, frequency: 'Quarterly' });

    // For Quarterly, offset -1 means 1 month before period end (inside the quarter)
    for (let i = 0; i < 4; i++) {
      await complianceDetailPage.fillScheduleRow(i, {
        creationMonthOffset: -1,
        creationDay:         15,
        deadlineMonthOffset: 1,
        deadlineDay:         20,
      }, 'Quarterly');
    }

    await complianceListPage.submitCreate();

    await test.step('Quarterly CT with negative offset must be accepted', async () => {
      await expect(
        page,
        'Quarterly CT with creation offset -1 (inside quarter) must be saved successfully',
      ).toHaveURL(/\/compliance\/[0-9a-f-]{36}/, { timeout: 10_000 });
      createdCTs.push(page.url().split('/').pop()!);
    });
  });

});
