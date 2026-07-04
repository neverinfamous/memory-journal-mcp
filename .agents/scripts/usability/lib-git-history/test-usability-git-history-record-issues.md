# Usability Test: Git History Analytics (Issue References)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse git history non-destructively and never mutate the commit log.

## Objective
Verify that `lib-git-history`'s `parser-record.ts` successfully parses and extracts issue references into the `associatedIssues` array (which contains objects with `{issue, action}`) from commits.

## Instructions

### Phase 1: Validating Extraction
1. **Extraction:** Create a test commit with a message that includes an issue reference.
   Use: `bun .\.agents\scripts\commit.ts --msg "feat(core): adding issue testing #123" --category Added --impact 0.8 --confidence 0.9 --validation passed`
2. **Parsing:** Extract the latest commit using `bun .\.agents\scripts\get-git-history-json.ts --limit 1` and redirect to `<appDataDir>\brain\<conversation-id>\scratch\record-test.json`.

### Phase 2: Meta-Cognitive Debugging
1. Verify that the output JSON correctly parses the issue references into the semantic JSON format specified by `schema.ts`, specifically checking that `associatedIssues` is an array of `{issue, action}`.
2. If `parser-record.ts` drops the references or structures them incorrectly, create a hypothesis in a scratch file.
3. Fix the parsing logic using `ts-pattern` if it is failing. Run `pnpm run check` to ensure no regression.

### Phase 3: Cleanup & Commit
1. **Crucial Cleanup:** Delete your test commit using `git reset --soft HEAD~1`. Delete `record-test.json`.
2. Commit any fixes to `lib-git-history` using `bun .\.agents\scripts\commit.ts` with valid arguments.

