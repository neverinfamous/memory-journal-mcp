# Usability Test: Git History Analytics (Reverts)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse git history non-destructively and never mutate the commit log.

## Objective
Verify that `lib-git-history`'s `parser-record.ts` successfully extracts semantics for revert operations (e.g. ensuring `cleanSubject` is correctly parsed) as defined in `entrySchema`.

## Instructions

### Phase 1: Validating Extraction
1. **Extraction (Revert):** Create a test commit, then revert it using `git revert HEAD --no-edit`.
2. **Parsing:** Extract the history using `bun .\.agents\scripts\get-git-history-json.ts --limit 5` and redirect to `<appDataDir>\brain\<conversation-id>\scratch\revert-test.json`.

### Phase 2: Meta-Cognitive Debugging
1. Verify that the output JSON accurately parses the commit message and ensure `cleanSubject` properly strips the "Revert" prefix, sets `isRevert: true`, and extracts the original commit hash to `revertedCommit`.
2. If `parser-record.ts` drops the revert semantics, or incorrectly parses `cleanSubject`, create a hypothesis in a scratch file.
3. Fix the parsing logic using `ts-pattern` if it is failing. Run `pnpm run check` to ensure no regression.

### Phase 3: Cleanup & Commit
1. **Crucial Cleanup:** Delete your test commits using `git reset --hard HEAD~2`. Delete `revert-test.json`.
2. Commit any fixes to `lib-git-history` using `bun .\.agents\scripts\commit.ts` with valid arguments.
