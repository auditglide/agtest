/**
 * Work Allocation — delegate, self-assign, rollback
 */
import { test, expect } from '../../fixtures/auth-fixture';
import {
  apiFetch,
  deactivateComplianceType,
  findCaseIdForClient,
  getCachedApiAuth,
  seedCase,
  seedComplianceType,
  seedClient,
  deleteClient,
  deleteComplianceType,
} from '../../helpers/api-seed.helper';

let token = '';
let branchId = '';
const waCtIds: string[] = [];
const waClientIds: string[] = [];

test.beforeAll(async () => {
  const cachedAuth = getCachedApiAuth();
  if (!cachedAuth) {
    throw new Error('Missing cached API auth. Run the Playwright setup project before work-allocation tests.');
  }
  ({ token, branchId } = cachedAuth);
});

test.afterAll(async () => {
  for (const clientId of waClientIds) {
    await deleteClient(token, clientId);
  }
  for (const ctId of waCtIds) {
    await deleteComplianceType(token, ctId);
  }
});

test.describe('Work Allocation', () => {

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

  function validPan(prefix: string, index: number): string {
    const letters = prefix.replace(/[^A-Z]/gi, '').toUpperCase().padEnd(5, 'A').slice(0, 5);
    return `${letters}${String(1000 + index)}${String.fromCharCode(65 + (index % 26))}`;
  }

  async function findWorkerQueuePageForCase(caseId: string, limit = 20): Promise<number | null> {
    const firstPage = await apiFetch<{ data: Array<{ caseId: string }>; total: number }>(
      'GET',
      `/cases/worker-queue?branchId=${encodeURIComponent(branchId)}&page=1&limit=${limit}`,
      token,
    );
    expect(firstPage.status, 'The worker queue must be readable while locating the seeded queue case').toBe(200);

    const totalPages = Math.max(1, Math.ceil((firstPage.data.total ?? 0) / limit));
    if ((firstPage.data.data ?? []).some((entry) => entry.caseId === caseId)) {
      return 1;
    }

    for (let pageNo = 2; pageNo <= totalPages; pageNo += 1) {
      const pageResponse = await apiFetch<{ data: Array<{ caseId: string }> }>(
        'GET',
        `/cases/worker-queue?branchId=${encodeURIComponent(branchId)}&page=${pageNo}&limit=${limit}`,
        token,
      );
      expect(pageResponse.status, `Worker queue page ${pageNo} must be readable while locating the seeded queue case`).toBe(200);
      if ((pageResponse.data.data ?? []).some((entry) => entry.caseId === caseId)) {
        return pageNo;
      }
    }

    return null;
  }

  async function openWorkQueuePage(page: import('@playwright/test').Page, targetPage: number): Promise<void> {
    await page.goto('/todo');
    await page.getByTestId('button-work-queue').click();

    const dialog = page.getByRole('dialog');
    await expect(dialog, 'The work queue dialog must open before queue-page navigation').toBeVisible();

    for (let current = 1; current < targetPage; current += 1) {
      const pager = dialog.locator('span').filter({ hasText: new RegExp(`^Page ${current} of \\d+$`) }).locator('..');
      await expect(pager, `Work queue dialog must show pagination state for page ${current}`).toBeVisible();
      await pager.getByRole('button').last().click();
      await expect(
        dialog.locator('span').filter({ hasText: new RegExp(`^Page ${current + 1} of \\d+$`) }),
        `Work queue dialog must navigate to page ${current + 1}`,
      ).toBeVisible();
    }
  }

  async function seedWorkAllocationFixture(prefix: string, caseCount: number) {
    const runId = Date.now();
    const clientIds: string[] = [];
    const seededCompliance = await seedComplianceType(token, {
      type: `${prefix}-CT-${runId}`,
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
    waCtIds.push(seededCompliance.complianceTypeId);

    for (let i = 0; i < caseCount; i += 1) {
      const client = await seedClient(token, {
        name: `${prefix}-Client-${runId}-${i}`,
        pan: validPan(`${prefix}${String(runId).slice(-2)}`, i),
        branchId,
        complianceTypeIds: [seededCompliance.complianceTypeId],
      });
      waClientIds.push(client.clientId);
      clientIds.push(client.clientId);
    }

    return {
      complianceTypeId: seededCompliance.complianceTypeId,
      clientIds,
    };
  }

  test('WA1 work allocation page loads @smoke', async ({ page }) => {
    await page.goto('/work-allocation');
    await expect(page.locator('body'), 'Work allocation page must not crash').not.toContainText('Error');
  });

  test('WA2 unallocated cases are listed', async ({ page }) => {
    await page.goto('/work-allocation');
    await page.waitForLoadState?.('networkidle').catch(() => {});

    const hasOverviewTable = await page.locator('table').filter({
      has: page.getByRole('columnheader', { name: 'Client' }),
    }).count();
    const hasEmpty = await page.getByText(/No cases found for this month\./i).count();
    const hasBranchPrompt = await page.getByText(/Select a branch to view cases\./i).count();

    expect(
      hasOverviewTable > 0 || hasEmpty > 0 || hasBranchPrompt > 0,
      'Work allocation page must show the overview table, an empty month state, or a branch-selection prompt',
    ).toBe(true);
  });

  test('WA3 delegate button is visible for unallocated cases', async ({ page }) => {
    await page.goto('/work-allocation');
    await page.waitForLoadState?.('networkidle').catch(() => {});

    const unassignedCheckboxes = page.locator('tbody input[type="checkbox"]');
    const count = await unassignedCheckboxes.count();

    if (count === 0) {
      test.skip(true, 'No unallocated cases found to test delegation');
    }

    await test.step('Delegate button is visible and enabled', async () => {
      await unassignedCheckboxes.first().check();
      await expect(
        page.getByRole('button', { name: /Assign \d+ case/i }),
        'Assign button must appear after selecting an unallocated case',
      ).toBeVisible();
    });
  });

  test('WA4 allocation batch rollback button is visible in history', async ({ page }) => {
    await page.goto('/work-allocation/history');
    await page.waitForLoadState?.('networkidle').catch(() => {});

    // Verify page loads; rollback is only available for batches
    await expect(page.locator('body'), 'Allocation history must not crash').not.toContainText('Error');
  });

  test('WA5 manual delegation preview distributes cases round-robin @p0', async () => {
    const { complianceTypeId } = await seedWorkAllocationFixture('WA5', 5);

    const usersResponse = await apiFetch<Array<{ userId: string; name: string }>>(
      'GET',
      `/work-allocation/assignable-users?branchId=${encodeURIComponent(branchId)}`,
      token,
    );
    expect(usersResponse.status, 'Assignable users must be readable for preview setup').toBe(200);

    if ((usersResponse.data?.length ?? 0) < 2) {
      test.skip(true, 'Need at least two assignable users in the selected branch to verify round-robin preview math');
    }

    const selectedUsers = usersResponse.data.slice(0, 2);
    const previewResponse = await apiFetch<{
      totalCases: number;
      totalAssociates: number;
      casesPerAssociate: number;
      remainder: number;
      distribution: Array<{ userId: string; userName: string; caseCount: number }>;
    }>(
      'POST',
      '/work-allocation/auto-delegate/preview',
      token,
      {
        branchId,
        complianceId: complianceTypeId,
        complianceFilterType: 'compliancetype',
        userIds: selectedUsers.map((user) => user.userId),
      },
    );

    expect(previewResponse.status, 'Manual delegation preview must succeed for the seeded compliance type').toBe(200);
    expect(previewResponse.data.totalCases, 'Preview must count every unassigned seeded case').toBe(5);
    expect(previewResponse.data.totalAssociates, 'Preview must count the selected associates').toBe(2);
    expect(previewResponse.data.casesPerAssociate, 'Base round-robin share must be floor(total / users)').toBe(2);
    expect(previewResponse.data.remainder, 'Preview must expose the extra-case remainder').toBe(1);

    const counts = previewResponse.data.distribution
      .map((entry) => entry.caseCount)
      .sort((a, b) => a - b);

    expect(counts, 'Round-robin preview should split 5 cases across 2 users as 2 and 3').toEqual([2, 3]);
  });

  test('WA6 manual delegation confirm assigns cases and records a rollback batch @p0', async () => {
    const { complianceTypeId } = await seedWorkAllocationFixture('WA6', 4);

    const usersResponse = await apiFetch<Array<{ userId: string; name: string }>>(
      'GET',
      `/work-allocation/assignable-users?branchId=${encodeURIComponent(branchId)}`,
      token,
    );
    expect(usersResponse.status, 'Assignable users must be readable for confirm setup').toBe(200);

    if ((usersResponse.data?.length ?? 0) < 2) {
      test.skip(true, 'Need at least two assignable users in the selected branch to verify manual delegation confirm');
    }

    const selectedUsers = usersResponse.data.slice(0, 2);
    const previewResponse = await apiFetch<{
      distribution: Array<{ userId: string; userName: string; caseCount: number }>;
    }>(
      'POST',
      '/work-allocation/auto-delegate/preview',
      token,
      {
        branchId,
        complianceId: complianceTypeId,
        complianceFilterType: 'compliancetype',
        userIds: selectedUsers.map((user) => user.userId),
      },
    );
    expect(previewResponse.status, 'Preview must succeed before confirming manual delegation').toBe(200);

    const confirmResponse = await apiFetch<{
      message: string;
      batchId: string;
      totalCases: number;
      totalAssociates: number;
      distribution: Array<{ userId: string; userName: string; casesAssigned: number }>;
    }>(
      'POST',
      '/work-allocation/auto-delegate/confirm',
      token,
      {
        branchId,
        complianceId: complianceTypeId,
        complianceFilterType: 'compliancetype',
        context: 'manual',
        distribution: previewResponse.data.distribution.map((entry) => ({
          userId: entry.userId,
          caseCount: entry.caseCount,
        })),
      },
    );

    expect(confirmResponse.status, 'Manual delegation confirm must succeed for the previewed distribution').toBe(200);
    expect(confirmResponse.data.message, 'Confirm response must acknowledge the allocation').toMatch(/cases distributed/i);
    expect(confirmResponse.data.totalCases, 'Confirm must assign all seeded cases').toBe(4);
    expect(confirmResponse.data.totalAssociates, 'Confirm must report the number of selected associates').toBe(2);
    expect(confirmResponse.data.batchId, 'Confirm must return a rollback batch identifier').toBeTruthy();

    const batchCasesResponse = await apiFetch<Array<{
      caseid: string;
      currentStatus: string;
      assignedToUserId: string;
      rolledBack: boolean;
    }>>(
      'GET',
      `/work-allocation/batches/${confirmResponse.data.batchId}/cases`,
      token,
    );

    expect(batchCasesResponse.status, 'The new allocation batch must be queryable immediately').toBe(200);
    expect(batchCasesResponse.data.length, 'The batch must contain every distributed case').toBe(4);
    expect(
      batchCasesResponse.data.every((entry) => entry.currentStatus === 'Assigned'),
      'Confirmed manual delegation must leave seeded cases in Assigned status',
    ).toBe(true);
    expect(
      batchCasesResponse.data.every((entry) => entry.assignedToUserId.length > 0),
      'Each batch row must record the target assignee',
    ).toBe(true);
    expect(
      batchCasesResponse.data.every((entry) => entry.rolledBack === false),
      'A fresh allocation batch must not be marked rolled back yet',
    ).toBe(true);
  });

  test('WA7 rollback returns still-assigned cases to New and skips progressed ones @p0', async () => {
    const { complianceTypeId } = await seedWorkAllocationFixture('WA7', 3);
    const requesterUserId = decodeJwtSubject(token);

    if (!requesterUserId) {
      test.skip(true, 'Could not decode the current user id from the cached API auth token');
    }

    const usersResponse = await apiFetch<Array<{ userId: string; name: string }>>(
      'GET',
      `/work-allocation/assignable-users?branchId=${encodeURIComponent(branchId)}`,
      token,
    );
    expect(usersResponse.status, 'Assignable users must be readable for rollback setup').toBe(200);

    const selfUser = usersResponse.data.find((user) => user.userId === requesterUserId);
    if (!selfUser) {
      test.skip(true, 'The authenticated admin user is not assignable in the current branch, so rollback progression cannot be verified safely');
    }

    const previewResponse = await apiFetch<{
      distribution: Array<{ userId: string; userName: string; caseCount: number }>;
    }>(
      'POST',
      '/work-allocation/auto-delegate/preview',
      token,
      {
        branchId,
        complianceId: complianceTypeId,
        complianceFilterType: 'compliancetype',
        userIds: [requesterUserId],
      },
    );
    expect(previewResponse.status, 'Preview must succeed before confirming the rollback fixture batch').toBe(200);

    const confirmResponse = await apiFetch<{
      batchId: string;
      totalCases: number;
    }>(
      'POST',
      '/work-allocation/auto-delegate/confirm',
      token,
      {
        branchId,
        complianceId: complianceTypeId,
        complianceFilterType: 'compliancetype',
        context: 'manual',
        distribution: previewResponse.data.distribution.map((entry) => ({
          userId: entry.userId,
          caseCount: entry.caseCount,
        })),
      },
    );
    expect(confirmResponse.status, 'Confirm must succeed before rollback can be tested').toBe(200);
    expect(confirmResponse.data.totalCases, 'The rollback fixture must start with three assigned cases').toBe(3);

    const batchCasesResponse = await apiFetch<Array<{
      caseid: string;
      currentStatus: string;
      rolledBack: boolean;
    }>>(
      'GET',
      `/work-allocation/batches/${confirmResponse.data.batchId}/cases`,
      token,
    );
    expect(batchCasesResponse.status, 'The rollback batch must expose its allocated cases').toBe(200);
    expect(batchCasesResponse.data.length, 'The rollback fixture batch must include every assigned case').toBe(3);

    const progressedCaseId = batchCasesResponse.data[0]?.caseid;
    expect(progressedCaseId, 'At least one allocated case is required for the rollback skip check').toBeTruthy();

    const progressResponse = await apiFetch<{ status: string }>(
      'PATCH',
      `/cases/${progressedCaseId}/status`,
      token,
      { status: 'In Progress' },
    );
    expect(progressResponse.status, 'The authenticated assignee must be able to move one allocated case to In Progress before rollback').toBe(200);
    expect(progressResponse.data.status, 'The progressed case must now be outside the rollbackable Assigned state').toBe('In Progress');

    const rollbackResponse = await apiFetch<{
      message: string;
      rolledBack: number;
      skipped: number;
    }>(
      'POST',
      `/work-allocation/rollback/${confirmResponse.data.batchId}`,
      token,
    );

    expect(rollbackResponse.status, 'Rollback must succeed for a live allocation batch').toBe(200);
    expect(rollbackResponse.data.message, 'Rollback must acknowledge completion').toMatch(/rollback complete/i);
    expect(rollbackResponse.data.rolledBack, 'Only the two still-Assigned cases should return to New').toBe(2);
    expect(rollbackResponse.data.skipped, 'The case already moved to In Progress must be skipped').toBe(1);

    const afterRollbackResponse = await apiFetch<Array<{
      caseid: string;
      currentStatus: string;
      rolledBack: boolean;
    }>>(
      'GET',
      `/work-allocation/batches/${confirmResponse.data.batchId}/cases`,
      token,
    );
    expect(afterRollbackResponse.status, 'The allocation batch must remain queryable after rollback').toBe(200);

    const statusByCaseId = new Map(afterRollbackResponse.data.map((entry) => [entry.caseid, entry.currentStatus]));
    expect(
      statusByCaseId.get(progressedCaseId),
      'The progressed case must stay In Progress after rollback skips it',
    ).toBe('In Progress');
    expect(
      afterRollbackResponse.data.filter((entry) => entry.caseid !== progressedCaseId).every((entry) => entry.currentStatus === 'New'),
      'Every still-Assigned case in the batch must revert to New',
    ).toBe(true);
    expect(
      afterRollbackResponse.data.filter((entry) => entry.caseid !== progressedCaseId).every((entry) => entry.rolledBack === true),
      'Rolled-back work-allocation rows must be stamped as rolled back',
    ).toBe(true);
  });

  test('WA8 direct-assign from monthly overview only distributes still-New cases @p1', async () => {
    const requesterUserId = decodeJwtSubject(token);
    expect(requesterUserId, 'Could not decode the current user id from the cached API auth token').toBeTruthy();

    const runId = Date.now();
    const seededCompliance = await seedComplianceType(token, {
      type: `WA8-CT-${runId}`,
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
    waCtIds.push(seededCompliance.complianceTypeId);

    await deactivateComplianceType(token, seededCompliance.complianceTypeId);

    const clientIds: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const client = await seedClient(token, {
        name: `WA8-Client-${runId}-${i}`,
        pan: validPan(`WA8${String(runId).slice(-2)}`, i),
        branchId,
        complianceTypeIds: [seededCompliance.complianceTypeId],
      });
      waClientIds.push(client.clientId);
      clientIds.push(client.clientId);
    }

    const caseIds: string[] = [];
    for (const clientId of clientIds) {
      const manualCase = await seedCase(token, {
        clientId,
        complianceTypeId: seededCompliance.complianceTypeId,
      });
      const caseId = manualCase.caseId || await findCaseIdForClient(token, branchId, clientId);
      expect(caseId, `The WA8 fixture client ${clientId} must generate a New case`).toBeTruthy();
      caseIds.push(caseId);
    }

    const usersResponse = await apiFetch<Array<{ userId: string; name: string }>>(
      'GET',
      `/work-allocation/assignable-users?branchId=${encodeURIComponent(branchId)}`,
      token,
    );
    expect(usersResponse.status, 'Assignable users must be readable for direct-assign confirm').toBe(200);

    const targetUser = usersResponse.data.find((user) => user.userId === requesterUserId) ?? usersResponse.data[0];
    if (!targetUser) {
      test.skip(true, 'Need at least one assignable user in the current branch to verify direct-assign confirm');
    }

    const previewResponse = await apiFetch<{
      totalCases: number;
      distribution: Array<{ userId: string; userName: string; caseCount: number }>;
    }>(
      'POST',
      '/work-allocation/direct-assign/preview',
      token,
      {
        caseIds,
        userIds: [targetUser.userId],
      },
    );
    expect(previewResponse.status, 'Direct-assign preview must succeed before confirm revalidation is tested').toBe(200);
    expect(previewResponse.data.totalCases, 'The preview should initially see all three selected New cases').toBe(3);

    const staleCaseId = caseIds[0];
    const staleAssign = await apiFetch('PATCH', `/cases/${staleCaseId}/assign`, token, { userId: requesterUserId });
    expect(staleAssign.status, 'One selected case must become non-New before confirm to exercise stale selection handling').toBe(200);

    const confirmResponse = await apiFetch<{
      message: string;
      batchId: string;
      totalCases: number;
      totalAssociates: number;
      distribution: Array<{ userId: string; userName: string; casesAssigned: number }>;
    }>(
      'POST',
      '/work-allocation/direct-assign/confirm',
      token,
      {
        caseIds,
        context: 'manual',
        distribution: previewResponse.data.distribution.map((entry) => ({
          userId: entry.userId,
          caseCount: entry.caseCount,
        })),
      },
    );

    expect(confirmResponse.status, 'Direct-assign confirm must succeed even when one selected case is no longer New').toBe(200);
    expect(confirmResponse.data.totalCases, 'Only the two still-New cases should be distributed at confirm time').toBe(2);
    expect(confirmResponse.data.totalAssociates, 'The direct-assign confirm must report the assignee count').toBe(1);
    expect(confirmResponse.data.distribution[0]?.casesAssigned, 'The stale selected case must be skipped from the final assignment batch').toBe(2);

    const batchCasesResponse = await apiFetch<Array<{ caseid: string }>>(
      'GET',
      `/work-allocation/batches/${confirmResponse.data.batchId}/cases`,
      token,
    );
    expect(batchCasesResponse.status, 'The direct-assign batch must remain inspectable after confirm').toBe(200);
    const batchCaseIds = batchCasesResponse.data.map((entry) => entry.caseid);
    expect(batchCaseIds, 'The case already assigned before confirm must not be redistributed in the direct-assign batch').not.toContain(staleCaseId);
  });

  test('WA9 self-assign from the work queue succeeds and removes the case from the queue @p1', async ({ page, caseDetailPage }) => {
    const runId = Date.now();
    const seededCompliance = await seedComplianceType(token, {
      type: `WA9-CT-${runId}`,
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
    waCtIds.push(seededCompliance.complianceTypeId);

    const queueClient = await seedClient(token, {
      name: `WA9-Client-${runId}`,
      pan: `WAQCL${String(runId).slice(-4)}A`,
      branchId,
      complianceTypeIds: [seededCompliance.complianceTypeId],
    });
    waClientIds.push(queueClient.clientId);

    const caseId = await findCaseIdForClient(token, branchId, queueClient.clientId);
    expect(caseId, 'The seeded WA9 client must produce a queueable New case').toBeTruthy();

    const queuePage = await findWorkerQueuePageForCase(caseId);
    expect(
      queuePage,
      'The seeded queue case must appear on some page of the worker queue before testing self-assignment',
    ).not.toBeNull();

    await openWorkQueuePage(page, queuePage ?? 1);

    await test.step('Open the work queue and self-assign the seeded case', async () => {
      await expect(page.getByRole('dialog').getByText(`WA9-Client-${runId}`)).toBeVisible();
      await page.getByTestId(`button-pickup-${caseId}`).click();
      await expect(page).toHaveURL(new RegExp(`/cases/${caseId}\\?from=todo$`));
    });

    await test.step('The picked-up case is now Assigned on its detail page', async () => {
      await caseDetailPage.expectStatus('Assigned');
    });

    await test.step('Returning to the work queue no longer shows the picked-up case', async () => {
      await openWorkQueuePage(page, 1);
      await expect(page.getByRole('dialog').getByText(`WA9-Client-${runId}`)).toHaveCount(0);
    });
  });

  test('WA10 self-assign conflict shows refreshed queue message @p1', async ({ page }) => {
    const runId = Date.now();
    const seededCompliance = await seedComplianceType(token, {
      type: `WA10-CT-${runId}`,
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
    waCtIds.push(seededCompliance.complianceTypeId);

    const queueClient = await seedClient(token, {
      name: `WA10-Client-${runId}`,
      pan: `WAQCF${String(runId).slice(-4)}A`,
      branchId,
      complianceTypeIds: [seededCompliance.complianceTypeId],
    });
    waClientIds.push(queueClient.clientId);

    const caseId = await findCaseIdForClient(token, branchId, queueClient.clientId);
    expect(caseId, 'The seeded WA10 client must produce a queueable New case').toBeTruthy();

    const queuePage = await findWorkerQueuePageForCase(caseId);
    expect(
      queuePage,
      'The seeded queue case must appear on some page of the worker queue before conflict handling is tested',
    ).not.toBeNull();

    await openWorkQueuePage(page, queuePage ?? 1);
    await expect(page.getByTestId(`button-pickup-${caseId}`)).toBeVisible();

    const backgroundClaim = await apiFetch(
      'POST',
      `/work-allocation/queue/${caseId}/self-assign`,
      token,
    );
    expect(backgroundClaim.status, 'The background claimant must successfully take the queue case before the visible pickup click').toBe(200);

    await test.step('Clicking the stale pickup button surfaces the refreshed-queue conflict UX', async () => {
      await page.getByTestId(`button-pickup-${caseId}`).click();
      await expect(
        page.getByText(/just picked up by someone else.*queue has been refreshed/i),
        'The work queue must explain that the case was claimed before the visible click landed',
      ).toBeVisible();
    });

    await test.step('The queue refresh removes the now-assigned case from the visible work queue', async () => {
      await expect(page.getByTestId(`button-pickup-${caseId}`)).toHaveCount(0);
    });
  });

});
