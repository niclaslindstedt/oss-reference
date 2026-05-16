# zag §21.5 — `sync-oss-spec` skill

Reference implementation of the `sync-oss-spec` maintenance skill that
[OSS_SPEC.md §21.5](../../../OSS_SPEC.md) requires of every project that
claims spec conformance, as it appears in
[zag](https://github.com/niclaslindstedt/zag) at commit `54c70b9`.

Unlike `update-spec` (which propagates a new mandate from the spec into
code), `sync-oss-spec` works the other way: it runs the spec's
conformance validator against the local repo, walks the resulting
violations, and fixes each one until the validator reports zero. This
showcase captures zag's playbook for that walk — the discovery process,
the violation→fix mapping table, and the verification loop. §21.5
enumerates several other required skills (`update-readme`, `update-docs`,
`update-website`, `update-manpages`, `maintenance`); they are out of
scope for this showcase, which is scoped to the `sync-oss-spec` skill
described in the section's closing paragraphs.

## File layout

```
SKILL.md             # the playbook: discovery, mapping table, verification, self-improvement
.last-updated        # baseline commit hash; empty means "never run"
```

## How this sits in zag

- **Canonical location.** Per §21.2, the skill lives at
  `.agent/skills/sync-oss-spec/` upstream. zag also ships `.claude/skills`
  as a symlink to `.agent/skills`, so the skill is discoverable by both
  the agent-neutral path and Claude Code's expected location. References
  inside `SKILL.md` use the `.claude/skills/sync-oss-spec/` path because
  that is the path Claude Code agents see.
- **Validator strategy.** zag is a **consumer** of the spec, not the
  reference Rust implementation, so it has no local `cargo run --
  validate`. The skill instead defaults to the **nonbinary fallback** —
  the bash mirror `scripts/validate.sh` published by the upstream
  `niclaslindstedt/oss-spec` repo — fetched on demand:

  ```sh
  curl -fsSL https://raw.githubusercontent.com/niclaslindstedt/oss-spec/main/scripts/validate.sh | bash -s -- .
  ```

  This keeps the skill runnable inside sandboxed agent sessions, CI
  runners with no Rust toolchain, and freshly-cloned checkouts. If a
  project vendors `scripts/validate.sh` locally, the skill prefers that
  copy.
- **Mapping table coverage.** The §X.Y → fix recipe table in `SKILL.md`
  covers every violation class zag has actually hit so far: §2 LICENSE,
  §7.1 tool-specific symlinks, §10.x missing/under-pinned workflows,
  §20.x test-organisation and source-size limits, §21.2/§21.3/§21.4/§21.5/§21.6
  skill-shape rules. New rows are appended as new violation classes
  surface — see the "Skill self-improvement" section at the bottom of
  `SKILL.md`.
- **Baseline tracking.** `.last-updated` holds the commit hash from the
  most recent successful run. Empty means "never run", in which case the
  skill uses `git rev-list --max-parents=0 HEAD` (the repo's initial
  commit) as the baseline so the first run still has a sane `OSS_SPEC.md`
  diff to inspect.
- **Position in the drift sweep.** zag's `maintenance` umbrella skill
  runs the per-artifact `update-*` skills first; `sync-oss-spec` runs
  last so it catches residual violations no per-artifact skill touched.

## How to adopt this in another project

1. **Decide your validator strategy.** If your project ships the
   reference `oss-spec` binary (i.e. you are the `oss-spec` repo
   itself), point the skill at `cargo run -- validate .`. Otherwise
   adopt zag's nonbinary fallback: the bash mirror fetched via `curl`
   from `niclaslindstedt/oss-spec`. The fallback works on any toolchain,
   including environments without Rust installed.

2. **Drop the files in.** Copy `SKILL.md` and `.last-updated` to
   `.agent/skills/sync-oss-spec/` in your repo. If you symlink
   `.claude/skills` to `.agent/skills` (§21.2), the skill becomes
   visible to Claude Code with no further wiring. Leave `.last-updated`
   empty on first commit — the skill itself rewrites it after a
   successful run.

3. **Localise the mapping table to your stack.** zag's table is
   Rust-centric in places — §20 references `#[cfg(test)] mod { … }`
   blocks and `tests/<module>_tests.rs` files, which are Rust-specific.
   Rewrite those rows for your language's test conventions while keeping
   the framing identical: each row is a `§X.Y` section the validator
   flags plus the canonical fix. The §2/§7.1/§10.x/§21.x rows are
   language-agnostic and can stay verbatim.

4. **Register the skill with your `maintenance` umbrella.** Per §21.6,
   the `maintenance` skill must list every individual skill in its
   registry, alphabetised, with a run-order slot. Slot `sync-oss-spec`
   **last** so the per-artifact `update-*` skills run first and
   `sync-oss-spec` only has to mop up residuals.

5. **Smoke-test.** Run the skill against your repo and confirm:
   - The validator (binary or curl one-liner) exits non-zero with at
     least one violation on a deliberately broken checkout (delete
     `LICENSE` to test §2).
   - The mapping table covers that violation, or you grow the table to
     cover it.
   - The skill writes the new baseline to `.last-updated` after the fix
     lands and the validator exits 0.

6. **Wire it into your drift-sweep cadence.** Run `sync-oss-spec` at
   least on every PR that touches `OSS_SPEC.md`, and periodically (e.g.
   weekly) against `main` to catch passive drift. CI can wrap the curl
   one-liner directly — no skill runner needed.

## Caveats

- The mapping table assumes the spec sections you cite still exist in
  the upstream `OSS_SPEC.md` at the version your repo claims to conform
  to. If `OSS_SPEC.md` renumbers sections (a §X.Y becomes §X.Z), the
  table rows must be updated, ideally as part of the same `sync-oss-spec`
  run that observes the renumbering — otherwise the table silently
  points at stale anchors.
- The nonbinary fallback fetches `scripts/validate.sh` from the upstream
  `main` branch every run. If you need reproducibility (e.g. for a
  release-gating check), vendor a pinned copy at `scripts/validate.sh`
  and run that instead; the skill prefers the vendored copy when
  present.
- The skill explicitly forbids "fixing" a violation by editing
  `OSS_SPEC.md` itself or by pinning to an older mirror — those silence
  the symptom without addressing the drift. The verification step is
  built around this: every violation present before the run must have a
  matching edit elsewhere in the diff.
- Rust-specific rows in the mapping table (§20 inline tests, §20.5
  source size, §20.2 test file stem regex) will fire as false negatives
  on non-Rust projects unless you rewrite them for your language's test
  conventions before the first real run.

## Provenance

Refreshed by `.agent/skills/copy-example` from
`.agent/skills/sync-oss-spec/` at `niclaslindstedt/zag@54c70b9`.
