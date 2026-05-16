---
name: Test domain layout and conventions
description: Per-directory breakdown of test domains under tests/ — what each suite covers, how it runs, and the rules for adding new test domains. Triggers when working in tests/ or in test config files.
paths:
  - "tests/**"
  - "vitest.config.ts"
  - "playwright.config.ts"
  - "playwright.a11y.config.ts"
  - "playwright.a11y-manual.config.ts"
---

# Test conventions

Tests live under `tests/` at the repo root (`OSS_SPEC.md` §20.3):

- `tests/data/` — schema roundtrip + the `load-cv` deep-merge contract.
- `tests/unit/` — pure-function unit tests (currently `utils/date`).
- `tests/visual/` — Playwright visual regression. Baseline PNGs are
  committed under `tests/visual/__screenshots__/` and were recorded on
  Linux; CI runs on `ubuntu-latest` for the same reason. Re-record with
  `make test-visual-update` only after an intentional UI change, and
  commit the new pixels in the same PR. See
  `.claude/rules/visual-snapshots.md` for the rebaseline workflow.
- `tests/a11y/` — Playwright + axe-core WCAG 2.2 AA scan of the built
  site, driven by `playwright.a11y.config.ts`. Asserts zero violations
  tagged `wcag2a` / `wcag2aa` / `wcag21a` / `wcag21aa` / `wcag22a` /
  `wcag22aa` for both languages × both themes × desktop + mobile
  viewports. A second pass collects AAA-tier findings (`wcag2aaa` /
  `wcag21aaa` / `wcag22aaa`) and surfaces them as console output and
  attached JSON on the test report; AAA findings never fail the test.
- `tests/a11y-manual/` — Playwright specs for the WCAG checks axe
  cannot express: reflow at 320 CSS px (SC 1.4.10), resize-text at
  200% (SC 1.4.4), focus-not-obscured (SC 2.4.11). Driven by
  `playwright.a11y-manual.config.ts` and run via
  `make test-a11y-manual`. **Not gated in CI** — they need a real
  browser and some are slightly noisy under heavy load — but they
  must be green locally before any launch. The `verify-wcag` skill
  promotes new untestable findings into this directory.

All test files end in `.test.ts` / `.test.mts` / `.tests.ts` per
`OSS_SPEC.md` §20.2 (regex `_?[Tt]ests?$` on the stem). Vitest picks
them up via `vitest.config.ts`; visual and a11y specs under
`tests/visual/`, `tests/a11y/`, and `tests/a11y-manual/` are excluded
from the Vitest `include` so Playwright owns them. Don't import test
code from `src/`.

When adding a new top-level test domain (e.g. integration tests),
extend `vitest.config.ts` `include` rather than scattering test
discovery across multiple configs.
