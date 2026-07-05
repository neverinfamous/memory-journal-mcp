# Usability Test: Strict Commit Validation CLI (History Category Parse)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse errors sequentially and never mutate git history.

## Objective
Verify that `commit.ts` correctly extracts the explicitly provided Category prefix from the history narrative (e.g. `Category: narrative text`).

## Instructions

### Phase 1: Adversarial Fuzzing
1. **Setup Mock Repo:** Create a new directory `<appDataDir>\brain\<conversation-id>\scratch\test-repo-history-category-parse` and initialize an empty git repository in it using `git init`.
2. **Commit with Inline History Prefix:** From within the mock repository, create a scratch file `dummy.txt`, stage it with `git add dummy.txt`.
3. Run `bun C:\Users\chris\Desktop\adamic\.agents\scripts\commit.ts --history "Removed: some deprecated functionality" --msg "refactor(core): cleanup" --impact 0.5 --confidence 0.5 --validation passed`. Note that we omit the `--category` flag so it relies on the history prefix!

### Phase 2: Meta-Cognitive Debugging
1. Extract the commit data using `bun C:\Users\chris\Desktop\adamic\.agents\scripts\get-git-history-json.ts --limit 1` within the mock repository.
2. **CRITICAL CHECK:** Ensure that `metadata.category` in the JSON is exactly `["Removed"]`, and the `History-Entry` does NOT include `Removed:`.
3. If it is `Changed` (fallback for `refactor`) instead of `Removed`, or if it fails, formulate a hypothesis in `<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`.
4. Fix the logic in `commit.ts` if necessary.

### Phase 3: Cleanup & Commit (Critical)
1. Delete the mock repository at `<appDataDir>\brain\<conversation-id>\scratch\test-repo-history-category-parse` and any scratch files.
2. If a fix was required to `commit.ts`, stage and commit it to the main repo using `commit.ts`.
