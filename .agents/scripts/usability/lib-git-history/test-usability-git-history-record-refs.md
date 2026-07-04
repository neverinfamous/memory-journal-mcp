# Usability Test: Git History Analytics (Refs Attributes)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse git history non-destructively and never mutate the commit log.

## Objective
Verify that `lib-git-history`'s `parser-record.ts` successfully parses structural reference attributes (`parents`, `refs`, `tags`) as defined in `entrySchema`.

## Instructions

### Phase 1: Validating Extraction
1. **Extraction:** Create a test commit. Create a tag for it using `git tag -a v1.0.0-test -m "test tag"`.
2. **Parsing:** Extract the latest commit using `bun .\.agents\scripts\get-git-history-json.ts --limit 1` and redirect to `<appDataDir>\brain\<conversation-id>\scratch\refs-test.json`.

### Phase 2: Meta-Cognitive Debugging
1. Verify that the output JSON accurately parses the `parents` (array of commit hashes), `refs` (array of branches/remotes), and `tags` (array of tags like `v1.0.0-test`).
2. If `parser-record.ts` drops or misparses any of these arrays, create a hypothesis in a scratch file.
3. Fix the parsing logic using `ts-pattern` if it is failing. Run `pnpm run check` to ensure no regression.

### Phase 3: Cleanup & Commit
1. **Crucial Cleanup:** Delete your test tag using `git tag -d v1.0.0-test`. Delete your test commit using `git reset --soft HEAD~1`. Delete `refs-test.json`.
2. Commit any fixes to `lib-git-history` using `bun .\.agents\scripts\commit.ts` with valid arguments.
