import { createHash, randomBytes } from 'crypto';

type PrismaClientLike = {
  emailVerification: {
    create(args: {
      data: {
        tokenhash: string;
        email: string;
        firmname: string;
        adminname: string;
        expiresat: Date;
        isused?: boolean;
      };
    }): Promise<unknown>;
    deleteMany(args: {
      where: {
        tokenhash?: string;
        email?: string;
      };
    }): Promise<unknown>;
  };
  $disconnect(): Promise<void>;
};

let prisma: PrismaClientLike | null = null;

function getTestDbUrl(): string {
  const url = process.env.TEST_DB_URL ?? '';
  if (!url) {
    throw new Error('TEST_DB_URL must be set to use DB-backed onboarding token fixtures.');
  }
  return url;
}

function sha256hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function getPrismaClient(): PrismaClientLike {
  if (prisma) {
    return prisma;
  }

  // Reuse the Prisma client already installed with auditglideapi.
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

export interface VerificationTokenFixture {
  rawToken: string;
  tokenHash: string;
  email: string;
}

export async function seedVerificationTokenFixture(input: {
  email: string;
  firmName?: string;
  adminName?: string;
  expiresAt: Date;
  isUsed?: boolean;
}): Promise<VerificationTokenFixture> {
  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = sha256hex(rawToken);

  try {
    await getPrismaClient().emailVerification.create({
      data: {
        tokenhash: tokenHash,
        email: input.email,
        firmname: input.firmName ?? `E2E Firm ${Date.now()}`,
        adminname: input.adminName ?? 'E2E Admin',
        expiresat: input.expiresAt,
        isused: input.isUsed ?? false,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/Authentication failed against database server/i.test(message)) {
      throw new Error(
        [
          'DB-backed onboarding token fixtures could not authenticate through TEST_DB_URL.',
          `Current TEST_DB_URL: ${getTestDbUrl()}`,
          'Your SSH tunnel may be up, but the remote Postgres username/password in TEST_DB_URL are not valid for that server.',
          'Use the same database credentials the remote app server uses, but keep the host/port as 127.0.0.1:5433 while the SSH tunnel is running.',
        ].join('\n'),
      );
    }
    throw error;
  }

  return {
    rawToken,
    tokenHash,
    email: input.email,
  };
}

export async function cleanupVerificationTokenFixture(fixture: VerificationTokenFixture): Promise<void> {
  try {
    await getPrismaClient().emailVerification.deleteMany({
      where: {
        tokenhash: fixture.tokenHash,
      },
    });
  } catch {
    // Ignore cleanup failures so tests can report the original assertion error.
  }
}

export async function disconnectOnboardingTestDb(): Promise<void> {
  if (!prisma) {
    return;
  }

  await prisma.$disconnect();
  prisma = null;
}
