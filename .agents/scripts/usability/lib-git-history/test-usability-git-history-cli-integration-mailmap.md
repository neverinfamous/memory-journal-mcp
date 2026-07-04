# Usability Test: Git History Analytics (Integration Flags - Mailmap)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse git history non-destructively and never mutate the commit log.

## Objective
Verify that `lib-git-history`'s CLI correctly implements the `--mailmap` integration flag.

## Instructions

### Phase 1: Validating Extraction
1. **Extraction:** Create a temporary `.mailmap` file mapping an author's email.
2. Run the following command (redirecting to a scratch file):
   - `bun .\.agents\scripts\get-git-history-json.ts --limit 1 --mailmap ".mailmap" > <appDataDir>\brain\<conversation-id>\scratch\mapping-test.json`

### Phase 2: Meta-Cognitive Debugging
1. Verify that `--mailmap` correctly resolves the author using the provided `.mailmap` file.
2. If the flag fails to map the author, formulate a hypothesis in a scratch file.
3. Fix the logic in `get-git-history-json.ts` and related parsers. Run `pnpm run check`.

### Phase 3: Cleanup & Commit
1. **Crucial Cleanup:** Delete the temporary mapping file and scratch JSON files.
2. Commit any fixes to `lib-git-history` using `bun .\.agents\scripts\commit.ts` with valid arguments.
