# Usability Test: Git History Analytics (Integration Flags - Issue Tracker)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse git history non-destructively and never mutate the commit log.

## Objective
Verify that `lib-git-history`'s CLI correctly implements the `--issue-tracker` integration flag.

## Instructions

### Phase 1: Validating Extraction
1. **Extraction:** Create a test commit with a message that includes a standard issue pattern (e.g. `#123`).
2. Run the following command (redirecting to a scratch file):
   - `bun .\.agents\scripts\get-git-history-json.ts --limit 1 --issue-tracker "https://github.com/org/repo/issues/" > <appDataDir>\brain\<conversation-id>\scratch\issues-tracker-test.json`

### Phase 2: Meta-Cognitive Debugging
1. Verify that `--issue-tracker` correctly prepends the tracker URL to the extracted `associatedIssues`.
2. If the flag fails to apply the tracker URL, formulate a hypothesis in a scratch file.
3. Fix the logic in `get-git-history-json.ts` and `parser-record.ts`. Run `pnpm run check`.

### Phase 3: Cleanup & Commit
1. **Crucial Cleanup:** Undo test commits using `git reset --soft HEAD~N`. Delete scratch JSON files.
2. Commit any fixes to `lib-git-history` using `bun .\.agents\scripts\commit.ts` with valid arguments.
