# Usability Test: Git History Analytics (Commit Size Enum)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse git history non-destructively and never mutate the commit log.

## Objective
Verify that `lib-git-history`'s schema correctly calculates and assigns the `size` enum ('XS', 'S', 'M', 'L', 'XL') based on the commit's diff footprint.

## Instructions

### Phase 1: Validating Extraction
1. **Extraction:** Create multiple test commits representing different sizes (e.g., 1 line change, 50 line change, 200 line change, 1000 line change).
2. **Parsing:** Extract the history using `bun .\.agents\scripts\get-git-history-json.ts --limit 4` and redirect to `<appDataDir>\brain\<conversation-id>\scratch\size-test.json`.

### Phase 2: Meta-Cognitive Debugging
1. Verify that the output JSON assigns a valid `size` enum value ('XS', 'S', 'M', 'L', 'XL') to each commit.
2. Verify that the size correlates properly with the number of insertions and deletions.
3. If `parser-record.ts` fails to calculate the size or assigns an invalid string not in the enum, create a hypothesis in a scratch file.
4. Fix the logic to enforce safe bounds. Run `pnpm run check` to ensure no regression.

### Phase 3: Cleanup & Commit
1. **Crucial Cleanup:** Delete your test commits (e.g., `git reset --hard HEAD~4`) and clean up any generated files in the workspace. Delete `size-test.json`.
2. Commit any fixes to `lib-git-history` using `bun .\.agents\scripts\commit.ts` with valid arguments.
