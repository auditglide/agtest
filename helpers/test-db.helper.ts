import { randomUUID } from 'node:crypto';

type PrismaClientLike = any;

type UserAccessInput = {
  user_read?: boolean;
  user_write?: boolean;
  user_delete?: boolean;
  branch_read?: boolean;
  branch_write?: boolean;
  branch_delete?: boolean;
  client_read?: boolean;
  client_write?: boolean;
  client_delete?: boolean;
  compliance_read?: boolean;
  compliance_write?: boolean;
  compliance_delete?: boolean;
  case_read?: boolean;
  case_write?: boolean;
  case_delete?: boolean;
  team_read?: boolean;
  team_write?: boolean;
  team_delete?: boolean;
  work_allocation?: boolean;
  dashboard?: boolean;
  verify_cases?: boolean;
  work_on_cases?: boolean;
};

let prisma: PrismaClientLike | null = null;

function getTestDbUrl(): string {
  const url = process.env.TEST_DB_URL ?? '';
  if (!url) {
    throw new Error('TEST_DB_URL must be set to use DB-backed test fixtures.');
  }
  return url;
}

function getPrismaClient(): PrismaClientLike {
  if (prisma) {
    return prisma;
  }

  // Reuse the Prisma client installed with auditglideapi.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PrismaClient } = require('../../auditglideapi/node_modules/@prisma/client') as {
    PrismaClient: new (options: { datasources: { db: { url: string } } }) => PrismaClientLike;
  };

  prisma = new PrismaClient({
    datasources: {
      db: {
        url: getTestDbUrl(),
      },
    },
  });

  return prisma;
}

async function hashPassword(password: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const bcrypt = require('../../auditglideapi/node_modules/bcrypt') as {
    hash(value: string, rounds: number): Promise<string>;
  };
  return bcrypt.hash(password, 4);
}

export async function ensureTestDbConnection(): Promise<void> {
  await getPrismaClient().$queryRawUnsafe('SELECT 1');
}

export async function getUserByEmail(email: string): Promise<{
  userid: string;
  firmid: string;
  name: string;
} | null> {
  const user = await getPrismaClient().user.findFirst({
    where: { emailid: email },
    select: { userid: true, firmid: true, name: true },
  });

  return user
    ? { userid: user.userid, firmid: user.firmid, name: user.name }
    : null;
}

export async function getAdminTestContext(branchId: string): Promise<{
  adminUserId: string;
  firmId: string;
  branchId: string;
}> {
  const email = process.env.TEST_ADMIN_EMAIL ?? '';
  if (!email) {
    throw new Error('TEST_ADMIN_EMAIL must be set to seed DB-backed fixtures in the admin firm.');
  }

  const user = await getUserByEmail(email);
  if (!user) {
    throw new Error(`Could not find TEST_ADMIN_EMAIL user "${email}" in the DB.`);
  }

  return {
    adminUserId: user.userid,
    firmId: user.firmid,
    branchId,
  };
}

export async function createTemporaryUser(input: {
  firmId: string;
  branchId: string;
  createdByUserId: string;
  email: string;
  password: string;
  name: string;
  designation?: 'Associate' | 'Manager' | 'Principal' | 'Partner' | 'TeamLeader';
  access: UserAccessInput;
}): Promise<{ userId: string; email: string; password: string }> {
  const userId = randomUUID();
  const secret = await hashPassword(input.password);

  await getPrismaClient().user.create({
    data: {
      userid: userId,
      firmid: input.firmId,
      name: input.name,
      emailid: input.email,
      designation: input.designation ?? 'Associate',
      secret,
      is_first_login: false,
      islocked: false,
      isactive: true,
      failed_login_attempts: 0,
      createdby: input.createdByUserId,
    },
  });

  await getPrismaClient().useraccess.create({
    data: {
      userid: userId,
      firmid: input.firmId,
      user_read: input.access.user_read ?? false,
      user_write: input.access.user_write ?? false,
      user_delete: input.access.user_delete ?? false,
      branch_read: input.access.branch_read ?? false,
      branch_write: input.access.branch_write ?? false,
      branch_delete: input.access.branch_delete ?? false,
      client_read: input.access.client_read ?? false,
      client_write: input.access.client_write ?? false,
      client_delete: input.access.client_delete ?? false,
      compliance_read: input.access.compliance_read ?? false,
      compliance_write: input.access.compliance_write ?? false,
      compliance_delete: input.access.compliance_delete ?? false,
      case_read: input.access.case_read ?? false,
      case_write: input.access.case_write ?? false,
      case_delete: input.access.case_delete ?? false,
      team_read: input.access.team_read ?? false,
      team_write: input.access.team_write ?? false,
      team_delete: input.access.team_delete ?? false,
      work_allocation: input.access.work_allocation ?? false,
      dashboard: input.access.dashboard ?? false,
      verify_cases: input.access.verify_cases ?? false,
      work_on_cases: input.access.work_on_cases ?? false,
      createdby: input.createdByUserId,
    },
  });

  await getPrismaClient().userbranchmap.create({
    data: {
      userid: userId,
      branchid: input.branchId,
    },
  });

  return { userId, email: input.email, password: input.password };
}

export async function deleteTemporaryUser(userId: string): Promise<void> {
  await getPrismaClient().userSession.deleteMany({ where: { userid: userId } }).catch(() => {});
  await getPrismaClient().userbranchmap.deleteMany({ where: { userid: userId } }).catch(() => {});
  await getPrismaClient().teamlist.deleteMany({ where: { userid: userId } }).catch(() => {});
  await getPrismaClient().useraccess.deleteMany({ where: { userid: userId } }).catch(() => {});
  await getPrismaClient().user.deleteMany({ where: { userid: userId } }).catch(() => {});
}

export async function getComplianceTypeState(complianceTypeId: string): Promise<{
  receivePayment: boolean;
  needsWorkAllocation: boolean;
  isactive: boolean;
}> {
  const row = await getPrismaClient().compliancetype.findUniqueOrThrow({
    where: { compliancetypeid: complianceTypeId },
    select: {
      receive_payment: true,
      needs_work_allocation: true,
      isactive: true,
    },
  });

  return {
    receivePayment: row.receive_payment,
    needsWorkAllocation: row.needs_work_allocation,
    isactive: row.isactive,
  };
}

export async function getSubtypeState(complianceSubtypeId: string): Promise<{
  receivePayment: boolean;
  needsWorkAllocation: boolean;
  isactive: boolean;
}> {
  const row = await getPrismaClient().compliancesubtype.findUniqueOrThrow({
    where: { compliancesubtypeid: complianceSubtypeId },
    select: {
      receive_payment: true,
      needs_work_allocation: true,
      isactive: true,
    },
  });

  return {
    receivePayment: row.receive_payment,
    needsWorkAllocation: row.needs_work_allocation,
    isactive: row.isactive,
  };
}

export async function getClientByName(name: string): Promise<{ clientid: string } | null> {
  const row = await getPrismaClient().client.findFirst({
    where: { name },
    select: { clientid: true },
  });
  return row ? { clientid: row.clientid } : null;
}

export async function createClientComplianceMap(clientId: string, complianceTypeId: string): Promise<void> {
  await getPrismaClient().clientcompliancemap.create({
    data: {
      clientid: clientId,
      compliancetypeid: complianceTypeId,
    },
  });
}

export async function getCaseState(caseId: string): Promise<{
  caseId: string;
  clientId: string;
  complianceTypeId: string;
  complianceSubtypeId: string | null;
  status: string;
  assignedTo: string | null;
  closedByUserId: string | null;
  paymentRequired: boolean;
  paymentStatus: string;
  paymentTotalDue: number;
  paymentTotalReceived: number;
  paymentOutstanding: number;
}> {
  const row = await getPrismaClient().renamedcase.findUniqueOrThrow({
    where: { caseid: caseId },
    select: {
      caseid: true,
      clientid: true,
      compliancetypeid: true,
      compliancesubtypeid: true,
      status: true,
      assignedto: true,
      closedbyuserid: true,
      payment_required: true,
      payment_status: true,
      payment_total_due: true,
      payment_total_received: true,
      payment_outstanding: true,
    },
  });

  return {
    caseId: row.caseid,
    clientId: row.clientid,
    complianceTypeId: row.compliancetypeid,
    complianceSubtypeId: row.compliancesubtypeid,
    status: row.status,
    assignedTo: row.assignedto,
    closedByUserId: row.closedbyuserid,
    paymentRequired: row.payment_required,
    paymentStatus: row.payment_status,
    paymentTotalDue: row.payment_total_due.toNumber(),
    paymentTotalReceived: row.payment_total_received.toNumber(),
    paymentOutstanding: row.payment_outstanding.toNumber(),
  };
}

export async function listCasesForCompliance(input: {
  complianceTypeId: string;
  complianceSubtypeId?: string | null;
  includeClosed?: boolean;
}): Promise<Array<{
  caseId: string;
  clientId: string;
  status: string;
  paymentRequired: boolean;
  paymentStatus: string;
}>> {
  const rows = await getPrismaClient().renamedcase.findMany({
    where: {
      compliancetypeid: input.complianceTypeId,
      compliancesubtypeid: input.complianceSubtypeId ?? null,
      ...(input.includeClosed ? {} : { status: { not: 'Closed' } }),
    },
    select: {
      caseid: true,
      clientid: true,
      status: true,
      payment_required: true,
      payment_status: true,
    },
    orderBy: { createdate: 'asc' },
  });

  return rows.map((row: any) => ({
    caseId: row.caseid,
    clientId: row.clientid,
    status: row.status,
    paymentRequired: row.payment_required,
    paymentStatus: row.payment_status,
  }));
}

export async function getClientComplianceSubtypeCases(clientId: string, complianceTypeId: string): Promise<Array<{
  caseId: string;
  complianceSubtypeId: string | null;
  paymentRequired: boolean;
  paymentStatus: string;
}>> {
  const rows = await getPrismaClient().renamedcase.findMany({
    where: { clientid: clientId, compliancetypeid: complianceTypeId },
    select: {
      caseid: true,
      compliancesubtypeid: true,
      payment_required: true,
      payment_status: true,
    },
    orderBy: { createdate: 'asc' },
  });

  return rows.map((row: any) => ({
    caseId: row.caseid,
    complianceSubtypeId: row.compliancesubtypeid,
    paymentRequired: row.payment_required,
    paymentStatus: row.payment_status,
  }));
}

export async function getCasePaymentHistory(caseId: string): Promise<Array<{
  paymentId: string;
  entryType: string;
  amountReceived: number;
  totalDue: number;
  totalReceived: number;
  outstanding: number;
  paymentStatus: string;
  note: string | null;
  receiptDocumentId: string | null;
  receiptDocumentName: string | null;
  isVoided: boolean;
  voidReason: string | null;
  correctsEntryId: string | null;
  createdAt: Date;
}>> {
  const rows = await getPrismaClient().casepayment.findMany({
    where: { caseid: caseId },
    orderBy: { createdate: 'desc' },
  });

  return rows.map((row: any) => ({
    paymentId: row.casepaymentid,
    entryType: row.entry_type,
    amountReceived: row.amount_received.toNumber(),
    totalDue: row.total_due.toNumber(),
    totalReceived: row.total_received.toNumber(),
    outstanding: row.outstanding.toNumber(),
    paymentStatus: row.payment_status,
    note: row.note,
    receiptDocumentId: row.receipt_document_id,
    receiptDocumentName: row.receipt_document_name,
    isVoided: row.is_voided,
    voidReason: row.void_reason,
    correctsEntryId: row.corrects_entry_id,
    createdAt: row.createdate,
  }));
}

export async function countPaymentEntries(caseId: string, options?: {
  nonVoidedOnly?: boolean;
  entryType?: string;
}): Promise<number> {
  return getPrismaClient().casepayment.count({
    where: {
      caseid: caseId,
      ...(options?.nonVoidedOnly ? { is_voided: false } : {}),
      ...(options?.entryType ? { entry_type: options.entryType } : {}),
    },
  });
}

export async function updatePaymentEntryCreatedAt(paymentId: string, createdAt: Date): Promise<void> {
  await getPrismaClient().casepayment.update({
    where: { casepaymentid: paymentId },
    data: { createdate: createdAt },
  });
}

export async function setCaseClosedByUser(caseId: string, closedByUserId: string | null): Promise<void> {
  await getPrismaClient().renamedcase.update({
    where: { caseid: caseId },
    data: { closedbyuserid: closedByUserId },
  });
}

export async function setCaseFixtureState(input: {
  caseId: string;
  status?: string;
  assignedToUserId?: string | null;
  closedByUserId?: string | null;
}): Promise<void> {
  await getPrismaClient().renamedcase.update({
    where: { caseid: input.caseId },
    data: {
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.assignedToUserId !== undefined ? { assignedto: input.assignedToUserId } : {}),
      ...(input.closedByUserId !== undefined ? { closedbyuserid: input.closedByUserId } : {}),
    },
  });
}

export async function disconnectTestDb(): Promise<void> {
  if (!prisma) {
    return;
  }

  await prisma.$disconnect();
  prisma = null;
}
