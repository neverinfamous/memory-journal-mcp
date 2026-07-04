# Usability Test: Git History Analytics (CLI Breaking Filter)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse git history non-destructively and never mutate the commit log.

## Objective
Verify that `lib-git-history`'s CLI correctly implements the `--breaking` filter flag.

## Instructions

### Phase 1: Validating Extraction
1. **Extraction:** Create a test commit with a breaking change (either using `!` in the type or a `BREAKING CHANGE:` trailer).
2. Extract history using the following combination (redirecting to a scratch file):
   - `bun .\.agents\scripts\get-git-history-json.ts --limit 5 --breaking`

### Phase 2: Meta-Cognitive Debugging
1. Verify that `--breaking` outputs only commits that are breaking changes (`isBreaking: true`).
2. If the CLI flag fails or outputs non-breaking commits, formulate a hypothesis in a scratch file.
3. Fix the formatting logic in `get-git-history-json.ts` and `git-runner.ts`. Run `pnpm run check`.

### Phase 3: Cleanup & Commit
1. **Crucial Cleanup:** Undo test commits. Delete scratch JSON files.
2. Commit any fixes to `lib-git-history` using `bun .\.agents\scripts\commit.ts` with valid arguments.
