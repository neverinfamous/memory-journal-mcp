# Usability Test: Git History Analytics (Schema Bounds)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse git history non-destructively and ensure schema bounds strictly adhere to SSoT.

## Objective
Verify that `lib-git-history` correctly enforces schema bounds on commit data (specifically ensuring metrics are strict integers, and that out-of-bounds or invalid string/number types are handled gracefully without breaking the parser).

## Instructions

### Phase 1: Validating Schema Bounds
1. **Extraction:** Create a test commit with extreme or malformed metric values (e.g. extremely large file counts, or manually mock a git diff that returns floats or extremely large strings if possible, or add an extremely large commit body). 
2. **Parsing:** Extract the latest commit using `bun .\.agents\scripts\get-git-history-json.ts --limit 1` and redirect to `<appDataDir>\brain\<conversation-id>\scratch\bounds-test.json`.

### Phase 2: Meta-Cognitive Debugging
1. Verify that the output JSON accurately parses the metrics (`fileCount`, `totalInsertions`, `totalDeletions`, `similarityScore`) as strict integers as required by the SSoT.
2. Verify that extremely large bounds do not cause `parser-record.ts` or `parser-batch.ts` to crash, and that the Zod schema (`entrySchema`) properly validates them (e.g., throwing a validation error or gracefully clipping/truncating, setting `isCorrupted: true`, etc).
3. If the Zod bounds are violated or it crashes, create a hypothesis in a scratch file.
4. Fix the Zod `schema.ts` bounds and parsing logic. Run `pnpm run check` to ensure no regression.

### Phase 3: Cleanup & Commit
1. **Crucial Cleanup:** Delete your test commit using `git reset --soft HEAD~1`. Delete `bounds-test.json`.
2. Commit any fixes to `lib-git-history` using `bun .\.agents\scripts\commit.ts` with valid arguments.
