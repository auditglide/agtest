# Test plans

Hand-written test plans for testers, as Markdown, rendered to PDF.

| File | What it is |
|---|---|
| `phase2-checklist.md` | Every Phase 2 feature as a tick list. Printed and filled in |
| `phase2-workflows.md` | How to test each one, step by step, in the order a CA would work |
| `pdf/` | The rendered PDFs. **Committed**, so a tester can pick one up without running anything |

## Editing

Edit the Markdown, never the PDF. Then re-render:

```bash
node testplans/render.mjs                    # both
node testplans/render.mjs phase2-checklist   # just one
```

Commit the `.md` and the regenerated `.pdf` together, or the two drift apart and somebody tests from
a stale printout.

`- [ ] something` becomes a real tick box in the PDF. A `>` quote becomes the tinted "what you should
see" panel that the workflow guide leans on.

## Why the PDFs are in `pdf/` and not `dist/`

This repo gitignores `dist/`. These PDFs are the deliverable, so they have to be committed.

## The Markdown parser

`render.mjs` borrows `markdown-it` from the `userguide` repo next door rather than adding a dependency
here, since this is a Playwright repo that otherwise has no use for one. If that folder ever moves, the
renderer falls back to plain text rather than failing, so a PDF still comes out.
