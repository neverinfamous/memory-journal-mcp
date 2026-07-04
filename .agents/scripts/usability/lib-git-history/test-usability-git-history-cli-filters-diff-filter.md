# Usability Test: Git History Analytics (CLI Diff Filter)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse git history non-destructively and never mutate the commit log.

## Objective
Verify that `lib-git-history`'s CLI correctly implements diff filtering (`--diff-filter`).

## Instructions

### Phase 1: Validating Extraction
1. **Extraction:** Extract history using `bun .\.agents\scripts\get-git-history-json.ts --diff-filter "A"` and redirect to a scratch file.

### Phase 2: Meta-Cognitive Debugging
1. Verify that `--diff-filter` matches only commits with added files.
2. If the CLI flag fails or throws an error, formulate a hypothesis in a scratch file.
3. Fix the filtering logic in `get-git-history-json.ts` and `git-runner.ts` to ensure these filters are correctly passed to git. Run `pnpm run check`.

### Phase 3: Cleanup & Commit
1. **Crucial Cleanup:** Delete scratch JSON files.
2. Commit any fixes to `lib-git-history` using `bun .\.agents\scripts\commit.ts` with valid arguments.
