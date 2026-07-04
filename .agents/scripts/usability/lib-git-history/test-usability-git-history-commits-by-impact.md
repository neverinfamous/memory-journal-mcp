# Usability Test: Git History Analytics (CLI Impact Filter)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse git history non-destructively and never mutate the commit log.

## Objective
Verify that `lib-git-history`'s CLI correctly implements the `--impact` filter as defined in `cliArgsSchema`.

## Instructions

### Phase 1: Validating Extraction
1. **Extraction:** Extract with `bun .\.agents\scripts\get-git-history-json.ts --limit 100 --impact ">=0.5"`.
2. Redirect output to `<appDataDir>\brain\<conversation-id>\scratch\impact-test.json`.

### Phase 2: Meta-Cognitive Debugging
1. Verify that the output JSON strictly contains only commits matching the requested impact (e.g. parsed as `>= 0.5`).
2. If the flag throws validation errors or fails to filter appropriately, create a hypothesis in a scratch file.
3. Fix the filtering logic to ensure `--impact` correctly filters the returned records after parsing. Run `bun run typecheck` and `bun run lint`.

### Phase 3: Cleanup & Commit
1. **Crucial Cleanup:** Delete `impact-test.json` and any scratch artifacts.
2. Commit any fixes to `lib-git-history` using `bun .\.agents\scripts\commit.ts` with valid arguments.
