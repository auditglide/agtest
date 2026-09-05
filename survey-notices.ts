/** Dumps the notices that already have a task, with their document count, so a candidate can be chosen
 *  deliberately rather than by trying one after another. Read-only. */
import { chromium } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const ENV = join(__dirname, '.env.dev');
if (existsSync(ENV)) for (const l of readFileSync(ENV, 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/); if (m) process.env[m[1]] ??= m[2];
}
const BASE = process.env.BASE!, EMAIL = process.env.EMAIL!, PASSWORD = process.env.PASSWORD!;

(async () => {
  const b = await chromium.launch({ headless: true });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"], input[type="text"]').first().fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await page.getByRole('button', { name: /sign in|log ?in/i }).first().click();
  await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 40_000 });

  await page.goto(`${BASE}/notices`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  await page.getByText('New, to acknowledge').first().click();
  await page.getByRole('option', { name: 'All notices' }).first().click();
  await page.waitForTimeout(4000);

  const withDocs: string[] = [];
  for (let pageNo = 1; pageNo <= 12; pageNo += 1) {
    for (const r of await page.locator('tbody tr').all()) {
      const cells = (await r.locator('td').allInnerTexts()).map((c) => c.replace(/\s+/g, ' ').trim());
      const docs = cells.find((c) => /^\d+$/.test(c));
      if (docs && docs !== '0') withDocs.push(`p${pageNo}  ${cells.filter(Boolean).join('  |  ').slice(0, 200)}`);
    }
    const next = page.getByRole('button', { name: '' }).last();
    const label = await page.getByText(/Page \d+ of \d+/).first().innerText().catch(() => '');
    console.log(`  scanned ${label || `page ${pageNo}`}`);
    const [cur, total] = (label.match(/Page (\d+) of (\d+)/) ?? []).slice(1).map(Number);
    if (cur && total && cur >= total) break;
    await next.click().catch(() => {});
    await page.waitForTimeout(2500);
  }
  console.log(`\n${withDocs.length} notices HAVE documents attached:\n`);
  withDocs.forEach((r) => console.log(r));
  await b.close();
})();
