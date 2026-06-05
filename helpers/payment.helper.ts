import { apiFetch, defaultSchedule } from './api-seed.helper';

export async function updateComplianceReceivePayment(
  token: string,
  complianceTypeId: string,
  input: {
    type: string;
    receivePayment: boolean;
    applyToOpenCases?: boolean;
  },
) {
  return apiFetch<{ complianceTypeId?: string }>(
    'PATCH',
    `/compliance/${complianceTypeId}`,
    token,
    {
      type: input.type,
      receivePayment: input.receivePayment,
      ...(input.applyToOpenCases !== undefined ? { applyToOpenCases: input.applyToOpenCases } : {}),
    },
  );
}

export async function createSubtype(
  token: string,
  complianceTypeId: string,
  input: {
    name: string;
    frequency?: 'Monthly' | 'Quarterly' | 'Yearly';
    needsWorkAllocation?: boolean;
    receivePayment?: boolean;
  },
) {
  const frequency = input.frequency ?? 'Monthly';
  return apiFetch<{ subtypeId: string }>(
    'POST',
    `/compliance/${complianceTypeId}/subtypes`,
    token,
    {
      name: input.name,
      schedule: defaultSchedule(frequency),
      needsWorkAllocation: input.needsWorkAllocation ?? true,
      receivePayment: input.receivePayment ?? false,
    },
  );
}

export async function updateSubtypeReceivePayment(
  token: string,
  complianceTypeId: string,
  complianceSubtypeId: string,
  input: {
    name: string;
    receivePayment: boolean;
    applyToOpenCases?: boolean;
  },
) {
  return apiFetch<{ subtypeId?: string }>(
    'PATCH',
    `/compliance/${complianceTypeId}/subtypes/${complianceSubtypeId}`,
    token,
    {
      name: input.name,
      receivePayment: input.receivePayment,
      ...(input.applyToOpenCases !== undefined ? { applyToOpenCases: input.applyToOpenCases } : {}),
    },
  );
}

export async function assignCase(token: string, caseId: string, userId: string) {
  return apiFetch('PATCH', `/cases/${caseId}/assign`, token, { userId });
}

export async function transitionCase(token: string, caseId: string, status: string, assignTo?: string) {
  return apiFetch('PATCH', `/cases/${caseId}/status`, token, {
    status,
    ...(assignTo ? { assignTo } : {}),
  });
}

export async function getCasePayment(token: string, caseId: string) {
  return apiFetch<{
    caseId: string;
    paymentRequired: boolean;
    paymentStatus: string;
    paymentTotalDue: number;
    paymentTotalReceived: number;
    paymentOutstanding: number;
    history: Array<{
      paymentId: string;
      entryType: string;
      amountReceived: number;
      totalReceived: number;
      outstanding: number;
      paymentStatus: string;
      note: string | null;
      isVoided: boolean;
      createdAt: string;
    }>;
  }>('GET', `/cases/${caseId}/payment`, token);
}

export async function addCasePayment(
  token: string,
  caseId: string,
  input: {
    totalDue?: number;
    amountReceived: number;
    note?: string;
    receiptS3Key?: string;
    receiptFilename?: string;
  },
) {
  return apiFetch('POST', `/cases/${caseId}/payment`, token, input);
}

export async function correctCasePayment(
  token: string,
  caseId: string,
  paymentId: string,
  input: {
    correctedAmount: number;
    reason: string;
    note?: string;
  },
) {
  return apiFetch('POST', `/cases/${caseId}/payment/${paymentId}/correct`, token, input);
}

export async function reopenCasePayment(token: string, caseId: string) {
  return apiFetch('POST', `/cases/${caseId}/payment/reopen`, token, {});
}

export async function writeOffCasePayment(token: string, caseId: string, reason: string) {
  return apiFetch('POST', `/cases/${caseId}/payment/write-off`, token, { reason });
}

export async function reverseWriteOffCasePayment(token: string, caseId: string) {
  return apiFetch('POST', `/cases/${caseId}/payment/un-write-off`, token, {});
}

export async function uploadPaymentReceipt(
  token: string,
  caseId: string,
  file: { name: string; mimeType: string; buffer: Buffer },
): Promise<{ s3Key: string; filename: string }> {
  const uploadUrlResponse = await apiFetch<{ uploadUrl: string; s3Key: string }>(
    'POST',
    `/cases/${caseId}/payment/upload-url`,
    token,
    {
      filename: file.name,
      mimeType: file.mimeType,
    },
  );

  if (uploadUrlResponse.status !== 200) {
    throw new Error(`Could not request payment receipt upload URL: ${uploadUrlResponse.text}`);
  }

  const putResponse = await fetch(uploadUrlResponse.data.uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': file.mimeType,
    },
    body: new Uint8Array(file.buffer),
  });

  if (!putResponse.ok) {
    throw new Error(`Could not upload payment receipt: HTTP ${putResponse.status}`);
  }

  return {
    s3Key: uploadUrlResponse.data.s3Key,
    filename: file.name,
  };
}

export async function getPaymentsDue(token: string, branchId: string) {
  return apiFetch<Array<{
    caseId: string;
    clientName: string;
    complianceTypeName: string;
    paymentStatus: string;
    paymentTotalDue: number;
    paymentTotalReceived: number;
    paymentOutstanding: number;
  }>>(
    'GET',
    `/cases/payments/due?branchId=${encodeURIComponent(branchId)}`,
    token,
  );
}

export async function getPaymentsSummary(
  token: string,
  input: { branchId: string; dateFrom?: string; dateTo?: string },
) {
  const qs = new URLSearchParams({ branchId: input.branchId });
  if (input.dateFrom) qs.set('dateFrom', input.dateFrom);
  if (input.dateTo) qs.set('dateTo', input.dateTo);
  return apiFetch('GET', `/payments/summary?${qs}`, token);
}

export async function listPayments(
  token: string,
  input: {
    branchId: string;
    dateFrom?: string;
    dateTo?: string;
    paymentStatus?: string;
    page?: number;
    limit?: number;
  },
) {
  const qs = new URLSearchParams({ branchId: input.branchId });
  if (input.dateFrom) qs.set('dateFrom', input.dateFrom);
  if (input.dateTo) qs.set('dateTo', input.dateTo);
  if (input.paymentStatus) qs.set('paymentStatus', input.paymentStatus);
  if (input.page) qs.set('page', String(input.page));
  if (input.limit) qs.set('limit', String(input.limit));
  return apiFetch('GET', `/payments/list?${qs}`, token);
}

export async function getPaymentsByCompliance(
  token: string,
  input: { branchId: string; dateFrom?: string; dateTo?: string },
) {
  const qs = new URLSearchParams({ branchId: input.branchId });
  if (input.dateFrom) qs.set('dateFrom', input.dateFrom);
  if (input.dateTo) qs.set('dateTo', input.dateTo);
  return apiFetch('GET', `/payments/by-compliance?${qs}`, token);
}

export async function getPaymentsByClient(
  token: string,
  input: { branchId: string; dateFrom?: string; dateTo?: string },
) {
  const qs = new URLSearchParams({ branchId: input.branchId });
  if (input.dateFrom) qs.set('dateFrom', input.dateFrom);
  if (input.dateTo) qs.set('dateTo', input.dateTo);
  return apiFetch('GET', `/payments/by-client?${qs}`, token);
}

export async function getClientPaymentHistory(
  token: string,
  clientId: string,
  input?: { page?: number; limit?: number; from?: string; to?: string },
) {
  const qs = new URLSearchParams();
  if (input?.page) qs.set('page', String(input.page));
  if (input?.limit) qs.set('limit', String(input.limit));
  if (input?.from) qs.set('from', input.from);
  if (input?.to) qs.set('to', input.to);
  return apiFetch('GET', `/cases/clients/${clientId}/payment-history?${qs}`, token);
}

export async function runCaseGenerationForDate(runAt: Date): Promise<void> {
  if (process.env.TEST_DB_URL && !process.env.DATABASE_URL) {
    process.env.DATABASE_URL = process.env.TEST_DB_URL;
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('../../auditglideapi/src/jobs/caseGeneration.ts') as {
    runCaseGenerationJob(input?: Date): Promise<void>;
  };
  await mod.runCaseGenerationJob(runAt);
}
