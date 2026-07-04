# Usability Test: Git History Analytics (Diff Context)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse git history non-destructively and never mutate the commit log.

## Objective
Verify that `lib-git-history`'s CLI correctly implements the `--diff-context` flag as defined in `cliArgsSchema`.

## Instructions

### Phase 1: Validating Extraction
1. **Extraction:** Create a test commit with a file (e.g. `.ts` or `.md` extension, NOT `.txt` which is excluded by patch filters) that has several lines of changes and context.
2. Extract history using `bun .\.agents\scripts\get-git-history-json.ts --limit 1 --diff-context 0` and redirect to a scratch file.
3. Extract history using `bun .\.agents\scripts\get-git-history-json.ts --limit 1 --diff-context 5` and redirect to another scratch file.

### Phase 2: Meta-Cognitive Debugging
1. Verify that `--diff-context` correctly changes the number of context lines in the diff patch output.
2. If the flag fails to modify the payload, formulate a hypothesis in a scratch file.
3. Fix the logic in `get-git-history-json.ts` and `git-runner.ts` to ensure context bounds are passed properly. Run `pnpm run check`.

### Phase 3: Cleanup & Commit
1. **Crucial Cleanup:** Undo test commits. Delete scratch JSON files.
2. Commit any fixes to `lib-git-history` using `bun .\.agents\scripts\commit.ts` with valid arguments.
