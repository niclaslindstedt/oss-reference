---
name: Visual snapshot rebaseline workflow
description: How and when to re-record Playwright visual baselines after a UI change. Triggers when editing rendered components, styles, snapshotted CV copy, or visual tests.
paths:
  - "src/styles/**"
  - "src/components/**"
  - "src/data/cv.json"
  - "src/data/cv/**"
  - "tests/visual/**"
  - "playwright.config.ts"
---

# Visual snapshots

The Visual workflow (`tests/visual/`) does strict pixel comparison
against PNGs committed under `tests/visual/__screenshots__/`.
Threshold is `maxDiffPixelRatio: 0.01` in `playwright.config.ts`.
Baselines were recorded on Linux and CI runs on `ubuntu-latest` —
re-recording on macOS or Windows produces sub-pixel font drift that
fails CI on the next run.

## When to expect baselines need updating

Treat any of these as a guaranteed rebaseline before pushing:

- **Text edits to rendered copy** in `src/data/cv.json` or
  `src/data/cv/*.json` — `tagline`, `description`, `summary`,
  `area`, `name`, project copy, anything that ends up inside a
  snapshotted view. Reflow alone trips the threshold.
- **Style changes** under `src/styles/` (tokens, layout, typography,
  color, spacing, motion, component CSS).
- **Component changes** — adding, removing, reordering, or
  restructuring sections, cards, or fields.
- **Dependency bumps** that ship glyphs or rendering (`@fontsource/*`,
  `playwright` — Playwright updates can bring a new bundled
  Chromium).

Snapshot → source quick map (the `debug-visual` skill has the full
table and diagnostic procedure):

| Snapshot family                                  | Driven by                                                                 |
| ------------------------------------------------ | ------------------------------------------------------------------------- |
| `hero-{en,sv}-{dark,light}`                      | `Hero.tsx`, `hero.css`, `cv.json` (`name`, `summary`, `tagline`, `links`) |
| `focus-{en,sv}-{dark,light}` (section card grid) | `Focus.tsx`, `focus.css`, `cv/focus.json` (`tagline`, `since`, `area`)    |
| `modal-focus-*` (skill modal body)               | `cv/focus.json` `description` text in particular                          |
| `homepage-*` (full above-fold page)              | Anything above the fold — collateral from hero / focus / token changes    |

## Workflow

When you make a change that the list above flags as visual:

1. `make build && CI=1 npm run test:visual` — use `CI=1` so retries
   and worker count match GitHub Actions.
2. If failures match the change's intent and **only those**
   snapshots failed, regenerate:
   `CI=1 npm run test:visual:update` (alias of `make test-visual-update`).
3. Re-run `CI=1 npm run test:visual` to confirm a clean pass.
4. `git status --short` must show **only** modified `*.png` files
   under `tests/visual/__screenshots__/`. Anything else means the
   tree was dirty — revert the noise before committing.
5. Commit the rebaseline as its own `test(visual): …` commit
   referencing the change that drove it (don't fold it into the
   feature commit — keeps the diff legible). Push and let CI
   confirm.

For predictable changes (text rewrites, isolated CSS retunes), do
this proactively before pushing the feature commit. For ambiguous
or cascading failures, invoke the `debug-visual` skill instead of
re-recording blind.

## Scoping a run

`test:visual` and `test:visual:update` pass extra arguments straight
through to `playwright test`, so when you know which snapshots a
change touches you can run (and rebaseline) just those instead of
the full suite. Three filters, combinable:

- **By file** — `npm run test:visual -- tests/visual/modals.test.ts`
  runs only the modals spec.
- **By test title** (`-g` / `--grep`) — `npm run test:visual -- -g "hero"`
  matches the strings inside `test("…")`. Examples of titles in the
  current suite: `hero — en / dark`, `skill modal — en / dark`,
  `search modal (results) — en / dark`, `experience section — en / dark`,
  `full page — en / dark (above the fold)`.
- **By project** — `--project chromium-desktop` or
  `--project chromium-mobile` limits the viewport.

The same flags work for updating: e.g.
`CI=1 npm run test:visual:update -- tests/visual/modals.test.ts -g "skill" --project chromium-desktop`
rebaselines just `skill modal — en / dark` on desktop. After a
scoped update, still run the full `CI=1 npm run test:visual` once
before pushing to confirm nothing else drifted, and keep the
`git status --short` guardrail — only the intended `*.png` files
should appear.

Use scoping when you're confident the change is local (a single
modal's copy, one section's CSS). For ambiguous or cascading
changes, run the full suite — partial rebaselines hide drift in
snapshots you didn't think to include.

## Guardrails

- **Linux only for re-recording.** Other OSes will fail CI.
- **Never re-record on a dirty tree.** The rebaseline commit must
  contain only `*.png` modifications under `tests/visual/__screenshots__/`.
- **Never re-record to silence a regression.** If a snapshot the
  change shouldn't affect is failing, inspect the diff PNGs in
  `test-results/` and fix the code.
- **Don't widen `maxDiffPixelRatio`** or disable retries to make CI
  green. The 0.01 tolerance is calibrated for sub-pixel font noise.
