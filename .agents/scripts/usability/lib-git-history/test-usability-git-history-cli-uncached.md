# Usability Test: Git History Analytics (CLI Uncached)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse git history non-destructively and never mutate the commit log.

## Objective
Verify that `lib-git-history`'s CLI explicitly skips the local cache when `--uncached` is provided, or when run by default.

## Instructions

### Phase 1: Validating Extraction
1. **Extraction:** Test the CLI default behavior (uncached).
2. Run the following command (redirecting to a scratch file):
   - `bun .\.agents\scripts\get-git-history-json.ts --limit 10 > <appDataDir>\brain\<conversation-id>\scratch\uncached-test.json`

### Phase 2: Meta-Cognitive Debugging
1. Verify that the SQLite cache database is NOT created or modified. 
2. If the cache is erroneously populated, formulate a hypothesis in a scratch file.
3. Fix the logic in `get-git-history-json.ts` and `cache.ts`. Run `pnpm run check`.

### Phase 3: Cleanup & Commit
1. **Crucial Cleanup:** Delete scratch JSON files.
2. Commit any fixes to `lib-git-history` using `bun .\.agents\scripts\commit.ts` with valid arguments.
