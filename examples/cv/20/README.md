# cv §20 — Frontend testing (visual regression + end-to-end)

Reference implementation of [OSS_SPEC.md §20](../../../OSS_SPEC.md) as it
appears in [cv](https://github.com/niclaslindstedt/cv) at commit `1c98b0c`.

cv is a Vite + React + TypeScript single-page site, so its tests under
`tests/` are mostly browser-driven: visual regression against pixel
baselines, plus a stack of end-to-end suites that exercise the rendered
page under real Chromium. This example covers the **frontend** half of
that suite — three Playwright configs and the specs they discover — plus
the two `.claude/rules/` files that tell agents how to keep the visual
baselines honest.

Out of scope for this showcase: the Vitest layer (`tests/unit/`,
`tests/data/`) and the pure-Node tooling around it. §20's mandate
(separate test files, naming convention, location) applies to both, but
the visual + end-to-end stack is the part with non-trivial structure;
the Vitest setup is a near-default `vitest.config.ts` and idiomatic
`*.test.ts` files.

## File layout

```
playwright.config.ts                          # visual regression — testDir: tests/visual
playwright.a11y.config.ts                     # PR-blocking axe scan — testDir: tests/a11y
playwright.a11y-manual.config.ts              # local-only WCAG checks — testDir: tests/a11y-manual

tests/
  visual/
    site.test.ts                              # hero + section snapshots across lang × theme
    modals.test.ts                            # one snapshot per modal variant (search, skill, ects, …)
  a11y/
    site.test.ts                              # static axe scan on home + timeline + print HTML
    interactions.test.ts                      # opens every modal, asserts focus trap + Escape closes
  a11y-manual/
    reflow.test.ts                            # SC 1.4.10 — no horizontal scroll @ 320×256 CSS px
    resize-text.test.ts                       # SC 1.4.4 — no clipping at 200% root font
    focus-not-obscured.test.ts                # SC 2.4.11 — tab through and probe each focus rect
    interactions.test.ts                      # focus-return after Escape, dialog name, reduced-motion
    timeline.test.ts                          # custom-widget keyboard ops (zoom, pan, details panel)

.claude/rules/
  visual-snapshots.md                         # **agent rebaseline playbook (the visual-regression manual)**
  tests.md                                    # per-domain rule file: what each suite covers, gating posture
```

Three Playwright configs because the three suites have different gating
postures and different setups; one config with three projects would fold
all three into the same retry / reporter / port shape, which is exactly
the wrong default for "PR-blocking visual" vs. "PR-blocking axe" vs.
"local-only manual". The visual baseline PNGs (`tests/visual/__screenshots__/`)
are **not** copied here — they live next to the specs upstream and are
regenerated locally per `.claude/rules/visual-snapshots.md`.

## How this sits in cv

- **Repo root.** Both Playwright configs and the Vitest config live at
  the repo root alongside `package.json`; tests live under `tests/` at
  the root, split into per-domain subdirectories (`data/`, `unit/`,
  `visual/`, `a11y/`, `a11y-manual/`). cv is a single-package Vite app,
  so there's no monorepo wrapping to push the configs deeper.
- **Three configs, three ports.** Each Playwright config pins its own
  preview port (`PLAYWRIGHT_PORT=4173` for visual, `4174` for a11y,
  `4175` for a11y-manual) and starts its own `npm run preview` web
  server. The three suites can therefore run in parallel locally
  without colliding on the default Vite preview port. In CI, each
  config gets its own workflow file (`.github/workflows/visual.yml`,
  `a11y.yml`, plus the deep `a11y-deep.yml` that drives pa11y) and the
  three jobs each rebuild the site from scratch.
- **Visual: pixel-exact, Linux-only baselines.** `playwright.config.ts`
  sets `maxDiffPixelRatio: 0.01` (sub-pixel font-rendering tolerance)
  and pins two viewports — `chromium-desktop` (1280×800) and
  `chromium-mobile` (390×844, `isMobile: true`, `hasTouch: true`). The
  PNGs in `tests/visual/__screenshots__/` were recorded on Linux and
  CI runs on `ubuntu-latest` for the same reason. Re-recording on macOS
  or Windows produces drift that fails the next CI run; the agent rule
  in `.claude/rules/visual-snapshots.md` calls this out as a hard
  guardrail.
- **What the specs do to stay deterministic.** `tests/visual/site.test.ts`
  and `modals.test.ts` are worth reading top-to-bottom for the
  determinism playbook: `page.clock.install({ time: FIXED_TIME })` so
  the footer year doesn't drift, `STABILIZE_CSS` to kill transitions /
  animations / `caret-color` / `backdrop-filter` (the headless
  compositor renders blurs differently from a desktop GPU and the drift
  was 2–12% on modal snapshots), `document.fonts?.ready` before the
  first capture, the `.celestial-sky, canvas { visibility: hidden }`
  rule to neutralise the RAF-painted starfield, and a
  `SECTION_OVERLAY_CSS` block that hides `.skip-link`,
  `.floating-controls`, and `.project-dates` so element-screenshots of
  tall sections (which Playwright scrolls and stitches) don't show
  fixed-position UI in two different places. Every line in those CSS
  blocks earned itself with a flake.
- **A11y: AA gates, AAA advises.** `tests/a11y/site.test.ts` runs two
  axe passes per variant. The AA pass (`wcag2a`/`wcag2aa`/`wcag21a`/
  `wcag21aa`/`wcag22a`/`wcag22aa`) asserts zero violations and is what
  fails CI. The AAA pass (`wcag2aaa`/`wcag21aaa`/`wcag22aaa`) logs
  findings to the console and attaches them as JSON on the test
  report, but never fails — so the badge stays green when AA passes
  while the AAA debt stays visible.
- **A11y interactions: real controls, real keyboard.** The sister
  `tests/a11y/interactions.test.ts` is the end-to-end half: it opens
  every modal, types into the search box, tabs through focus to verify
  the focus trap, presses Escape to close, drives the theme and
  language toggles via their real buttons (not via
  `document.documentElement.dataset.theme`), and re-runs axe after each
  state change. Bugs in the toggle itself stay invisible if the test
  bypasses the control — the comments call this out.
- **Manual a11y: WCAG checks axe can't express.** `tests/a11y-manual/`
  encodes the three Success Criteria axe-core cannot audit. `reflow.test.ts`
  uses a 320×256 viewport and asserts `documentElement.scrollWidth ≤
  clientWidth + 1`. `resize-text.test.ts` sets the root font to 32px
  (the 200% of WCAG's 16px baseline) and asserts the same overflow
  invariant plus that no `overflow: hidden` heading is clipped.
  `focus-not-obscured.test.ts` tabs up to 80 times and probes nine
  points in each focus rect with `document.elementFromPoint` — if zero
  points return the focused element (or a descendant) the focus is
  fully obscured. These are **not** wired into CI: they need a real
  browser, some are slightly flaky under heavy load, and the network
  during `make build` can shift the timeline's bar positions enough to
  move a focus rect off-screen. The local-only posture is intentional;
  they gate a launch, not a PR.
- **Snapshots live next to the spec.** The visual config sets
  `snapshotPathTemplate: "{testDir}/__screenshots__/{testFilePath}/{arg}-{projectName}{ext}"`
  so review diffs sit beside the spec that produced them — a snapshot
  failure surfaces both the test and its baselines in the same review
  pane.
- **AGENTS.md describes all of this** (§20.4 mandate) and points
  agents at `.claude/rules/tests.md` (per-domain breakdown) and
  `.claude/rules/visual-snapshots.md` (the rebaseline playbook).

Read in this order: `playwright.config.ts` →
`.claude/rules/visual-snapshots.md` → `tests/visual/site.test.ts` →
`tests/visual/modals.test.ts` → `playwright.a11y.config.ts` →
`tests/a11y/site.test.ts` → `tests/a11y/interactions.test.ts` →
`playwright.a11y-manual.config.ts` → the five `tests/a11y-manual/*` specs.

## Agent instructions for visual regression (the `.claude/rules/` half)

The user-requested piece. cv ships two rule files under
`.claude/rules/` so any agent editing the repo gets the workflow
inlined into its working context:

- **`.claude/rules/visual-snapshots.md`** — the rebaseline playbook.
  Lists which file changes guarantee a rebaseline (text in
  `src/data/cv*.json`, `src/styles/**`, component changes, dependency
  bumps that ship glyphs / Chromium), the snapshot → source map
  (`hero-{en,sv}-{dark,light}` is driven by `Hero.tsx` + `hero.css` +
  the cv summary/tagline JSON, etc.), the four-step workflow
  (`make build && CI=1 npm run test:visual` → if-and-only-if the
  expected snapshots failed, `CI=1 npm run test:visual:update` →
  re-run `CI=1 npm run test:visual` → verify
  `git status --short` shows only `*.png` under
  `tests/visual/__screenshots__/`), and the three scoping flags
  (`--config` isn't applicable here, but file path, `-g` /
  `--grep` on the test title, and `--project chromium-desktop` /
  `chromium-mobile` are) so a single-modal change doesn't trigger a
  full-suite rebaseline. The hard guardrails — Linux-only,
  never-on-a-dirty-tree, never-as-a-regression-silencer,
  never-widen-`maxDiffPixelRatio` — are at the bottom.
- **`.claude/rules/tests.md`** — the supporting per-domain rule file.
  Lists what each suite covers, where its baselines live, the
  gated-in-CI vs. local-only posture, and the rule that new test
  domains extend `vitest.config.ts` rather than spawning a fourth
  Playwright config.

Both files have YAML front-matter that pins them to the paths whose
edits trigger their workflow:

- `visual-snapshots.md` triggers on `src/styles/**`, `src/components/**`,
  `src/data/cv.json`, `src/data/cv/**`, `tests/visual/**`,
  `playwright.config.ts`.
- `tests.md` triggers on `tests/**`, `vitest.config.ts`,
  `playwright*.config.ts`.

These two paths are how Claude Code's rule system picks the right rule
file up automatically when an agent edits a UI-touching file or a test
file; without them, an agent could land a CSS retune and only discover
the visual baseline drift when CI runs.

## How to adopt this in another project

1. **Drop the three Playwright configs in.** Copy `playwright.config.ts`
   (visual), `playwright.a11y.config.ts` (a11y), and
   `playwright.a11y-manual.config.ts` (manual) to the repo root. Rename
   if your stack has competing configs; the `--config` flag in
   `package.json` scripts is what wires each suite to its config. Pin
   each config to its own port so the three preview servers don't
   collide locally. Adjust `webServer.command` to whatever boots your
   built site (cv uses `npm run preview -- --host 127.0.0.1 --port
   $PORT --strictPort`); the `--strictPort` flag is important — without
   it Vite will pick a free port if `$PORT` is taken and the test will
   then hit the wrong server.
2. **Mirror the `tests/` layout.** Create `tests/visual/`,
   `tests/a11y/`, and `tests/a11y-manual/` and copy in the specs that
   match what your app actually has. The cv specs are written against
   selectors specific to this site (`.hero`, `.focus-item-btn`,
   `.skill-modal-overlay`, `#projects .project-stack-btn`, etc.); the
   *structure* of the specs is what's reusable, not the selectors. The
   patterns worth copying verbatim:
   - The `preparePage` / `STABILIZE_CSS` / `SECTION_OVERLAY_CSS` /
     `page.clock.install` recipe for deterministic visual snapshots.
   - The two-pass axe scan (AA fails, AAA logs) in
     `tests/a11y/site.test.ts`.
   - The focus-trap probe (`tabCycleStaysInside`) and
     `openAndAssertModal` helpers in `tests/a11y/interactions.test.ts`.
   - The `elementFromPoint`-based focus-not-obscured probe in
     `tests/a11y-manual/focus-not-obscured.test.ts`.
3. **Add the `tests/visual/__screenshots__/` baseline directory.**
   `playwright.config.ts` sets
   `snapshotPathTemplate: "{testDir}/__screenshots__/{testFilePath}/{arg}-{projectName}{ext}"`,
   so baselines live next to the specs. Record them on Linux
   (the OS CI runs on) by running `npm run test:visual:update` once
   after the first specs pass; **never re-record on macOS or Windows**.
4. **Wire the npm scripts.** Add the seven scripts cv exposes:
   ```json
   "test": "vitest run",
   "test:visual": "playwright test",
   "test:visual:update": "playwright test --update-snapshots",
   "test:visual:ui": "playwright test --ui",
   "test:a11y": "playwright test --config=playwright.a11y.config.ts",
   "test:a11y-manual": "playwright test --config=playwright.a11y-manual.config.ts",
   "test:pa11y": "node scripts/run-pa11y.mjs"
   ```
   The `:visual:update` script is the one the agent rule invokes; keep
   it as its own script entry so agents don't have to know the
   `--update-snapshots` flag.
5. **Wire the Makefile.** cv exposes `make test`, `make test-visual`,
   `make test-visual-update`, `make test-a11y`, `make test-a11y-manual`.
   The Makefile aliases are what AGENTS.md (§7) lists, so an agent
   reading the repo doesn't need to thumb through `package.json`
   scripts.
6. **Wire the CI workflows.** Three files in `.github/workflows/`:
   `visual.yml` runs `make test-visual` after `make build`,
   `a11y.yml` runs `make test-a11y`, and a deep `a11y-deep.yml`
   (optional) runs `make test-pa11y` on a schedule. Each workflow
   installs the Playwright Chromium with
   `npx playwright install --with-deps chromium` and uploads
   `playwright-report` / `a11y-report` as artifacts on failure
   (`if: failure()`). The manual config is **not** wired into CI by
   design.
7. **Copy `.claude/rules/visual-snapshots.md` and `tests.md`** (or
   their equivalent in your agent harness — Cursor `.cursorrules`,
   Aider `CONVENTIONS.md`, etc.) and rewrite the snapshot → source
   map for your codebase. The path-trigger front-matter is what makes
   the rule load automatically when an agent touches a UI file. The
   workflow text (build → run → update → verify → commit) is portable
   as-is; the snapshot names and the file paths in the map are not.
8. **Document it in AGENTS.md.** Add a `## Test conventions` section
   (§20.4 mandate) that names the directory layout, the
   `_?[Tt]ests?$` stem regex, the `make test*` commands, and points
   at `.claude/rules/tests.md` and `.claude/rules/visual-snapshots.md`.

## Caveats

- **Linux-only visual baselines.** Recording baselines on macOS or
  Windows produces sub-pixel font drift and a different Chromium
  rasteriser path; the next CI run will fail on most snapshots. This
  is the single most common foot-gun and the agent rule calls it out
  three separate times.
- **`backdrop-filter: blur(...)` is non-portable.** The headless
  compositor renders blurs differently from a desktop GPU; cv disables
  it during snapshots (`STABILIZE_CSS` in `modals.test.ts`). If your
  modals depend on a glassy backdrop, expect to do the same.
- **Determinism is the hard part.** The fonts-ready wait, the clock
  install, the canvas hide, the caret-color kill, the section-overlay
  CSS — each one earned itself by flaking on CI. Don't trim them on a
  refresh because they "look unused"; they're load-bearing.
- **`tests/a11y-manual/` is intentionally not gated in CI.** Some
  specs (timeline keyboard ops, focus-not-obscured) are slightly flaky
  under heavy load or when build-time network is slow. They gate a
  launch (run them locally before a release) and a UI overhaul, not a
  PR. If you wire them into CI, expect retry noise.
- **The visual config's `webServer` reuses an existing preview server
  locally** (`reuseExistingServer: !process.env.CI`), so if you have
  a `npm run preview` already running on port 4173, the visual suite
  will run against *that* — not against a fresh build. Helpful for
  fast iteration; surprising the first time it bites you.
- **`tests/visual/__screenshots__/` is not copied into this showcase.**
  The baselines are binary PNGs (~8 MB total at the time of writing)
  and live next to the upstream specs. To see the actual recorded
  baselines, browse the upstream repo at the source commit named in
  the provenance line below.
- **WCAG AAA findings are advisory, not gates.** The two-pass axe scan
  in `tests/a11y/site.test.ts` only fails on AA. If you want AAA to
  fail CI, change the second pass from logging + attaching JSON to
  asserting `aaa.violations.length === 0` — but read the spec text
  on §20 first and be sure your design system is willing to pay the
  contrast / target-size cost.
- **cv's `package.json` and `Makefile`** are *not* copied here — they
  ship the scripts that drive these configs (`test:visual`,
  `test:visual:update`, `test:a11y`, `test:a11y-manual`,
  `make test-visual-update`, …). See the upstream repo for the
  canonical entries; step 4 above lists the minimum set.
- **The `.claude/rules/*.md` path-trigger front-matter is
  Claude-Code-specific.** Other agent harnesses use different
  mechanisms (Cursor's `.cursorrules` is a single file, Aider's
  `CONVENTIONS.md` is global). The *content* of the rule is portable;
  the auto-loading mechanism is not.

Refreshed by `.agent/skills/copy-example` from `playwright.config.ts, playwright.a11y.config.ts, playwright.a11y-manual.config.ts, tests/visual/, tests/a11y/, tests/a11y-manual/, .claude/rules/visual-snapshots.md, .claude/rules/tests.md` at cv@1c98b0c.
