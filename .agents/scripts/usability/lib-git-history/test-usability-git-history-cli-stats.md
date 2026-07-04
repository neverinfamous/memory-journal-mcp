# Usability Test: Git History Analytics (Stats Flag)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** Ensure you correctly implement and utilize the `--stats` flag to omit commit bodies and patches while preserving file modification metrics.

## Objective
Verify that `lib-git-history`'s `--stats` flag correctly drops the commit body and full patch diffs, but *keeps* the `files` array, `fileCount`, `totalInsertions`, and `totalDeletions` for statistical analysis.

## Instructions

### Phase 1: Stats Validation
1. Extract the git history using `bun .\.agents\scripts\get-git-history-json.ts --limit 5 --stats` and redirect it to `<appDataDir>\brain\<conversation-id>\scratch\stats-test.json`.

### Phase 2: Meta-Cognitive Debugging
1. Examine the resulting JSON. Verify that the `body` and `patch` fields are completely omitted or empty.
2. Verify that the `files` array, `fileCount`, `totalInsertions`, and `totalDeletions` are preserved in the output.
3. If `--stats` is missing or behaving incorrectly, implement it in `cli.ts`, `schema.ts`, and `get-git-history-json.ts`. Run `pnpm run check`.

### Phase 3: Cleanup & Commit
1. **Crucial Cleanup:** Delete `stats-test.json`.
2. Commit any fixes to `lib-git-history` using `bun .\.agents\scripts\commit.ts --msg "feat(lib-git-history): implement --stats flag for lightweight metrics" --category Added --impact 0.5 --confidence 1.0 --validation passed`.
