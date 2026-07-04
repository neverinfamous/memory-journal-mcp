# Usability Test: Strict Commit Validation CLI (Category Fallback)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse errors sequentially and never mutate git history. If an accidental commit is created during fuzzing, you must reset it immediately.

## Objective
Verify that `commit.ts` correctly applies the fallback category logic (e.g., `feat` -> `Added`, `fix` -> `Fixed`) when an explicit `--category` is not provided.

## Instructions

### Phase 1: Adversarial Fuzzing
1. **Setup Mock Repo:** Create a new directory `<appDataDir>\brain\<conversation-id>\scratch\test-repo-category-fallback` and initialize an empty git repository in it using `git init`.
2. **Missing Explicit Category:** From within the mock repository, create a scratch file `dummy.txt`, stage it with `git add dummy.txt`, and attempt to run `bun C:\Users\chris\Desktop\adamic\.agents\scripts\commit.ts` without providing a `--category` flag, but with a type of `feat` (e.g., `bun C:\Users\chris\Desktop\adamic\.agents\scripts\commit.ts --msg "feat(core): subject" --impact 0.5 --confidence 0.5 --validation passed --no-history`).

### Phase 2: Meta-Cognitive Debugging
1. The commit should succeed without the `--category` flag. Verify it succeeded using `bun C:\Users\chris\Desktop\adamic\.agents\scripts\get-git-history-json.ts --limit 1`.
2. **CRITICAL CHECK:** Examine the `metadata.category` field in the JSON output. It MUST be an array containing exactly `"Added"` (i.e. `["Added"]`) because the commit type was `feat`.
3. If it crashes, throws an error, or sets the category to `["Changed"]` or `undefined`, formulate a hypothesis for the failure in a scratch file (`<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`).
4. Fix `commit.ts` if the fallback logic is broken.

### Phase 3: Cleanup & Commit (Critical)
1. Delete the mock repository at `<appDataDir>\brain\<conversation-id>\scratch\test-repo-category-fallback` and any other scratch files.
2. If a fix was required to `commit.ts`, stage it in the main repository and commit using `bun C:\Users\chris\Desktop\adamic\.agents\scripts\commit.ts` with valid arguments.
