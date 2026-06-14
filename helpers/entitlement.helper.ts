/**
 * T4 — entitlement seeding for E2E. Sets/clears a firm's plan, module overrides, limits and
 * trial expiry directly in the DB (reusing the API's Prisma client), so the FE's gating,
 * upsell, Plan & Usage meters and trial banner can be exercised.
 *
 * NOTE: these mutate the SHARED admin firm. The entitlements spec runs SERIALLY and restores
 * state in afterEach; run it on its own (not concurrently with the rest of the suite).
 */
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-var-requires */
import { getUserByEmail } from './test-db.helper';

let prisma: any;
function db(): any {
  if (!prisma) {
    const url = process.env.TEST_DB_URL ?? '';
    if (!url) throw new Error('TEST_DB_URL must be set for entitlement seeding.');
    const { PrismaClient } = require('../../auditglideapi/node_modules/@prisma/client');
    prisma = new PrismaClient({ datasources: { db: { url } } });
  }
  return prisma;
}

export async function adminFirmId(): Promise<string> {
  const u = await getUserByEmail(process.env.TEST_ADMIN_EMAIL ?? '');
  if (!u) throw new Error('TEST_ADMIN_EMAIL user not found in the DB.');
  return u.firmid;
}

/** Force a module on/off for the firm (null = remove the override → back to default). */
export async function setModule(firmId: string, key: string, enabled: boolean | null): Promise<void> {
  if (enabled === null) {
    await db().firmModule.deleteMany({ where: { firmid: firmId, module_key: key } });
  } else {
    await db().firmModule.upsert({
      where: { firmid_module_key: { firmid: firmId, module_key: key } },
      create: { firmid: firmId, module_key: key, enabled },
      update: { enabled },
    });
  }
}

export async function setLimit(firmId: string, metric: string, limit: number, period = 'plan'): Promise<void> {
  await db().firmLimit.upsert({
    where: { firmid_metric_key: { firmid: firmId, metric_key: metric } },
    create: { firmid: firmId, metric_key: metric, limit_value: limit, period },
    update: { limit_value: limit, period },
  });
}

export async function setPlan(firmId: string, code: string | null): Promise<void> {
  let planId: string | null = null;
  if (code) {
    const p = await db().plan.findUnique({ where: { code }, select: { plan_id: true } });
    planId = p?.plan_id ?? null;
  }
  await db().firm.update({ where: { firmid: firmId }, data: { plan_id: planId } });
}

export async function setPlanExpiry(firmId: string, when: Date | null): Promise<void> {
  await db().firm.update({ where: { firmid: firmId }, data: { plan_expires_at: when } });
}

/** Restore the firm to no overrides (free modules stay on via the resolver's defaults). */
export async function clearEntitlements(firmId: string): Promise<void> {
  await db().firmModule.deleteMany({ where: { firmid: firmId } });
  await db().firmLimit.deleteMany({ where: { firmid: firmId } });
  await db().firm.update({ where: { firmid: firmId }, data: { plan_id: null, plan_expires_at: null } });
}
