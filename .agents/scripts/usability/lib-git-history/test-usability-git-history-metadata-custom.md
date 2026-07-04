# Usability Test: Git History Analytics (Custom Trailers Extraction)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse git history non-destructively and never mutate the commit log.

## Objective
Verify that `lib-git-history`'s `parser-record.ts` successfully parses and extracts `customTrailers` into the `metadata` object and maps all trailer key-value pairs in `trailersObj`.

## Instructions

### Phase 1: Validating Extraction
1. **Extraction:** Create a test commit with a message that explicitly includes custom non-standard trailers in the body (e.g., `MyCustomTrailer: foo`, `Another-Trailer: bar`). 
   Use standard git commands or `bun .\.agents\scripts\commit.ts`.
2. **Parsing:** Extract the latest commit using `bun .\.agents\scripts\get-git-history-json.ts --limit 1` and redirect to `<appDataDir>\brain\<conversation-id>\scratch\metadata-custom-test.json`.

### Phase 2: Meta-Cognitive Debugging
1. Verify that the output JSON correctly parses the trailers into the semantic JSON format specified by `schema.ts`. Verify that `trailersObj` accurately represents a map of all trailer key-value pairs (e.g., `{"MyCustomTrailer": "foo", "Another-Trailer": "bar"}`).
2. Ensure that `customTrailers` is also populated accurately in the `metadata` object if required.
3. If `parser-record.ts` drops the trailers or structures them incorrectly, create a hypothesis in a scratch file.
4. Fix the parsing logic using `ts-pattern` if it is failing. Run `pnpm run check` to ensure no regression.

### Phase 3: Cleanup & Commit
1. **Crucial Cleanup:** Delete your test commit using `git reset --soft HEAD~1`. Delete `metadata-custom-test.json`.
2. Commit any fixes to `lib-git-history` using `bun .\.agents\scripts\commit.ts` with valid arguments.
