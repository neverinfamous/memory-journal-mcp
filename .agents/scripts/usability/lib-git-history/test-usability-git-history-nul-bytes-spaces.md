# Usability Test: Git History Analytics (NUL-bytes & Spaces)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse git history non-destructively and never mutate the commit log.

## Objective
Verify that `lib-git-history` successfully parses file names with spaces and weird characters using NUL-byte delimiting.

## Instructions

### Phase 1: Validating Extraction
1. **Extraction:** Create a test commit adding a file named `my weird file name.txt` (Note: creating files with carriage returns natively on Windows is impossible and `lib-agent-exec` payload schemas explicitly block them, so stick to spaces or emojis).
2. Commit it.
3. **Parsing:** Extract the latest commit using `bun .\.agents\scripts\get-git-history-json.ts --limit 1` and redirect to `<appDataDir>\brain\<conversation-id>\scratch\nul-byte-test.json`.

### Phase 2: Meta-Cognitive Debugging
1. Verify that the output JSON correctly parses the file paths in the `files` array without truncation or misinterpreting the spaces/carriage returns.
2. Verify in the code (e.g., `git-runner.ts` or `parser-batch.ts`) that NUL-delimited parsing flags (`--name-status -z`, `--numstat -z`) are actively utilized.
3. If the files are dropped, incorrectly formatted, or the `-z` flags are missing, create a hypothesis in a scratch file.
3. Fix the parsing logic using `ts-pattern` if it is failing. Run `pnpm run check` to ensure no regression.

### Phase 3: Cleanup & Commit
1. **Crucial Cleanup:** Delete your test commit using `git reset --soft HEAD~1`. Delete `nul-byte-test.json`.
2. Commit any fixes to `lib-git-history` using `bun .\.agents\scripts\commit.ts` with valid arguments.
