/**
 * Compliance Assigned Clients — toggle, assign, unassign
 */
import { test, expect } from '../../fixtures/auth-fixture';
import {
  apiFetch, defaultSchedule, getCachedApiAuth, seedComplianceType, seedClient,
  assignClientToCompliance, deleteComplianceType, deleteClient,
  deactivateClient,
} from '../../helpers/api-seed.helper';

let token = '';
let branchId = '';
let ctId = '';
let baseCtId = '';
let activeClient = '';
let inactiveClient = '';
let activeClientName = '';
let inactiveClientName = '';
let extraClientName = '';
const extraClientIds: string[] = [];

test.beforeAll(async () => {
  const cachedAuth = getCachedApiAuth();
  if (!cachedAuth) {
    throw new Error('Missing cached API auth. Run the Playwright setup project before compliance-clients tests.');
  }
  ({ token, branchId } = cachedAuth);

  const baseCt = await seedComplianceType(token, { type: `QC-Base-CT-${Date.now()}`, frequency: 'Monthly' });
  const ct = await seedComplianceType(token, { type: `QC-CT-${Date.now()}`, frequency: 'Monthly' });
  baseCtId = baseCt.complianceTypeId;
  ctId = ct.complianceTypeId;

  const runId = Date.now();
  activeClientName = `QC-Active-Client-${runId}`;
  inactiveClientName = `QC-Inactive-Client-${runId}`;
  extraClientName = `QC-Extra-Unassign-${runId}`;

  const c1 = await seedClient(token, {
    name: activeClientName,
    pan: 'AAQCC1111Q',
    branchId,
    complianceTypeIds: [baseCtId],
  });
  const c2 = await seedClient(token, {
    name: inactiveClientName,
    pan: 'AAQCC2222Q',
    branchId,
    complianceTypeIds: [baseCtId],
  });
  activeClient   = c1.clientId;
  inactiveClient = c2.clientId;

  // Assign both to the CT, then deactivate c2
  await assignClientToCompliance(token, ctId, [activeClient, inactiveClient]);
  await deactivateClient(token, inactiveClient);
});

test.afterAll(async () => {
  await deleteComplianceType(token, ctId);
  await deleteComplianceType(token, baseCtId);
  await deleteClient(token, activeClient);
  await deleteClient(token, inactiveClient);
  for (const clientId of extraClientIds) {
    await deleteClient(token, clientId);
  }
});

test.describe('Compliance — Assigned Clients', () => {

  test('QC1 assigned clients list shows only active clients by default @smoke', async ({ complianceDetailPage }) => {
    await complianceDetailPage.navigate(ctId);

    await test.step('Active client must be visible', async () => {
      await complianceDetailPage.expectClientInList(activeClientName);
    });

    await test.step('Inactive client must NOT be visible by default', async () => {
      await complianceDetailPage.expectClientNotInList(inactiveClientName);
    });
  });

  test('QC2 Show Inactive toggle reveals inactive clients without full page refresh @smoke', async ({
    complianceDetailPage, page,
  }) => {
    await complianceDetailPage.navigate(ctId);

    const originalUrl = page.url();
    const mainFrameNavigations: string[] = [];
    page.on('framenavigated', frame => {
      if (frame === page.mainFrame()) {
        mainFrameNavigations.push(frame.url());
      }
    });

    await test.step('Toggle Show Inactive ON', async () => {
      await complianceDetailPage.toggleShowInactiveClients(true);
    });

    await test.step('Inactive client appears with badge', async () => {
      await complianceDetailPage.expectClientInList(inactiveClientName);
      await complianceDetailPage.expectInactiveBadgeForClient(inactiveClientName);
    });

    await test.step('No browser navigation occurred while toggling', async () => {
      expect(
        page.url(),
        'Toggle must keep the user on the same compliance detail URL',
      ).toBe(originalUrl);
      expect(
        mainFrameNavigations.length,
        `Toggle must NOT trigger a browser navigation. Navigations detected: ${mainFrameNavigations.join(', ')}`,
      ).toBe(0);
    });

    await test.step('Toggle back OFF — inactive client disappears', async () => {
      await complianceDetailPage.toggleShowInactiveClients(false);
      await complianceDetailPage.expectClientNotInList(inactiveClientName);
    });
  });

  test('QC3 unassign active client removes them from list', async ({ complianceDetailPage }) => {
    // Seed an extra client to unassign (don't touch the main clients)
    const extra = await seedClient(token, {
      name: extraClientName,
      pan: 'AAQCC3333Q',
      branchId,
      complianceTypeIds: [baseCtId],
    });
    extraClientIds.push(extra.clientId);
    await assignClientToCompliance(token, ctId, [extra.clientId]);

    await complianceDetailPage.navigate(ctId);

    await test.step('Unassign the extra client (keep cases)', async () => {
      await complianceDetailPage.unassignClients([extraClientName], false);
    });

    await test.step('Extra client no longer appears in list', async () => {
      await complianceDetailPage.expectClientNotInList(extraClientName);
    });

    await deleteClient(token, extra.clientId);
  });

  test('QC4 assign clients modal search filters by name, PAN, and GSTN @p1', async ({ complianceDetailPage }) => {
    const runId = Date.now();
    const nameOnly = await seedClient(token, {
      name: `QC4-Search-Name-${runId}`,
      pan: `QCNAM${String(runId).slice(-4)}A`,
      branchId,
      complianceTypeIds: [baseCtId],
    });
    const panOnly = await seedClient(token, {
      name: `QC4-Search-Pan-${runId}`,
      pan: `QCPAN${String(runId).slice(-4)}B`,
      branchId,
      complianceTypeIds: [baseCtId],
    });
    const gstnOnly = await seedClient(token, {
      name: `QC4-Search-Gstn-${runId}`,
      pan: `QCGST${String(runId).slice(-4)}C`,
      gstn: `27QCGST${String(runId).slice(-4)}C1Z5`,
      branchId,
      complianceTypeIds: [baseCtId],
    });
    extraClientIds.push(nameOnly.clientId, panOnly.clientId, gstnOnly.clientId);

    await complianceDetailPage.navigate(ctId);
    await complianceDetailPage.openAssignClientsModal();

    await test.step('Search by client name narrows the assign modal results', async () => {
      await complianceDetailPage.searchAssignClientsModal(`QC4-Search-Name-${runId}`);
      await complianceDetailPage.expectAssignModalClientVisible(`QC4-Search-Name-${runId}`);
      await complianceDetailPage.expectAssignModalClientHidden(`QC4-Search-Pan-${runId}`);
    });

    await test.step('Search by PAN narrows the assign modal results', async () => {
      await complianceDetailPage.searchAssignClientsModal(`QCPAN${String(runId).slice(-4)}B`);
      await complianceDetailPage.expectAssignModalClientVisible(`QC4-Search-Pan-${runId}`);
      await complianceDetailPage.expectAssignModalClientHidden(`QC4-Search-Gstn-${runId}`);
    });

    await test.step('Search by GSTN narrows the assign modal results', async () => {
      await complianceDetailPage.searchAssignClientsModal(`27QCGST${String(runId).slice(-4)}C1Z5`);
      await complianceDetailPage.expectAssignModalClientVisible(`QC4-Search-Gstn-${runId}`);
      await complianceDetailPage.expectAssignModalClientHidden(`QC4-Search-Name-${runId}`);
    });
  });

  test('QC5 parent CT with active subtypes returns no schedule impact @p1', async () => {
    const runId = Date.now();
    const parentCt = await seedComplianceType(token, {
      type: `QC5-Parent-${runId}`,
      frequency: 'Monthly',
      schedule: defaultSchedule('Monthly'),
    });
    const client = await seedClient(token, {
      name: `QC5-Client-${runId}`,
      pan: `QCIVE${String(runId).slice(-4)}A`,
      branchId,
      complianceTypeIds: [parentCt.complianceTypeId],
    });

    try {
      const subtypeCreate = await apiFetch(
        'POST',
        `/compliance/${parentCt.complianceTypeId}/subtypes`,
        token,
        {
          name: `QC5-Subtype-${runId}`,
          schedule: defaultSchedule('Monthly'),
          needsWorkAllocation: true,
        },
      );
      expect(subtypeCreate.status, 'The QC5 subtype fixture must be creatable before schedule analysis').toBe(201);

      const analysis = await apiFetch<{
        hasImpact: boolean;
        noImpactReason?: string;
        clientCount: number;
        scenario1: unknown[];
        scenario2: unknown[];
      }>(
        'POST',
        `/compliance/${parentCt.complianceTypeId}/schedule/analyze`,
        token,
        {
          schedule: defaultSchedule('Monthly').map((entry) => ({
            ...entry,
            creation_month_offset: 0,
            creation_day: 1,
          })),
        },
      );

      expect(analysis.status, 'Parent schedule analysis must succeed even when active subtypes exist').toBe(200);
      expect(analysis.data.hasImpact, 'Parent CT schedules should report no impact when active subtypes exist').toBe(false);
      expect(analysis.data.noImpactReason, 'The API should explain that the parent schedule is ignored once active subtypes exist').toBe('parent_has_subtypes');
      expect(analysis.data.scenario1.length, 'No Scenario 1 periods should be reported for a parent with active subtypes').toBe(0);
      expect(analysis.data.scenario2.length, 'No Scenario 2 periods should be reported for a parent with active subtypes').toBe(0);
    } finally {
      await deleteClient(token, client.clientId);
      await deleteComplianceType(token, parentCt.complianceTypeId);
    }
  });

});
