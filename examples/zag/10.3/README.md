# zag §10.3 — Release pipeline

Reference implementation of [OSS_SPEC.md §10.3](../../../OSS_SPEC.md) as it
appears in [zag](https://github.com/niclaslindstedt/zag) at commit
`4a837b4`.

These files implement the two-workflow release flow the spec mandates:
`version-bump` (manually dispatched, picks the next semver, pushes a
`v*` tag), and `release` (triggered by that tag push, regenerates the
changelog, rewrites every version manifest, commits back to `main`,
force-moves the tag onto the release commit, then builds/tests/publishes
artifacts via OIDC trusted publishing).

## File layout

```
.github/workflows/
  version-bump.yml           # workflow_dispatch entry point
  release.yml                # push: tags: ['v*']
scripts/
  release.sh                 # local break-glass: same logic as version-bump
  generate-changelog.sh      # called by release.yml, step 3
  update-versions.sh         # called by release.yml, step 4
```

## How this sits in zag

- **Repo root.** The two workflows live at `.github/workflows/` and the
  three scripts at `scripts/` — both at the upstream repo root. Nothing
  here is nested inside a subpackage; even though zag is a Cargo
  workspace with multiple crates (`zag-cli`, `zag-agent`, `zag-orch`,
  `zag-serve`, `bindings/rust`), the release pipeline drives the
  workspace as a single unit.
- **Secrets.** `version-bump.yml` checks out `main` with
  `secrets.RELEASE_TOKEN` (a GitHub App / PAT) so the tag push it
  performs fires the `release` workflow. The default `GITHUB_TOKEN`
  deliberately suppresses downstream workflow triggers and is therefore
  unsuitable here. `release.yml` itself uses the default `GITHUB_TOKEN`
  for the commit-back-to-`main` and tag-force-push steps so the
  rewritten tag does **not** re-fire `release` on itself.
- **Tag protection.** Hand-pushing `v*` tags must be blocked by a tag
  protection rule on the repo, scoped to the bot identity that
  `version-bump` runs as. The workflow trigger alone does not enforce
  this — see the spec text in §10.3 for the full rationale.
- **Publishing.** zag publishes to crates.io, npm, NuGet, and PyPI; each
  publish job in `release.yml` declares its own least-privilege
  `permissions:` block with `id-token: write` and authenticates via the
  registry's OIDC trusted-publishing flow. No long-lived API tokens.
- **Toolchain pin.** zag pins Rust 1.88.0 in every job via
  `dtolnay/rust-toolchain@1.88.0`, matching the floor in §10.3 and the
  repo-root `rust-toolchain.toml`.

Read in this order: `version-bump.yml` → `release.yml` (top to bottom,
the job DAG mirrors the steps in the spec) → the three scripts.

## How to adopt this in another project

1. **Drop the files in.** Copy `.github/workflows/version-bump.yml`,
   `.github/workflows/release.yml`, and `scripts/{release,generate-changelog,update-versions}.sh`
   to the same paths in the target repo. Mark the scripts executable
   (`chmod +x scripts/*.sh`) and commit on a branch.

2. **Rewrite `scripts/update-versions.sh` for your stack.** zag's copy
   is Rust-specific: it bumps every `Cargo.toml` in the workspace plus
   `bindings/rust/Cargo.toml`, then runs `cargo generate-lockfile` to
   refresh `Cargo.lock`. For a different language, replace those `sed`
   blocks with whatever rewrites your manifests need:
   - **Node** — `package.json` (and every workspace package) +
     `package-lock.json`. `npm version --no-git-tag-version <ver>` is
     usually enough.
   - **Python** — `pyproject.toml` / `setup.cfg` / `__version__.py`.
   - **Mixed** — chain the rewrites; the spec (§10.3 step 4) lists the
     full set of manifests the script must keep honest. The script
     must be idempotent: if every manifest is already at the target
     version, it exits 0 with no diff so step 5 of the release
     workflow becomes a no-op rather than creating an empty commit.

3. **Adjust the publish jobs in `release.yml`.** The matrix-build,
   test, and `update-repo` jobs are stack-agnostic and can usually
   stay as-is, but the `publish-*` jobs are registry-specific:
   - Keep only the publish jobs your project actually ships to (drop
     `publish-crates` if you don't ship a crate, etc.).
   - Each kept job must keep its `permissions: { contents: read,
     id-token: write }` block and continue to authenticate via OIDC
     trusted publishing for that registry — never a long-lived token.
   - If you add a new registry, model the job on the closest existing
     one and follow the spec's "Trusted publishing" subsection.

4. **Wire up the `RELEASE_TOKEN` secret.** Create a GitHub App (or PAT)
   with `contents: write` on the target repo, install it, and store
   the installation token as the `RELEASE_TOKEN` repository secret.
   `version-bump.yml` falls back to `GITHUB_TOKEN` if the secret is
   absent so you can smoke-test the workflow before tag triggering
   matters, but **you cannot ship without `RELEASE_TOKEN`** — without
   it, `release.yml` will not fire when `version-bump` pushes the tag.

5. **Configure repository protections.**
   - Branch-protect `main`. Grant the release bot identity a narrow
     exception so `release.yml` can push the `chore(release): …`
     commit.
   - Tag-protect `v*`, scoped so only the same bot identity can create
     them. This is what stops a maintainer from hand-pushing a tag
     and bypassing `version-bump`.

6. **Configure trusted publishing on each registry.** Register the
   target repo + workflow filename + job environment on
   crates.io, PyPI, npm, NuGet (whichever apply). The OIDC token the
   workflow mints must match the trusted-publisher configuration the
   registry expects, or the publish step fails.

7. **Dry-run.** Manually dispatch `version-bump` with `bump: patch` on
   a release candidate. Confirm: a `vX.Y.Z` tag appears, `release.yml`
   fires, `CHANGELOG.md` is regenerated, every manifest is bumped, the
   commit lands on `main`, the tag force-moves onto that commit, and
   the publish jobs authenticate via OIDC. The first run on a new repo
   often surfaces a missed manifest in step 2 or a trusted-publisher
   misconfiguration in step 6 — both are cheap to fix once observed.

## Caveats

- The matrix-build job in `release.yml` targets zag's specific binary
  artefact set (Linux/macOS/Windows on multiple architectures). The
  shape is reusable but the actual targets and packaging steps are
  not — treat that job as a template, not a drop-in.
- `generate-changelog.sh` parses conventional-commit history with `git
  log` and a small awk pipeline. It assumes the project actually
  follows Conventional Commits (§8.1 of the spec); if yours doesn't,
  fix the commit hygiene first rather than weakening the script.

## Provenance

Refreshed by `.agent/skills/copy-example` from
`.github/workflows/{version-bump,release}.yml` and
`scripts/{release,generate-changelog,update-versions}.sh` at
`niclaslindstedt/zag@4a837b4`.
