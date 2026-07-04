# Usability Test: Git History Analytics (Patch Truncation)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse git history non-destructively and never mutate the commit log.

## Objective
Verify that `lib-git-history`'s schema correctly flags commits with an excessively large diff patch by setting `isPatchTruncated: true`.

## Instructions

### Phase 1: Validating Extraction
1. **Extraction:** Create a test commit with a massive diff (e.g., adding a huge text file or modifying thousands of lines).
2. **Parsing:** Extract the history using `bun .\.agents\scripts\get-git-history-json.ts --limit 1 --include-patch --max-patch-length 100` and redirect to `<appDataDir>\brain\<conversation-id>\scratch\patch-truncated-test.json`.

### Phase 2: Meta-Cognitive Debugging
1. Verify that the output JSON accurately parses the commit and ensures `isPatchTruncated: true` is properly set.
2. Verify the `patch` string is actually truncated to the limit.
3. If `parser-record.ts` or `git-runner.ts` fails to truncate the patch or set the flag, create a hypothesis in a scratch file.
4. Fix the logic to enforce safe bounds. Run `pnpm run check` to ensure no regression.

### Phase 3: Cleanup & Commit
1. **Crucial Cleanup:** Delete your test commits (e.g., `git reset --hard HEAD~1`) and clean up any generated files in the workspace. Delete `patch-truncated-test.json`.
2. Commit any fixes to `lib-git-history` using `bun .\.agents\scripts\commit.ts` with valid arguments.
