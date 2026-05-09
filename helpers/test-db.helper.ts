type PrismaClientLike = {
  renamedcase: {
    update(args: {
      where: { caseid: string };
      data: { status?: string; assignedto?: string | null; closedbyuserid?: string | null };
    }): Promise<unknown>;
  };
  $disconnect(): Promise<void>;
};

let prisma: PrismaClientLike | null = null;

function getTestDbUrl(): string {
  const url = process.env.TEST_DB_URL ?? '';
  if (!url) {
    throw new Error('TEST_DB_URL must be set to use DB-backed case fixtures.');
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

export async function setCaseClosedByUser(caseId: string, closedByUserId: string | null): Promise<void> {
  await getPrismaClient().renamedcase.update({
    where: { caseid: caseId },
    data:  { closedbyuserid: closedByUserId },
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
    data:  {
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
