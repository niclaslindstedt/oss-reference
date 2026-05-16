---
name: fix-dependabot-prs
description: "Use when the user wants to clean up the open Dependabot PR queue. Walks the open Dependabot PRs newest-first, merges the green ones, then rebases and fixes the CI-failing ones, pushes, waits for CI, and merges."
---

# fix-dependabot-prs

Drain the open Dependabot PR queue end-to-end:

1. **Pass 1 — merge the green ones.** Walk all open Dependabot PRs
   newest-first and squash-merge any PR whose CI is green. Skip PRs
   that Dependabot is currently rebasing (the body says so).
2. **Pass 2 — repair the failing ones.** For every remaining open
   Dependabot PR with failing CI, manually rebase onto `main`, fix the
   problem, push, and let CI re-run.
3. **Pass 3 — merge the repaired ones.** After all repairs are pushed,
   wait 3 minutes for CI to settle, then merge any that turned green.

The skill is intent-driven — only run when the user asks for it.

## Inputs the skill needs

- The repository the user is working in. Resolve once with
  `git remote get-url origin` and reuse for every MCP call.
- A working tree on a throwaway branch is fine — the skill checks out
  Dependabot PR branches with `git fetch` + `git checkout`, so any
  uncommitted local work must be stashed or committed first. Refuse to
  start if `git status --short` is non-empty.

## Pass 1 — merge the green ones

### 1.1 Discover the queue

Use `mcp__github__list_pull_requests` with `state: "open"` and
`sort: "created"`, `direction: "desc"` to get newest-first. Filter
client-side to PRs whose author login is `dependabot[bot]`.

For each PR, capture:

- `number`, `title`, `head.ref` (branch), `base.ref` (usually `main`)
- `body` (used to detect rebasing state)
- `mergeable_state` / `mergeable`

### 1.2 Skip rules

Skip a PR in this pass if **any** of these is true:

- The PR body contains the phrase `Dependabot is rebasing` (case
  insensitive). Dependabot writes this into the PR description while a
  rebase is in flight; touching the branch races with it.
- The PR is in `draft` state.
- The PR has merge conflicts (`mergeable_state == "dirty"`).
- CI is not green — leave it for Pass 2.

### 1.3 Check CI

Use `mcp__github__pull_request_read` with `method: "status"` (or read
the combined status / check runs) on the PR's head SHA. A PR is green
only if **every** required check has concluded `success`. A single
`failure`, `cancelled`, `timed_out`, or still-running check disqualifies
it from this pass.

### 1.4 Merge

For each green PR, call `mcp__github__merge_pull_request` with
`merge_method: "squash"` (squash is the only permitted strategy per
`CLAUDE.md`). Use the PR title as the squash commit subject so the
Conventional-Commits prefix Dependabot already chose (e.g.
`build(deps): bump foo from 1.2.3 to 1.2.4`) ends up on `main`.

Continue down the list until every green PR is merged. Newest-first
matters because merging a newer bump for the same package can render
older PRs in the queue obsolete — Dependabot will close them
automatically once their target version has been superseded.

## Pass 2 — repair the failing ones

After Pass 1, the only remaining open Dependabot PRs are:

- ones currently rebasing (skip — Dependabot owns them),
- ones with failing CI or merge conflicts (this pass handles them).

For each failing PR, newest-first:

### 2.1 Check out the branch locally

```sh
git fetch origin <head.ref>
git checkout <head.ref>
git rebase origin/<base.ref>
```

If the rebase has conflicts, resolve them and `git rebase --continue`.
For Dependabot version bumps the conflicts are almost always inside
`package-lock.json`. Don't hand-edit the lockfile — re-run the package
manager so the lockfile is regenerated against the bumped version in
`package.json`:

```sh
git checkout --theirs package-lock.json   # accept main's lockfile
npm install                                # regenerate against package.json
git add package-lock.json
git rebase --continue
```

### 2.2 Reproduce the CI failure

Read the failing check run logs via the MCP GitHub tools (or the
status API) to identify which step failed. Then run the equivalent
`make` target locally:

| Failing CI step | Local command      |
| --------------- | ------------------ |
| Format check    | `make fmt-check`   |
| Schema validate | `make validate`    |
| Lint / types    | `make lint`        |
| Build           | `make build`       |
| Unit tests      | `make test`        |
| Visual tests    | `make test-visual` |
| Lighthouse      | `make lighthouse`  |

Fix the underlying cause — never bypass the check (no `--no-verify`,
no skipped tests). If the bump genuinely breaks the codebase (API
change in the dependency), patch the consuming code in `src/`.
For visual snapshot drift caused only by a dependency upgrade,
re-record with `make test-visual-update` and commit the new pixels.

### 2.3 Push

Force-push the rebased branch back to its Dependabot remote:

```sh
git push --force-with-lease origin <head.ref>
```

`--force-with-lease` (not `--force`) so a concurrent Dependabot
rebase doesn't get clobbered. If the lease check fails, Dependabot
beat us to it — abandon this PR for the current run and move on.

### 2.4 Move on

Don't wait for CI yet. Continue to the next failing PR so all repairs
run their CI in parallel.

## Pass 3 — merge the repaired ones

Once every failing PR from Pass 2 has been pushed:

1. Wait 3 minutes (`sleep 180`) so CI has time to start and finish on
   the small surface a Dependabot bump touches.
2. Re-list the open Dependabot PRs and re-check CI for the ones touched
   in Pass 2.
3. Squash-merge any that are now green, exactly like Pass 1.
4. Anything still red after the wait stays open — surface it to the
   user with the failing check name and a one-line diagnosis. Don't
   loop indefinitely.

## Reporting

At the end, print a table:

| PR  | Title | Outcome                                                    |
| --- | ----- | ---------------------------------------------------------- |
| #N  | …     | merged / skipped (rebasing) / left open (CI red after fix) |

So the user can see at a glance what landed and what still needs eyes.

## Guardrails

- **Squash merge only.** Never use merge or rebase merge — `CLAUDE.md`
  forbids it.
- **Never push to `main`.** Only the merge call writes to `main`, via
  the MCP `merge_pull_request` tool.
- **Respect Dependabot's rebases.** The `Dependabot is rebasing` marker
  in a PR body is a hard skip — don't checkout, don't push.
- **No `--no-verify`, no skipped tests.** A failing check is a real
  failure; fix the cause.
- **Stop on repeated failure.** If the same PR fails CI twice after a
  repair attempt, leave it open and report it. Don't burn cycles.
