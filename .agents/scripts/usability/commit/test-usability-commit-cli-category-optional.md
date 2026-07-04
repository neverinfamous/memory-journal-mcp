# Usability Test: Strict Commit Validation CLI (Category Optional)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse errors sequentially and never mutate git history. If an accidental commit is created during fuzzing, you must reset it immediately.

## Objective
Verify that the `commit.ts` CLI correctly treats the `--category` flag as optional and allows commits to proceed without it.

## Instructions

### Phase 1: Adversarial Fuzzing
1. **Setup Mock Repo:** Create a new directory `<appDataDir>\brain\<conversation-id>\scratch\test-repo-category-optional` and initialize an empty git repository in it using `git init`.
2. **Missing Category:** From within the mock repository, create a scratch file `dummy.txt`, stage it with `git add dummy.txt`, and attempt to run `bun C:\Users\chris\Desktop\adamic\.agents\scripts\commit.ts` without providing a `--category` flag (e.g., `bun C:\Users\chris\Desktop\adamic\.agents\scripts\commit.ts --msg "feat(core): category is optional" --impact 0.5 --confidence 0.5 --validation passed`). Ensure you provide all other mandatory flags correctly.

### Phase 2: Meta-Cognitive Debugging
1. The commit should succeed without the `--category` flag. Verify it succeeded using `bun C:\Users\chris\Desktop\adamic\.agents\scripts\get-git-history-json.ts --limit 1`.
2. If it crashes, throws an error, or forces a category, formulate a hypothesis for the failure in a scratch file (`<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`).
3. If the script incorrectly enforces `--category`, fix the CLI arguments schema in `commit.ts` to allow it to be optional as per SSoT.

### Phase 3: Cleanup & Commit (Critical)
> [!CAUTION]
> Fuzzing commit scripts can accidentally pollute the repository.
1. Delete the mock repository at `<appDataDir>\brain\<conversation-id>\scratch\test-repo-category-optional` and any other scratch files.
2. If a fix was required to `commit.ts`, stage it in the main repository and commit using `bun C:\Users\chris\Desktop\adamic\.agents\scripts\commit.ts` with valid arguments (`--msg "fix(commit): make category flag optional"`, `--category Changed`, `--impact 0.5`, `--confidence 0.5`, `--validation passed`).
