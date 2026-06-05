/**
 * AI Avatar Phase 3 — Endpoint Tests (Category 3).
 *
 * Tests the full POST /ai/interpret pipeline for multi-tool composition:
 *   real question → LLM → composite_query intent → backend runs both steps and
 *   combines → `composite` response (or a single intent when reduce-to-single applies).
 *
 * Hits the live dev server + real LLM. No browser.
 *
 * Run: npx playwright test tests/ai/phase3.spec.ts
 */
import { test, expect } from '@playwright/test';
import { apiFetch, getCachedApiAuth } from '../../helpers/api-seed.helper';

let token    = '';
let branchId = '';
const PAGE_CTX = '/dashboard';

interface AIResponse {
  type:      string;
  operator?: string;
  route?:    string;
  params?:   string;
  count?:    number;
  items?:    Array<{ id: string; label: string }>;
  message?:  string;
  answer?:   string;
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

// ─── intersect — user dimension ───────────────────────────────────────────────

test('AI-P3-01 "Who is absent today and has overdue cases?" → composite intersect (user)', async () => {
  const resp = await interpret('Who is absent today and also has overdue cases?');
  expect(resp.type).toBe('composite');
  expect(resp.operator).toBe('intersect');
  // user intersection → a count + answer; no client nav route
  expect(typeof resp.count).toBe('number');
  expect(resp.answer).toBeTruthy();
});

// ─── intersect — client dimension ─────────────────────────────────────────────

test('AI-P3-02 "Which clients have open cases and pending payments?" → composite intersect (client)', async () => {
  const resp = await interpret('Which clients have open cases and pending payments?');
  expect(resp.type).toBe('composite');
  expect(resp.operator).toBe('intersect');
  expect(typeof resp.count).toBe('number');
  // client results land on the filtered client list when non-empty
  if ((resp.count ?? 0) > 0) {
    expect(resp.route).toBe('/clients');
    expect(new URLSearchParams(resp.params ?? '').get('clientIds')).toBeTruthy();
  }
});

// ─── difference — client dimension ────────────────────────────────────────────

test('AI-P3-03 "Clients with open cases but no pending payments" → composite difference', async () => {
  const resp = await interpret('Show me clients with open cases but no outstanding payments');
  // difference is the ideal answer; a single-intent navigate is an acceptable fallback
  expect(['composite', 'navigate', 'unknown']).toContain(resp.type);
  if (resp.type === 'composite') {
    expect(resp.operator).toBe('difference');
  }
});

// ─── conjunction — one entity, two facts ──────────────────────────────────────

test('AI-P3-04 "Did Baby close any cases on the day she came in?" → composite conjunction (or unknown if name not found)', async () => {
  const resp = await interpret('Did Baby close any cases on the day she came in?');
  // conjunction when Baby resolves; unknown/disambiguation when the name does not.
  expect(['composite', 'unknown', 'disambiguation_required']).toContain(resp.type);
  if (resp.type === 'composite') {
    expect(resp.operator).toBe('conjunction');
    expect(resp.answer).toBeTruthy();
  }
});

// ─── reduce-to-single guard (must NOT be composite) ───────────────────────────

test('AI-P3-05 "Ravi is on leave — who has his cases?" → single intent, NOT composite', async () => {
  const resp = await interpret('Ravi is on leave, who has his cases?');
  // This reduces to a single case_list/navigate (the leave clause is context).
  // It must NOT be answered as a composite query.
  expect(resp.type).not.toBe('composite');
  expect(['navigate', 'disambiguation_required', 'unknown', 'aggregate']).toContain(resp.type);
});
