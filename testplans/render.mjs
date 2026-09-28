/**
 * Turn the test plan Markdown into PDFs the testers can be handed.
 *
 *   node testplans/render.mjs            # every .md in this folder
 *   node testplans/render.mjs phase2-checklist
 *
 * Output: testplans/pdf/<name>.pdf. NOT dist/, which this repo gitignores - these PDFs are the
 * deliverable and have to be committed so a tester can pick one up without running anything.
 *
 * markdown-it comes from the userguide repo next door rather than being added as a dependency here:
 * this is a Playwright test repo and does not otherwise need a Markdown parser. If that folder is ever
 * moved, the fallback below renders the document as plain text rather than failing outright, so the
 * PDF still exists.
 */
import { readdirSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'pdf');
const USERGUIDE_MD = join(here, '..', '..', 'userguide', 'node_modules', 'markdown-it', 'index.mjs');

async function loadRenderer() {
  if (existsSync(USERGUIDE_MD)) {
    const { default: MarkdownIt } = await import(pathToFileURL(USERGUIDE_MD).href);
    const md = new MarkdownIt({ html: false, linkify: true, typographer: false });
    // markdown-it leaves "- [ ] foo" as the literal text "[ ] foo". These documents are printed and
    // ticked with a pen, so turn them into real boxes.
    return (src) => md.render(src).replace(/<li>\[ \]\s*/g, '<li class="tick">');
  }
  console.warn('! markdown-it not found next door; rendering as plain text.');
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  return (src) => `<pre class="fallback">${esc(src)}</pre>`;
}

/* Deliberately plain and printable: this gets printed, ticked with a pen, and scanned back. */
const CSS = `
  @page { size: A4; margin: 16mm 14mm 18mm; }
  * { box-sizing: border-box; }
  body { font: 10.5pt/1.5 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         color: #0f172a; margin: 0; }
  h1 { font-size: 21pt; margin: 0 0 2mm; letter-spacing: -0.2pt; }
  h1 + p > strong:first-child { font-size: 12pt; }
  h2 { font-size: 14pt; margin: 9mm 0 2.5mm; padding-bottom: 1.5mm;
       border-bottom: 1.5pt solid #1e293b; break-after: avoid; }
  h3 { font-size: 11.5pt; margin: 5mm 0 1.5mm; color: #1e293b; break-after: avoid; }
  h4 { font-size: 10.5pt; margin: 4mm 0 1mm; break-after: avoid; }
  p, li { orphans: 2; widows: 2; }
  ul, ol { padding-left: 6mm; margin: 1.5mm 0; }
  li { margin: 0.8mm 0; }
  strong { color: #0b1220; }
  code { font: 9.5pt ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
         background: #f1f5f9; padding: 0.3mm 1mm; border-radius: 2px; }
  pre.fallback { font: 9pt/1.45 ui-monospace, Menlo, monospace; white-space: pre-wrap; }
  table { border-collapse: collapse; width: 100%; margin: 2.5mm 0 4mm; font-size: 9.5pt;
          break-inside: avoid; }
  th { text-align: left; background: #f1f5f9; border: 0.5pt solid #cbd5e1;
       padding: 1.6mm 2mm; font-weight: 700; }
  td { border: 0.5pt solid #e2e8f0; padding: 1.6mm 2mm; vertical-align: top; }
  blockquote { margin: 2mm 0 3mm; padding: 2mm 0 2mm 4mm; border-left: 2.5pt solid #94a3b8;
               background: #f8fafc; break-inside: avoid; }
  blockquote p { margin: 0 0 1.5mm; }
  blockquote p:last-child { margin-bottom: 0; }
  blockquote table { margin: 2mm 0; background: #fff; }
  hr { border: 0; border-top: 0.5pt solid #cbd5e1; margin: 6mm 0; }
  /* The tick boxes. Printed and filled in by hand, so they have to be big enough to see. */
  li.tick { list-style: none; margin-left: -5mm; padding-left: 0; }
  li.tick::before {
    content: ""; display: inline-block; width: 3.4mm; height: 3.4mm; margin-right: 2.4mm;
    border: 0.8pt solid #64748b; border-radius: 1px; vertical-align: -0.4mm; }
`;

const HEADER = (title) => `
  <div style="font:8pt -apple-system,Segoe UI,sans-serif;color:#64748b;width:100%;
              padding:0 14mm;display:flex;justify-content:space-between;">
    <span>AuditGlide &middot; ${title}</span><span>${new Date().toISOString().slice(0, 10)}</span>
  </div>`;

const FOOTER = `
  <div style="font:8pt -apple-system,Segoe UI,sans-serif;color:#64748b;width:100%;
              padding:0 14mm;text-align:right;">
    Page <span class="pageNumber"></span> of <span class="totalPages"></span>
  </div>`;

const only = process.argv[2];
const files = readdirSync(here)
  .filter((f) => f.endsWith('.md'))
  .filter((f) => !only || basename(f, '.md') === only);

if (files.length === 0) {
  console.error(only ? `No testplans/${only}.md` : 'No .md files in testplans/');
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
const render = await loadRenderer();
const browser = await chromium.launch();
try {
  for (const file of files) {
    const name = basename(file, '.md');
    const src = readFileSync(join(here, file), 'utf8');
    const title = (src.match(/^#\s+(.+)$/m) ?? [, name])[1];
    const page = await browser.newPage();
    await page.setContent(
      `<!doctype html><meta charset="utf-8"><title>${title}</title><style>${CSS}</style>${render(src)}`,
      { waitUntil: 'load' },
    );
    const out = join(outDir, `${name}.pdf`);
    await page.pdf({
      path: out, format: 'A4', printBackground: true,
      displayHeaderFooter: true, headerTemplate: HEADER(title), footerTemplate: FOOTER,
      margin: { top: '18mm', bottom: '16mm', left: '14mm', right: '14mm' },
    });
    await page.close();
    console.log(`✓ ${out}`);
  }
} finally {
  await browser.close();
}
