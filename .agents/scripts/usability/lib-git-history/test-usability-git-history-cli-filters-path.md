# Usability Test: Git History Analytics (CLI Path Filter)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse git history non-destructively and never mutate the commit log.

## Objective
Verify that `lib-git-history`'s CLI correctly implements the `--path` filter.

## Instructions

### Phase 1: Validating Extraction
1. **Extraction:** Create a test commit that modifies a specific file (e.g., `package.json` or a scratch file).
2. Extract history using `bun .\.agents\scripts\get-git-history-json.ts --path "package.json"` and redirect it to a scratch file.

### Phase 2: Meta-Cognitive Debugging
1. Verify that the output file only contains commits that touched the specified path.
2. If the CLI flag fails or throws an error, formulate a hypothesis in a scratch file.
3. Fix the filtering logic in `get-git-history-json.ts` and `git-runner.ts` to ensure the filter is correctly passed to git. Run `pnpm run check`.

### Phase 3: Cleanup & Commit
1. **Crucial Cleanup:** Undo test commits using `git reset --soft HEAD~1`. Delete scratch JSON files.
2. Commit any fixes to `lib-git-history` using `bun .\.agents\scripts\commit.ts` with valid arguments.
