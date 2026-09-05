/**
 * GST Notices — staff-app workflow, scraper-independent (E2E).
 *
 * Unlike notices.spec.ts (which ingests through the auditglidenm endpoint), this suite
 * STUBS notices straight into the DB, so it needs neither the scraper nor NM_SERVICE_TOKEN.
 * It assumes "all kinds of notices are available" (varied types, due dates, periods, a
 * back-dated one, one with a document) and then drives the full staff-app flow against
 * the real API: list/filter, view, acknowledge, no-action, create task, assign/reassign,
 * notes, hours, documents, the task lifecycle, and closing/reopening tasks.
 *
 * Prerequisites (suite self-skips cleanly otherwise):
 *   - TEST_DB_URL   — to stub notices + mint users (no scraper involved).
 *   - the test firm is entitled to gst_notices.
 *   - both notice migrations applied to the target DB (review_status + notice_task*).
 *
 * Run: npx playwright test tests/notices/notices-staff.spec.ts --project=chromium
 */
import { test, expect } from '@playwright/test';
import { apiFetch, getCachedApiAuth, seedClient, deleteClient } from '../../helpers/api-seed.helper';
import * as db from '../../helpers/test-db.helper';

const TEST_DB_URL = process.env.TEST_DB_URL ?? '';

let token = '';
let branchId = '';
let firmId = '';
let adminUserId = '';
let otherUserId = '';
let clientId = '';
let skipReason = '';

const STAMP = String(Date.now()).slice(-4);
const GSTIN = `29ZSTUB${STAMP}F1Z7`;   // valid GST format, unique per run

function userIdFromToken(jwt: string): string {
  try { return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8')).sub as string; }
  catch { return ''; }
}
function daysAgo(n: number): Date { return new Date(Date.now() - n * 86_400_000); }
function daysAhead(n: number): Date { return new Date(Date.now() + n * 86_400_000); }
const today = () => new Date().toISOString().slice(0, 10);

// "All kinds of notices" — the staff would see a mix like this on the screen.
interface Kind { key: string; listType: string; listDescription: string; noticeDate: Date | null; due: Date | null; taxPeriods: string | null; status: string | null; withDocument?: boolean }
const KINDS: Kind[] = [
  { key: 'scrutiny',      listType: 'Scrutiny Of Returns', listDescription: 'ASMT-10 — discrepancy in returns', noticeDate: daysAgo(2),  due: daysAhead(30), taxPeriods: 'Apr 2025 - Jun 2025', status: 'Pending' },
  { key: 'determination', listType: 'Determination Of Tax', listDescription: 'DRC-01 — show cause notice',       noticeDate: daysAgo(5),  due: daysAhead(15), taxPeriods: 'FY 2023-24',          status: 'Pending' },
  { key: 'recovery',      listType: 'Recovery',             listDescription: 'DRC-13 — recovery from third party', noticeDate: daysAgo(1),  due: null,          taxPeriods: null,                  status: 'Open' },
  { key: 'nodue',         listType: 'General',              listDescription: 'Intimation with no due date',        noticeDate: daysAgo(3),  due: null,          taxPeriods: null,                  status: null },
  { key: 'old',           listType: 'Audit',                listDescription: 'Back-dated notice (outside window)',  noticeDate: daysAgo(800), due: null,         taxPeriods: 'FY 2021-22',          status: 'Closed' },
  { key: 'withdoc',       listType: 'Scrutiny Of Returns', listDescription: 'Notice that carries a document',      noticeDate: daysAgo(4),  due: daysAhead(20), taxPeriods: 'Jul 2025 - Sep 2025', status: 'Pending', withDocument: true },
  { key: 'extra1',        listType: 'Determination Of Tax', listDescription: 'Bulk task candidate A',              noticeDate: daysAgo(6),  due: daysAhead(10), taxPeriods: 'FY 2023-24',          status: 'Pending' },
  { key: 'extra2',        listType: 'Determination Of Tax', listDescription: 'Bulk task candidate B',              noticeDate: daysAgo(6),  due: daysAhead(10), taxPeriods: 'FY 2023-24',          status: 'Pending' },
];
const noticeIdByKey: Record<string, string> = {};   // kind.key → noticecaseid
let singleTaskId = '';

interface NoticeItem { noticeId: string; gstCaseId: string; gstin: string; reviewStatus: string; isNew: boolean; type: string | null; dueDate: string | null; noticeTaskId: string | null }

async function listOurs(reviewStatus?: string): Promise<NoticeItem[]> {
  const qs = new URLSearchParams({ clientIds: clientId, pageSize: '100' });
  if (reviewStatus) qs.set('reviewStatus', reviewStatus);
  const r = await apiFetch<{ items: NoticeItem[] }>('GET', `/notices?${qs.toString()}`, token);
  expect(r.ok, `GET /notices → ${r.status}: ${r.text.slice(0, 200)}`).toBeTruthy();
  return r.data.items;
}
const idFor = (key: string) => noticeIdByKey[key];
async function getTask(taskId: string) {
  const r = await apiFetch<Record<string, any>>('GET', `/notice-tasks/${taskId}`, token);
  expect(r.ok, `GET /notice-tasks/${taskId} → ${r.status}: ${r.text.slice(0, 200)}`).toBeTruthy();
  return r.data;
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const auth = getCachedApiAuth();
  if (!auth) throw new Error('Missing cached API auth — run the Playwright setup project first.');
  ({ token, branchId } = auth);
  adminUserId = userIdFromToken(token);

  if (!TEST_DB_URL) { skipReason = 'TEST_DB_URL not set — this suite stubs notices directly into the DB.'; return; }

  const ctx = await db.getAdminTestContext(branchId);
  firmId = ctx.firmId;

  // Entitlement gate (same as the real screen): bail early + clearly if the firm isn't entitled.
  const probe = await apiFetch('GET', '/notices?pageSize=1', token);
  if (probe.status === 403) { skipReason = 'Test firm is not entitled to gst_notices.'; return; }

  // A client in the admin's branch (client-create needs ≥1 compliance type — reuse an existing one),
  // then stub every "kind" of notice against it.
  const comps = await apiFetch<Array<{ complianceTypeId: string }>>('GET', '/compliance', token);
  const complianceTypeId = (Array.isArray(comps.data) ? comps.data : [])[0]?.complianceTypeId;
  if (!complianceTypeId) { skipReason = 'No compliance type available to attach the test client.'; return; }
  const c = await seedClient(token, { name: `Notices Staff E2E ${STAMP}`, gstn: GSTIN, branchId, complianceTypeIds: [complianceTypeId] });
  clientId = c.clientId;

  for (let i = 0; i < KINDS.length; i++) {
    const k = KINDS[i];
    const { noticeCaseId } = await db.seedNoticeCase({
      firmId, clientId, gstin: GSTIN, gstCaseId: `STUB${STAMP}${i}`,
      reviewStatus: 'new', noticeDate: k.noticeDate, latestDueDate: k.due,
      taxPeriods: k.taxPeriods, status: k.status, listType: k.listType,
      listDescription: k.listDescription, withDocument: k.withDocument,
    });
    noticeIdByKey[k.key] = noticeCaseId;
  }

  const usersRes = await apiFetch<unknown>('GET', `/users?branchId=${branchId}&isactive=true`, token);
  const raw = usersRes.data as unknown;
  const users = (Array.isArray(raw) ? raw : ((raw as { users?: unknown[]; data?: unknown[] })?.users ?? (raw as { data?: unknown[] })?.data ?? [])) as Array<{ userId: string; isactive?: boolean }>;
  otherUserId = users.find((u) => u.userId !== adminUserId && u.isactive !== false)?.userId ?? adminUserId;
});

test.afterAll(async () => {
  if (clientId) await deleteClient(token, clientId).catch(() => {});
  if (TEST_DB_URL) {
    try { await db.cleanupNoticesForGstin(GSTIN); await db.disconnectTestDb(); } catch { /* best-effort */ }
  }
});

test.beforeEach(() => { test.skip(!!skipReason, skipReason); });

test.describe('GST Notices — staff app (stubbed data)', () => {

  test('S1 all kinds of notices show on the screen with their GST Case ID; back-dated one only in the status view @smoke', async () => {
    const news = await listOurs('new');
    expect(news.length).toBe(KINDS.length);
    for (const it of news) {
      expect(it.gstCaseId).toBeTruthy();
      expect(it.isNew).toBe(true);
      expect(it).not.toHaveProperty('linkedCaseId');
    }
    const types = new Set(news.map((i) => i.type));
    expect(types).toContain('Scrutiny Of Returns');
    expect(types).toContain('Determination Of Tax');
    expect(types).toContain('Recovery');

    // Default 7-day browse hides the back-dated notice; the "new" view (no date window) shows it.
    const browse = await listOurs();
    expect(browse.some((i) => i.noticeId === idFor('old'))).toBe(false);
    expect(news.some((i) => i.noticeId === idFor('old'))).toBe(true);
  });

  test('S2 a notice opens its detail (documents listed; due may be empty)', async () => {
    const withDoc = await apiFetch<{ documents: unknown[]; attachments: unknown[]; gstCaseId: string }>('GET', `/notices/${idFor('withdoc')}`, token);
    expect(withDoc.ok).toBeTruthy();
    expect(withDoc.data.documents.length).toBeGreaterThanOrEqual(1);

    const noDue = await apiFetch<{ dueDate: string | null }>('GET', `/notices/${idFor('nodue')}`, token);
    expect(noDue.ok).toBeTruthy();
    expect(noDue.data.dueDate).toBeNull();
  });

  test('S3 "No action needed" on a single notice clears it from the badge', async () => {
    const beforeNew = (await listOurs('new')).length;
    const ack = await apiFetch<{ acknowledged: number }>('POST', '/notices/acknowledge', token, { noticeIds: [idFor('recovery')] });
    expect(ack.ok).toBeTruthy();
    expect(ack.data.acknowledged).toBeGreaterThanOrEqual(1);
    expect((await listOurs('new')).length).toBe(beforeNew - 1);
    expect((await listOurs('no_action')).some((i) => i.noticeId === idFor('recovery'))).toBe(true);
  });

  test('S4 bulk "No action needed" actions several notices at once', async () => {
    const ids = [idFor('determination'), idFor('old')];
    const r = await apiFetch<{ acknowledged: number }>('POST', '/notices/acknowledge', token, { noticeIds: ids });
    expect(r.ok).toBeTruthy();
    expect(r.data.acknowledged).toBe(2);
    const noAction = (await listOurs('no_action')).map((i) => i.noticeId);
    expect(noAction).toEqual(expect.arrayContaining(ids));
  });

  test('S5 "Create a task" from a notice (due defaults to the notice due) flips it to task_created', async () => {
    const r = await apiFetch<{ taskId: string }>('POST', '/notice-tasks', token, {
      noticeId: idFor('scrutiny'), assignedto: adminUserId, note: 'Review the ASMT-10 and draft a reply',
    });
    expect(r.ok, `POST /notice-tasks → ${r.status}: ${r.text.slice(0, 200)}`).toBeTruthy();
    singleTaskId = r.data.taskId;

    const row = (await listOurs('task_created')).find((i) => i.noticeId === idFor('scrutiny'));
    expect(row, 'notice now under task_created').toBeTruthy();
    expect(row!.noticeTaskId).toBe(singleTaskId);

    const t = await getTask(singleTaskId);
    expect(t.status).toBe('assigned');
    expect(t.notice.gstCaseId).toBe(`STUB${STAMP}0`);
    expect(t.dueDate, "due defaulted to the notice's due date").not.toBeNull();
    expect(t.notes.map((n: { note: string }) => n.note)).toContain('Review the ASMT-10 and draft a reply');
    expect(t.canManage).toBe(true);
    expect(t.canLogTime).toBe(true);
  });

  test('S6 a task created from a notice with no due date has no due (no fallback supplied)', async () => {
    const r = await apiFetch<{ taskId: string }>('POST', '/notice-tasks', token, { noticeId: idFor('nodue'), assignedto: adminUserId });
    expect(r.ok).toBeTruthy();
    const t = await getTask(r.data.taskId);
    expect(t.dueDate).toBeNull();
  });

  test('S7 bulk "Create tasks" raises one task per selected notice', async () => {
    const ids = [idFor('extra1'), idFor('extra2')];
    const r = await apiFetch<{ created: number }>('POST', '/notice-tasks/bulk', token, { noticeIds: ids, assignedto: adminUserId, note: 'Bulk-raised' });
    expect(r.ok).toBeTruthy();
    expect(r.data.created).toBe(2);
    const tc = (await listOurs('task_created')).map((i) => i.noticeId);
    expect(tc).toEqual(expect.arrayContaining(ids));
  });

  test('S8 a work-allocation user can reassign a task', async () => {
    test.skip(otherUserId === adminUserId, 'firm has only one active user — nothing to reassign to');
    const r = await apiFetch<{ assignedto: string }>('PATCH', `/notice-tasks/${singleTaskId}/assign`, token, { assignedto: otherUserId });
    expect(r.ok).toBeTruthy();
    expect((await getTask(singleTaskId)).assignedTo.userId).toBe(otherUserId);

    // hand it back so the rest of the lifecycle runs as the assignee
    await apiFetch('PATCH', `/notice-tasks/${singleTaskId}/assign`, token, { assignedto: adminUserId });
    expect((await getTask(singleTaskId)).assignedTo.userId).toBe(adminUserId);
  });

  test('S9 the assignee works the task: WIP → notes → hours → document', async () => {
    // illegal skip is rejected
    expect((await apiFetch('PATCH', `/notice-tasks/${singleTaskId}/status`, token, { status: 'closed' })).status, 'assigned → closed is rejected').toBe(400);

    expect((await apiFetch('PATCH', `/notice-tasks/${singleTaskId}/status`, token, { status: 'in_progress' })).ok).toBeTruthy();

    expect((await apiFetch('POST', `/notice-tasks/${singleTaskId}/notes`, token, { note: 'Reply drafted, pending partner review' })).ok).toBeTruthy();

    expect((await apiFetch('POST', `/notice-tasks/${singleTaskId}/time-logs`, token, { logDate: today(), durationHours: 2, durationMinutes: 15, notes: 'Drafting reply' })).ok).toBeTruthy();

    const confirm = await apiFetch<{ documentId: string }>('POST', `/notice-tasks/${singleTaskId}/documents`, token, {
      s3Key: `notice-tasks/${singleTaskId}/reply-${STAMP}.pdf`, filename: `reply-${STAMP}.pdf`, displayName: 'Reply to ASMT-10.pdf',
    });
    expect(confirm.ok).toBeTruthy();

    const t = await getTask(singleTaskId);
    expect(t.status).toBe('in_progress');
    expect(t.totalMinutes).toBe(135);
    expect(t.notes.length).toBeGreaterThanOrEqual(2);
    expect(t.documents.some((d: { displayName: string }) => d.displayName === 'Reply to ASMT-10.pdf')).toBe(true);
  });

  test('S10 an open task shows in My To-Do; closing it removes it; reopening brings it back', async () => {
    const inTodo = async () => (await apiFetch<{ items: Array<{ taskId: string }> }>('GET', '/notice-tasks/todo', token)).data.items.some((i) => i.taskId === singleTaskId);
    expect(await inTodo(), 'in-progress task is in My To-Do').toBe(true);

    // close it
    const close = await apiFetch<{ status: string }>('PATCH', `/notice-tasks/${singleTaskId}/status`, token, { status: 'closed' });
    expect(close.ok).toBeTruthy();
    const closed = await getTask(singleTaskId);
    expect(closed.status).toBe('closed');
    expect(closed.closedAt, 'closed_at is stamped').not.toBeNull();
    expect(await inTodo(), 'closed task leaves My To-Do').toBe(false);

    // reopen
    expect((await apiFetch('PATCH', `/notice-tasks/${singleTaskId}/status`, token, { status: 'in_progress' })).ok).toBeTruthy();
    const reopened = await getTask(singleTaskId);
    expect(reopened.status).toBe('in_progress');
    expect(reopened.closedAt, 'closed_at cleared on reopen').toBeNull();
    expect(await inTodo(), 'reopened task is back in My To-Do').toBe(true);
  });

  test('S11 every kind of notice is actionable — acknowledge the remaining new ones in bulk', async () => {
    const remaining = (await listOurs('new')).map((i) => i.noticeId);
    if (remaining.length === 0) return;   // nothing left to action
    const r = await apiFetch<{ acknowledged: number }>('POST', '/notices/acknowledge', token, { noticeIds: remaining });
    expect(r.ok).toBeTruthy();
    expect(r.data.acknowledged).toBe(remaining.length);
    expect((await listOurs('new')).length, 'no notices left unreviewed').toBe(0);
  });
});
