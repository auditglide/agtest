/**
 * AI Avatar Phase 2 — Endpoint Tests (Category 3).
 *
 * Tests the full POST /ai/interpret pipeline for navigate-with-filters:
 *   real question → LLM → navigate response with correct route + params.
 *
 * Hits the live dev server + real LLM. No browser.
 *
 * Run: npx playwright test tests/ai/phase2.spec.ts
 */

import { test, expect } from '@playwright/test';
import { apiFetch, getCachedApiAuth } from '../../helpers/api-seed.helper';

let token    = '';
let branchId = '';
const PAGE_CTX = '/dashboard';

interface AIResponse {
  type:    string;
  route?:  string;
  params?: string;
  message?: string;
  subject?: string;
}

test.beforeAll(() => {
  const auth = getCachedApiAuth();
  if (!auth) throw new Error('Missing cached API auth — run setup first');
  ({ token, branchId } = auth);
});

async function interpret(query: string): Promise<AIResponse> {
  await new Promise(r => setTimeout(r, 800));   // avoid AI rate limiter
  const res = await apiFetch<AIResponse>(
    'POST', '/ai/interpret', token,
    { query, currentPage: PAGE_CTX, activeBranchId: branchId },
  );
  if (!res.ok) throw new Error(`/ai/interpret failed ${res.status}: ${res.text.slice(0, 200)}`);
  return res.data;
}

/** Parse the params string into a URLSearchParams for assertions. */
function qp(resp: AIResponse): URLSearchParams {
  return new URLSearchParams(resp.params ?? '');
}

// ─── Gap 1: Deadline filters ──────────────────────────────────────────────────

test('AI-P2-01 "Show me cases due this week" → /cases with deadline range', async () => {
  const resp = await interpret('Show me cases due this week');
  expect(resp.type).toBe('navigate');
  expect(resp.route).toBe('/cases');
  const p = qp(resp);
  expect(p.get('deadlineFrom')).toBeTruthy();
  expect(p.get('deadlineTo')).toBeTruthy();
  expect(p.get('createdFrom')).toBeNull();
});

test('AI-P2-02 "Which cases are due tomorrow?" → /cases with deadline filter', async () => {
  const resp = await interpret('Which cases are due tomorrow?');
  expect(resp.type).toBe('navigate');
  expect(resp.route).toBe('/cases');
  expect(qp(resp).get('deadlineFrom')).toBeTruthy();
});

test('AI-P2-03 "Cases created this month" → /cases with created range (not deadline)', async () => {
  const resp = await interpret('Show me cases created this month');
  expect(resp.type).toBe('navigate');
  expect(resp.route).toBe('/cases');
  const p = qp(resp);
  expect(p.get('createdFrom')).toBeTruthy();
  expect(p.get('deadlineFrom')).toBeNull();
});

// ─── Gap 2a: Unassigned ───────────────────────────────────────────────────────

test('AI-P2-04 "Show me cases with no assignee" → /cases?unassigned=true', async () => {
  const resp = await interpret('Show me cases with no assignee');
  expect(resp.type).toBe('navigate');
  expect(resp.route).toBe('/cases');
  expect(qp(resp).get('unassigned')).toBe('true');
});

test('AI-P2-05 "Which cases are unassigned?" → /cases?unassigned=true', async () => {
  const resp = await interpret('Which cases are unassigned?');
  expect(resp.type).toBe('navigate');
  expect(qp(resp).get('unassigned')).toBe('true');
});

// ─── Gap 2b: Inactive clients ─────────────────────────────────────────────────

test('AI-P2-06 "Show me inactive clients" → /clients?inactive=true', async () => {
  const resp = await interpret('Show me inactive clients');
  expect(resp.type).toBe('navigate');
  expect(resp.route).toBe('/clients');
  expect(qp(resp).get('inactive')).toBe('true');
});

test('AI-P2-07 "Which clients have we marked inactive?" → /clients?inactive=true', async () => {
  const resp = await interpret('Which clients have we marked as inactive?');
  expect(resp.type).toBe('navigate');
  expect(qp(resp).get('inactive')).toBe('true');
});

// ─── Gap 2c: Fee-only visits ──────────────────────────────────────────────────

test('AI-P2-08 "Show me only paid consultations" → /visitor-log?hasPayment=1', async () => {
  const resp = await interpret('Show me only paid consultations');
  expect(resp.type).toBe('navigate');
  expect(resp.route).toBe('/visitor-log');
  expect(qp(resp).get('hasPayment')).toBe('1');
});

test('AI-P2-09 "Which visits generated revenue?" → navigate (hasPayment) or consultation_fees aggregate', async () => {
  const resp = await interpret('Which visits generated revenue?');
  // Valid as a LIST (navigate hasPayment), a TOTAL (aggregate consultation_fees),
  // or unknown — the phrase is inherently ambiguous.
  expect(['navigate', 'aggregate', 'unknown']).toContain(resp.type);
  if (resp.type === 'navigate') {
    expect(resp.route).toBe('/visitor-log');
    expect(qp(resp).get('hasPayment')).toBe('1');
  } else if (resp.type === 'aggregate') {
    expect(resp.subject).toBe('consultation_fees');
  }
});

// ─── Gap 2d+3: Payment tabs ───────────────────────────────────────────────────

test('AI-P2-10 "Show me written off cases" → /payments?tab=writtenOff', async () => {
  const resp = await interpret('Show me written off cases');
  expect(resp.type).toBe('navigate');
  expect(resp.route).toBe('/payments');
  expect(qp(resp).get('tab')).toBe('writtenOff');
});

test('AI-P2-11 "Break payments down by client" → /payments?tab=byClient', async () => {
  const resp = await interpret('Break payments down by client');
  expect(resp.type).toBe('navigate');
  expect(resp.route).toBe('/payments');
  expect(qp(resp).get('tab')).toBe('byClient');
});

// ─── Gap 5: Work allocation tabs ──────────────────────────────────────────────

test('AI-P2-12 "Show me the allocation history" → /work-allocation?tab=history', async () => {
  const resp = await interpret('Show me the allocation history');
  expect(resp.type).toBe('navigate');
  expect(resp.route).toBe('/work-allocation');
  expect(qp(resp).get('tab')).toBe('history');
});

test('AI-P2-13 "I want to set up auto delegation rules" → /work-allocation?tab=auto', async () => {
  const resp = await interpret('I want to set up auto delegation rules');
  expect(resp.type).toBe('navigate');
  expect(resp.route).toBe('/work-allocation');
  expect(qp(resp).get('tab')).toBe('auto');
});

// ─── Gap 4: Closed by (already works) ─────────────────────────────────────────

test('AI-P2-14 "Everything Rajesh Sharma closed last month" → /closed-cases with assignedto + dates', async () => {
  const resp = await interpret('Show me everything Rajesh Sharma closed last month');
  // navigate (resolved) | disambiguation (multiple Rajesh) | unknown (resolution failed) are all valid
  expect(['navigate', 'disambiguation_required', 'unknown']).toContain(resp.type);
  if (resp.type === 'navigate') {
    expect(resp.route).toBe('/closed-cases');
    const p = qp(resp);
    expect(p.get('assignedto')).toBeTruthy();
    expect(p.get('createdFrom')).toBeTruthy();
  }
});

// ─── Gap 6: Month attendance (already works) ──────────────────────────────────

test('AI-P2-15 "Show me my attendance for April" → /my-attendance with April dates', async () => {
  const resp = await interpret('Show me my attendance for April');
  expect(resp.type).toBe('navigate');
  expect(resp.route).toBe('/my-attendance');
  const p = qp(resp);
  // April → dateFrom contains "-04-"
  expect(p.get('dateFrom')).toContain('-04-');
});
