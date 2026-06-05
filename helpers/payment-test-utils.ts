import type { Page } from '@playwright/test';
import { LoginPage } from '../page-objects/login.page';
import { assignCase, transitionCase } from './payment.helper';

export function decodeJwtSubject(accessToken: string): string {
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

export function validPan(prefix: string, index = 0): string {
  const letters = prefix.replace(/[^A-Z]/gi, '').toUpperCase().padEnd(5, 'A').slice(0, 5);
  const digits = String(1000 + (index % 9000));
  const suffix = String.fromCharCode(65 + (index % 26));
  return `${letters}${digits}${suffix}`;
}

export function inr(amount: number): RegExp {
  const value = amount.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  return new RegExp(`₹\\s*${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
}

export async function relogin(page: Page, email: string, password: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.evaluate(() => {
    try { localStorage.clear(); } catch {}
    try { sessionStorage.clear(); } catch {}
  });
  const loginPage = new LoginPage(page);
  await loginPage.navigate();
  await loginPage.loginAndExpectSuccess(email, password);
}

export async function closeCaseAsUser(token: string, caseId: string, userId: string): Promise<void> {
  const assignResponse = await assignCase(token, caseId, userId);
  if (assignResponse.status !== 200) {
    throw new Error(`Could not assign case ${caseId} to ${userId}: ${assignResponse.text}`);
  }

  const inProgressResponse = await transitionCase(token, caseId, 'In Progress');
  if (inProgressResponse.status !== 200) {
    throw new Error(`Could not move case ${caseId} to In Progress: ${inProgressResponse.text}`);
  }

  const closedResponse = await transitionCase(token, caseId, 'Closed');
  if (closedResponse.status !== 200) {
    throw new Error(`Could not close case ${caseId}: ${closedResponse.text}`);
  }
}

export async function closeSharedCase(token: string, caseId: string): Promise<void> {
  const inProgressResponse = await transitionCase(token, caseId, 'In Progress');
  if (inProgressResponse.status !== 200) {
    throw new Error(`Could not move shared case ${caseId} to In Progress: ${inProgressResponse.text}`);
  }

  const closedResponse = await transitionCase(token, caseId, 'Closed');
  if (closedResponse.status !== 200) {
    throw new Error(`Could not close shared case ${caseId}: ${closedResponse.text}`);
  }
}
