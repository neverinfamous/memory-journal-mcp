# Usability Test: Git History Analytics (Authorship Attributes)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse git history non-destructively and never mutate the commit log.

## Objective
Verify that `lib-git-history`'s `parser-record.ts` successfully parses authorship commit attributes (`author`, `email`, `committer`, `committerEmail`, `committerDate`, `date`) as defined in `entrySchema`.

## Instructions

### Phase 1: Validating Extraction
1. **Extraction:** Create a test commit. 
2. **Parsing:** Extract the latest commit using `bun .\.agents\scripts\get-git-history-json.ts --limit 1` and redirect to `<appDataDir>\brain\<conversation-id>\scratch\authorship-test.json`.

### Phase 2: Meta-Cognitive Debugging
1. Verify that the output JSON accurately parses the `author`, `email`, `committer`, `committerEmail`, `committerDate`, and `date` fields, ensuring dates are ISO 8601 strings.
2. If `parser-record.ts` drops or misparses any of these attributes, create a hypothesis in a scratch file.
3. Fix the parsing logic using `ts-pattern` if it is failing. Run `pnpm run check` to ensure no regression.

### Phase 3: Cleanup & Commit
1. **Crucial Cleanup:** Delete your test commit using `git reset --soft HEAD~1`. Delete `authorship-test.json`.
2. Commit any fixes to `lib-git-history` using `bun .\.agents\scripts\commit.ts` with valid arguments.
