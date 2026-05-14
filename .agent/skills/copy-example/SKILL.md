---
name: copy-example
description: "Use when adding or refreshing a reference example for an OSS_SPEC concept. Given a project name from project-index.json and the spec section to showcase, clones the upstream repo, locates the concept's implementation, copies it under examples/<project>/<section>/, and registers a showcase entry in the index."
---

# Copying a reference example into oss-reference

**Governing spec sections:** §13 (Examples) for layout; §21.5 (`update-examples` family) for the maintenance pattern this skill implements; `project-index.schema.json` for the shape of the entries this skill writes.

This repository curates reference implementations of OSS_SPEC concepts as they appear in real projects. The unit of work this skill handles is a single **showcase**: one project's implementation of one OSS_SPEC section, copied into this repo and registered in `project-index.json` so other agents can find it.

The skill is parameterised by:

- `PROJECT` — the `name` field of an entry in `project-index.json` (e.g. `zag`).
- `SECTION` — the OSS_SPEC section to showcase (e.g. `10.3`, `8.4`, `21.5`).
- `SOURCE_PATH` *(optional)* — explicit upstream path. If omitted, the skill infers it from the section number (see "Section → source-path heuristics" below).
- `TITLE` *(optional)* — short label for the showcase. Defaults to the heading text of the section in `OSS_SPEC.md`.

If any of the required inputs are missing or ambiguous, ask the user before proceeding — do **not** guess between two plausible upstream paths.

## Tracking mechanism

`.agent/skills/copy-example/.last-updated` contains the git commit hash of the last successful run. Empty means "never run".

## Inputs and preflight

```sh
PROJECT="${1:?usage: copy-example <project> <section> [source-path] [title]}"
SECTION="${2:?missing OSS_SPEC section}"
SOURCE_PATH="${3:-}"
TITLE="${4:-}"

GITHUB=$(jq -r --arg n "$PROJECT" '.projects[] | select(.name==$n) | .github' project-index.json)
[ -n "$GITHUB" ] && [ "$GITHUB" != "null" ] \
  || { echo "ERROR: $PROJECT not in project-index.json"; exit 1; }

grep -qE "^#{2,4} ${SECTION}\\. |^#{2,4} ${SECTION} " OSS_SPEC.md \
  || { echo "ERROR: §$SECTION not found in OSS_SPEC.md (run sync-oss-spec first)"; exit 1; }
```

## Discovery process

1. **Clone the upstream project** into a scratch directory and capture the head commit:

   ```sh
   SCRATCH=$(mktemp -d)
   git clone --quiet --depth=1 "$GITHUB" "$SCRATCH"
   SRC_COMMIT=$(git -C "$SCRATCH" rev-parse HEAD)
   ```

2. **Resolve the source path** the showcase needs. If `SOURCE_PATH` was passed, validate it; otherwise infer it from the section number.

   Section → source-path heuristics (extend this table as new showcases are added):

   | OSS_SPEC section                          | Typical upstream path(s)                                                                                       |
   | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
   | §2 License                                | `LICENSE`                                                                                                      |
   | §3 README.md                              | `README.md`                                                                                                    |
   | §4 CONTRIBUTING.md                        | `CONTRIBUTING.md`                                                                                              |
   | §5 CODE_OF_CONDUCT.md                     | `CODE_OF_CONDUCT.md`                                                                                           |
   | §6 SECURITY.md                            | `SECURITY.md`                                                                                                  |
   | §7 AGENTS.md (single source of truth)     | `AGENTS.md` and the symlinks listed in §7.1                                                                    |
   | §8.4 CHANGELOG.md                         | `CHANGELOG.md`                                                                                                 |
   | §9 Makefile                               | `Makefile`                                                                                                     |
   | §10.1 CI pipeline                         | `.github/workflows/ci.yml`                                                                                     |
   | §10.3 Release pipeline                    | `.github/workflows/version-bump.yml`, `.github/workflows/release.yml`, `scripts/release.sh`, `scripts/generate-changelog.sh`, `scripts/update-versions.sh` (last two when present — the release workflow calls them) |
   | §10.4 Website deployment                  | `.github/workflows/pages.yml`                                                                                  |
   | §10.5 Toolchain pinning                   | `rust-toolchain.toml` / `.nvmrc` / `.python-version` / `go.mod` `toolchain` directive (whichever applies)      |
   | §11.1 docs/                               | `docs/`                                                                                                        |
   | §11.2 website/                            | `website/`                                                                                                     |
   | §11.3 SEO and discoverability             | the relevant subset of `website/` plus any `scripts/` that prerender or generate metadata                      |
   | §12.x CLI surfaces                        | `src/` entry points for `--help-agent`, `--debug-agent`, `man/`, `docs`/`man` subcommands                      |
   | §13.5 prompts/                            | `prompts/`                                                                                                     |
   | §15 issue + PR templates                  | `.github/ISSUE_TEMPLATE/`, `.github/PULL_REQUEST_TEMPLATE.md`                                                  |
   | §19 logging                               | `src/output.*` (or the project's equivalent central output module)                                             |
   | §21.x agent skills                        | `.agent/skills/<skill-name>/`                                                                                  |
   | §22 bootstrap checklist                   | not a single file — skip; use `update-readme` if a README needs the checklist quoted                           |

   If the heuristic fires multiple candidates and the user did not specify, ask which to copy. If the path does not exist upstream:

   ```sh
   [ -e "$SCRATCH/$SOURCE_PATH" ] \
     || { echo "ERROR: $SOURCE_PATH not found in $GITHUB@$SRC_COMMIT"; exit 1; }
   ```

3. **Compute the destination** under `examples/`:

   ```sh
   # Section numbers are dotted; keep dots so the path mirrors the spec.
   DEST="examples/$PROJECT/$SECTION"
   ```

   For a section that spans multiple upstream files in different directories (e.g. §10.3, which mixes `.github/workflows/*.yml` with `scripts/*.sh`), use the section number as the destination directory and **preserve the upstream relative path** under it (`examples/<project>/<section>/.github/workflows/release.yml`, `examples/<project>/<section>/scripts/release.sh`, …). Flattening every file into one directory loses the distinction between workflows and scripts and makes the example unreadable. Only flatten when every copied file genuinely belongs in the same directory.

4. **Copy the files**, preserving symlinks. `rsync -a` is the cleanest tool when available; fall back to `cp -a` if it isn't installed (common in minimal containers):

   ```sh
   rm -rf "$DEST"
   mkdir -p "$DEST"
   COPY="rsync -a"; command -v rsync >/dev/null || COPY="cp -a"
   if [ -d "$SCRATCH/$SOURCE_PATH" ]; then
     $COPY "$SCRATCH/$SOURCE_PATH/" "$DEST/"
   else
     # When preserving upstream layout, recreate the parent directory first.
     mkdir -p "$DEST/$(dirname "$SOURCE_PATH")"
     $COPY "$SCRATCH/$SOURCE_PATH" "$DEST/$SOURCE_PATH"
   fi
   ```

5. **Add a README inside `$DEST`** describing what this example is, which upstream commit it came from, and which OSS_SPEC section it implements. One paragraph is enough:

   ```markdown
   # <project> §<section> — <title>

   Reference implementation of OSS_SPEC.md §<section> as it appears in
   [<project>](<github>) at commit `<short-sha>`.

   <one paragraph explaining what the example demonstrates and where to look first>

   Refreshed by `.agent/skills/copy-example` from `<source_path>`.
   ```

6. **Register the showcase** in `project-index.json`. If an entry with the same `section` already exists for this project, replace it; otherwise append:

   ```sh
   TITLE="${TITLE:-$(awk -v s="$SECTION" '
     $0 ~ "^#{2,4} " s "\\. |^#{2,4} " s " " {
       sub(/^#+ +[0-9.]+ +/, ""); print; exit
     }' OSS_SPEC.md)}"

   tmp=$(mktemp)
   jq --arg p "$PROJECT" --arg s "$SECTION" --arg t "$TITLE" \
      --arg src "$SOURCE_PATH" --arg dest "$DEST" --arg c "$SRC_COMMIT" \
      '
      .projects |= map(
        if .name == $p then
          .showcases = ((.showcases // []) | map(select(.section != $s))
                        + [{
                            section: $s, title: $t, path: $dest,
                            source_path: $src, source_commit: $c
                          }])
        else . end
      )
      ' project-index.json > "$tmp" && mv "$tmp" project-index.json
   ```

7. **Validate**:

   ```sh
   npx -y -p ajv-cli@5 -p ajv-formats@3 ajv validate \
     -s project-index.schema.json -d project-index.json \
     --spec=draft2020 -c ajv-formats
   ```

## Mapping table

| Situation                                             | Action                                                                                                                                                                                            |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First showcase for a project                          | Create `examples/<project>/`, copy files in, append the first showcase entry under the project's `showcases` array.                                                                               |
| Refreshing an existing showcase                       | Same flow; the `jq` script above drops the old entry for the same `section` before appending the new one.                                                                                         |
| The upstream path moved (rename, restructure)         | Pass the new `SOURCE_PATH` explicitly. Update the heuristics table above so the next agent picks the new path automatically.                                                                      |
| The section needs multiple files                      | Copy each file into the same `examples/<project>/<section>/` directory; record the directory in `path` and a comma-joined or representative file path in `source_path` (or expand the schema).   |
| The section concept does not exist upstream           | Stop and tell the user which projects *do* implement it — don't fabricate an example.                                                                                                              |
| Upstream license forbids redistribution               | Stop. Record the link in the showcase's `notes` field with `path` omitted, so the index points readers at the upstream rather than copying.                                                       |

## Update checklist

- [ ] Confirm `PROJECT` exists in `project-index.json` and `§SECTION` exists in `OSS_SPEC.md`.
- [ ] Clone the upstream repo and capture `SRC_COMMIT`.
- [ ] Resolve `SOURCE_PATH` (from the user, from the heuristics table, or interactively).
- [ ] Copy files into `examples/<project>/<section>/`, preserving symlinks.
- [ ] Write or refresh the destination `README.md` with the project / section / commit attribution.
- [ ] Upsert the showcase entry in `project-index.json` and revalidate against the schema.
- [ ] Stamp the baseline:

      git rev-parse HEAD > .agent/skills/copy-example/.last-updated

## Verification

1. `examples/<project>/<section>/` exists and is non-empty.
2. `examples/<project>/<section>/README.md` names the upstream commit.
3. `ajv validate -s project-index.schema.json -d project-index.json` exits 0.
4. `jq '.projects[] | select(.name == $p) | .showcases[] | select(.section == $s)' --arg p "$PROJECT" --arg s "$SECTION" project-index.json` returns exactly one object whose `source_commit` matches `SRC_COMMIT`.
5. `.last-updated` was rewritten with the current `HEAD`.

## Skill self-improvement

After a run, extend this file:

1. **Extend the section → source-path heuristics table** whenever you resolve a section that was not yet covered.
2. **Record edge cases** (multi-file sections, license caveats, license-only mirrors) as new rows in the mapping table.
3. **Flag projects that are bad fits** — if a project keeps producing partial or non-canonical examples, note it here so the next agent can pick a better source for that section.
4. **Commit the skill edit** alongside the example so the knowledge compounds.
