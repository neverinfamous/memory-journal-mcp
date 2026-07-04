# Usability Test: Git History Analytics (CLI Time Filter - Until)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse git history non-destructively and never mutate the commit log.

## Objective
Verify that `lib-git-history`'s CLI correctly implements the `--until` filter.

## Instructions

### Phase 1: Validating Extraction
1. **Extraction:** Use `bun .\.agents\scripts\get-git-history-json.ts --until "yesterday"` to extract history.
2. Redirect output to `<appDataDir>\brain\<conversation-id>\scratch\time-filter-until-test.json`.

### Phase 2: Meta-Cognitive Debugging
1. Verify that the CLI argument is correctly parsed and passed to the git command without errors.
2. Check that the output JSON strictly contains commits matching the time filter.
3. If the CLI rejects the flag or misinterprets it, create a hypothesis in a scratch file.
4. Fix the CLI parsing logic to ensure time filters map correctly. Run `pnpm run check`.

### Phase 3: Cleanup & Commit
1. **Crucial Cleanup:** Delete `time-filter-until-test.json` and any scratch files.
2. Commit any fixes to `lib-git-history` using `bun .\.agents\scripts\commit.ts` with valid arguments.
