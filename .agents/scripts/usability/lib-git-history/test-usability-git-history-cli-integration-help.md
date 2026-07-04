# Usability Test: Git History Analytics (Integration Flags - Help)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse git history non-destructively and never mutate the commit log.

## Objective
Verify that `lib-git-history`'s CLI correctly implements the `--help` flag.

## Instructions

### Phase 1: Validating Extraction
1. **Extraction:** Test the CLI `--help` flag.
2. Run the following command (redirecting to a scratch file):
   - `bun .\.agents\scripts\get-git-history-json.ts --help > <appDataDir>\brain\<conversation-id>\scratch\help-test.txt`

### Phase 2: Meta-Cognitive Debugging
1. Verify that `--help` prints the usage instructions, including the available flags, and exits cleanly.
2. If the flag fails to print help or errors out, formulate a hypothesis in a scratch file.
3. Fix the logic in `get-git-history-json.ts` and `cli.ts`. Run `pnpm run check`.

### Phase 3: Cleanup & Commit
1. **Crucial Cleanup:** Delete scratch files.
2. Commit any fixes to `lib-git-history` using `bun .\.agents\scripts\commit.ts` with valid arguments.
