/**
 * AI Avatar Phase 4 — Endpoint Tests (Category 3).
 *
 * Two halves:
 *  - POST /ai/query  — run a spec directly. NO LLM tokens. Validates the
 *    semantic-layer endpoint + analytics response shape.
 *  - POST /ai/interpret — analytics questions through the live LLM (uses tokens).
 *
 * Run: npx playwright test tests/ai/phase4.spec.ts
 */
import { test, expect } from '@playwright/test';
import { apiFetch, getCachedApiAuth } from '../../helpers/api-seed.helper';

let token    = '';
let branchId = '';
const PAGE_CTX = '/dashboard';

interface AIResponse {
  type:      string;
  columns?:  { field: string; label: string; type: string }[];
  rows?:     Record<string, unknown>[];
  headline?: string;
  chartHint?: string;
  spec?:     Record<string, unknown>;
  message?:  string;
}

test.beforeAll(() => {
  const auth = getCachedApiAuth();
  if (!auth) throw new Error('Missing cached API auth — run setup first');
  ({ token, branchId } = auth);
});

async function runQuery(spec: Record<string, unknown>) {
  return apiFetch<AIResponse>('POST', '/ai/query', token, { spec, activeBranchId: branchId });
}

async function interpret(query: string): Promise<AIResponse> {
  await new Promise(r => setTimeout(r, 800));   // avoid AI rate limiter
  const res = await apiFetch<AIResponse>('POST', '/ai/interpret', token, { query, currentPage: PAGE_CTX, activeBranchId: branchId });
  if (!res.ok) throw new Error(`/ai/interpret failed ${res.status}: ${res.text.slice(0, 200)}`);
  return res.data;
}

// ─── POST /ai/query — direct spec execution (no LLM) ──────────────────────────

test('AI-P4-Q01 payments revenue by compliance type → analytics + bar', async () => {
  const res = await runQuery({ dataset: 'payments', metric: { op: 'sum', field: 'amount' }, group_by: ['compliance_type'] });
  expect(res.ok).toBeTruthy();
  expect(res.data.type).toBe('analytics');
  expect(res.data.chartHint).toBe('bar');
  // columns: dim0 + value
  expect(res.data.columns?.some(c => c.field === 'value')).toBeTruthy();
});

test('AI-P4-Q02 monthly revenue trend → analytics + line', async () => {
  const res = await runQuery({ dataset: 'payments', metric: { op: 'sum', field: 'amount' }, time_bucket: 'month', filters: { date_range: 'this_fy' } });
  expect(res.ok).toBeTruthy();
  expect(res.data.type).toBe('analytics');
  expect(res.data.chartHint).toBe('line');
  expect(res.data.columns?.[0].field).toBe('bucket');
});

test('AI-P4-Q03 average closure time by compliance → analytics', async () => {
  const res = await runQuery({ dataset: 'cases', metric: { op: 'avg', field: 'closure_days' }, group_by: ['compliance_type'] });
  expect(res.ok).toBeTruthy();
  expect(res.data.type).toBe('analytics');
});

test('AI-P4-Q04 invalid dimension → 400', async () => {
  const res = await runQuery({ dataset: 'payments', metric: { op: 'count' }, group_by: ['totally_made_up'] });
  expect(res.status).toBe(400);
});

test('AI-P4-Q05 cross-dataset dimension is rejected → 400', async () => {
  // "user" is not a payments dimension
  const res = await runQuery({ dataset: 'payments', metric: { op: 'count' }, group_by: ['user'] });
  expect(res.status).toBe(400);
});

// ─── POST /ai/interpret — analytics classification (LLM) ──────────────────────

test('AI-P4-I01 "monthly revenue trend for the last 6 months" → analytics', async () => {
  const resp = await interpret('Show me the monthly revenue trend for the last 6 months');
  expect(resp.type).toBe('analytics');
  expect((resp.spec as { dataset?: string })?.dataset).toBe('payments');
});

test('AI-P4-I02 "average case closure time by compliance type" → analytics', async () => {
  const resp = await interpret('What is the average case closure time by compliance type?');
  expect(resp.type).toBe('analytics');
  expect((resp.spec as { dataset?: string })?.dataset).toBe('cases');
});

test('AI-P4-I03 "how much did we collect this month" → NOT analytics (single total → aggregate)', async () => {
  const resp = await interpret('How much did we collect this month?');
  // A single total must reduce to aggregate_query, not analytics_query.
  expect(resp.type).not.toBe('analytics');
  expect(['aggregate', 'navigate', 'unknown']).toContain(resp.type);
});
