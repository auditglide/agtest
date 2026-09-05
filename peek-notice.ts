/** Opens a notice task's documents and saves them, so the notice's own tax period can be read before the
 *  financial year is set on it. Read-only. */
import { chromium } from '@playwright/test';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const ENV = join(__dirname, '.env.dev');
if (existsSync(ENV)) for (const l of readFileSync(ENV, 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/); if (m) process.env[m[1]] ??= m[2];
}
const BASE = process.env.BASE!, EMAIL = process.env.EMAIL!, PASSWORD = process.env.PASSWORD!;
const TASK = process.env.TASK_ID!;
const OUT = '/private/tmp/claude-501/-Users-shaina-Desktop-Manas-MyStuff-AuditGlide-code-auditglideapi/aafe716b-06de-430a-8852-bb53e2c40ab4/scratchpad/notice-docs';
mkdirSync(OUT, { recursive: true });

(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"], input[type="text"]').first().fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await page.getByRole('button', { name: /sign in|log ?in/i }).first().click();
  await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 40_000 });

  await page.goto(`${BASE}/notice-tasks/${TASK}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: join(OUT, 'task-detail.png'), fullPage: true });
  console.log((await page.locator('body').innerText()).replace(/\n{2,}/g, '\n').slice(0, 2500));
  await b.close();
})();
