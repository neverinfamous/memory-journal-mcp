# Usability Test: Git History Analytics (Include Patch)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse git history non-destructively and never mutate the commit log.

## Objective
Verify that `lib-git-history`'s CLI correctly implements the `--include-patch` flag.

## Instructions

### Phase 1: Validating Extraction
1. **Extraction:** Create a test commit with a file addition and modification.
2. Extract history using `bun .\.agents\scripts\get-git-history-json.ts --limit 1 --include-patch` and redirect to a scratch file.

### Phase 2: Meta-Cognitive Debugging
1. Verify that `--include-patch` correctly populates the `patch` string field in the root payload OR in the `files` array, as intended by the schema.
2. If the flag fails to modify the payload, formulate a hypothesis in a scratch file.
3. Fix the logic in `get-git-history-json.ts` and `git-runner.ts` to ensure patches are requested from git. Run `pnpm run check`.

### Phase 3: Cleanup & Commit
1. **Crucial Cleanup:** Undo test commits. Delete scratch JSON files.
2. Commit any fixes to `lib-git-history` using `bun .\.agents\scripts\commit.ts` with valid arguments.
