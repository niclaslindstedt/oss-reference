# Agent guidance for oss-reference

This file is the canonical source of truth for AI coding agents working in this
repo. `CLAUDE.md`, `.cursorrules`, `.windsurfrules`, `GEMINI.md`,
`.aider.conf.md`, and `.github/copilot-instructions.md` are symlinks to this
file.

## What this repo is

`oss-reference` is a curated collection of reference examples for the concepts
defined in [`OSS_SPEC.md`](OSS_SPEC.md) (the canonical version lives in
[`niclaslindstedt/oss-spec`](https://github.com/niclaslindstedt/oss-spec)). Each
example is copied verbatim from a real project that implements the
corresponding spec section, so readers — human or agent — can see what a
conforming implementation actually looks like in the wild.

Reference projects are tracked in [`project-index.json`](project-index.json),
validated against [`project-index.schema.json`](project-index.schema.json).
Examples live under `examples/<project>/<section>/`.

This repo is intentionally **not** itself a full OSS_SPEC implementation. It
ships the spec text, the project index, and the maintenance skills — but not
the §10 release pipeline, §11.2 website, §12 CLI surfaces, etc. The spec
mandates this repo follows are only the ones that keep the index honest.

## Project index

`project-index.json` is the source of truth for which upstream projects this
repo curates. Every entry has:

- `name` — kebab-case, matches the GitHub repo name.
- `description`, `github`, `language`, `status` — basic provenance.
- `showcases` — zero or more `{section, title, path, source_path,
  source_commit}` records pointing each spec section at the local example and
  the upstream commit it was copied from.

Edit the index only through the `copy-example` and `sync-oss-spec` skills
(both run via Claude Code). They are responsible for keeping `source_commit`
honest, dropping stale entries, and re-validating against the schema. Hand
edits to the index are allowed but should be rerun through `ajv validate -s
project-index.schema.json -d project-index.json` before committing.

## OSS_SPEC conformance

The local `OSS_SPEC.md` is a **copy** of the canonical spec, refreshed by
`sync-oss-spec`. The `spec_version` field in `project-index.json` tracks the
version this repo's showcases are validated against; bumping it is part of the
sync skill's job.

When in doubt about a layout, naming, or workflow decision, consult the
relevant section of `OSS_SPEC.md` — it is the source of truth for the
conventions this repo follows.

## Where new code goes

| Change type                          | Goes in                                                |
| ------------------------------------ | ------------------------------------------------------ |
| New reference example                | `examples/<project>/<section>/` (run `copy-example`)   |
| New indexed project                  | New entry in `project-index.json`                      |
| New field on a project / showcase    | First update `project-index.schema.json`, then the data |
| New maintenance skill                | `.agent/skills/<skill-name>/SKILL.md` (+ `.last-updated`) |
| Spec refresh                         | Run `sync-oss-spec` — never hand-edit `OSS_SPEC.md`    |

## Maintenance skills

Per §21 of `OSS_SPEC.md`, this repo ships agent skills for keeping drift-prone
artifacts in sync with their sources of truth. Skills live under
`.agent/skills/<name>/` and are accessible via the `.claude/skills` symlink.

| Skill            | When to run                                                                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sync-oss-spec`  | When `OSS_SPEC.md` may have moved upstream or when indexed examples may be stale. Fetches the spec, syncs `spec_version`, refreshes stale showcases. |
| `copy-example`   | When adding or refreshing a reference example. Given a project + spec section, clones the upstream repo, copies the implementation, updates the index. |

Each skill has a `SKILL.md` (the playbook) and a `.last-updated` file (the
baseline commit hash). Run a skill by loading its `SKILL.md` and following the
discovery process and update checklist. The skill rewrites `.last-updated` at
the end of a successful run, and improves itself in place when it discovers
new mapping entries.

## Commit conventions

Follow [Conventional Commits](https://www.conventionalcommits.org/). Common
scopes in this repo: `index` (project-index changes), `spec` (OSS_SPEC.md
refresh), `examples` (added or refreshed showcase), `skills` (skill
playbook edits).

## OSS_SPEC deviations

This repo is a reference collection, not a shipped product. The following
`OSS_SPEC.md` obligations are intentionally skipped. If `sync-oss-spec` or an
equivalent check flags one of these, leave it alone — the deviation is a
design choice, not drift.

- **§2 LICENSE / §4 CONTRIBUTING.md / §5 CODE_OF_CONDUCT.md / §6 SECURITY.md** —
  not yet authored. Will be added as the repo grows past its bootstrap shape.
- **§8.4 `CHANGELOG.md`** — not maintained. There is no release cadence.
- **§9 Makefile** — minimal; this repo has no build step.
- **§10 CI / release pipeline / website deployment** — none. Examples are
  copied in by hand via `copy-example`; no automated gate exists yet.
- **§11.1 docs/ / §11.2 website/ / §11.3 SEO** — N/A. The index *is* the
  documentation surface.
- **§12 CLI obligations** — N/A. This repo ships no binary.
- **§13.5 prompt versioning** — the two skills here are short enough to inline
  their guidance in `SKILL.md`. Versioned `prompts/<skill>/<version>.md` files
  will land if a skill grows past one screen.
- **§15 issue / PR templates** — not yet authored.
- **§20 test organization** — N/A. There is no `src/` to test.
- **§21.5 required `update-*` skills** — `update-readme`, `update-docs`,
  `update-website`, and `update-manpages` are omitted because their target
  artifacts (a meaningful README beyond this stub, `docs/`, `website/`, `man/`)
  do not yet exist. They will be added when those artifacts exist.
- **§21.6 `maintenance` umbrella skill** — omitted while only two skills exist
  and they run in obvious order (sync, then copy). Will be added the moment a
  third skill lands.
