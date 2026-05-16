# zag §3 — README badge row

Reference example of the badge row prescribed by [OSS_SPEC §3](../../../OSS_SPEC.md#3-readmemd). The
upstream `README.md` was copied verbatim from `niclaslindstedt/zag` at
`54c70b9` and lives here as [`README.upstream.md`](README.upstream.md) so the
showcase `README.md` (this file) can document the badge choices without name
collision.

The badges in question are the first nine lines of `README.upstream.md`:

```md
# zag

[![ci](https://github.com/niclaslindstedt/zag/actions/workflows/ci.yml/badge.svg)](https://github.com/niclaslindstedt/zag/actions/workflows/ci.yml)
[![release](https://github.com/niclaslindstedt/zag/actions/workflows/release.yml/badge.svg)](https://github.com/niclaslindstedt/zag/actions/workflows/release.yml)
[![pages](https://github.com/niclaslindstedt/zag/actions/workflows/pages.yml/badge.svg)](https://github.com/niclaslindstedt/zag/actions/workflows/pages.yml)
[![crates](https://img.shields.io/crates/v/zag-cli.svg)](https://crates.io/crates/zag-cli)
[![npm](https://img.shields.io/npm/v/@nlindstedt/zag-agent.svg)](https://www.npmjs.com/package/@nlindstedt/zag-agent)
[![pypi](https://img.shields.io/pypi/v/zag-agent.svg)](https://pypi.org/project/zag-agent/)
[![nuget](https://img.shields.io/nuget/v/Zag.svg)](https://www.nuget.org/packages/Zag/)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
```

## File layout

```text
examples/zag/3/
├── README.md          # this file — explains the badge philosophy
└── README.upstream.md # zag's README.md, copied verbatim; lines 3–10 are the badge row
```

## How this sits in `zag`

- **Workflow filenames are one word.** `ci.yml`, `release.yml`, `pages.yml`.
  GitHub renders the badge label from the workflow's `name:` (or the filename
  when `name:` is omitted). zag relies on the filename, so each badge reads as
  a single lowercase token: `ci`, `release`, `pages`. The row is scannable at
  a glance and the badge label matches what a maintainer types when navigating
  to `.github/workflows/<name>.yml`. (zag also has `version-bump.yml`, but
  that's a chore workflow with no signal worth a badge — see "Caveats".)
- **One badge per CI workflow that produces a publishable signal.** zag's
  three are: build/test/lint (`ci`), the publish pipeline (`release`), and
  the docs site deploy (`pages`). Each badge points at the workflow's runs
  page, so clicking through goes straight to the most recent run.
- **One badge per publishing target.** zag ships to four registries —
  crates.io, npm, PyPI, NuGet — so there are four version badges, each
  sourced from `img.shields.io/<registry>/v/<pkg>.svg` and clicking through
  takes you to the registry listing where you can copy an install command.
- **License is a static shields.io badge** linking to `LICENSE` in the repo
  root. No workflow, no registry — just provenance.

## How to adopt this in another project

1. **Name your workflows in one word.** Rename `.github/workflows/build.yml`
   to `ci.yml`, `publish.yml` to `release.yml`, etc. Avoid `name:` overrides
   that diverge from the filename — when they match, the badge label, the
   filename, and the URL slug are all the same string and there's nothing
   to remember.
2. **Add one CI-status badge per workflow that gates a release or a deploy.**
   Skip workflows that are chores (version bumps, dependency PRs, label
   sweeps) — they don't carry a signal a reader needs to see. The template is:

   ```md
   [![<name>](https://github.com/<owner>/<repo>/actions/workflows/<name>.yml/badge.svg)](https://github.com/<owner>/<repo>/actions/workflows/<name>.yml)
   ```

3. **Add one version badge per publishing target.** Pick the canonical
   shields.io endpoint for the registry — `crates`, `npm`, `pypi`, `nuget`,
   `gem`, `packagist`, `hexpm`, `pub`, etc. — and link straight to the
   package page on that registry:

   ```md
   [![<registry>](https://img.shields.io/<registry>/v/<pkg>.svg)](<registry-url>/<pkg>)
   ```

4. **Add a static license badge** pointing to your repo-root `LICENSE`:

   ```md
   [![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
   ```

   Swap `MIT` for whatever SPDX identifier matches your `LICENSE`.

5. **Stop there.** Resist the temptation to add more (see below).

## Why we only care about the important badges

A badge earns its place in the row by being **actionable**: a reader either
checks it (is the build green right now?) or clicks through it (where do I
install this?). Anything else is decoration that pushes the project's
one-sentence description further down the page.

Concretely, that's three categories, in order:

1. **CI status** — one badge per release-gating workflow. Tells a reader
   whether main is currently shippable.
2. **Release / version** — one badge per registry the project publishes to.
   Tells a reader where to install from and what version they'll get.
3. **License** — one badge. Tells a reader whether they can use the project
   at all.

OSS_SPEC §3 marks coverage, security scanning, and downloads as **optional**
— this showcase deliberately drops all three. Reasons:

- **Coverage** — Coverage percentages are noisy, easy to game, and rarely
  what a reader is asking. The `ci` badge already says "tests pass"; a
  separate coverage badge adds a number without adding information. Add it
  back only if coverage is a contractual obligation (e.g. you publish a
  guarantee around it).
- **Security scanning** — Most badges here ("0 vulnerabilities", "Snyk
  green") expire silently or report on the *badge service*'s last scan, not
  your repo's current state. If you want this signal, surface it inside CI
  as a failing job, not as a badge.
- **Downloads** — Vanity metric. Tells the reader how popular the project
  is, not whether it's the right tool for their job. Same goes for stars,
  contributors, sponsors, Gitter, Discord, "made with ❤", "PRs welcome",
  and code-style badges.

The test is: **if the badge went red, would a maintainer act on it?** CI red
→ fix it. Version stale → cut a release. License missing → ship the file.
Coverage dropped 2% → almost certainly not.

## Caveats

- **Workflow `name:` overrides.** If a workflow sets a `name:` that differs
  from the filename, GitHub renders that `name:` in the badge instead of the
  filename. zag's workflows leave `name:` unset on purpose so the filename
  is the badge label. If you set `name: Continuous Integration`, your badge
  reads "Continuous Integration", not "ci".
- **Workflow filename casing.** Badge labels are case-sensitive and come from
  the filename. `CI.yml` renders as `CI`, `ci.yml` as `ci`. Pick one casing
  and stick with it across the repo.
- **Default-branch assumption.** GitHub's actions badge endpoint shows the
  status of the workflow's most recent run on the **default branch**. If you
  rename `main` → `trunk` or run the workflow only on tags, the badge will
  read "no status" until a default-branch run completes. Use the `?branch=`
  query string if you need a non-default branch.
- **`version-bump.yml` is deliberately not badged.** It's the chore workflow
  that opens release PRs; its red/green state isn't a signal anyone but the
  maintainer needs. Apply the same filter to dependabot-style workflows,
  label-sync chores, and stale-bot runs.
- **Scoped npm packages need URL-encoding** in the shields endpoint:
  `@nlindstedt/zag-agent` → `@nlindstedt%2Fzag-agent`. zag's badge happens
  to render fine without encoding because shields.io tolerates the literal
  `@` and `/`, but if you hit a broken badge that's the first thing to check.
- **Crates.io / NuGet caching.** shields.io caches registry responses for
  several minutes; a fresh publish may take a moment to reflect in the
  version badge. Not a bug — don't bisect it.

Refreshed by `.agent/skills/copy-example` from `README.md` at `zag@54c70b9`.
