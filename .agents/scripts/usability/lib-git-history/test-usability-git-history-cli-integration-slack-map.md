# Usability Test: Git History Analytics (Integration Flags - Slack Map)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse git history non-destructively and never mutate the commit log.

## Objective
Verify that `lib-git-history`'s CLI correctly implements the `--slack-map` integration flag.

## Instructions

### Phase 1: Validating Extraction
1. **Extraction:** Create a temporary `slack-map.json` file.
2. Run the following command (redirecting to a scratch file):
   - `bun .\.agents\scripts\get-git-history-json.ts --limit 1 --slack-map "slack-map.json" > <appDataDir>\brain\<conversation-id>\scratch\slack-map-test.json`

### Phase 2: Meta-Cognitive Debugging
1. Verify that `--slack-map` resolves Slack handles in the JSON output if the mapping file exists.
2. If the flag fails to map the author or resolve the handle, formulate a hypothesis in a scratch file.
3. Fix the logic in `get-git-history-json.ts` and related parsers. Run `pnpm run check`.

### Phase 3: Cleanup & Commit
1. **Crucial Cleanup:** Delete the temporary mapping file and scratch JSON files.
2. Commit any fixes to `lib-git-history` using `bun .\.agents\scripts\commit.ts` with valid arguments.
