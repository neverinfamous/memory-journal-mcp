# Usability Test: Git History Analytics (Summary Flag)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** Ensure you don't overwhelm output contexts by correctly utilizing the `--summary` flag.

## Objective
Verify that `lib-git-history`'s `--summary` flag correctly drops detailed patch metrics and file diff arrays, focusing only on the commit metadata.

## Instructions

### Phase 1: Summary Validation
1. Extract the git history using `bun .\.agents\scripts\get-git-history-json.ts --limit 5 --summary` and redirect it to `<appDataDir>\brain\<conversation-id>\scratch\summary-test.json`.

### Phase 2: Meta-Cognitive Debugging
1. Examine the resulting JSON. Verify that the `files` array and line-by-line patch stats are completely omitted or empty, and only the commit metadata (author, message, category, impact) remains.
2. If detailed diffs or files are still present, formulate a hypothesis in a scratch file.
3. Fix the summary flag logic in `get-git-history-json.ts` and `git-runner.ts` to ensure it properly passes the arguments or prunes the output. Run `pnpm run check`.

### Phase 3: Cleanup & Commit
1. **Crucial Cleanup:** Delete `summary-test.json`.
2. Commit any fixes to `lib-git-history` using `bun .\.agents\scripts\commit.ts --msg "type(scope): message" --category Changed --impact 0.5 --confidence 0.5 --validation passed`.
