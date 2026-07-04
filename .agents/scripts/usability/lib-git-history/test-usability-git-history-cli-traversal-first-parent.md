# Usability Test: Git History Analytics (Traversal - First Parent)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse git history non-destructively and never mutate the commit log.

## Objective
Verify that `lib-git-history`'s CLI correctly implements the `--first-parent` traversal flag.

## Instructions

### Phase 1: Validating Extraction
1. **Extraction:** Create a series of commits including a merge commit if possible, or just test the flag.
2. Extract history using the following combination (redirecting to a scratch file):
   - `bun .\.agents\scripts\get-git-history-json.ts --limit 5 --first-parent`

### Phase 2: Meta-Cognitive Debugging
1. Verify that `--first-parent` affects the commit graph traversal.
2. If the flag fails to modify the git command correctly, formulate a hypothesis in a scratch file.
3. Fix the logic in `get-git-history-json.ts` and `git-runner.ts`. Run `pnpm run check`.

### Phase 3: Cleanup & Commit
1. **Crucial Cleanup:** Undo any test commits. Delete scratch JSON files.
2. Commit any fixes to `lib-git-history` using `bun .\.agents\scripts\commit.ts` with valid arguments.
