# zag §10.3 — Release pipeline

Reference implementation of OSS_SPEC.md §10.3 as it appears in
[zag](https://github.com/niclaslindstedt/zag) at commit `4a837b4`.

This example shows the two-workflow release flow the spec mandates:
`version-bump` (manually dispatched, computes the next version and pushes
a `v*` tag using `RELEASE_TOKEN`) and `release` (triggered by the `v*`
tag push, regenerates the changelog, rewrites version manifests, commits
back to `main`, force-moves the tag, then builds, tests, and publishes
release artifacts to crates.io via OIDC trusted publishing). The
`scripts/` files are the break-glass local equivalents — `release.sh`
mirrors the version-bump logic, while `generate-changelog.sh` and
`update-versions.sh` are the helpers the release workflow invokes.

Start with `.github/workflows/version-bump.yml`, then read
`.github/workflows/release.yml` top-to-bottom; the script helpers are
short enough to read after.

Refreshed by `.agent/skills/copy-example` from
`.github/workflows/{version-bump,release}.yml` and
`scripts/{release,generate-changelog,update-versions}.sh`.
