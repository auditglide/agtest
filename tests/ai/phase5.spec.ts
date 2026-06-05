/**
 * AI Avatar Phase 5 — Endpoint Tests (Category 3).
 *
 * Edge cases through the live LLM: fuzzy/misspelled names, Hindi input,
 * graceful out-of-scope/hypotheticals, and a follow-up context pair.
 *
 * Run: npx playwright test tests/ai/phase5.spec.ts
 */
import { test, expect } from '@playwright/test';
import { apiFetch, getCachedApiAuth } from '../../helpers/api-seed.helper';

let token    = '';
let branchId = '';
const PAGE_CTX = '/dashboard';

interface AIResponse {
  type:    string;
  route?:  string;
  message?: string;
  intent?: string;
}

// A real client name from the test admin's firm + a misspelled version of it.
// Fetched at runtime so the fuzzy test doesn't assume a specific firm's data.
let realClient = '';
let typoClient = '';

/** Delete one interior character to simulate a typo while keeping similarity high. */
function misspell(name: string): string {
  if (name.length < 5) return name;
  const i = Math.floor(name.length / 2);
  return name.slice(0, i) + name.slice(i + 1);
}

test.beforeAll(async () => {
  const auth = getCachedApiAuth();
  if (!auth) throw new Error('Missing cached API auth — run setup first');
  ({ token, branchId } = auth);

  // Pick a real client (name ≥ 6 chars so a 1-char typo stays above the fuzzy threshold).
  const res = await apiFetch<{ data: { clientId: string; name: string }[] }>(
    'GET', `/clients?branchId=${branchId}&limit=20`, token,
  );
  const candidate = (res.ok ? res.data.data : []).find((c) => c.name.replace(/\s/g, '').length >= 6);
  if (candidate) {
    realClient = candidate.name;
    typoClient = misspell(candidate.name);
  }
});

async function interpret(query: string, context?: unknown): Promise<AIResponse> {
  await new Promise(r => setTimeout(r, 800));   // avoid AI rate limiter
  const res = await apiFetch<AIResponse>('POST', '/ai/interpret', token, {
    query, currentPage: PAGE_CTX, activeBranchId: branchId, context,
  });
  if (!res.ok) throw new Error(`/ai/interpret failed ${res.status}: ${res.text.slice(0, 200)}`);
  return res.data;
}

// ─── D. Out-of-scope / hypotheticals → graceful (type unknown) ────────────────

test('AI-P5-01 hypothetical → graceful decline (not a wrong answer)', async () => {
  const resp = await interpret('What if we doubled all our GST fees next year?');
  expect(resp.type).toBe('unknown');
  // Should be a helpful message, not the generic parse-failure text.
  expect(resp.message ?? '').not.toMatch(/didn't understand/i);
});

test('AI-P5-02 chit-chat → graceful decline', async () => {
  const resp = await interpret('Write me a poem about taxes');
  expect(resp.type).toBe('unknown');
});

// ─── B. Multilingual (Hindi) — intent understood regardless of language ───────

test('AI-P5-03 Hindi "kitne clients hain?" → understood (count / navigate)', async () => {
  const resp = await interpret('kitne clients hain?');
  expect(['aggregate', 'navigate']).toContain(resp.type);
});

test('AI-P5-04 Hindi "is mahine kitna payment aaya?" → understood', async () => {
  const resp = await interpret('is mahine kitna payment aaya?');
  expect(['aggregate', 'navigate']).toContain(resp.type);
});

// ─── A. Fuzzy / misspelled entity name ────────────────────────────────────────

test('AI-P5-05 misspelled real client → resolved or "did you mean" (not a dead-end)', async () => {
  test.skip(!typoClient, 'No suitable client (name ≥ 6 chars) in this firm to fuzzy-test.');
  const resp = await interpret(`Show me cases for ${typoClient}`);
  // Fuzzy fallback should resolve the misspelling to the real client or offer a
  // disambiguation — not a "couldn't find a client named" unknown.
  expect(['navigate', 'aggregate', 'disambiguation_required']).toContain(resp.type);
});

// ─── C. Follow-up context (1 turn) ────────────────────────────────────────────

test('AI-P5-06 follow-up "what about closed ones?" carries the prior client', async () => {
  test.skip(!realClient, 'No client in this firm to run the follow-up test.');
  const firstQuery = `Show me cases for ${realClient}`;
  const first = await interpret(firstQuery);
  // Carry the previous turn as context (what the frontend sends).
  const resp = await interpret('what about the closed ones?', {
    query:  firstQuery,
    intent: first.intent ?? first.type,
  });
  // The follow-up should still land on a cases view, not become unknown.
  expect(['navigate', 'aggregate', 'disambiguation_required']).toContain(resp.type);
  if (resp.type === 'navigate') {
    expect(resp.route === '/closed-cases' || resp.route === '/cases').toBeTruthy();
  }
});
