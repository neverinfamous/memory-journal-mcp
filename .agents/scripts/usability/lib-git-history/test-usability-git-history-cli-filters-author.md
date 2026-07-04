# Usability Test: Git History Analytics (CLI Author Filter)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse git history non-destructively and never mutate the commit log.

## Objective
Verify that `lib-git-history`'s CLI correctly implements the `--author` filter as defined in `cliArgsSchema`.

## Instructions

### Phase 1: Validating Extraction
1. **Extraction:** Create a test commit with a specific author by using environment variables with the wrapper: `$env:GIT_AUTHOR_NAME="TestAuthor"; $env:GIT_AUTHOR_EMAIL="test@example.com"; $env:GIT_COMMITTER_NAME="TestAuthor"; $env:GIT_COMMITTER_EMAIL="test@example.com"; bun .\.agents\scripts\commit.ts --msg "feat(core): unique author test" --category Added --impact 0.1 --confidence 1.0 --validation passed`.
2. Extract history using `bun .\.agents\scripts\get-git-history-json.ts --author "TestAuthor"` and redirect to `<appDataDir>\brain\<conversation-id>\scratch\author-filter-test.json` (ensure the scratch directory exists first).
3. Extract history using a non-matching author to verify exclusion.

### Phase 2: Meta-Cognitive Debugging
1. Verify that the CLI arguments correctly filter the output JSON down to only commits by "TestAuthor".
2. If the CLI rejects the flags or returns empty arrays incorrectly, create a hypothesis in a scratch file.
3. Fix the CLI parsing logic to ensure the `--author` filter maps to `git log --author` properly. Run `pnpm run check`.

### Phase 3: Cleanup & Commit
1. **Crucial Cleanup:** Undo the test commit using `git reset --soft HEAD~1`. Delete `author-filter-test.json`.
2. Commit any fixes to `lib-git-history` using `bun .\.agents\scripts\commit.ts` with valid arguments.
