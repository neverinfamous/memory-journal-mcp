# Usability Test: Git History Analytics (CLI Grep Filter)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse git history non-destructively and never mutate the commit log.

## Objective
Verify that `lib-git-history`'s CLI correctly implements the `--grep` message filter.

## Instructions

### Phase 1: Validating Extraction
1. **Extraction:** Create test commits that contain specific keywords in their commit messages (e.g., "feat(test): keyword_search_2").
2. Extract history using `bun .\.agents\scripts\get-git-history-json.ts --grep "keyword_search_2"` and redirect to a scratch file.

### Phase 2: Meta-Cognitive Debugging
1. Verify that the output file only contains commits matching the keyword.
2. If the CLI flag fails or throws an error, formulate a hypothesis in a scratch file.
3. Fix the filtering logic in `get-git-history-json.ts` and `git-runner.ts` to ensure this filter is correctly passed to git. Run `pnpm run check`.

### Phase 3: Cleanup & Commit
1. **Crucial Cleanup:** Undo test commits using `git reset --soft HEAD~N`. Delete scratch JSON files.
2. Commit any fixes to `lib-git-history` using `bun .\.agents\scripts\commit.ts` with valid arguments.
