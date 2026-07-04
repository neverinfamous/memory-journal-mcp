# Usability Test: Git History Analytics (Integration Flags - Cache)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse git history non-destructively and never mutate the commit log.

## Objective
Verify that `lib-git-history`'s CLI correctly implements the `--cache` integration flag.

## Instructions

### Phase 1: Validating Extraction
1. **Extraction:** Test the CLI `--cache` flag.
2. Run the following command (redirecting to a scratch file):
   - `bun .\.agents\scripts\get-git-history-json.ts --limit 10 --cache > <appDataDir>\brain\<conversation-id>\scratch\cache-test.json`

### Phase 2: Meta-Cognitive Debugging
1. Verify that `--cache` implements caching by checking if the SQLite cache database is created and populated with commits.
2. If the flag fails to cache correctly, formulate a hypothesis in a scratch file.
3. Fix the logic in `get-git-history-json.ts` and `cache.ts`. Run `pnpm run check`.

### Phase 3: Cleanup & Commit
1. **Crucial Cleanup:** Delete scratch JSON files and the cache database.
2. Commit any fixes to `lib-git-history` using `bun .\.agents\scripts\commit.ts` with valid arguments.
