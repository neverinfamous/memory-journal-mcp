# Usability Test: Git History Analytics (Breaking Changes Bang)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse git history non-destructively and never mutate the commit log.

## Objective
Verify that `lib-git-history` successfully parses `feat(scope)!` syntax into the correct `isBreaking` flag, as required by the SSoT mapping.

## Instructions

### Phase 1: Validating Extraction
1. **Extraction:** Create a test commit with a message that uses the bang `!` syntax for breaking changes.
   Use: `bun .\.agents\scripts\commit.ts --msg "feat(core)!: adding breaking change testing via bang" --category Added --impact 0.9 --confidence 0.9 --validation passed`
2. **Parsing:** Extract the latest commit using `bun .\.agents\scripts\get-git-history-json.ts --limit 1`. You can inspect the output directly or save it to a scratch file (ensure the scratch directory exists first).
3. **Filtering Test:** Run `bun .\.agents\scripts\get-git-history-json.ts --breaking` and verify that the test commit is returned.

### Phase 2: Meta-Cognitive Debugging
1. Verify that the output JSON correctly sets `isBreaking: true` for the commit according to `schema.ts`.
2. If `parser-record.ts` drops the breaking change flag, create a hypothesis in a scratch file.
3. Fix the parsing logic using `ts-pattern` if it is failing. Run `pnpm run check` to ensure no regression.

### Phase 3: Cleanup & Commit
1. **Crucial Cleanup:** Delete your test commit using `git reset --soft HEAD~1`. Delete `breaking-bang-test.json`.
2. Commit any fixes to `lib-git-history` using `bun .\.agents\scripts\commit.ts` with valid arguments.
