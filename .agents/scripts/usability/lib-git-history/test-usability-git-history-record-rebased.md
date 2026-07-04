# Usability Test: Git History Analytics (Rebased)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse git history non-destructively and never mutate the commit log.

## Objective
Verify that `lib-git-history`'s `parser-record.ts` successfully extracts semantics for rebased commits, correctly setting the `isRebased` boolean flag in `entrySchema`.

## Instructions

### Phase 1: Validating Extraction
1. **Extraction (Rebased):** Create a commit that simulates being rebased by intentionally mismatching the author and committer dates.
   - Use WSL or PowerShell to create a commit where `GIT_AUTHOR_DATE` is in the past, but `GIT_COMMITTER_DATE` is current:
   - For example: `$env:GIT_AUTHOR_DATE="2020-01-01T12:00:00"; git commit --allow-empty -m "chore(test): rebased commit"; Remove-Item Env:\GIT_AUTHOR_DATE`
2. **Parsing:** Extract the history using `bun .\.agents\scripts\get-git-history-json.ts --limit 1` and redirect to `<appDataDir>\brain\<conversation-id>\scratch\rebased-test.json`.

### Phase 2: Meta-Cognitive Debugging
1. Verify that the output JSON accurately parses the commit and ensures `isRebased` is appropriately evaluated as defined in the schema.
2. If `parser-record.ts` drops the rebased semantics, create a hypothesis in a scratch file.
3. Fix the parsing logic using `ts-pattern` if it is failing. Run `pnpm run check` to ensure no regression.

### Phase 3: Cleanup & Commit
1. **Crucial Cleanup:** Delete your test commits (if any) and `rebased-test.json`.
2. Commit any fixes to `lib-git-history` using `bun .\.agents\scripts\commit.ts` with valid arguments.
