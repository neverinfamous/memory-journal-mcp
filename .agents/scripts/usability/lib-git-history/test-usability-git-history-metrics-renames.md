# Usability Test: Git History Analytics (Metrics & Renames)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must strictly follow Zod constraints and integer typing for git metrics.

## Objective
Verify that `lib-git-history` strictly parses numerical metrics (`fileCount`, `totalInsertions`, `totalDeletions`) as integers when files are renamed and modified.

## Instructions

### Phase 1: Creating Rename & Metric Data
1. Rename an existing temporary file in the workspace or create one and rename it in a single commit, while modifying some lines.
2. Commit it using `bun .\.agents\scripts\commit.ts --msg "chore(test): rename and modify file" --category Changed --impact 0.5 --confidence 0.5 --validation passed`.
3. Extract the commit data using `bun .\.agents\scripts\get-git-history-json.ts --limit 1` into `<appDataDir>\brain\<conversation-id>\scratch\rename-test.json`.

### Phase 2: Meta-Cognitive Debugging
1. Examine the JSON. Verify that `fileCount`, `totalInsertions`, and `totalDeletions` are strict integers and accurately reflect the rename/modification operation.
2. Specifically verify that the file entry with status `R` contains both `oldFile` and `file` properties, as well as correctly tracked `insertions`, `deletions`, and an accurately parsed integer for `similarityScore`.
3. If the numerical fields (including `similarityScore`) are strings, calculated incorrectly, or the `oldFile` field is missing, write a hypothesis in a scratch file.
4. Fix `parser-batch.ts`, `parser-record.ts`, or `schema.ts` to ensure data coercion meets Zod requirements.

### Phase 3: Cleanup & Commit
1. **Crucial Cleanup:** Undo the test commit and restore the workspace (`git reset --hard HEAD~1` if appropriate, but be careful not to lose unsaved changes). Delete `rename-test.json`.
2. Commit any fixes to `lib-git-history` using `bun .\.agents\scripts\commit.ts` with valid arguments.
