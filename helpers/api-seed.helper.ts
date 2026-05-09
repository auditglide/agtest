import { waitForAuthRequestSlot } from './auth-rate-limit.helper';
import * as fs from 'fs';
import * as path from 'path';

/**
 * API Seed Helper
 *
 * Creates and destroys test data via the REST API so tests start
 * from a known state without going through the UI for setup.
 *
 * All created resources are tracked and cleaned up in teardown.
 */

const API_URL  = process.env.API_URL  ?? 'https://devapi.auditglide.com';
const AUTH_API_STATE_FILE = path.join(__dirname, '..', '.auth', 'api-user.json');
const COMPLIANCE_SEED_INTERVAL_MS = Number(process.env.COMPLIANCE_SEED_INTERVAL_MS ?? '2500');
let lastComplianceSeedAt = 0;

interface ApiResponse<T> { data: T; status: number }

interface ApiFetchResponse<T> {
  ok: boolean;
  status: number;
  data: T;
  text: string;
}

export interface SeedClient {
  clientId: string;
  name: string;
}

export interface SeedCompliance {
  complianceTypeId: string;
  type: string;
}

export interface SeedCase {
  caseId: string;
}

interface CaseListItem {
  caseId: string;
  clientId: string;
  clientName: string;
  status: string;
}

interface CaseListResponse {
  data: CaseListItem[];
  total: number;
  page: number;
  limit: number;
}

interface ComplianceDetailResponse {
  complianceTypeId: string;
  type: string;
  frequency: 'Monthly' | 'Quarterly' | 'Yearly';
  needsWorkAllocation: boolean;
  isactive: boolean;
  schedule: Array<{
    period_index: number;
    creation_month_offset: number;
    creation_day: number;
    deadline_month_offset: number;
    deadline_day: number;
  }>;
}

function headers(token?: string): Record<string, string> {
  const h: Record<string, string> = {};
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

export async function apiFetch<T = unknown>(
  method: string,
  path: string,
  token?: string,
  body?: unknown,
): Promise<ApiFetchResponse<T>> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: body ? { ...headers(token), 'Content-Type': 'application/json' } : headers(token),
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data: T;
  try { data = JSON.parse(text) as T; } catch { data = text as unknown as T; }

  return {
    ok: res.ok,
    status: res.status,
    data,
    text,
  };
}

async function apiCall<T>(
  method: string,
  path: string,
  token?: string,
  body?: unknown,
): Promise<ApiResponse<T>> {
  const res = await apiFetch<T>(method, path, token, body);

  if (!res.ok) {
    throw new Error(
      `API ${method} ${path} → ${res.status}\n` +
      `Body: ${res.text.slice(0, 400)}`,
    );
  }
  return { data: res.data, status: res.status };
}

async function waitForComplianceSeedSlot(): Promise<void> {
  if (!Number.isFinite(COMPLIANCE_SEED_INTERVAL_MS) || COMPLIANCE_SEED_INTERVAL_MS <= 0) {
    return;
  }

  const now = Date.now();
  const waitMs = Math.max(0, lastComplianceSeedAt + COMPLIANCE_SEED_INTERVAL_MS - now);
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  lastComplianceSeedAt = Date.now();
}

function isRateLimitError(error: unknown, path: string): boolean {
  return error instanceof Error && error.message.includes(`${path} → 429`);
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

interface LoginBranch { branchId: string; bname: string; isdefault: boolean }
interface LoginData { accessToken: string; lastBranchId?: string | null; branches?: LoginBranch[] }

export function getCachedApiAuth(): { token: string; branchId: string } | null {
  if (!fs.existsSync(AUTH_API_STATE_FILE)) return null;

  try {
    const cached = JSON.parse(fs.readFileSync(AUTH_API_STATE_FILE, 'utf8')) as {
      token?: string;
      branchId?: string;
    };

    if (cached.token && cached.branchId) {
      return { token: cached.token, branchId: cached.branchId };
    }
  } catch {
    // ignore malformed cache and let callers decide how to proceed
  }

  return null;
}

export async function apiLogin(email: string, password: string): Promise<{ token: string; branchId: string }> {
  const cached = getCachedApiAuth();
  if (cached) {
    return cached;
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await waitForAuthRequestSlot();
      const res = await apiCall<LoginData>('POST', '/auth/login', undefined, {
        emailid: email,
        password,
        useragent: 'playwright-seed',
      });

      const { accessToken, lastBranchId, branches } = res.data;
      const branchId =
        lastBranchId ??
        branches?.find(b => b.isdefault)?.branchId ??
        branches?.[0]?.branchId ??
        '';

      try {
        fs.writeFileSync(
          AUTH_API_STATE_FILE,
          JSON.stringify({
            token: accessToken,
            branchId,
            email,
            createdAt: new Date().toISOString(),
          }, null, 2),
        );
      } catch {
        // ignore cache write failures
      }

      return { token: accessToken, branchId };
    } catch (error) {
      lastError = error as Error;
      if (!/\/auth\/login → 429\b/.test(lastError.message) || attempt === 2) {
        throw lastError;
      }

      const backoffMs = attempt === 0 ? 20_000 : 45_000;
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  throw lastError ?? new Error('apiLogin failed unexpectedly');
}

// ─── Clients ──────────────────────────────────────────────────────────────────

export async function seedClient(
  token: string,
  overrides: Partial<{ name: string; pan: string; gstn: string; complianceTypeIds: string[]; branchId: string }> = {},
): Promise<SeedClient> {
  if (!overrides.branchId) throw new Error('seedClient: branchId is required — pass the branchId returned by apiLogin()');
  const name = overrides.name ?? `Test Client ${Date.now()}`;
  const body = {
    name,
    pan:               overrides.pan  ?? `AAAAA${String(Date.now()).slice(-4)}A`,
    branchId:          overrides.branchId,
    complianceTypeIds: overrides.complianceTypeIds ?? [],
    ...overrides,
  };
  const res = await apiCall<{ clientId: string }>('POST', '/clients', token, body);
  return { clientId: res.data.clientId, name };
}

export async function deleteClient(token: string, clientId: string): Promise<void> {
  await apiCall('DELETE', `/clients/${clientId}`, token).catch(() => {
    // ignore 404 — already cleaned up
  });
}

export async function deactivateClient(token: string, clientId: string): Promise<void> {
  await apiCall('PATCH', `/clients/${clientId}`, token, { isactive: false });
}

// ─── Compliance types ─────────────────────────────────────────────────────────

const DEFAULT_MONTHLY_SCHEDULE = Array.from({ length: 12 }, (_, i) => ({
  period_index: i,
  creation_month_offset: 1,
  creation_day: 11,
  deadline_month_offset: 1,
  deadline_day: 20,
}));

const DEFAULT_QUARTERLY_SCHEDULE = Array.from({ length: 4 }, (_, i) => ({
  period_index: i,
  creation_month_offset: 1,
  creation_day: 11,
  deadline_month_offset: 1,
  deadline_day: 20,
}));

const DEFAULT_YEARLY_SCHEDULE = [{
  period_index: 0,
  creation_month_offset: 1,
  creation_day: 11,
  deadline_month_offset: 3,
  deadline_day: 31,
}];

export function defaultSchedule(frequency: 'Monthly' | 'Quarterly' | 'Yearly') {
  if (frequency === 'Monthly')   return DEFAULT_MONTHLY_SCHEDULE;
  if (frequency === 'Quarterly') return DEFAULT_QUARTERLY_SCHEDULE;
  return DEFAULT_YEARLY_SCHEDULE;
}

export async function seedComplianceType(
  token: string,
  overrides: Partial<{
    type: string;
    frequency: 'Monthly' | 'Quarterly' | 'Yearly';
    needsWorkAllocation: boolean;
    schedule: typeof DEFAULT_MONTHLY_SCHEDULE;
  }> = {},
): Promise<SeedCompliance> {
  const frequency = overrides.frequency ?? 'Monthly';
  const type = overrides.type ?? `Test CT ${Date.now()}`;
  const body = {
    type,
    frequency,
    needsWorkAllocation: overrides.needsWorkAllocation ?? false,
    schedule: overrides.schedule ?? defaultSchedule(frequency),
  };

  for (let attempt = 0; attempt < 6; attempt += 1) {
    await waitForComplianceSeedSlot();
    try {
      const res = await apiCall<{ complianceTypeId: string }>('POST', '/compliance', token, body);
      return { complianceTypeId: res.data.complianceTypeId, type };
    } catch (error) {
      if (!isRateLimitError(error, '/compliance') || attempt === 5) {
        throw error;
      }

      const backoffMs = 10_000 + (5_000 * attempt);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  throw new Error('seedComplianceType failed unexpectedly');
}

export async function seedCase(
  token: string,
  body: { clientId: string; complianceTypeId: string },
): Promise<SeedCase> {
  const res = await apiCall<{ caseId: string }>('POST', '/cases', token, body);
  return { caseId: res.data.caseId };
}

export async function findCaseIdForClient(
  token: string,
  branchId: string,
  clientId: string,
): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const res = await apiCall<CaseListResponse>(
      'GET',
      `/cases?branchId=${encodeURIComponent(branchId)}&clientid=${encodeURIComponent(clientId)}&page=1&limit=20`,
      token,
    );

    const caseId = res.data.data?.[0]?.caseId;
    if (caseId) {
      return caseId;
    }

    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  return '';
}

export async function deleteComplianceType(token: string, ctId: string): Promise<void> {
  await apiCall('DELETE', `/compliance/${ctId}`, token).catch(() => {});
}

export async function getComplianceType(
  token: string,
  ctId: string,
): Promise<ComplianceDetailResponse> {
  const res = await apiCall<ComplianceDetailResponse>('GET', `/compliance/${ctId}`, token);
  return res.data;
}

export async function assignClientToCompliance(
  token: string,
  ctId: string,
  clientIds: string[],
): Promise<void> {
  await apiCall('POST', `/compliance/${ctId}/clients`, token, { clientIds });
}

export async function deactivateComplianceType(token: string, ctId: string): Promise<void> {
  const existing = await getComplianceType(token, ctId);
  await apiCall('PATCH', `/compliance/${ctId}`, token, {
    type: existing.type,
    isactive: false,
  });
}

export async function reactivateComplianceType(token: string, ctId: string): Promise<void> {
  const existing = await getComplianceType(token, ctId);
  await apiCall('PATCH', `/compliance/${ctId}`, token, {
    type: existing.type,
    isactive: true,
  });
}
