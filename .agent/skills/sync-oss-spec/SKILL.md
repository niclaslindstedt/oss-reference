---
name: sync-oss-spec
description: "Use when OSS_SPEC.md may have moved upstream or when the indexed examples may be stale. Fetches the latest spec, updates the local copy and the index's spec_version, then walks every showcase in project-index.json and refreshes any whose upstream source_commit has diverged."
---

# Syncing oss-reference with OSS_SPEC.md

**Governing spec sections:** the entire `OSS_SPEC.md` (this repo curates reference implementations of its mandates), plus §21.5 (which recommends every project claiming conformance to the spec ship a `sync-oss-spec` skill).

This repository's job is to curate reference examples of OSS_SPEC concepts as implemented in real projects. When the spec moves, the examples it points at may no longer exemplify the latest wording — and when the indexed projects move, the examples copied from them may go stale. This skill is the single playbook for bringing both back into sync.

It is fully standalone: it fetches the canonical spec from GitHub, replaces the local copy on drift, and walks `project-index.json` to refresh stale showcases. Do **not** depend on any external validator binary — agents that do not ship the `oss-spec` CLI must still be able to run this skill end-to-end.

## Tracking mechanism

`.agent/skills/sync-oss-spec/.last-updated` contains the git commit hash of the last successful run. Empty means "never run" — use the repo's initial commit (`git rev-list --max-parents=0 HEAD`) as the baseline.

## Fetch the canonical spec

The upstream source of truth is the `main` branch of `niclaslindstedt/oss-spec`. Pull it into a scratch file at the start of every run:

```sh
SPEC_URL="https://raw.githubusercontent.com/niclaslindstedt/oss-spec/main/OSS_SPEC.md"
SPEC_TMP="$(mktemp -t oss-spec.XXXXXX.md)"
curl -fsSL "$SPEC_URL" -o "$SPEC_TMP"
```

If `curl` is unavailable, fall back to `wget -qO "$SPEC_TMP" "$SPEC_URL"`. Never proceed with a stale local copy — a failed fetch is a hard stop, not a silent skip.

Record the upstream spec version so every downstream decision is made against a known target:

```sh
SPEC_VERSION=$(awk '/^version:/ {print $2; exit}' "$SPEC_TMP")
echo "upstream OSS_SPEC.md version: $SPEC_VERSION"
```

Compare the fetched copy against the local one and overwrite on drift:

```sh
if [ -f OSS_SPEC.md ]; then
  diff -u OSS_SPEC.md "$SPEC_TMP" || cp "$SPEC_TMP" OSS_SPEC.md
else
  cp "$SPEC_TMP" OSS_SPEC.md
fi
```

If the spec was rewritten, sync the version in the index too:

```sh
INDEX_SPEC_VERSION=$(jq -r '.spec_version' project-index.json)
if [ "$INDEX_SPEC_VERSION" != "$SPEC_VERSION" ]; then
  tmp=$(mktemp)
  jq --arg v "$SPEC_VERSION" '.spec_version = $v' project-index.json > "$tmp" \
    && mv "$tmp" project-index.json
fi
```

## Discovery process

1. Read the baseline and list every commit that may have introduced drift since then:

   ```sh
   BASELINE=$(cat .agent/skills/sync-oss-spec/.last-updated)
   git log --oneline "$BASELINE"..HEAD
   git diff --name-only "$BASELINE"..HEAD
   ```

2. Validate that `project-index.json` still matches `project-index.schema.json`:

   ```sh
   # Any JSON Schema draft 2020-12 validator will do; example with ajv-cli:
   npx -y -p ajv-cli@5 -p ajv-formats@3 ajv validate \
     -s project-index.schema.json -d project-index.json \
     --spec=draft2020 -c ajv-formats
   ```

   `ajv-formats` is needed because the schema uses the `uri` and `date`
   formats; without it `ajv-cli` errors out on the unknown format names.

   Validation failures are blockers — fix them before continuing.

3. Walk every showcase and check whether its upstream has moved since `source_commit`:

   ```sh
   jq -r '.projects[] as $p
          | $p.showcases // []
          | .[]
          | select(.source_commit != null)
          | "\($p.name)\t\($p.github)\t\(.section)\t\(.source_path // "")\t\(.source_commit)\t\(.path // "")"' \
     project-index.json |
   while IFS=$'\t' read -r name github section src_path src_commit dest; do
     scratch=$(mktemp -d)
     git clone --quiet --filter=blob:none "$github" "$scratch" || {
       echo "FETCH-FAIL: $name"; continue;
     }
     head=$(git -C "$scratch" rev-parse HEAD)
     if [ "$head" != "$src_commit" ]; then
       # Has the showcase's source path actually changed?
       if [ -n "$src_path" ] && \
          ! git -C "$scratch" diff --quiet "$src_commit" "$head" -- "$src_path"; then
         echo "STALE: $name §$section ($src_path) — re-run copy-example"
       elif [ -z "$src_path" ]; then
         echo "STALE: $name §$section (no source_path recorded) — re-run copy-example"
       else
         # Upstream moved but not this path. Just bump source_commit.
         echo "BUMP:  $name §$section -> $head"
       fi
     fi
     rm -rf "$scratch"
   done
   ```

4. Confirm the spec sections referenced by every showcase still exist in the fetched spec:

   ```sh
   jq -r '.projects[].showcases // [] | .[].section' project-index.json |
   sort -u |
   while read -r s; do
     [ -z "$s" ] && continue
     grep -qE "^#{2,4} ${s}\\. |^#{2,4} ${s} " "$SPEC_TMP" \
       || echo "MISSING-SECTION: §$s no longer exists in OSS_SPEC.md"
   done
   ```

## Mapping table

| Symptom                                                            | Where to fix it                                                                                                                                                                                                                            |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `OSS_SPEC.md` differs from `$SPEC_TMP`                             | Overwrite the local copy with `$SPEC_TMP`. Then update `project-index.json` `spec_version` if it has changed.                                                                                                                              |
| `project-index.json` fails schema validation                       | Edit `project-index.json` until `ajv` (or equivalent) reports no errors. Adjust the schema only if the spec demands a new field.                                                                                                           |
| `STALE: …` reported for a showcase                                 | Run the `copy-example` skill with the same project + section. It re-clones the upstream repo, replaces files under `examples/<project>/<section>/`, and rewrites the showcase's `source_commit`. Commit the refreshed example separately.  |
| `BUMP: …` reported (upstream moved, path unchanged)                | Update only `source_commit` in `project-index.json` — no file changes needed.                                                                                                                                                              |
| `MISSING-SECTION: §X` (section removed or renumbered upstream)     | Re-read the relevant area of `$SPEC_TMP` to find where the content moved. Update every affected showcase's `section` and `title`. If the concept was dropped entirely, remove the showcase and its `examples/<project>/<section>/` folder. |
| A project in `project-index.json` no longer exists upstream        | Mark its `status` as `archived` if the repo is read-only on GitHub. If the repo was deleted, remove the project entry and any `examples/<project>/` folder.                                                                                |
| Schema gains a new optional field                                  | Add it to `project-index.schema.json`, then write the new field on the entries that need it.                                                                                                                                               |

## Update checklist

- [ ] Fetch `$SPEC_URL` into `$SPEC_TMP`; abort on failure.
- [ ] Diff `$SPEC_TMP` against `OSS_SPEC.md`; overwrite on drift.
- [ ] If `SPEC_VERSION` differs from `.spec_version` in the index, sync the value.
- [ ] Validate `project-index.json` against `project-index.schema.json`.
- [ ] Run discovery step 3 — for each `STALE`, dispatch to `copy-example`; for each `BUMP`, just rewrite `source_commit`.
- [ ] Run discovery step 4 — fix any `MISSING-SECTION` by remapping or removing the showcase.
- [ ] Re-run every check above; all must report nothing.
- [ ] Stamp the new baseline:

      git rev-parse HEAD > .agent/skills/sync-oss-spec/.last-updated

## Verification

1. `diff OSS_SPEC.md "$SPEC_TMP"` is empty.
2. `.spec_version` in `project-index.json` equals the spec's YAML `version`.
3. `ajv validate -s project-index.schema.json -d project-index.json` exits 0.
4. Re-running discovery step 3 prints no `STALE` or `BUMP` lines.
5. Re-running discovery step 4 prints no `MISSING-SECTION` lines.
6. `.last-updated` was rewritten with the current `HEAD`.

## Skill self-improvement

After a run, extend this file:

1. **Grow the mapping table** whenever a new failure mode appears that this table does not yet cover.
2. **Extend the discovery steps** whenever the spec or index schema gains a new structural rule worth checking automatically here.
3. **Record fix recipes** (exact commands or edit patterns) for failures that required more than a one-line change.
4. **Flag recurring drift** — if the same showcase keeps going stale, consider whether the upstream path is too narrow, the source project is too volatile to track, or `copy-example` needs a better mapping for this section.
5. **Commit the skill edit** alongside the data fixes so the knowledge compounds.
