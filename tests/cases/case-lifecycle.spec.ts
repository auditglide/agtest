/**
 * Case Lifecycle — status transitions
 *
 * Valid chain: New → Assigned → In Progress → Completed-Pending Verification
 *           → Verified / Rework Required → (Rework) In Progress → ...→ Closed
 */
import { test, expect } from '../../fixtures/auth-fixture';
import {
  apiFetch,
  getCachedApiAuth,
  seedComplianceType,
  seedClient,
  seedCase,
  findCaseIdForClient,
  deleteClient,
  deleteComplianceType,
} from '../../helpers/api-seed.helper';
import { disconnectTestDb, setCaseClosedByUser } from '../../helpers/test-db.helper';

let token = '';
let branchId = '';
let ctId = '';
const createdClientIds: string[] = [];
const extraCtIds: string[] = [];
const caseIds: Record<'ks1' | 'ks2' | 'ks3' | 'ks4' | 'ks5' | 'ks6' | 'ks7', string> = {
  ks1: '',
  ks2: '',
  ks3: '',
  ks4: '',
  ks5: '',
  ks6: '',
  ks7: '',
};

test.beforeAll(async () => {
  const cachedAuth = getCachedApiAuth();
  if (!cachedAuth) {
    throw new Error('Missing cached API auth. Run the Playwright setup project before case-lifecycle tests.');
  }
  ({ token, branchId } = cachedAuth);

  const ct = await seedComplianceType(token, {
    type: `KS-CT-${Date.now()}`,
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

  const scenarios = [
    { key: 'ks1' as const, name: `KS1-Client-${Date.now()}`, pan: 'AAKSS1111K' },
    { key: 'ks2' as const, name: `KS2-Client-${Date.now()}`, pan: 'AAKSS2222K' },
    { key: 'ks3' as const, name: `KS3-Client-${Date.now()}`, pan: 'AAKSS3333K' },
    { key: 'ks4' as const, name: `KS4-Client-${Date.now()}`, pan: 'AAKSS4444K' },
    { key: 'ks5' as const, name: `KS5-Client-${Date.now()}`, pan: 'AAKSS5555K' },
    { key: 'ks6' as const, name: `KS6-Client-${Date.now()}`, pan: 'AAKSS6666K' },
    { key: 'ks7' as const, name: `KS7-Client-${Date.now()}`, pan: 'AAKSS7777K' },
  ];

  for (const scenario of scenarios) {
    const client = await seedClient(token, {
      name: scenario.name,
      pan: scenario.pan,
      branchId,
      complianceTypeIds: [ctId],
    });
    createdClientIds.push(client.clientId);

    const seededCase = await seedCase(token, {
      clientId: client.clientId,
      complianceTypeId: ctId,
    });
    caseIds[scenario.key] = seededCase.caseId;
  }
});

test.afterAll(async () => {
  await deleteComplianceType(token, ctId);
  for (const extraCtId of extraCtIds) {
    await deleteComplianceType(token, extraCtId);
  }
  for (const clientId of createdClientIds) {
    await deleteClient(token, clientId);
  }
  await disconnectTestDb();
});

test.describe('Case Lifecycle', () => {

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

  test('KS1 New → Assigned transition @smoke', async ({ caseDetailPage }) => {
    await caseDetailPage.navigate(caseIds.ks1);
    await caseDetailPage.expectStatus('New');

    await test.step('Transition to Assigned', async () => {
      await caseDetailPage.transitionTo('Assigned');
    });

    await test.step('Status badge shows Assigned', async () => {
      await caseDetailPage.expectStatus('Assigned');
    });
  });

  test('KS2 Assigned → In Progress', async ({ caseDetailPage }) => {
    await caseDetailPage.navigate(caseIds.ks2);

    await caseDetailPage.expectStatus('New');
    await caseDetailPage.transitionTo('Assigned');
    await caseDetailPage.expectStatus('Assigned');
    await caseDetailPage.transitionTo('In Progress');
    await caseDetailPage.expectStatus('In Progress');
  });

  test('KS3 In Progress → Completed-Pending Verification', async ({ caseDetailPage }) => {
    await caseDetailPage.navigate(caseIds.ks3);

    await caseDetailPage.transitionTo('Assigned');
    await caseDetailPage.transitionTo('In Progress');
    await caseDetailPage.transitionTo('Completed');
    await caseDetailPage.expectStatus(/Completed.*Pending/i);
  });

  test('KS4 In Progress → Closed transition works @p0', async ({ caseDetailPage }) => {
    await caseDetailPage.navigate(caseIds.ks4);

    await caseDetailPage.transitionTo('Assigned');
    await caseDetailPage.transitionTo('In Progress');
    await caseDetailPage.transitionTo('Closed');
    await caseDetailPage.expectStatus('Closed');
  });

  test('KS5 Completed → Rework Required → In Progress (rework loop)', async ({ caseDetailPage }) => {
    await caseDetailPage.navigate(caseIds.ks5);

    await caseDetailPage.transitionTo('Assigned');
    await caseDetailPage.transitionTo('In Progress');
    await caseDetailPage.transitionTo('Completed');

    await test.step('Send to Rework Required', async () => {
      await caseDetailPage.transitionTo('Rework Required');
      await caseDetailPage.expectStatus('Rework Required');
    });

    await test.step('Resume work — back to In Progress', async () => {
      await caseDetailPage.transitionTo('In Progress');
      await caseDetailPage.expectStatus('In Progress');
    });
  });

  test('KS6 Completed-Pending Verification → Closed transition works @p0', async ({ caseDetailPage }) => {
    await caseDetailPage.navigate(caseIds.ks6);

    await caseDetailPage.transitionTo('Assigned');
    await caseDetailPage.transitionTo('In Progress');
    await caseDetailPage.transitionTo('Completed');
    await caseDetailPage.expectStatus(/Completed.*Pending/i);
    await caseDetailPage.transitionTo('Closed');
    await caseDetailPage.expectStatus('Closed');
  });

  test('KS7 invalid transition button is absent (cannot go New → Completed)', async ({ caseDetailPage }) => {
    await caseDetailPage.navigate(caseIds.ks7);
    await caseDetailPage.expectStatus('New');

    await test.step('Completed transition button must NOT be visible from New', async () => {
      await caseDetailPage.expectTransitionButtonAbsent('Completed');
    });

    await test.step('Verified transition button must NOT be visible from New', async () => {
      await caseDetailPage.expectTransitionButtonAbsent('Verified');
    });
  });

  test('KR1 reopen own closed normal case reassigns it back to the current user @p1', async ({ caseDetailPage, page }) => {
    const requesterUserId = decodeJwtSubject(token);
    expect(requesterUserId, 'Could not decode the current user id from the cached API auth token').toBeTruthy();

    const runId = Date.now();
    const reopenedClient = await seedClient(token, {
      name: `KR1-Client-${runId}`,
      pan: `KROPN${String(runId).slice(-4)}A`,
      branchId,
      complianceTypeIds: [ctId],
    });
    createdClientIds.push(reopenedClient.clientId);

    const reopenedCase = await seedCase(token, {
      clientId: reopenedClient.clientId,
      complianceTypeId: ctId,
    });

    const assignResponse = await fetch(`${process.env.API_URL ?? 'https://devapi.auditglide.com'}/cases/${reopenedCase.caseId}/assign`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userId: requesterUserId }),
    });
    expect(assignResponse.status, 'KR1 fixture case must be assignable to the current user').toBe(200);

    const inProgressResponse = await fetch(`${process.env.API_URL ?? 'https://devapi.auditglide.com'}/cases/${reopenedCase.caseId}/status`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status: 'In Progress' }),
    });
    expect(inProgressResponse.status, 'KR1 fixture case must move to In Progress before closing').toBe(200);

    const closedResponse = await fetch(`${process.env.API_URL ?? 'https://devapi.auditglide.com'}/cases/${reopenedCase.caseId}/status`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status: 'Closed' }),
    });
    expect(closedResponse.status, 'KR1 fixture case must close successfully before reopen is tested').toBe(200);

    await caseDetailPage.navigate(reopenedCase.caseId);
    await caseDetailPage.expectStatus('Closed');

    const currentUserName = await page.evaluate(() => {
      const raw = sessionStorage.getItem('user');
      if (!raw) return '';
      try {
        return (JSON.parse(raw) as { name?: string }).name ?? '';
      } catch {
        return '';
      }
    });

    await test.step('Reopen the closed case through the own-case confirm flow', async () => {
      await caseDetailPage.reopenOwnCase();
    });

    await test.step('The reopened case returns to Assigned and is reassigned to the current user', async () => {
      await caseDetailPage.expectStatus('Assigned');
      if (currentUserName) {
        await caseDetailPage.expectAssignedTo(new RegExp(currentUserName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
      }
    });
  });

  test('KR2 reopen someone else’s closed normal case requires assignee selection @p1', async ({ caseDetailPage, page }) => {
    test.skip(!process.env.TEST_DB_URL, 'TEST_DB_URL must be set to run the DB-backed someone-else reopen fixture');

    const requesterUserId = decodeJwtSubject(token);
    expect(requesterUserId, 'Could not decode the current user id from the cached API auth token').toBeTruthy();

    const assignableUsers = await apiFetch<Array<{ userId: string; name: string }>>(
      'GET',
      `/work-allocation/assignable-users?branchId=${encodeURIComponent(branchId)}`,
      token,
    );
    expect(assignableUsers.status, 'Assignable users must be readable for the reopen-assignee flow').toBe(200);

    const otherUser = assignableUsers.data.find((user) => user.userId !== requesterUserId);
    if (!otherUser) {
      test.skip(true, 'Need a second assignable user in the branch to model “someone else closed this case”');
      return;
    }

    const runId = Date.now();
    const dedicatedCt = await seedComplianceType(token, {
      type: `KR2-CT-${runId}`,
      frequency: 'Monthly',
      needsWorkAllocation: true,
      schedule: Array.from({ length: 12 }, (_, i) => ({
        period_index: i,
        creation_month_offset: 3,
        creation_day: 1,
        deadline_month_offset: 3,
        deadline_day: 20,
      })),
    });
    extraCtIds.push(dedicatedCt.complianceTypeId);

    const fixtureClient = await seedClient(token, {
      name: `KR2-Client-${runId}`,
      pan: `KRTWO${String(runId).slice(-4)}A`,
      branchId,
      complianceTypeIds: [dedicatedCt.complianceTypeId],
    });
    createdClientIds.push(fixtureClient.clientId);

    const fixtureCase = await seedCase(token, {
      clientId: fixtureClient.clientId,
      complianceTypeId: dedicatedCt.complianceTypeId,
    });

    expect((await apiFetch('PATCH', `/cases/${fixtureCase.caseId}/assign`, token, { userId: requesterUserId })).status).toBe(200);
    expect((await apiFetch('PATCH', `/cases/${fixtureCase.caseId}/status`, token, { status: 'In Progress' })).status).toBe(200);
    expect((await apiFetch('PATCH', `/cases/${fixtureCase.caseId}/status`, token, { status: 'Closed' })).status).toBe(200);

    await setCaseClosedByUser(fixtureCase.caseId, otherUser.userId);

    const currentUserName = await page.evaluate(() => {
      const raw = sessionStorage.getItem('user');
      if (!raw) return '';
      try {
        return (JSON.parse(raw) as { name?: string }).name ?? '';
      } catch {
        return '';
      }
    });

    await caseDetailPage.navigate(fixtureCase.caseId);
    await caseDetailPage.expectStatus('Closed');

    const selfUser = assignableUsers.data.find((user) => user.userId === requesterUserId);
    const reopenAssigneeName = currentUserName || selfUser?.name || otherUser.name;

    await test.step('Reopening a case closed by someone else opens the assignee picker dialog', async () => {
      await page.getByRole('button', { name: /Reopen Case/i }).click();
      await expect(page.getByRole('dialog').getByRole('heading', { name: 'Reopen Case' })).toBeVisible();
      await expect(page.getByRole('dialog').getByText(/Select the user to reassign this case to/i)).toBeVisible();
      await expect(
        page.getByRole('dialog').getByRole('button', { name: /^Reopen$/i }),
        'The Path B reopen action must stay disabled until an assignee is selected',
      ).toBeDisabled();
    });

    await test.step('Selecting an assignee allows the reopen and reassigns the case', async () => {
      await page.getByRole('dialog').locator('button').filter({ hasText: /Select user/i }).click();
      await page.getByRole('option', { name: new RegExp(reopenAssigneeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }).click();
      await page.getByRole('dialog').getByRole('button', { name: /^Reopen$/i }).click();
      await caseDetailPage.expectStatus('Assigned');
      await caseDetailPage.expectAssignedTo(new RegExp(reopenAssigneeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    });
  });

  test('KR3 reopen shared closed case goes back to the shared pool path @p1', async ({ caseDetailPage }) => {
    const requesterUserId = decodeJwtSubject(token);
    expect(requesterUserId, 'Could not decode the current user id from the cached API auth token').toBeTruthy();

    const runId = Date.now();
    const sharedCt = await seedComplianceType(token, {
      type: `KR3-CT-${runId}`,
      frequency: 'Monthly',
      needsWorkAllocation: false,
      schedule: Array.from({ length: 12 }, (_, i) => ({
        period_index: i,
        creation_month_offset: 3,
        creation_day: 1,
        deadline_month_offset: 3,
        deadline_day: 20,
      })),
    });
    extraCtIds.push(sharedCt.complianceTypeId);

    const sharedClient = await seedClient(token, {
      name: `KR3-Client-${runId}`,
      pan: `KRTHR${String(runId).slice(-4)}A`,
      branchId,
      complianceTypeIds: [sharedCt.complianceTypeId],
    });
    createdClientIds.push(sharedClient.clientId);

    const sharedCase = await seedCase(token, {
      clientId: sharedClient.clientId,
      complianceTypeId: sharedCt.complianceTypeId,
    });

    expect((await apiFetch('PATCH', `/cases/${sharedCase.caseId}/status`, token, { status: 'In Progress' })).status).toBe(200);
    expect((await apiFetch('PATCH', `/cases/${sharedCase.caseId}/status`, token, { status: 'Closed' })).status).toBe(200);

    await caseDetailPage.navigate(sharedCase.caseId);
    await caseDetailPage.expectStatus('Closed');

    await test.step('Reopening a shared closed case returns it to the shared pool', async () => {
      await caseDetailPage.reopenOwnCase();
      await caseDetailPage.expectStatus('New');
    });

    await test.step('The reopened shared case must be unassigned after returning to the pool', async () => {
      const refreshed = await apiFetch<{ status: string; assignedTo: string | null }>(
        'GET',
        `/cases/${sharedCase.caseId}`,
        token,
      );
      expect(refreshed.status, 'The reopened shared case must remain readable').toBe(200);
      expect(refreshed.data.status, 'Shared reopen must reset the case to New').toBe('New');
      expect(refreshed.data.assignedTo, 'Shared reopen must clear the assignee and return the case to the pool').toBeNull();
    });
  });

});
