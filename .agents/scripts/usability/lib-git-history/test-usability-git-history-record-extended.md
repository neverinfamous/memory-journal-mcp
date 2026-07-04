# Usability Test: Git History Analytics (Extended Attributes)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse git history non-destructively and never mutate the commit log.

## Objective
Verify that `lib-git-history`'s `parser-record.ts` successfully parses extended attributes (`references`, `coAuthors`, `reviewers`) as defined in `entrySchema`.

## Instructions

### Phase 1: Validating Extraction
1. **Extraction:** Create a test commit with a message that includes "Co-authored-by: Name <email>", "Reviewed-by: Name <email>", and references to other commits.
2. **Parsing:** Extract the latest commit using `bun .\.agents\scripts\get-git-history-json.ts --limit 1` and redirect to `<appDataDir>\brain\<conversation-id>\scratch\extended-test.json`.

### Phase 2: Meta-Cognitive Debugging
1. Verify that the output JSON accurately parses `coAuthors` and `reviewers` arrays, and captures `references`.
2. If `parser-record.ts` drops extended attributes, create a hypothesis in a scratch file.
3. Fix the parsing logic using `ts-pattern` if it is failing. Run `pnpm run check` to ensure no regression.

### Phase 3: Cleanup & Commit
1. **Crucial Cleanup:** Delete your test commit using `git reset --soft HEAD~1`. Delete `extended-test.json`.
2. Commit any fixes to `lib-git-history` using `bun .\.agents\scripts\commit.ts` with valid arguments.
