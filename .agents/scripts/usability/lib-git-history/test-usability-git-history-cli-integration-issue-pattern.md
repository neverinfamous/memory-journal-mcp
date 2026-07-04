# Usability Test: Git History Analytics (Integration Flags - Issue Pattern)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse git history non-destructively and never mutate the commit log.

## Objective
Verify that `lib-git-history`'s CLI correctly implements the `--issue-pattern` integration flag.

## Instructions

### Phase 1: Validating Extraction
1. **Extraction:** Create a test commit with a message that includes a custom issue pattern (e.g. `JIRA-1234`).
2. Run the following command (redirecting to a scratch file):
   - `bun .\.agents\scripts\get-git-history-json.ts --limit 1 --issue-pattern "[A-Z]+-\d+" > <appDataDir>\brain\<conversation-id>\scratch\issues-pattern-test.json`

### Phase 2: Meta-Cognitive Debugging
1. Verify that `--issue-pattern` dynamically modifies the regex used to detect `associatedIssues`, and correctly identifies the custom issue.
2. If the flag fails to extract the issue, formulate a hypothesis in a scratch file.
3. Fix the logic in `get-git-history-json.ts` and `parser-record.ts`. Run `pnpm run check`.

### Phase 3: Cleanup & Commit
1. **Crucial Cleanup:** Undo test commits using `git reset --soft HEAD~N`. Delete scratch JSON files.
2. Commit any fixes to `lib-git-history` using `bun .\.agents\scripts\commit.ts` with valid arguments.
