# Usability Test: Git History Analytics (CLI Formatting - Changelog Only)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse git history non-destructively and never mutate the commit log.

## Objective
Verify that `lib-git-history`'s CLI correctly implements the `--changelog-only` formatting flag.

## Instructions

### Phase 1: Validating Extraction
1. **Extraction:** Extract history using the following combination (redirecting to a scratch file):
   - `bun .\.agents\scripts\get-git-history-json.ts --limit 5 --changelog-only`

### Phase 2: Meta-Cognitive Debugging
1. Verify that `--changelog-only` returns only commits relevant for a changelog (e.g., skips chore, docs, test).
2. If the CLI flag fails or outputs unexpected structures, formulate a hypothesis in a scratch file.
3. Fix the formatting logic in `get-git-history-json.ts` and `git-runner.ts`. Run `pnpm run check`.

### Phase 3: Cleanup & Commit
1. **Crucial Cleanup:** Delete scratch JSON files.
2. Commit any fixes to `lib-git-history` using `bun .\.agents\scripts\commit.ts` with valid arguments.
