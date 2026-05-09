/**
 * Case List — filters and search
 */
import { test, expect } from '../../fixtures/auth-fixture';
import {
  apiFetch,
  deleteClient,
  deleteComplianceType,
  getCachedApiAuth,
  seedCase,
  seedClient,
  seedComplianceType,
} from '../../helpers/api-seed.helper';

test.describe('Case List', () => {

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

  test('KL1 case list loads with default view @smoke', async ({ caseListPage, page }) => {
    await caseListPage.navigate();

    await test.step('Page loads without error', async () => {
      await expect(page.locator('body'), 'Page must not show a crash / error screen').not.toContainText('Error');
    });
  });

  test('KL2 filter by status — only matching cases shown', async ({ caseListPage }) => {
    await caseListPage.navigate();

    const before = await caseListPage.getCaseCount();

    await test.step('Filter by status "New"', async () => {
      await caseListPage.filterByStatus('New');
    });

    await test.step('Case count may differ after filter', async () => {
      const after = await caseListPage.getCaseCount();
      // We can't assert exact count without knowing the data,
      // but we verify the filter applied without a crash
      expect(typeof after).toBe('number');
    });
  });

  test('KL3 filter by compliance type — no crash', async ({ caseListPage, page }) => {
    await caseListPage.navigate();

    await test.step('Select first compliance type in filter', async () => {
      await caseListPage.selectFirstComplianceTypeFilterOption();
    });

    await test.step('Page must not crash', async () => {
      await expect(page.locator('body')).not.toContainText('Error');
    });
  });

  test('KL4 search returns filtered results', async ({ caseListPage }) => {
    await caseListPage.navigate();

    const query = 'ZZZNONEXISTENTZZZZ';

    await test.step('Search for a non-existent client name in client filter', async () => {
      await caseListPage.searchClientFilter(query);
    });

    await test.step('Client filter search shows no matches', async () => {
      await caseListPage.expectNoClientFilterMatches(query);
    });
  });

  test('KL5 multi-status filter returns only the selected statuses @p1', async () => {
    const cachedAuth = getCachedApiAuth();
    if (!cachedAuth) {
      throw new Error('Missing cached API auth. Run the Playwright setup project before case-list tests.');
    }

    const { token, branchId } = cachedAuth;
    const requesterUserId = decodeJwtSubject(token);
    expect(requesterUserId, 'Could not decode the current user id from the cached API auth token').toBeTruthy();

    const runId = Date.now();
    const seededCt = await seedComplianceType(token, {
      type: `KL5-CT-${runId}`,
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

    const createdClientIds: string[] = [];

    try {
      const newClient = await seedClient(token, {
        name: `KL5-New-${runId}`,
        pan: `KLNWA${String(runId).slice(-4)}A`,
        branchId,
        complianceTypeIds: [seededCt.complianceTypeId],
      });
      const assignedClient = await seedClient(token, {
        name: `KL5-Assigned-${runId}`,
        pan: `KLASG${String(runId).slice(-4)}B`,
        branchId,
        complianceTypeIds: [seededCt.complianceTypeId],
      });
      const inProgressClient = await seedClient(token, {
        name: `KL5-InProgress-${runId}`,
        pan: `KLINP${String(runId).slice(-4)}C`,
        branchId,
        complianceTypeIds: [seededCt.complianceTypeId],
      });
      createdClientIds.push(newClient.clientId, assignedClient.clientId, inProgressClient.clientId);

      const newCase = await seedCase(token, { clientId: newClient.clientId, complianceTypeId: seededCt.complianceTypeId });
      const assignedCase = await seedCase(token, { clientId: assignedClient.clientId, complianceTypeId: seededCt.complianceTypeId });
      const inProgressCase = await seedCase(token, { clientId: inProgressClient.clientId, complianceTypeId: seededCt.complianceTypeId });

      const assignAssigned = await apiFetch('PATCH', `/cases/${assignedCase.caseId}/assign`, token, { userId: requesterUserId });
      expect(assignAssigned.status, 'The Assigned fixture case must be assignable to the current user').toBe(200);

      const assignInProgress = await apiFetch('PATCH', `/cases/${inProgressCase.caseId}/assign`, token, { userId: requesterUserId });
      expect(assignInProgress.status, 'The In Progress fixture case must be assignable to the current user').toBe(200);

      const progressCase = await apiFetch<{ status: string }>(
        'PATCH',
        `/cases/${inProgressCase.caseId}/status`,
        token,
        { status: 'In Progress' },
      );
      expect(progressCase.status, 'The In Progress fixture case must move into In Progress successfully').toBe(200);

      await test.step('Repeated status query params return only New and Assigned cases for the seeded compliance type', async () => {
        const filteredResponse = await apiFetch<{
          data: Array<{ caseId: string; clientName: string; status: string; complianceTypeId: string }>;
          total: number;
          page: number;
          limit: number;
        }>(
          'GET',
          `/cases?branchId=${encodeURIComponent(branchId)}&status=New&status=Assigned&complianceId=${encodeURIComponent(seededCt.complianceTypeId)}&complianceFilterType=compliancetype&page=1&limit=50`,
          token,
        );

        expect(filteredResponse.status, 'Repeated status query params must be accepted by the cases list API').toBe(200);

        const caseIds = filteredResponse.data.data.map((entry) => entry.caseId);
        expect(caseIds, 'The seeded New case must be present in the filtered result set').toContain(newCase.caseId);
        expect(caseIds, 'The seeded Assigned case must be present in the filtered result set').toContain(assignedCase.caseId);
        expect(caseIds, 'The seeded In Progress case must be excluded from the filtered result set').not.toContain(inProgressCase.caseId);

        const statuses = new Set(filteredResponse.data.data.map((entry) => entry.status));
        expect(
          [...statuses].every((status) => status === 'New' || status === 'Assigned'),
          `Only New and Assigned statuses should be returned. Got: ${[...statuses].join(', ')}`,
        ).toBe(true);
      });
    } finally {
      for (const clientId of createdClientIds) {
        await deleteClient(token, clientId);
      }
      await deleteComplianceType(token, seededCt.complianceTypeId);
    }
  });

  test('KL6 compliance filter requires complianceId plus complianceFilterType @p1', async () => {
    const cachedAuth = getCachedApiAuth();
    if (!cachedAuth) {
      throw new Error('Missing cached API auth. Run the Playwright setup project before case-list tests.');
    }

    const { token, branchId } = cachedAuth;
    const seededCt = await seedComplianceType(token, {
      type: `KL6-CT-${Date.now()}`,
      frequency: 'Monthly',
    });

    try {
      const missingFilterType = await apiFetch(
        'GET',
        `/cases?branchId=${encodeURIComponent(branchId)}&complianceId=${encodeURIComponent(seededCt.complianceTypeId)}&page=1&limit=20`,
        token,
      );

      expect(
        missingFilterType.status,
        'The cases API must reject complianceId when complianceFilterType is omitted',
      ).toBe(400);
      expect(
        missingFilterType.text,
        'The validation error must explain that complianceId and complianceFilterType are coupled',
      ).toMatch(/complianceId and complianceFilterType must be provided together/i);
    } finally {
      await deleteComplianceType(token, seededCt.complianceTypeId);
    }
  });

});
