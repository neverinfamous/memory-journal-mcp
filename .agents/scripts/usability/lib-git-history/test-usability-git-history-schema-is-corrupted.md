# Usability Test: Git History Analytics (isCorrupted Flag)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse git history non-destructively and never mutate the commit log.

## Objective
Verify that `lib-git-history`'s schema correctly flags commits with an `isCorrupted: true` flag when the parser encounters unrecoverable structural errors in the commit data.

## Instructions

### Phase 1: Validating Extraction
1. **Extraction:** Create a malformed test commit or manually inject corrupt data into the parsing pipeline (e.g. by modifying a test fixture or mocking git output to omit mandatory fields like author or date).
2. **Parsing:** Extract the history using `bun .\.agents\scripts\get-git-history-json.ts --limit 1` (or point to a mock if testing internally) and redirect to `<appDataDir>\brain\<conversation-id>\scratch\corrupted-test.json`.

### Phase 2: Meta-Cognitive Debugging
1. Verify that the output JSON accurately parses the commit and ensures `isCorrupted: true` is set, and that the process doesn't throw a fatal exception.
2. If `parser-record.ts` fails to set the flag or crashes completely, create a hypothesis in a scratch file.
3. Fix the logic to enforce safe bounds and gracefully handle the error. Run `pnpm run check` to ensure no regression.

### Phase 3: Cleanup & Commit
1. **Crucial Cleanup:** Delete your test commits or mock files. Delete `corrupted-test.json`.
2. Commit any fixes to `lib-git-history` using `bun .\.agents\scripts\commit.ts` with valid arguments.
