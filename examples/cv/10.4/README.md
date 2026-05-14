# cv §10.4 — Website deployment

Reference implementation of [OSS_SPEC.md §10.4](../../../OSS_SPEC.md) as it
appears in [cv](https://github.com/niclaslindstedt/cv) at commit `846ef7c`.

This is the single workflow that ships the
[niclaslindstedt.se](https://niclaslindstedt.se) site to GitHub Pages on every
push to `main`. It triggers on `push: branches: [main]` (with a
`workflow_dispatch` escape hatch), rehydrates the data-cache JSONs that
back the dynamic sections of the site, runs `make build` (which calls the
Vite build), uploads the `dist/` output as a Pages artifact, and deploys it
through `actions/deploy-pages` with a one-shot retry on transient failure.

## File layout

```
.github/workflows/
  pages.yml                    # push: branches: [main] + workflow_dispatch
```

## How this sits in cv

- **Repo root.** `pages.yml` lives at `.github/workflows/` in the upstream
  root. cv is a single-package Vite/React/TypeScript app — no
  monorepo wrapping — so the workflow drives the repo as a whole.
- **Two-job split.** `build` produces the Pages artifact, `deploy` consumes
  it. Only the `deploy` job declares the `github-pages` environment and the
  `pages: write` / `id-token: write` permissions actually needed to publish;
  `build` runs with `contents: read`. The top-level `permissions:` block
  grants the union so the checkout in `build` still works.
- **Source-data extraction.** cv's spec-mandated extraction step (§11.2) is
  not an inline script in `pages.yml`. Instead, a separate
  `.github/workflows/data-refresh.yml` runs once a day and writes
  `src/data/github-activity.json` + `src/data/project-stats.json` to a
  dedicated `data-cache` branch. `pages.yml`'s first real step
  (`Restore data-cache JSONs`) fetches that branch with `git fetch origin
  data-cache --depth 1` and materialises both JSONs back into `src/data/`
  before `npm ci`. If the branch is missing — first deploy on a fresh
  fork — the step is a soft no-op and the Vite build falls through to its
  cold-start path. This is a deliberate split from the spec's "extract on
  every build" wording: the GitHub GraphQL API rate-limits aggressively and
  doing it on every push was overwriting good data with rate-limited
  garbage. The cache branch is the single writer; deploys only read.
- **Toolchain pin.** `actions/setup-node@v6` reads `node-version-file:
  .nvmrc` (`24`), matching §10.5. `cache: npm` keys off `package-lock.json`.
- **Build entry point.** `make build` is the spec-blessed indirection
  (§9). The Makefile target is a one-liner around `npm run build`; the
  workflow therefore stays language-agnostic and the Vite/Rollup details
  live in `vite.config.ts`.
- **Secrets.** Exactly one is wired: `VITE_GOATCOUNTER_ENDPOINT` (analytics
  collector URL), exported as an env var on the `make build` step so Vite
  inlines it. Vite's `VITE_*` prefix means the value ends up in the bundle
  shipped to browsers — treat it as public, not as a credential. No
  long-lived publishing tokens; `actions/deploy-pages` authenticates via
  the OIDC token minted by `permissions: { id-token: write }`.
- **Concurrency.** `group: pages`, `cancel-in-progress: false`. The spec
  requires exactly this: a slow deploy must never be cancelled by a faster
  one piling up behind it, because GitHub Pages takes the *last* artifact
  to finish, not the *latest* commit to start.
- **Retry on deploy.** `deploy-pages` is occasionally flaky for reasons
  outside the repo's control (Pages backend hiccups, CDN warmup). The
  `deploy` job runs the action with `continue-on-error: true`, sleeps 90s
  if attempt 1 failed, and retries. The `environment.url` expression
  prefers the first attempt's URL when it succeeded and falls back to the
  second. Two attempts is enough in practice — three would mostly just
  delay surfacing a real outage.
- **Pages settings.** Repo Settings → Pages must be set to "GitHub Actions"
  as the source (not "Deploy from a branch"). Without this, the
  `configure-pages` / `deploy-pages` actions error out with a misleading
  permissions message.

Read in this order: the top-level triggers / permissions / concurrency
block, then the `build` job (checkout → data-cache restore → setup-node →
`npm ci` → `make build` → upload artifact), then the `deploy` job with its
retry pair.

## How to adopt this in another project

1. **Drop the file in.** Copy `.github/workflows/pages.yml` to the same
   path in the target repo. Commit on a branch.

2. **Replace the build entry point.** The workflow assumes `make build`
   produces the deployable output in `dist/`. If your project has no
   Makefile, either:
   - Add a minimal `Makefile` with `build:` and `local:` targets that
     wrap your real build command (recommended — matches §9), or
   - Replace `run: make build` with the equivalent `npm run build` /
     `cargo run --bin site-gen` / `mkdocs build` invocation directly.
   - Update the `upload-pages-artifact` `path:` if your build emits
     somewhere other than `dist/` (`build/`, `public/`, `_site/`, etc.).

3. **Wire up the source-data extraction step.** This is the
   spec-mandated piece (§11.2) and the part that varies most between
   projects:
   - If your data is cheap to recompute, inline the extraction script as
     a step *before* `make build` and skip the cache-branch dance.
   - If your data is expensive or rate-limited (cv's case: GitHub
     GraphQL), copy the cache-branch pattern: add a `data-refresh.yml`
     scheduled workflow that writes JSONs to a dedicated branch
     (`data-cache` here), and keep the `Restore data-cache JSONs` step
     so deploys read from that branch rather than calling the upstream
     API. The deploy must remain a *reader* — never let `pages.yml`
     write back to the cache branch, or two concurrent deploys will
     race.
   - If you want the deployed site to reflect the latest released tag
     rather than the working tree (the §11.2 "git-aware extraction"
     pattern), have the extractor `git show $(git describe --tags
     --abbrev=0 --match 'v*'):path/to/file` for the source files it
     reads, and fall back to the working tree on tag-miss.

4. **Set the Node version (or swap the toolchain).** `.nvmrc` must exist
   at the repo root and pin a non-floating version (§10.5). For a
   non-Node site, replace `actions/setup-node` with the matching
   `setup-python` / `setup-go` / `dtolnay/rust-toolchain` step and the
   `npm ci` / `make build` pair with your stack's install + build.

5. **Configure Pages in repo settings.** Settings → Pages → Source =
   "GitHub Actions". No branch needs to be selected — the workflow
   provides the artifact.

6. **Add the analytics / runtime env vars you actually need.** Drop the
   `VITE_GOATCOUNTER_ENDPOINT` env var if you don't use GoatCounter;
   add your own under `env:` on the `make build` step, and remember
   that anything baked into a static build is shipped to every visitor.
   Real secrets belong server-side, not in `pages.yml`.

7. **Decide whether you want the deploy retry.** The two-attempt pattern
   is cheap insurance against `actions/deploy-pages` flakes. Keep it as
   written, or simplify the `deploy` job to a single `uses:
   actions/deploy-pages@v5` step if you'd rather fail loudly on the
   first error. The `environment.url` expression must be updated to
   match whichever step IDs you keep.

8. **Smoke-test.** Push a no-op commit to `main`. Confirm: the workflow
   fires, the `Restore data-cache JSONs` step prints either restored
   filenames or the cold-start message, `make build` succeeds, the
   artifact uploads, and the `deploy` job's environment URL resolves to
   your Pages URL. The first run on a fresh repo usually surfaces a
   missing `.nvmrc`, a wrong `path:` on `upload-pages-artifact`, or a
   Pages-source setting still pointing at a branch.

## Caveats

- **Cache-branch pattern is project-specific.** The `data-cache`
  branch + `data-refresh.yml` writer + `pages.yml` reader split is cv's
  workaround for GitHub GraphQL rate limits. Projects whose
  source-data extraction is local-only (parsing `Cargo.toml`,
  `CHANGELOG.md`, etc.) should inline the extractor and delete the
  cache-restore step entirely — keeping it as dead code will confuse
  readers.
- **`VITE_GOATCOUNTER_ENDPOINT` is not secret.** Vite's `VITE_*`
  convention inlines env vars into the client bundle. Storing the
  value as a GitHub Actions secret is convenient (one place to edit)
  but does not provide confidentiality. Anything that must stay
  private cannot ride this workflow.
- **GitHub Pages serves the *latest finished* artifact, not the
  latest commit.** The `cancel-in-progress: false` concurrency setting
  is what makes that behaviour safe; if you flip it to `true` to "save
  CI minutes", you'll occasionally cancel a slow deploy of a newer
  commit and leave the site on an older one. Don't.
- **Retry hides root causes.** Two `deploy-pages` attempts will paper
  over occasional flakes, but if you see attempt 2 firing routinely,
  something is wrong (artifact too large, Pages outage, wrong source
  setting). Treat sustained retries as a signal, not a free pass.
- **No release coupling.** Per §10.4, this workflow is independent of
  any release pipeline. cv doesn't ship a versioned release artifact
  anyway, but if you bolt this onto a project that does, do *not*
  add a `needs:` dependency between this workflow and the release
  workflow — the spec explicitly forbids it.

## Provenance

Refreshed by `.agent/skills/copy-example` from `.github/workflows/pages.yml`
at `niclaslindstedt/cv@846ef7c`.
