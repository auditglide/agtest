/**
 * Which notices on dev are actually ready to be investigated end to end?
 *
 * Two things have to be true and they are unrelated: the notice must carry its own PDF (or the AI has
 * nothing to read), and the client's returns must already be pulled for the year (or Investigate can only
 * say "waiting for this source"). This lists the notices where both hold.
 *
 * Read-only. Signs in through the UI to borrow the session, then asks the API directly.
 */
import { chromium } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const ENV = join(__dirname, '.env.dev');
if (existsSync(ENV)) for (const l of readFileSync(ENV, 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/); if (m) process.env[m[1]] ??= m[2];
}
const BASE = process.env.BASE!, EMAIL = process.env.EMAIL!, PASSWORD = process.env.PASSWORD!;

type Notice = {
  gstCaseId: string; gstin: string; clientId: string | null; clientName: string | null;
  type: string | null; description: string | null; noticeDate: string | null; taxPeriods: string | null;
  documentCount: number; reviewStatus: string; noticeTaskId?: string | null;
};

(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();

  // Borrow the app's own credentials off a real request - the access token is held in memory, not storage.
  let auth = '', apiKey = '', api = '';
  page.on('request', (r) => {
    const h = r.headers();
    if (h['authorization'] && !auth) { auth = h['authorization']; apiKey = h['x-api-key'] ?? ''; api = new URL(r.url()).origin; }
  });

  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"], input[type="text"]').first().fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await page.getByRole('button', { name: /sign in|log ?in/i }).first().click();
  await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 40_000 });
  await page.waitForTimeout(4000);
  if (!auth) { console.log('could not borrow a session'); await b.close(); return; }

  const get = async (path: string) => {
    const r = await page.request.get(`${api}${path}`, { headers: { authorization: auth, 'x-api-key': apiKey } });
    if (!r.ok()) return null;
    return r.json();
  };

  // 1. Every notice that carries its own documents.
  const all: Notice[] = [];
  for (let p = 1; p <= 12; p += 1) {
    const res = await get(`/notices?page=${p}&pageSize=100&reviewStatus=all`);
    const items: Notice[] = res?.notices ?? res?.items ?? res?.data ?? [];
    if (!items.length) break;
    all.push(...items);
    if (items.length < 100) break;
  }
  const withDocs = all.filter((n) => (n.documentCount ?? 0) > 0 && n.clientId);
  console.log(`${all.length} notices, ${withDocs.length} of them carry documents\n`);

  // 2. Which years each of those clients actually has data for.
  const clients = [...new Map(withDocs.map((n) => [n.clientId!, n])).values()];
  const years = new Map<string, string[]>();
  for (const c of clients) {
    const r = await get(`/gst-investigation/fys?clientId=${c.clientId}`);
    years.set(c.clientId!, r?.fys ?? []);
  }

  // 3. One client's scrutiny/demand notices in full, with their task and tax period.
  const WHO = process.env.WHO ?? '';
  for (const n of withDocs) {
    if (WHO && !(n.clientName ?? '').toUpperCase().includes(WHO.toUpperCase())) continue;
    if (!/SCRUTINY|DETERMINATION|ASMT|DRC/i.test(`${n.type ?? ''} ${n.description ?? ''}`)) continue;
    console.log(JSON.stringify({
      case: n.gstCaseId, date: (n.noticeDate ?? '').slice(0, 10), docs: n.documentCount,
      period: n.taxPeriods, status: n.reviewStatus, task: (n as unknown as { noticeTaskId?: string }).noticeTaskId ?? null,
      what: `${n.type ?? ''} ${n.description ?? ''}`.replace(/\s+/g, ' ').trim().slice(0, 70),
    }));
  }
  await b.close();
})();
