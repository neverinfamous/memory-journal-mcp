# Usability Test: Git History Analytics (File Truncation)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse git history non-destructively and never mutate the commit log.

## Objective
Verify that `lib-git-history`'s schema correctly flags commits with an excessive number of changed files by setting `isFilesTruncated: true`.

## Instructions

### Phase 1: Validating Extraction
1. **Extraction:** Create a test commit with a massive number of modified or created files (e.g., hundreds of small files).
2. **Parsing:** Extract the history using `bun .\.agents\scripts\get-git-history-json.ts --limit 1` and redirect to `<appDataDir>\brain\<conversation-id>\scratch\files-truncated-test.json`.

### Phase 2: Meta-Cognitive Debugging
1. Verify that the output JSON accurately parses the commit and ensures `isFilesTruncated: true` is properly set due to the high volume of file changes.
2. Verify the `files` array is actually truncated as well.
3. If `parser-record.ts` or `git-runner.ts` fails to truncate the files or set the flag, create a hypothesis in a scratch file.
4. Fix the logic to enforce safe bounds. Run `pnpm run check` to ensure no regression.

### Phase 3: Cleanup & Commit
1. **Crucial Cleanup:** Delete your test commits (e.g., `git reset --hard HEAD~1`) and clean up any generated files in the workspace. Delete `files-truncated-test.json`.
2. Commit any fixes to `lib-git-history` using `bun .\.agents\scripts\commit.ts` with valid arguments.
