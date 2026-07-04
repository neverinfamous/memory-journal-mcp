# Usability Test: Git History Analytics (CLI Max Body Length)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse git history non-destructively and never mutate the commit log.

## Objective
Verify that `lib-git-history`'s CLI correctly implements the size limiting flag `--max-body-length` as defined in `cliArgsSchema`.

## Instructions

### Phase 1: Validating Extraction
1. **Extraction:** Create a test commit with a very long commit body.
2. Extract history using the following (redirecting to a scratch file):
   - `bun .\.agents\scripts\get-git-history-json.ts --limit 1 --max-body-length 50`

### Phase 2: Meta-Cognitive Debugging
1. Verify that `--max-body-length` truncates the parsed commit body appropriately.
2. If the flag fails to truncate the body, formulate a hypothesis in a scratch file.
3. Fix the logic in `get-git-history-json.ts` and `git-runner.ts` to ensure truncation bounds are enforced. Run `pnpm run check`.

### Phase 3: Cleanup & Commit
1. **Crucial Cleanup:** Undo test commits using `git reset --hard HEAD~N`. Delete scratch JSON files.
2. Commit any fixes to `lib-git-history` using `bun .\.agents\scripts\commit.ts` with valid arguments.
