# Usability Test: Git History Analytics (Binary File Metrics)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse git history non-destructively and never mutate the commit log.

## Objective
Verify that `lib-git-history`'s `parser-batch.ts` correctly extracts quantitative metrics (`fileCount`, `totalInsertions`, `totalDeletions`) and correctly assigns `isBinary` and `language` to individual files when commits include binary and source files.

## Instructions

### Phase 1: Validating Extraction
1. **Extraction:** Create a test commit adding a binary file (e.g. an image) and a recognizable source code file (e.g. `.ts` or `.json`).
2. Extract history using `bun .\.agents\scripts\get-git-history-json.ts --limit 1` and redirect to `<appDataDir>\brain\<conversation-id>\scratch\binary-test.json`.

### Phase 2: Meta-Cognitive Debugging
1. Verify that the output JSON accurately computes `fileCount`, `totalInsertions`, and `totalDeletions`, ensuring that binary files are counted but do not distort textual line metrics.
2. Verify that the files array correctly flags the binary file with `isBinary: true` and the source code file has the appropriate `language` string identified.
3. If `parser-batch.ts` miscalculates these metrics or drops `isBinary`/`language`, create a hypothesis in a scratch file.
3. Fix the parsing logic using `ts-pattern` if it is failing. Run `pnpm run check` to ensure no regression.

### Phase 3: Cleanup & Commit
1. **Crucial Cleanup:** Delete your test commits using `git reset --hard HEAD~1`. Delete `binary-test.json`.
2. Commit any fixes to `lib-git-history` using `bun .\.agents\scripts\commit.ts` with valid arguments.
