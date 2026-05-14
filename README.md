# oss-reference

Reference examples for [OSS_SPEC](https://github.com/niclaslindstedt/oss-spec)
concepts, drawn from real projects that implement them.

`OSS_SPEC.md` is a prescriptive, language-agnostic specification for
bootstrapping an open-source project. It tells you *what* a release pipeline,
a changelog, a `--help-agent` flag, or a `sync-oss-spec` skill must look like.
This repo answers the next question: *what does a conforming implementation
actually look like in the wild?* — by mirroring concrete files from working
projects, attributed back to the upstream commit they were copied from.

## What's in here

| Path                          | Purpose                                                                 |
| ----------------------------- | ----------------------------------------------------------------------- |
| `OSS_SPEC.md`                 | Local copy of the canonical spec, refreshed by the `sync-oss-spec` skill |
| `project-index.json`          | Index of projects that implement OSS_SPEC, and which sections each one showcases |
| `project-index.schema.json`   | JSON Schema (draft 2020-12) that `project-index.json` validates against |
| `examples/<project>/<section>/` | Verbatim copies of upstream implementations, one folder per showcase    |
| `AGENTS.md`                   | Guidance for AI coding agents working in this repo                      |
| `.agent/skills/`              | Maintenance playbooks (see below); also surfaced via `.claude/skills`   |

## Indexed projects

The initial index covers public projects under
[`github.com/niclaslindstedt`](https://github.com/niclaslindstedt):

- [`zag`](https://github.com/niclaslindstedt/zag) — one CLI across Claude,
  Codex, Gemini, Copilot, and Ollama.
- [`zig`](https://github.com/niclaslindstedt/zig) — describe, share, and run
  workflows; written in Rust.
- [`zad`](https://github.com/niclaslindstedt/zad) — agent adapter system
  for fan-out to multiple service providers.
- [`ztf`](https://github.com/niclaslindstedt/ztf) — end-to-end testing
  harness for agent flows.
- [`juris`](https://github.com/niclaslindstedt/juris) — Swedish legal
  document collector in Python.
- [`spotifai`](https://github.com/niclaslindstedt/spotifai) —
  AI-augmented Spotify companion.
- [`cv`](https://github.com/niclaslindstedt/cv) — personal site / CV in
  Vite + React + TypeScript.
- [`blog`](https://github.com/niclaslindstedt/blog) — terminal-themed
  Markdown blog maintained by Claude skills.

Add more by extending `project-index.json` (and re-validating against
`project-index.schema.json`).

## Maintenance skills

Two playbooks under `.agent/skills/` keep this repo honest:

- **`sync-oss-spec`** — fetches the latest `OSS_SPEC.md` from
  `niclaslindstedt/oss-spec`, replaces the local copy if it drifted, syncs
  `spec_version` in the index, and walks every showcase to flag stale
  upstream commits. Stale showcases are dispatched back to `copy-example`.
- **`copy-example`** — given a project from the index and an OSS_SPEC
  section, clones the upstream repo, copies the concept's implementation
  into `examples/<project>/<section>/`, writes a README inside that folder
  with provenance (project, section, source commit), and registers the
  showcase in `project-index.json`.

Each skill is a self-contained `SKILL.md` plus a `.last-updated` commit-hash
file. Run a skill by loading its `SKILL.md` and following the discovery
process and update checklist; the skill updates its own `.last-updated` when
it finishes.

## Workflow

Add a new reference example:

```sh
# Conceptual — the skill's discovery process spells out the exact commands.
# Load .agent/skills/copy-example/SKILL.md and run with:
#   PROJECT=zag SECTION=10.3
```

Refresh everything against the upstream spec:

```sh
# Load .agent/skills/sync-oss-spec/SKILL.md and follow its checklist.
```

## Status

Bootstrap shape only. No examples have been copied in yet — `showcases` is
empty for every project in the index. The next step is to run `copy-example`
for a handful of representative sections (e.g. `zag` §10.3 release pipeline,
`blog` §21 maintenance skills, `juris` §12 CLI surfaces).
