/**
 * GST Notices + Notice Tasks — end-to-end (API-level).
 *
 * Covers everything built in the notices redesign:
 *   - Phase A: GST Case ID surfaced; notice→case linking removed (no linkedCaseId).
 *   - Phase B: review_status acknowledge model (new | no_action | task_created),
 *              POST /notices/acknowledge, re-pull dedupe, reviewStatus filter +
 *              "specific status ⇒ no date window" (badge-matching default).
 *   - Phase C: Notice Task entity — create (single + bulk), detail, status transitions,
 *              reassign, notes, hours, documents, and the assignee's My To-Do.
 *   - Access: the whole feature is open to any authenticated user in an entitled firm.
 *
 * Notices are server-to-server data, so they're seeded through the scraper's internal
 * ingest endpoint (POST /internal/notices, x-nm-token). The suite SKIPS itself cleanly
 * when its prerequisites aren't configured:
 *   - NM_SERVICE_TOKEN env (to ingest notices)
 *   - the test firm is entitled to gst_notices
 * The "open access" test additionally needs TEST_DB_URL (to mint a no-permission user).
 *
 * Run: npx playwright test tests/notices/notices.spec.ts --project=chromium
 */
import { test, expect } from '@playwright/test';
import { apiFetch, getCachedApiAuth, seedClient, deleteClient } from '../../helpers/api-seed.helper';
import { waitForAuthRequestSlot } from '../../helpers/auth-rate-limit.helper';
import * as db from '../../helpers/test-db.helper';

const API_URL  = process.env.API_URL ?? 'https://devapi.auditglide.com';
const NM_TOKEN  = process.env.NM_SERVICE_TOKEN ?? '';
const TEST_DB_URL = process.env.TEST_DB_URL ?? '';

let token = '';
let branchId = '';
let adminUserId = '';
let otherUserId = '';
let clientId = '';
let skipReason = '';

// Unique-per-run GSTIN + case IDs so every notice is created fresh as `new`.
const STAMP = String(Date.now()).slice(-4);
const GSTIN = `27ABCDE${STAMP}F1Z5`;               // valid GST format
const caseIds = Array.from({ length: 5 }, (_, i) => `AGT${Date.now()}${i}`);
let createdTaskId = '';

function ddmmyyyy(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}
function userIdFromToken(jwt: string): string {
  try { return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8')).sub as string; }
  catch { return ''; }
}

/** Ingest notices via the scraper's internal endpoint (token-auth, not JWT). */
async function ingest(cases: Array<Record<string, unknown>>) {
  const res = await fetch(`${API_URL}/internal/notices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-nm-token': NM_TOKEN },
    body: JSON.stringify({ gstin: GSTIN, clientId, cases }),
  });
  const text = await res.text();
  let data: unknown; try { data = JSON.parse(text); } catch { data = text; }
  return { ok: res.ok, status: res.status, data: data as Record<string, unknown>, text };
}

interface NoticeItem {
  noticeId: string; gstCaseId: string; gstin: string; reviewStatus: string;
  isNew: boolean; noticeTaskId: string | null;
}
/** Our client's notices, optionally filtered by review status (status filter ⇒ no date window). */
async function listOurs(reviewStatus?: string): Promise<NoticeItem[]> {
  const qs = new URLSearchParams({ clientIds: clientId, pageSize: '100' });
  if (reviewStatus) qs.set('reviewStatus', reviewStatus);
  const r = await apiFetch<{ items: NoticeItem[] }>('GET', `/notices?${qs.toString()}`, token);
  expect(r.ok, `GET /notices → ${r.status}: ${r.text.slice(0, 200)}`).toBeTruthy();
  return r.data.items;
}
/** Every notice for our client across all time + statuses (explicit wide date window). */
async function countAllOurs(): Promise<number> {
  const qs = new URLSearchParams({ clientIds: clientId, pageSize: '100', dateFrom: '2017-01-01' });
  const r = await apiFetch<{ items: NoticeItem[] }>('GET', `/notices?${qs.toString()}`, token);
  expect(r.ok).toBeTruthy();
  return r.data.items.length;
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const auth = getCachedApiAuth();
  if (!auth) throw new Error('Missing cached API auth — run the Playwright setup project first.');
  ({ token, branchId } = auth);
  adminUserId = userIdFromToken(token);

  if (!NM_TOKEN) { skipReason = 'NM_SERVICE_TOKEN not set — cannot ingest GST notices.'; return; }

  // A client (in the admin's branch) with a GSTIN the ingest can match (needs ≥1 compliance type).
  const comps = await apiFetch<Array<{ complianceTypeId: string }>>('GET', '/compliance', token);
  const complianceTypeId = (Array.isArray(comps.data) ? comps.data : [])[0]?.complianceTypeId;
  if (!complianceTypeId) { skipReason = 'No compliance type available to attach the test client.'; return; }
  const c = await seedClient(token, { name: `Notices E2E ${STAMP}`, gstn: GSTIN, branchId, complianceTypeIds: [complianceTypeId] });
  clientId = c.clientId;

  // Seed 5 notices: [0] back-dated (window test), [1..4] issued today; [2] carries a due date.
  const today = ddmmyyyy(new Date());
  const ing = await ingest([
    { gstCaseId: caseIds[0], noticeDate: '01/01/2023', listType: 'Scrutiny Of Returns', listDescription: 'Old notice (outside the 7-day window)' },
    { gstCaseId: caseIds[1], noticeDate: today, listType: 'Determination Of Tax', listDescription: 'Notice to acknowledge' },
    { gstCaseId: caseIds[2], noticeDate: today, listType: 'Determination Of Tax', listDescription: 'Notice → task', latestDueDate: '15/12/2026' },
    { gstCaseId: caseIds[3], noticeDate: today, listType: 'Determination Of Tax', listDescription: 'Bulk task A' },
    { gstCaseId: caseIds[4], noticeDate: today, listType: 'Determination Of Tax', listDescription: 'Bulk task B' },
  ]);
  if (ing.data?.noticeManagementDisabled) { skipReason = 'Test firm is not entitled to gst_notices.'; return; }
  expect(ing.ok, `ingest → ${ing.status}: ${ing.text.slice(0, 200)}`).toBeTruthy();
  expect(ing.data.cases).toBe(5);

  // A second active user for the reassign test (falls back to admin if the firm has only one).
  const usersRes = await apiFetch<unknown>('GET', `/users?branchId=${branchId}&isactive=true`, token);
  const raw = usersRes.data as unknown;
  const users = (Array.isArray(raw) ? raw : ((raw as { users?: unknown[]; data?: unknown[] })?.users ?? (raw as { data?: unknown[] })?.data ?? [])) as Array<{ userId: string; isactive?: boolean }>;
  otherUserId = users.find((u) => u.userId !== adminUserId && u.isactive !== false)?.userId ?? adminUserId;
});

test.afterAll(async () => {
  if (clientId) await deleteClient(token, clientId).catch(() => {});
  if (NM_TOKEN && TEST_DB_URL) {
    try {
      await db.cleanupNoticesForGstin(GSTIN);
      await db.disconnectTestDb();
    } catch { /* DB cleanup best-effort */ }
  }
});

test.beforeEach(() => { test.skip(!!skipReason, skipReason); });

test.describe('GST Notices + Notice Tasks (E2E)', () => {

  test('N1 list surfaces GST Case ID and drops the removed linked-case field @smoke', async () => {
    const items = await listOurs('new');
    expect(items.length).toBe(5);
    for (const it of items) {
      expect(it.gstCaseId, 'every row exposes the GST Case ID').toBeTruthy();
      expect(it.reviewStatus).toBe('new');
      expect(it.isNew).toBe(true);
      expect(it, 'notice→case linking was removed').not.toHaveProperty('linkedCaseId');
    }
    expect(items.map((i) => i.gstCaseId).sort()).toEqual([...caseIds].sort());
  });

  test('N2 a status filter ignores the date window (matches the badge); the plain browse keeps last-7-days', async () => {
    const newItems = await listOurs('new');
    expect(newItems.some((i) => i.gstCaseId === caseIds[0]), 'back-dated notice IS in the "new" view (no date window)').toBe(true);

    const browse = await listOurs();   // no reviewStatus, no dates → legacy 7-day window
    expect(browse.some((i) => i.gstCaseId === caseIds[0]), 'back-dated notice is OUTSIDE the 7-day browse window').toBe(false);
    expect(browse.some((i) => i.gstCaseId === caseIds[1]), "today's notice is inside the window").toBe(true);
  });

  test('N3 acknowledge ("No action needed") clears the row from new + drops the badge count', async () => {
    const before = (await listOurs('new')).length;
    const countBefore = (await apiFetch<{ count: number }>('GET', '/notices/new-count', token)).data.count;

    const noticeId = (await listOurs('new')).find((i) => i.gstCaseId === caseIds[1])!.noticeId;
    const ack = await apiFetch<{ acknowledged: number }>('POST', '/notices/acknowledge', token, { noticeIds: [noticeId] });
    expect(ack.ok).toBeTruthy();
    expect(ack.data.acknowledged).toBeGreaterThanOrEqual(1);

    expect((await listOurs('new')).length).toBe(before - 1);
    expect((await listOurs('no_action')).some((i) => i.gstCaseId === caseIds[1])).toBe(true);

    const countAfter = (await apiFetch<{ count: number }>('GET', '/notices/new-count', token)).data.count;
    expect(countAfter).toBe(countBefore - 1);
  });

  test('N4 re-pulling the same notice never re-flags it as new and never duplicates it', async () => {
    const re = await ingest([{ gstCaseId: caseIds[1], noticeDate: ddmmyyyy(new Date()), listType: 'Determination Of Tax', listDescription: 'Re-pulled' }]);
    expect(re.ok).toBeTruthy();
    expect(await countAllOurs(), 'no duplicate row created').toBe(5);
    expect((await listOurs('no_action')).some((i) => i.gstCaseId === caseIds[1]), 'review state preserved on re-pull').toBe(true);
    expect((await listOurs('new')).some((i) => i.gstCaseId === caseIds[1])).toBe(false);
  });

  test('N5 "Create a task" raises a Notice Task and flips the notice to task_created', async () => {
    const noticeId = (await listOurs('new')).find((i) => i.gstCaseId === caseIds[2])!.noticeId;
    const res = await apiFetch<{ taskId: string }>('POST', '/notice-tasks', token, {
      noticeId, assignedto: adminUserId, note: 'Prepare the reply',
    });
    expect(res.ok, `POST /notice-tasks → ${res.status}: ${res.text.slice(0, 200)}`).toBeTruthy();
    createdTaskId = res.data.taskId;
    expect(createdTaskId).toBeTruthy();

    const taskRow = (await listOurs('task_created')).find((i) => i.gstCaseId === caseIds[2]);
    expect(taskRow, 'notice now shows under task_created').toBeTruthy();
    expect(taskRow!.noticeTaskId, 'notice links back to its task').toBe(createdTaskId);
  });

  test('N6 task detail carries the read-only notice, the initial note, and open-to-all capability flags', async () => {
    const r = await apiFetch<Record<string, any>>('GET', `/notice-tasks/${createdTaskId}`, token);
    expect(r.ok).toBeTruthy();
    const t = r.data;
    expect(t.status).toBe('assigned');
    expect(t.notice.gstCaseId).toBe(caseIds[2]);
    expect(t.dueDate, "due date defaulted to the notice's due").toContain('2026-12-15');
    expect(t.notes.map((n: { note: string }) => n.note)).toContain('Prepare the reply');
    expect(t.totalMinutes).toBe(0);
    expect(t.canManage).toBe(true);
    expect(t.canLogTime).toBe(true);
  });

  test('N7 status transitions are guarded; reopen is allowed', async () => {
    const setStatus = (status: string) => apiFetch<unknown>('PATCH', `/notice-tasks/${createdTaskId}/status`, token, { status });

    expect((await setStatus('closed')).status, 'assigned → closed must be rejected').toBe(400);
    expect((await setStatus('in_progress')).ok).toBeTruthy();
    expect((await setStatus('closed')).ok).toBeTruthy();
    expect((await setStatus('in_progress')).ok, 'reopen closed → in_progress allowed').toBeTruthy();

    const t = (await apiFetch<{ status: string }>('GET', `/notice-tasks/${createdTaskId}`, token)).data;
    expect(t.status).toBe('in_progress');
  });

  test('N8 notes can be added to the task thread', async () => {
    const before = (await apiFetch<{ notes: unknown[] }>('GET', `/notice-tasks/${createdTaskId}`, token)).data.notes.length;
    const r = await apiFetch<{ noteId: string }>('POST', `/notice-tasks/${createdTaskId}/notes`, token, { note: 'Followed up with the client' });
    expect(r.ok).toBeTruthy();
    const after = (await apiFetch<{ notes: unknown[] }>('GET', `/notice-tasks/${createdTaskId}`, token)).data.notes.length;
    expect(after).toBe(before + 1);
  });

  test('N9 hours can be logged and roll up into the task total', async () => {
    const r = await apiFetch<{ logId: string }>('POST', `/notice-tasks/${createdTaskId}/time-logs`, token, {
      logDate: new Date().toISOString().slice(0, 10), durationHours: 1, durationMinutes: 30, notes: 'Drafting',
    });
    expect(r.ok, `POST time-logs → ${r.status}: ${r.text.slice(0, 200)}`).toBeTruthy();
    const t = (await apiFetch<{ totalMinutes: number }>('GET', `/notice-tasks/${createdTaskId}`, token)).data;
    expect(t.totalMinutes).toBe(90);
  });

  test('N10 documents can be registered against the task and removed', async () => {
    const confirm = await apiFetch<{ documentId: string }>('POST', `/notice-tasks/${createdTaskId}/documents`, token, {
      s3Key: `notice-tasks/${createdTaskId}/e2e-${STAMP}.pdf`, filename: `e2e-${STAMP}.pdf`, displayName: 'E2E reply.pdf',
    });
    expect(confirm.ok, `confirm doc → ${confirm.status}: ${confirm.text.slice(0, 200)}`).toBeTruthy();
    const docId = confirm.data.documentId;

    const withDoc = (await apiFetch<{ documents: Array<{ documentId: string; displayName: string }> }>('GET', `/notice-tasks/${createdTaskId}`, token)).data;
    expect(withDoc.documents.some((d) => d.documentId === docId && d.displayName === 'E2E reply.pdf')).toBe(true);

    const del = await apiFetch<{ ok: boolean }>('DELETE', `/notice-tasks/${createdTaskId}/documents/${docId}`, token);
    expect(del.ok).toBeTruthy();
    const after = (await apiFetch<{ documents: unknown[] }>('GET', `/notice-tasks/${createdTaskId}`, token)).data;
    expect(after.documents.length).toBe(0);
  });

  test('N11 the task appears in the assignee\'s My To-Do', async () => {
    const r = await apiFetch<{ items: Array<{ taskId: string; status: string }> }>('GET', '/notice-tasks/todo', token);
    expect(r.ok).toBeTruthy();
    const mine = r.data.items.find((i) => i.taskId === createdTaskId);
    expect(mine, 'task assigned to me shows in My To-Do').toBeTruthy();
    expect(['assigned', 'in_progress']).toContain(mine!.status);
  });

  test('N12 a work-allocation user can reassign the task', async () => {
    test.skip(otherUserId === adminUserId, 'firm has only one active user — nothing to reassign to');
    const r = await apiFetch<{ assignedto: string }>('PATCH', `/notice-tasks/${createdTaskId}/assign`, token, { assignedto: otherUserId });
    expect(r.ok).toBeTruthy();
    const t = (await apiFetch<{ assignedTo: { userId: string } }>('GET', `/notice-tasks/${createdTaskId}`, token)).data;
    expect(t.assignedTo.userId).toBe(otherUserId);
  });

  test('N13 bulk "Create tasks" raises one task per selected notice', async () => {
    const ids = (await listOurs('new'))
      .filter((i) => [caseIds[3], caseIds[4]].includes(i.gstCaseId))
      .map((i) => i.noticeId);
    expect(ids.length).toBe(2);
    const r = await apiFetch<{ created: number }>('POST', '/notice-tasks/bulk', token, { noticeIds: ids, assignedto: adminUserId, note: 'Bulk' });
    expect(r.ok, `bulk → ${r.status}: ${r.text.slice(0, 200)}`).toBeTruthy();
    expect(r.data.created).toBe(2);

    const tc = await listOurs('task_created');
    expect(tc.some((i) => i.gstCaseId === caseIds[3])).toBe(true);
    expect(tc.some((i) => i.gstCaseId === caseIds[4])).toBe(true);
  });

  test('N14 GST Notices are open to every user in an entitled firm (no permission needed)', async () => {
    test.skip(!TEST_DB_URL, 'TEST_DB_URL not set — cannot mint a no-permission user.');
    const ctx = await db.getAdminTestContext(branchId);
    const email = `notices-e2e-${STAMP}@auditglide.test`;
    const password = 'NoPerm@12345';
    const temp = await db.createTemporaryUser({
      firmId: ctx.firmId, branchId, createdByUserId: ctx.adminUserId,
      email, password, name: 'Notices E2E No-Perm', access: {},   // all permissions false
    });
    try {
      await waitForAuthRequestSlot();
      const login = await apiFetch<{ accessToken: string }>('POST', '/auth/login', undefined, { emailid: email, password, useragent: 'playwright-notices-e2e' });
      expect(login.ok, `temp login → ${login.status}`).toBeTruthy();
      const tempToken = login.data.accessToken;

      // View: no client_read, yet the list works.
      const view = await apiFetch<{ items: NoticeItem[] }>('GET', `/notices?clientIds=${clientId}&reviewStatus=new`, tempToken);
      expect(view.status, 'no-permission user can VIEW notices').toBe(200);

      // Act: no work-allocation, yet acknowledge works.
      const target = view.data.items.find((i) => i.gstCaseId === caseIds[0]);
      if (target) {
        const ack = await apiFetch<{ acknowledged: number }>('POST', '/notices/acknowledge', tempToken, { noticeIds: [target.noticeId] });
        expect(ack.status, 'no-permission user can ACT (acknowledge)').toBe(200);
      }
    } finally {
      await db.deleteTemporaryUser(temp.userId).catch(() => {});
    }
  });
});
