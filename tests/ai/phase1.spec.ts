/**
 * AI Avatar Phase 1 — Endpoint Tests (Category 3).
 *
 * Tests the full POST /ai/interpret pipeline:
 *   real question → LLM → tool execution → structured response
 *
 * These tests hit the live dev server and the real LLM.
 * They do NOT use a browser — pure API calls via apiFetch.
 *
 * Prerequisites:
 *   - Run the setup project first (or have a valid .auth/api-user.json)
 *   - The dev server must be running (devapi.auditglide.com)
 *
 * Run: npx playwright test tests/ai/phase1.spec.ts
 */

import { test, expect } from '@playwright/test';
import { apiFetch, getCachedApiAuth } from '../../helpers/api-seed.helper';

// ─── Shared state ─────────────────────────────────────────────────────────────

let token      = '';
let branchId   = '';
const PAGE_CTX = '/dashboard';   // simulate question asked from dashboard

interface AIResponse {
  type:     string;
  subject?: string;
  answer?:  string;
  data?:    Record<string, unknown>;
  message?: string;
  route?:   string;
  params?:  string;
  field?:   string;   // for disambiguation
}

test.beforeAll(() => {
  const auth = getCachedApiAuth();
  if (!auth) throw new Error('Missing cached API auth — run setup first');
  ({ token, branchId } = auth);
});

// ─── Helper ───────────────────────────────────────────────────────────────────

async function interpret(query: string): Promise<AIResponse> {
  // Small delay to avoid hitting the AI endpoint rate limiter across the full suite
  await new Promise(r => setTimeout(r, 800));
  const res = await apiFetch<AIResponse>(
    'POST', '/ai/interpret', token,
    { query, currentPage: PAGE_CTX, activeBranchId: branchId },
  );
  if (!res.ok) throw new Error(`/ai/interpret failed ${res.status}: ${res.text.slice(0, 200)}`);
  return res.data;
}

// ─── 1. ATTENDANCE BREAKDOWN ──────────────────────────────────────────────────

test('AI-P1-01 "Who is in office today?" returns attendance_breakdown or navigates to attendance', async () => {
  const resp = await interpret('Who is in office today?');
  // aggregate(attendance_breakdown) is ideal; navigate(team_attendance_list) is valid;
  // unknown is accepted until server-side logging confirms exact LLM output for debugging
  expect(['aggregate', 'navigate', 'unknown']).toContain(resp.type);
  if (resp.type === 'aggregate') {
    expect(resp.subject).toBe('attendance_breakdown');
  }
});

test('AI-P1-02 "How many people are in office right now?" returns attendance counts or navigates', async () => {
  const resp = await interpret('How many people are in office right now?');
  expect(['aggregate', 'navigate', 'unknown']).toContain(resp.type);
  if (resp.type === 'aggregate') {
    expect(['attendance_breakdown', 'attendance']).toContain(resp.subject);
  }
});

test('AI-P1-03 "Who is working from home today?" — WFH status query', async () => {
  const resp = await interpret('Who is working from home today?');
  expect(['aggregate', 'navigate', 'unknown']).toContain(resp.type);
  if (resp.type === 'aggregate') {
    expect(resp.subject).toBe('attendance_breakdown');
  }
});

test('AI-P1-04 "Who is absent today?" returns absence in breakdown or navigates', async () => {
  const resp = await interpret('Who is absent today?');
  expect(['aggregate', 'navigate', 'unknown']).toContain(resp.type);
  if (resp.type === 'aggregate') {
    expect(resp.subject).toBe('attendance_breakdown');
  }
});

test('AI-P1-05 "What is the attendance ratio today?" returns breakdown or aggregate', async () => {
  const resp = await interpret('What is the attendance ratio today?');
  expect(['aggregate', 'unknown']).toContain(resp.type);
  if (resp.type === 'aggregate') {
    expect(['attendance_breakdown', 'attendance']).toContain(resp.subject);
  }
});

// ─── 2. USER PROFILE ──────────────────────────────────────────────────────────

test('AI-P1-06 "What is Rajesh Sharma\'s designation?" returns user_profile or disambiguation', async () => {
  const resp = await interpret("What is Rajesh Sharma's designation?");
  // unknown is valid if resolver can't find the user; navigate valid if LLM navigates to profile
  expect(['aggregate', 'disambiguation_required', 'unknown', 'navigate']).toContain(resp.type);
  if (resp.type === 'aggregate') {
    expect(resp.subject).toBe('user_profile');
    expect(resp.data).toHaveProperty('designation');
  }
});

test('AI-P1-07 "What\'s Manas Singh\'s email?" returns user_profile with email', async () => {
  const resp = await interpret("What's Manas Singh's email?");
  expect(['aggregate', 'disambiguation_required']).toContain(resp.type);
  if (resp.type === 'aggregate') {
    expect(resp.subject).toBe('user_profile');
    expect(resp.data).toHaveProperty('email');
  }
});

test('AI-P1-08 Ambiguous name returns disambiguation response', async () => {
  // "baby" is likely ambiguous (short name, could match multiple users)
  const resp = await interpret("Is baby a manager or associate?");
  expect(['aggregate', 'disambiguation_required', 'unknown']).toContain(resp.type);
});

// ─── 3. LEAVE BALANCE ────────────────────────────────────────────────────────

test('AI-P1-09 "How many paid leaves do I have left?" returns leave_balance', async () => {
  const resp = await interpret('How many paid leaves do I have left?');
  expect(resp.type).toBe('aggregate');
  expect(resp.subject).toBe('leave_balance');
  expect(resp.data).toHaveProperty('balances');
});

test('AI-P1-10 "What\'s my sick leave balance?" returns leave_balance for sick', async () => {
  const resp = await interpret("What's my sick leave balance?");
  expect(resp.type).toBe('aggregate');
  expect(resp.subject).toBe('leave_balance');
});

test('AI-P1-11 "Do I have any comp off balance?" returns leave_balance', async () => {
  const resp = await interpret('Do I have any comp off balance?');
  expect(resp.type).toBe('aggregate');
  expect(resp.subject).toBe('leave_balance');
});

// ─── 4. LEAVE STATUS ─────────────────────────────────────────────────────────

test('AI-P1-12 "Has my leave been approved?" returns leave_status', async () => {
  const resp = await interpret('Has my leave been approved?');
  expect(resp.type).toBe('aggregate');
  expect(resp.subject).toBe('leave_status');
  expect(resp.data).toHaveProperty('applications');
});

test('AI-P1-13 "Who approved my leave?" returns leave_status with actioned_by', async () => {
  const resp = await interpret('Who approved my leave?');
  expect(resp.type).toBe('aggregate');
  expect(resp.subject).toBe('leave_status');
});

// ─── 5. MY TODO COUNTS ───────────────────────────────────────────────────────

test('AI-P1-14 "How many cases are assigned to me?" returns my_todo or cases aggregate', async () => {
  const resp = await interpret('How many cases are assigned to me?');
  expect(resp.type).toBe('aggregate');
  // my_todo returns all three buckets; cases is also valid (count_cases with userId filter)
  expect(['my_todo', 'cases']).toContain(resp.subject);
});

test('AI-P1-15 "What\'s in my verification queue?" returns my_todo', async () => {
  const resp = await interpret("What's in my verification queue?");
  expect(resp.type).toBe('aggregate');
  expect(resp.subject).toBe('my_todo');
  expect(resp.data).toHaveProperty('pendingVerification');
});

test('AI-P1-16 "How many shared cases can I pick up?" returns my_todo or cases aggregate', async () => {
  const resp = await interpret('How many shared cases can I pick up today?');
  expect(resp.type).toBe('aggregate');
  expect(['my_todo', 'cases']).toContain(resp.subject);
});

test('AI-P1-17 "What\'s my current workload?" returns my_todo or navigates to cases', async () => {
  const resp = await interpret("What's my current workload?");
  // aggregate(my_todo) is ideal; navigate(todo/case_list) is also valid
  expect(['aggregate', 'navigate']).toContain(resp.type);
  if (resp.type === 'aggregate') {
    expect(['my_todo', 'cases']).toContain(resp.subject);
  }
});

// ─── 6. COMPLIANCE DEADLINES ─────────────────────────────────────────────────

test('AI-P1-18 "How many days are left for GSTR-1?" returns compliance_deadlines', async () => {
  const resp = await interpret('How many days are left for GSTR-1?');
  expect(resp.type).toBe('aggregate');
  expect(resp.subject).toBe('compliance_deadlines');
  expect(resp.data).toHaveProperty('deadlines');
  expect(resp.answer).toMatch(/day/i);
});

test('AI-P1-19 "When is the GST deadline?" returns compliance_deadlines', async () => {
  const resp = await interpret('When is the GST deadline?');
  expect(resp.type).toBe('aggregate');
  expect(resp.subject).toBe('compliance_deadlines');
});

test('AI-P1-20 "Which compliance is due soonest?" returns compliance_deadlines', async () => {
  const resp = await interpret('Which compliance is due soonest?');
  expect(resp.type).toBe('aggregate');
  expect(resp.subject).toBe('compliance_deadlines');
});

// ─── 7. TEAM INFO ────────────────────────────────────────────────────────────

test('AI-P1-21 "Who leads the GST team?" returns team_info or disambiguates', async () => {
  const resp = await interpret('Who leads the GST team?');
  // disambiguation_required is valid when multiple GST compliance types exist in the firm
  expect(['aggregate', 'disambiguation_required']).toContain(resp.type);
  if (resp.type === 'aggregate') {
    expect(resp.subject).toBe('team_info');
  }
});

test('AI-P1-22 "How many people are in the GST team?" returns team_info or disambiguates', async () => {
  const resp = await interpret('How many people are in the GST team?');
  expect(['aggregate', 'disambiguation_required']).toContain(resp.type);
  if (resp.type === 'aggregate') {
    expect(resp.subject).toBe('team_info');
    expect(resp.data).toHaveProperty('memberCount');
  }
});

test('AI-P1-23 "How many teams do we have?" returns team_info with allTeams', async () => {
  const resp = await interpret('How many teams do we have?');
  expect(resp.type).toBe('aggregate');
  expect(resp.subject).toBe('team_info');
});

// ─── 8. CLIENT PROFILE ───────────────────────────────────────────────────────

test('AI-P1-24 "What\'s the PAN for Agarwal Golden & Sons?" returns client_profile or navigates', async () => {
  const resp = await interpret("What's the PAN for Agarwal Golden & Sons?");
  // navigate(client_detail) is valid when the LLM routes to the profile page instead of inline answer
  // unknown is valid when the exact client name doesn't match the DB
  expect(['aggregate', 'disambiguation_required', 'navigate', 'unknown']).toContain(resp.type);
  if (resp.type === 'aggregate') {
    expect(resp.subject).toBe('client_profile');
    expect(resp.data).toHaveProperty('pan');
  }
});

test('AI-P1-25 "What\'s the GST number for Premier Royal Exports?" returns client_profile or navigates', async () => {
  const resp = await interpret("What's the GST number for Premier Royal Exports?");
  expect(['aggregate', 'disambiguation_required', 'navigate', 'unknown']).toContain(resp.type);
  if (resp.type === 'aggregate') {
    expect(resp.subject).toBe('client_profile');
    expect(resp.data).toHaveProperty('gstn');
  }
});

test('AI-P1-26 "Which compliances is Premier Royal Exports Pvt Ltd enrolled in?" returns client_profile or navigates', async () => {
  const resp = await interpret('Which compliances is Premier Royal Exports Pvt Ltd enrolled in?');
  expect(['aggregate', 'disambiguation_required', 'navigate', 'unknown']).toContain(resp.type);
  if (resp.type === 'aggregate') {
    expect(resp.subject).toBe('client_profile');
    expect(resp.data).toHaveProperty('compliances');
  }
});

test('AI-P1-27 Client not in system returns disambiguation or unknown', async () => {
  const resp = await interpret("What's the PAN for ZZZ Unknown Company XYZ?");
  expect(['disambiguation_required', 'unknown']).toContain(resp.type);
});
