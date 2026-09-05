/**
 * Takes ONE real notice on dev through the whole workflow, with the browser recorded.
 *
 *   npx tsx run-notice-e2e.ts                    (reads .env.dev for BASE / EMAIL / PASSWORD)
 *   TASK_ID=<uuid> npx tsx run-notice-e2e.ts     (force a particular notice)
 *
 * Read -> Rebuild -> Investigate -> Working papers -> Draft reply -> download the Word file.
 *
 * No GST OTP is needed anywhere in this walk. Reading the notice is a PDF job; Investigate runs off data
 * already pulled for the client and year; Rebuild degrades to "can't fetch" rather than failing when the
 * session is dead; Working papers and Draft reply never touch the portal. The one thing that DOES need a
 * session is pulling a source that was never fetched, and the script simply does not do that - it picks a
 * notice whose data is already there.
 *
 * It never opens the reply that was actually filed for the notice, so the letter that comes out is the
 * product's own answer rather than a copy of a CA's.
 *
 * IT STOPS AT THE FIRST REAL FAILURE. Anything on the critical path - the read producing issues, a figure
 * to compare, the Word file downloading - throws, with a screenshot and a plain sentence saying what was
 * expected and what was there instead. Only genuinely optional things are shrugged off, and each one is
 * written to the log so nothing is skipped quietly.
 *
 * Everything lands in auditglideRnD/e2e-run: the video, the .docx, a screenshot per step, and a log.
 */
import { chromium, type Page, type BrowserContext, type Locator } from '@playwright/test';
import { mkdirSync, writeFileSync, appendFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// ── settings ──────────────────────────────────────────────────────────────────────────────────────
const ENV_FILE = join(__dirname, '.env.dev');
if (existsSync(ENV_FILE)) {
  for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '');
  }
}
const OUT = '/Users/shaina/Desktop/Manas/MyStuff/AuditGlide/code/auditglideRnD/e2e-run';
const BASE = process.env.BASE ?? 'https://devapp.auditglide.com';
const EMAIL = process.env.EMAIL ?? '';
const PASSWORD = process.env.PASSWORD ?? '';
const FORCED_TASK = process.env.TASK_ID ?? '';
const FIND_CLIENT = process.env.CLIENT ?? '';
const FIND_TYPE = process.env.NOTICE_TYPE ?? 'ASMT-10';
const SET_FY = process.env.FY ?? '';   // only ever the year the notice itself names
const SLOW = Number(process.env.SLOW ?? 350);        // slow enough to follow on the video

mkdirSync(join(OUT, 'steps'), { recursive: true });
const LOG = join(OUT, 'run.log');
writeFileSync(LOG, `run started ${new Date().toISOString()}\nbase ${BASE}\n\n`);

let step = 0;
const say = (m: string) => { console.log(m); appendFileSync(LOG, m + '\n'); };
async function shot(page: Page, name: string) {
  step += 1;
  await page.screenshot({ path: join(OUT, 'steps', `${String(step).padStart(2, '0')}-${name}.png`), fullPage: true });
}
/** A caption burned onto the page for a moment, so the video says what is happening. */
async function narrate(page: Page, text: string) {
  say(`\n== ${text}`);
  await page.evaluate((t) => {
    const d = document.createElement('div');
    d.textContent = t;
    d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;background:#111;color:#fff;'
      + 'font:600 20px/1.5 system-ui;padding:14px 20px;text-align:center;letter-spacing:.2px';
    d.id = '__narration';
    document.getElementById('__narration')?.remove();
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 2600);
  }, text).catch(() => {});
  await page.waitForTimeout(1400);
}

/** Click a control if it is there; note it and carry on if it is not. Nothing here is worth failing over. */
async function tryClick(target: Locator, label: string, timeout = 4000): Promise<boolean> {
  try {
    await target.first().waitFor({ state: 'visible', timeout });
    await target.first().click();
    say(`  clicked ${label}`);
    await target.page().waitForTimeout(SLOW);
    return true;
  } catch { say(`  (${label} not available)`); return false; }
}
const btn = (page: Page, name: string | RegExp) => page.getByRole('button', { name });

/** The critical path. Stops the run, with a screenshot and a sentence saying what was expected. */
class Stopped extends Error {}
async function must(page: Page, target: Locator, label: string, timeout = 20_000) {
  try {
    await target.first().waitFor({ state: 'visible', timeout });
  } catch {
    await shot(page, 'stopped');
    throw new Stopped(`expected ${label}, and it never appeared`);
  }
  await target.first().click();
  say(`  clicked ${label}`);
  await page.waitForTimeout(SLOW);
}
async function mustSee(page: Page, target: Locator, label: string, timeout = 20_000) {
  try { await target.first().waitFor({ state: 'visible', timeout }); }
  catch { await shot(page, 'stopped'); throw new Stopped(`expected to see ${label}, and it was not there`); }
  say(`  saw ${label}`);
}

// ── the walk ──────────────────────────────────────────────────────────────────────────────────────

async function login(page: Page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await narrate(page, 'Signing in to AuditGlide');
  await page.locator('input[type="email"], input[type="text"]').first().fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await shot(page, 'login');
  await btn(page, /sign in|log ?in|continue/i).first().click();
  await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 40_000 });
  say(`  signed in, at ${page.url()}`);
  await shot(page, 'signed-in');
}

/** Find a notice task whose investigation is worth walking. */
async function openWorkspace(page: Page): Promise<string> {
  if (FORCED_TASK) {
    await page.goto(`${BASE}/notice-tasks/${FORCED_TASK}/investigation`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    return FORCED_TASK;
  }
  await narrate(page, 'Finding the notice to work on');
  await page.goto(`${BASE}/notices`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);

  // A named client: search for them, then take the row whose type is the one asked for.
  if (FIND_CLIENT) {
    await must(page, page.getByText('New, to acknowledge'), 'the Show filter');
    await must(page, page.getByRole('option', { name: 'All notices' }), 'the "All notices" option');
    await page.waitForTimeout(2500);
    // The Search box only filters the rows already on screen ("206 notices · 0 shown on this page"), so the
    // client has to be narrowed with the Clients filter, which asks the server.
    await must(page, page.getByText(/Select clients/i), 'the Clients filter');
    await page.waitForTimeout(1200);
    const search = page.getByPlaceholder(/search/i).last();
    await search.fill(FIND_CLIENT).catch(() => {});
    await page.waitForTimeout(2000);
    await shot(page, 'client-filter');
    await must(page, page.getByRole('option').or(page.locator('[role="option"], li, label')).filter({ hasText: new RegExp(FIND_CLIENT, 'i') }), `the client "${FIND_CLIENT}"`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(4000);
    await shot(page, 'notice-search');

    const rows = await page.locator('tbody tr').all();
    say(`  ${rows.length} notice(s) for "${FIND_CLIENT}"`);
    let opened = '';
    for (const r of rows) {
      const text = (await r.innerText().catch(() => '')).replace(/\s+/g, ' ');
      if (!text.includes(FIND_TYPE)) continue;
      const docs = text.match(/\b(\d+)\s+(?:Task created|View)/)?.[1];
      say(`  candidate: ${text.slice(0, 120)}`);
      const open = r.getByRole('button', { name: /task created/i });
      if (!(await open.isVisible().catch(() => false))) { say('    no task on this one'); continue; }
      if (docs === '0') { say('    no documents on this one'); continue; }
      await open.click();
      await page.waitForTimeout(3000);
      opened = page.url().match(/notice-tasks\/([0-9a-f-]{36})/i)?.[1] ?? '';
      if (opened) break;
    }
    if (!opened) { await shot(page, 'stopped'); throw new Stopped(`no ${FIND_TYPE} with a task and documents for "${FIND_CLIENT}"`); }
    await must(page, btn(page, /open investigation/i), 'Open investigation');
    await page.waitForTimeout(4000);
    if (await page.getByText(/Which financial year is this notice for/i).isVisible().catch(() => false)) {
      if (!SET_FY) {
        await shot(page, 'stopped');
        throw new Stopped('this notice has no financial year set - it must be set before it can be investigated');
      }
      // The year comes from the notice itself, never from a guess.
      await narrate(page, `Setting the year this notice covers: FY ${SET_FY}`);
      await must(page, page.getByText('Select FY'), 'the financial-year picker');
      await must(page, page.getByRole('option', { name: `FY ${SET_FY}` }), `FY ${SET_FY}`);
      await must(page, btn(page, /Set & continue/), 'Set & continue');
      await page.waitForTimeout(4000);
    }
    await mustSee(page, page.getByRole('button', { name: /Read/ }), 'the investigation workspace');
    say(`  using task ${opened}`);
    return opened;
  }

  // The list opens on "New, to acknowledge" - notices nobody has picked up, which by definition have no
  // task behind them. The ones worth walking are under "Task created".
  await must(page, page.getByText('New, to acknowledge'), 'the Show filter');
  await must(page, page.getByRole('option', { name: 'Task created' }), 'the "Task created" option');
  await page.waitForTimeout(3500);
  await shot(page, 'notices-with-tasks');

  const created = page.getByRole('button', { name: /task created/i });
  const n = await created.count();
  say(`  ${n} notices already have a task`);
  if (!n) { await shot(page, 'stopped'); throw new Stopped('no notice on this account has a task created yet'); }

  for (let i = 0; i < Math.min(n, 10); i += 1) {
    await page.goto(`${BASE}/notices`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(3000);
    await page.getByText('New, to acknowledge').first().click().catch(() => {});
    await page.getByRole('option', { name: 'Task created' }).first().click().catch(() => {});
    await page.waitForTimeout(3000);
    const row = page.getByRole('button', { name: /task created/i }).nth(i);
    if (!(await row.isVisible().catch(() => false))) break;
    await row.click();
    await page.waitForTimeout(3000);
    const taskId = page.url().match(/notice-tasks\/([0-9a-f-]{36})/i)?.[1];
    if (!taskId) { say(`  candidate ${i + 1}: did not open a task`); continue; }
    say(`  candidate ${i + 1}: task ${taskId}`);
    if (!(await tryClick(btn(page, /open investigation/i), 'Open investigation', 8000))) {
      say('    no "Open investigation" here, trying the next'); continue;
    }
    await page.waitForTimeout(3500);
    // The workspace only shows its tabs once the notice has a client AND a financial year.
    if (!(await page.getByRole('button', { name: /Read/ }).first().isVisible().catch(() => false))) {
      say(await page.getByText(/Which financial year is this notice for/i).isVisible().catch(() => false)
        ? '    no financial year set on this notice, trying the next'
        : '    the workspace did not open, trying the next');
      continue;
    }
    // And there is no point walking a notice with no PDF behind it - the AI would have nothing to read.
    await page.getByRole('button', { name: /^1?\s*Read$/ }).first().click().catch(() => {});
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: /Read the notice \(AI\)|Re-read notice/ }).first().click().catch(() => {});
    await page.waitForTimeout(1800);
    if (await page.getByText(/No documents attached to this notice/i).isVisible().catch(() => false)) {
      say('    no documents attached to this notice, trying the next');
      await page.getByRole('button', { name: /^Cancel$/ }).first().click().catch(() => {});
      continue;
    }
    const files = await page.getByRole('checkbox').count().catch(() => 0);
    say(`  using task ${taskId} (${files} document(s) attached)`);
    return taskId;
  }
  throw new Error('no notice task was ready to investigate');
}

const tab = (page: Page, name: RegExp) => btn(page, name).first();

async function doRead(page: Page) {
  await narrate(page, 'Step 1 of 5 - reading the notice with AI');
  await shot(page, 'read-before');

  // The picker is already open - choosing the notice left it up, which is how we knew it had documents.
  if (!(await page.getByText(/Which files are the notice/i).isVisible().catch(() => false))) {
    await must(page, btn(page, /Read the notice \(AI\)|Re-read notice/), 'Read the notice (AI)');
  }
  await shot(page, 'read-picker');
  await must(page, btn(page, /^Read \d+ files?$/), 'the Read files button in the picker', 15_000);
  say('  waiting for the AI read…');
  await page.getByText(/Reading the notice/i).first().waitFor({ state: 'hidden', timeout: 240_000 }).catch(() => {});
  await page.waitForTimeout(3000);
  await shot(page, 'read-result');
  if (await page.getByText('No claim read yet').first().isVisible().catch(() => false)) {
    await shot(page, 'stopped');
    throw new Stopped('the AI read finished but produced no issues');
  }

  await narrate(page, 'Confirming each issue against the notice');
  const confirms = page.getByText('Confirm', { exact: true });
  const c = await confirms.count();
  for (let i = 0; i < c; i += 1) {
    await confirms.nth(0).click().catch(() => {});     // the list re-renders as each is ticked
    await page.waitForTimeout(400);
  }
  say(`  confirmed ${c} issue(s)`);
  await tryClick(btn(page, /Save changes/), 'Save changes');
  await page.waitForTimeout(1200);
  await shot(page, 'read-confirmed');
}

async function doRebuild(page: Page) {
  await tryClick(btn(page, /Continue to Rebuild/), 'Continue to Rebuild') || await tryClick(tab(page, /Rebuild$/), 'Rebuild tab');
  await tryClick(btn(page, /Continue anyway/), 'Continue anyway (unconfirmed)', 3000);
  await page.waitForTimeout(2000);
  await narrate(page, "Step 2 of 5 — checking the officer's own arithmetic");
  await shot(page, 'rebuild-before');

  const rebuilds = btn(page, /Rebuild his figures|Rebuild again/);
  const n = await rebuilds.count();
  say(`  ${n} issue(s) can be rebuilt`);
  for (let i = 0; i < n; i += 1) {
    if (await rebuilds.nth(i).isEnabled().catch(() => false)) {
      await rebuilds.nth(i).click();
      await page.waitForTimeout(6000);
    }
  }
  await page.waitForTimeout(2000);
  await shot(page, 'rebuild-result');
  for (const s of ['His figures reconstruct', "His figures don’t match", 'Couldn’t fetch']) {
    if (await page.getByText(s).first().isVisible().catch(() => false)) say(`  outcome: ${s}`);
  }
}

async function doInvestigate(page: Page) {
  await tryClick(tab(page, /Investigate$/), 'Investigate tab');
  await page.waitForTimeout(3000);
  await narrate(page, 'Step 3 of 5 — checking the figures against the returns');
  await shot(page, 'investigate-open');

  // The strip that says which figure the notice points at is the surest way in.
  const pointer = page.locator('button', { hasText: /GSTR|Ledger/ }).filter({ hasNot: page.locator('svg.lucide-git-compare') });
  const strip = page.getByText(/The notice points at/i);
  if (await strip.isVisible().catch(() => false)) {
    say('  the notice points at a figure - starting there');
    await pointer.first().click().catch(() => {});
  } else {
    say('  no suggestion strip; choosing a figure by hand');
    await tryClick(page.getByText('Choose a return…'), 'Return picker');
    await page.getByRole('option').first().click().catch(() => {});
    await page.waitForTimeout(800);
    await tryClick(page.getByText(/^Choose…$/), 'Section picker');
    await page.getByRole('option').first().click().catch(() => {});
  }
  await page.waitForTimeout(5000);
  await mustSee(page, page.getByText(/Recommended comparisons/i), 'the recommended comparisons for that figure');
  await shot(page, 'investigate-cards');

  await narrate(page, 'Running every recommended comparison');
  await tryClick(btn(page, /^Re-run all$/), 'Re-run all');
  await page.waitForTimeout(6000);
  await shot(page, 'investigate-ran');

  await narrate(page, 'Saving what the comparisons found');
  const saves = btn(page, /^Save$/);
  const s = await saves.count();
  for (let i = 0; i < Math.min(s, 4); i += 1) { await saves.nth(0).click().catch(() => {}); await page.waitForTimeout(1800); }
  say(`  saved ${Math.min(s, 4)} finding(s)`);
  await shot(page, 'investigate-saved');

  await narrate(page, 'Choosing how to answer the notice');
  if (await tryClick(btn(page, /ways to answer|\d+ ways$/), 'ways to answer')) {
    await page.waitForTimeout(2500);
    await shot(page, 'ways-panel');
    // Take out anything a previous run left in, so the reply carries the arguments chosen NOW.
    const already = page.locator('[title="In the reply. Click to take it out."]');
    let out = 0;
    while (await already.count() > 0 && out < 20) { await already.first().click().catch(() => {}); await page.waitForTimeout(700); out += 1; }
    if (out) say(`  took out ${out} argument(s) left from an earlier run`);

    const include = page.locator('[title="Include this argument in the reply"]');
    const k = await include.count();
    for (let i = 0; i < Math.min(k, 3); i += 1) { await include.nth(0).click().catch(() => {}); await page.waitForTimeout(900); }
    say(`  ticked ${Math.min(k, 3)} argument(s) for the reply`);
    await shot(page, 'ways-chosen');
    await tryClick(btn(page, /^Done$/), 'Done');
  }
  await page.waitForTimeout(1500);
}

async function doWorkingPapers(page: Page) {
  await tryClick(tab(page, /Working papers$/), 'Working papers tab');
  await page.waitForTimeout(3000);
  await narrate(page, 'Step 4 of 5 — the working papers behind the reply');
  await shot(page, 'working-papers');
}

async function doDraft(page: Page, ctx: BrowserContext) {
  await tryClick(tab(page, /Draft reply$/), 'Draft reply tab');
  await page.waitForTimeout(4000);
  await narrate(page, 'Step 5 of 5 — the draft reply');
  await shot(page, 'draft-open');

  // Fill by the box's own LABEL, never by guessing from its placeholder. The first run of this script wrote
  // a product name into the client's address because it matched on shape rather than on meaning.
  await narrate(page, 'Filling in what only the client can know');
  const ANSWERS: [string, RegExp, string][] = [
    ['Client address', /^Client address$/i, '3/145 Mettupalayam Road, Pollachi, Tamil Nadu 642001'],
    ['Officer designation', /^Officer designation$/i, 'Assistant Commissioner (ST)'],
    ['Circle', /^Circle$/i, 'Pollachi Rural Circle'],
  ];
  const filled: string[] = [];
  for (const [name, label, value] of ANSWERS) {
    const box = page.locator('label').filter({ hasText: label }).locator('input').first();
    if (!(await box.isVisible().catch(() => false))) { say(`  (no "${name}" box on this letter)`); continue; }
    // Overwrite whatever is there: the draft persists between runs, and an earlier run of this script put
    // the wrong thing in the address.
    const was = await box.inputValue().catch(() => '');
    if (was === value) { say(`  ("${name}" already correct)`); continue; }
    await box.fill(value); await box.blur();
    if (was) say(`  (replaced "${was.slice(0, 40)}")`);
    filled.push(`${name} = ${value}`);
    await page.waitForTimeout(800);
  }
  say(`  filled ${filled.length} heading field(s):`); filled.forEach((f) => say(`     ${f}`));

  // Clear anything an earlier run typed into the evidence tables. Nothing is invented for them here: a
  // working paper is the CA's to produce, and a made-up figure in one is worse than an empty grid.
  const cells = page.locator('table input');
  let cleared = 0;
  for (let i = 0; i < await cells.count(); i += 1) {
    const c = cells.nth(i);
    if (!(await c.isVisible().catch(() => false))) continue;
    if ((await c.inputValue().catch(() => '')) === '') continue;
    await c.fill(''); await c.blur(); cleared += 1;
    await page.waitForTimeout(400);
  }
  if (cleared) say(`  cleared ${cleared} table cell(s) left from an earlier run`);
  await page.waitForTimeout(1500);
  await shot(page, 'draft-filled');
  await shot(page, 'draft-filled');

  await page.getByText(/left before this can go out|Ready to send/).first().scrollIntoViewIfNeeded().catch(() => {});
  await shot(page, 'draft-blockers');

  await narrate(page, 'Downloading the letter as a Word file');
  const dl = page.waitForEvent('download', { timeout: 120_000 });
  await must(page, btn(page, /Download as Word/), 'Download as Word');
  const file = await dl.catch(async () => {
    await shot(page, 'stopped');
    throw new Stopped('Download as Word was pressed but no file came back');
  });
  const name = file.suggestedFilename();
  await file.saveAs(join(OUT, name));
  say(`  downloaded ${name}`);
  await page.waitForTimeout(2000);
  await shot(page, 'draft-downloaded');
  return name;
}

// ── run ───────────────────────────────────────────────────────────────────────────────────────────
async function main() {
  if (!EMAIL || !PASSWORD) throw new Error(`set BASE / EMAIL / PASSWORD in ${ENV_FILE}`);
  const browser = await chromium.launch({ headless: true, slowMo: SLOW });
  const context = await browser.newContext({
    viewport: { width: 1500, height: 950 },
    recordVideo: { dir: join(OUT, 'video'), size: { width: 1500, height: 950 } },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') say(`  [browser] ${m.text().slice(0, 160)}`); });
  page.on('pageerror', (e) => say(`  [page error] ${String(e).slice(0, 160)}`));

  let docx = '';
  try {
    await login(page);
    const taskId = await openWorkspace(page);
    say(`\nWALKING TASK ${taskId}\n${page.url()}`);
    await doRead(page);
    await doRebuild(page);
    await doInvestigate(page);
    await doWorkingPapers(page);
    docx = await doDraft(page, context);
    await narrate(page, 'Done: notice read, figures checked, reply drafted and downloaded');
  } catch (e) {
    say(`\n*** STOPPED HERE: ${(e as Error).message}`);
    say(`    the page was ${page.url()}`);
    await shot(page, 'failure').catch(() => {});
  } finally {
    await context.close();
    await browser.close();
    say(`\nfinished. word file: ${docx || '(none)'}`);
  }
}
main();
