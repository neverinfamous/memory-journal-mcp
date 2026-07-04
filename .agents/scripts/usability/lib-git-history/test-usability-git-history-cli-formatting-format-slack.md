# Usability Test: Git History Analytics (CLI Formatting - Slack Format)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse git history non-destructively and never mutate the commit log.

## Objective
Verify that `lib-git-history`'s CLI correctly implements the Slack formatting output `--format "slack"`.

## Instructions

### Phase 1: Validating Extraction
1. **Extraction:** Extract history using the following (redirecting to a scratch file):
   - `bun .\.agents\scripts\get-git-history-json.ts --limit 5 --format "slack"`

### Phase 2: Meta-Cognitive Debugging
1. Verify that `--format "slack"` outputs slack-compatible format (Block Kit JSON).
2. If the CLI flag fails or outputs unexpected structures, formulate a hypothesis in a scratch file.
3. Fix the formatting logic in `get-git-history-json.ts` and `git-runner.ts`. Run `pnpm run check`.

### Phase 3: Cleanup & Commit
1. **Crucial Cleanup:** Delete scratch slack files.
2. Commit any fixes to `lib-git-history` using `bun .\.agents\scripts\commit.ts` with valid arguments.
