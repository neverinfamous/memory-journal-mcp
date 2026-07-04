# Usability Test: Git History Analytics (CLI Category Filter)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse git history non-destructively and never mutate the commit log.

## Objective
Verify that `lib-git-history`'s CLI correctly implements the `--category` filter as defined in `cliArgsSchema`.

## Instructions

### Phase 1: Validating Extraction
1. **Extraction:** Use `bun .\.agents\scripts\get-git-history-json.ts --limit 10 --category Changed`.
2. Redirect output to `<appDataDir>\brain\<conversation-id>\scratch\category-test.json`.

### Phase 2: Meta-Cognitive Debugging
1. Verify that the output JSON strictly contains only commits matching the requested category (e.g. parsed as Changed).
2. If the flag throws validation errors or fails to filter appropriately, create a hypothesis in a scratch file.
3. Fix the filtering logic to ensure `--category` correctly filters the returned records after parsing. Run `pnpm run check`.

### Phase 3: Cleanup & Commit
1. **Crucial Cleanup:** Delete `category-test.json` and any scratch artifacts.
2. Commit any fixes to `lib-git-history` using `bun .\.agents\scripts\commit.ts` with valid arguments.
