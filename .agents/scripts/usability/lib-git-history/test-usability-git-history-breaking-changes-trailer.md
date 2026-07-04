# Usability Test: Git History Analytics (Breaking Changes Trailer)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse git history non-destructively and never mutate the commit log.

## Objective
Verify that `lib-git-history` successfully parses `BREAKING CHANGE:` trailers into the correct `isBreaking` flag and extracts the description, as required by the SSoT mapping.

## Instructions

### Phase 1: Validating Extraction
1. **Extraction:** Create a test commit with a message that includes a `BREAKING CHANGE:` block.
   Use: `` bun .\.agents\scripts\commit.ts --msg "feat(core): adding breaking change testing`n`nBREAKING CHANGE: this changes everything via trailer" --category Added --impact 0.9 --confidence 0.9 --validation passed ``
2. **Parsing:** Extract the latest commit using `bun .\.agents\scripts\get-git-history-json.ts --limit 1` and redirect to `<appDataDir>\brain\<conversation-id>\scratch\breaking-trailer-test.json`.
3. **Filtering Test:** Run `bun .\.agents\scripts\get-git-history-json.ts --breaking` and verify that the test commit is returned.

### Phase 2: Meta-Cognitive Debugging
1. Verify that the output JSON correctly sets `isBreaking: true` and accurately extracts `breakingChangeDescription` ("this changes everything via trailer") for the commit according to `schema.ts`.
2. If `parser-record.ts` drops the breaking change flag or description, create a hypothesis in a scratch file.
3. Fix the parsing logic using `ts-pattern` if it is failing. Run `pnpm run check` to ensure no regression.

### Phase 3: Cleanup & Commit
1. **Crucial Cleanup:** Delete your test commit using `git reset --soft HEAD~1`. Delete `breaking-trailer-test.json`.
2. Commit any fixes to `lib-git-history` using `bun .\.agents\scripts\commit.ts` with valid arguments.
