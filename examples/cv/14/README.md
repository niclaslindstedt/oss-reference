# cv §14 — Dependency hygiene

Reference implementation of [OSS_SPEC.md §14](../../../OSS_SPEC.md) as it
appears in [cv](https://github.com/niclaslindstedt/cv) at commit `846ef7c`.

cv's dependency-hygiene story is four pieces working in concert: the standard
`.github/dependabot.yml` config that opens the bump PRs, a
`.github/workflows/dependabot.yml` CI workflow that fails while any
Dependabot PR is open, a status badge in the repo `README.md` that turns red
when that workflow fails (the social pressure), and a `fix-dependabot-prs`
agent skill that drains the queue end-to-end (merge the green ones, rebase
and fix the red ones, merge what turns green). The first file is the spec
mandate; the other three are the operational loop cv runs around it so the
queue never stagnates.

## File layout

```
.github/
  dependabot.yml                          # weekly npm + github-actions bumps, limit 10 each
  workflows/
    dependabot.yml                        # hourly CI check that fails while Dependabot PRs are open
.agent/skills/
  fix-dependabot-prs/
    SKILL.md                              # agent playbook for draining the queue
    .last-updated                         # baseline commit hash (per §21.4)
README-badge-snippet.md                   # the badge line cv pastes into its repo README
```

The badge snippet is shown as a standalone file here because cv's full
`README.md` is well outside the §14 scope; the line it represents lives in
the repo root README at upstream `README.md:9`.

## How this sits in cv

- **Repo root.** Both YAML files live under `.github/` at the repo root; the
  skill lives under `.agent/skills/` (with the `.claude/skills` symlink
  from §21.2 making it discoverable to Claude Code). cv is a single-package
  Vite/React/TypeScript app — no monorepo wrapping — so `directory: /` in
  the Dependabot config covers the only `package.json`.
- **Two ecosystems, not three.** `npm` and `github-actions` are the only
  ecosystems Dependabot watches. There is no `docker` ecosystem entry
  because cv has no Dockerfile; this is the spec's "configure it for the
  package ecosystem, GitHub Actions versions, and Docker base images" with
  Docker correctly omitted. Both ecosystems share the same weekly cadence
  and a 10-PR cap so the queue never balloons past what a single
  `fix-dependabot-prs` run can clear.
- **The CI workflow is a forcing function, not a checker.** Most projects
  treat Dependabot PRs as "merge when I get to it". cv inverts that:
  `.github/workflows/dependabot.yml` runs on `push: branches: [main]`,
  `pull_request: [opened, reopened, closed]`, and an hourly cron, and if
  `gh pr list --author app/dependabot --state open` returns >0, the job
  exits 1 and the README badge turns red. The badge staying red is what
  prompts the human (or agent) to run the skill. Note the author filter:
  `app/dependabot` not `dependabot[bot]` — `gh pr list --author` wants the
  app slug, not the bot login the API returns.
- **The badge is the visible half of the forcing function.** Without the
  badge, the failing workflow is invisible — it lives in the Actions tab
  that nobody opens unprompted. cv's repo `README.md` includes
  `[![Dependabot](.../actions/workflows/dependabot.yml/badge.svg)](...)`
  alongside the CI/Visual/Pages badges (see `README-badge-snippet.md` in
  this directory for the exact line), so the moment the workflow fails
  the front-page status row goes red and the queue is suddenly the most
  conspicuous thing about the repo. The badge URL points at the workflow
  file shipped in this example (`.github/workflows/dependabot.yml`) — the
  two are a pair, and dropping the badge into a repo that doesn't have
  the workflow yet will render an `unknown`-state shield. Keep the badge
  link target pointing at the workflow page so a reader who clicks it
  lands on the most recent run with the failure message, not on a
  generic Actions filter.
- **The skill is the queue-drainer.** `.agent/skills/fix-dependabot-prs/
  SKILL.md` is a three-pass procedure: merge the green PRs newest-first,
  rebase + repair the red ones, wait 3 minutes, merge what turned green.
  It uses the GitHub MCP tools (`mcp__github__list_pull_requests`,
  `mcp__github__merge_pull_request`) for PR operations and falls back to
  local `git fetch` + `git rebase` + `npm install` when a bump needs the
  lockfile regenerated. Squash-merge is the only permitted strategy
  (cv's `CLAUDE.md` forbids merge and rebase merges).
- **Permissions are read-only on the workflow.** The dependabot CI job
  needs only `contents: read` and `pull-requests: read` — it never writes.
  All writes go through the skill (which uses the developer's PAT via the
  MCP server), not through `GITHUB_TOKEN`.
- **No SCA job yet.** §14 also calls for a software composition analysis
  job (`npm audit`, `osv-scanner`, etc.) failing on high-severity
  advisories. cv does not have this wired up at the showcased commit —
  Dependabot security alerts are the only line of defence today. A future
  refresh of this showcase should add the SCA workflow once it lands.
- **SHA-pinning of CI actions.** §14 also mandates pinning CI actions by
  commit SHA. cv currently still pins by major-version tag
  (`actions/checkout@v6`); Dependabot's `github-actions` ecosystem updates
  those tags, but a stricter conformance pass would replace them with
  commit SHAs and let Dependabot rewrite the SHA on each bump. Treat that
  as an open item, not a feature of this example.

Read in this order: `dependabot.yml` (what bumps and when), `workflows/
dependabot.yml` (how the badge stays honest), then `SKILL.md` (how a human
or agent drains the queue).

## How to adopt this in another project

1. **Drop `.github/dependabot.yml` in.** Adjust `package-ecosystem` to your
   stack: `cargo` for Rust, `pip` / `uv` for Python, `gomod` for Go,
   `docker` if you ship a Dockerfile. Keep the `github-actions` block —
   every project with workflows needs it. Pick a cadence (`weekly` is the
   safe default; `daily` is appropriate for security-sensitive projects).
   Set `open-pull-requests-limit` to something your team can actually
   clear in one sitting.

2. **Drop `.github/workflows/dependabot.yml` in if you want the forcing
   function.** It is a 25-line workflow with no external dependencies
   (`gh` is preinstalled on `ubuntu-latest`). It is also the workflow
   that drives the badge in the next step — installing the badge
   without this workflow leaves you with an `unknown`-state shield, so
   commit them together. If your team prefers a softer signal, drop
   both the workflow and the badge and rely on Dependabot's own PR list
   — but be honest with yourself about whether anyone will look at it.

3. **Paste the badge line into your `README.md`.** `README-badge-snippet.md`
   in this directory holds the exact markdown cv uses; copy it into the
   badge row of the target repo's `README.md`, alongside the other
   workflow badges, and swap `niclaslindstedt/cv` for your org/repo. The
   badge URL must keep pointing at `.../actions/workflows/dependabot.yml/
   badge.svg` — that filename matches the workflow you just installed,
   and changing one without the other quietly breaks the pair.

4. **Drop `.agent/skills/fix-dependabot-prs/` in.** The skill is mostly
   tool-agnostic but assumes:
   - **Squash-merge is permitted on `main`.** If your project uses a
     different merge strategy, edit the `merge_method` line in the skill
     (the skill explicitly forbids non-squash because cv's `CLAUDE.md`
     does — adjust to match your project's contract).
   - **Conflicts inside `package-lock.json` are resolved by regenerating
     it.** For non-npm stacks, replace the `git checkout --theirs
     package-lock.json && npm install` recipe in §2.1 with the equivalent
     for your lockfile (`cargo update --workspace`, `uv lock`, `pdm lock
     --update-reuse`, `go mod tidy`, …).
   - **`make` targets named `fmt-check`, `lint`, `build`, `test` exist
     locally.** The reproduce-failure table in §2.2 of the skill maps
     CI step names to local `make` targets. Update the table to match
     your Makefile targets, or replace `make X` with the raw command.

5. **Stamp `.last-updated`.** Run `git rev-parse HEAD >
   .agent/skills/fix-dependabot-prs/.last-updated` after the first commit
   so the skill has a baseline (per §21.4 an empty file means "never
   run").

6. **Wire the skill into `AGENTS.md`.** Per §21.8, every skill must be
   listed in the project's `AGENTS.md` "Maintenance skills" section with
   a one-line description of when to run it. Add a row pointing at
   `.agent/skills/fix-dependabot-prs/` with the trigger ("Run when the
   Dependabot badge is red" or similar).

7. **Confirm the `.claude/skills` symlink exists.** Per §21.2, the
   tool-specific path must be a symlink to `.agent/skills`. If your
   project doesn't have it yet:
   ```sh
   mkdir -p .claude
   ln -s ../.agent/skills .claude/skills
   ```
   Then commit the symlink so other Claude Code users in the repo see
   the skill automatically.

8. **Add the missing §14 pieces.** Even after dropping these files in,
   the spec still requires:
   - Secret scanning + push protection enabled in repo settings (no
     workflow needed; toggle in Settings → Code security).
   - Dependency review on PRs (`actions/dependency-review-action` as a
     job in `ci.yml`, or the GitHub-native "Dependency review" check).
   - SHA-pinned CI actions (replace `actions/checkout@v6` with
     `actions/checkout@<full-sha> # v6` everywhere; Dependabot will then
     keep the SHA fresh).
   - An SCA CI job (`npm audit --audit-level=high`, `cargo audit`,
     `osv-scanner -r .`, …) that fails on high-severity advisories.

   None of these are in cv at this commit; they are §14 obligations the
   adopter must add separately, not pieces this example provides.

## Caveats

- **`gh pr list --author app/dependabot` is exact-string.** Use
  `app/dependabot`, not `dependabot[bot]`, not `dependabot`. The `gh` CLI
  resolves the slug differently from the REST API and the wrong form
  silently returns 0 PRs — making the workflow always-green and useless.
- **Hourly cron is enough; don't go shorter.** Dependabot itself takes
  minutes to push a rebased branch and trigger CI; running this workflow
  more often than hourly just burns minutes without changing the answer.
- **The skill is intent-driven, not scheduled.** It is not a CI job and
  must not be invoked from a workflow. Running it requires an agent in
  the loop that can resolve merge conflicts, regenerate lockfiles, and
  decide when to give up on a PR. Trying to automate it past that point
  reinvents Dependabot's own auto-merge feature (which is the better
  choice if your team is willing to trust it).
- **`--force-with-lease`, never `--force`.** The skill always uses
  `git push --force-with-lease` when pushing a rebased branch back, so
  a concurrent Dependabot rebase isn't clobbered. If the lease check
  fails, the skill abandons the PR for the current run instead of
  retrying — Dependabot beat us to it and will reopen the work.
- **Squash-merge is non-negotiable in cv's contract.** The skill
  explicitly forbids merge commits and rebase merges. If you adopt this
  in a project that prefers a different strategy, edit the skill's
  Guardrails section to match; otherwise the skill will refuse to merge.
- **The forcing-function workflow is opinionated.** Failing CI on `main`
  while a Dependabot PR is open is a deliberate choice — it makes
  "ignore the queue" impossible. Teams that find this too noisy should
  either delete the workflow, or weaken it to `continue-on-error: true`
  and rely on the badge alone. Don't water it down silently; the whole
  point is the social pressure.
- **No security-update fast lane.** The Dependabot config doesn't split
  out `security-updates: { open-pull-requests-limit: ... }` from the
  general bump schedule. If you want CVE-driven bumps to bypass the
  weekly cadence, add a second block per ecosystem with `schedule:
  interval: daily` and a higher limit, scoped to security updates.

## Provenance

Refreshed by `.agent/skills/copy-example` from `.github/dependabot.yml`,
`.github/workflows/dependabot.yml`, `.agent/skills/fix-dependabot-prs/` at
`niclaslindstedt/cv@846ef7c`.
