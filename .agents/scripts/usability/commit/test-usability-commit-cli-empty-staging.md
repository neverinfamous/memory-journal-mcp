# Usability Test: Strict Commit Validation CLI (Empty Staging)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse errors sequentially and never mutate git history.

## Objective
Verify that the `commit.ts` CLI safely rejects commits when no files are staged.

## Instructions

### Phase 1: Adversarial Fuzzing
1. **Setup Mock Repo:** Create a new directory `<appDataDir>\brain\<conversation-id>\scratch\test-repo-empty` and initialize an empty git repository in it using `git init`.
2. **Empty Staging:** From within that mock repository, attempt to run the commit script using its absolute path: `bun C:\Users\chris\Desktop\adamic\.agents\scripts\commit.ts` with valid arguments (`--msg "type(scope): message" --category Changed --impact 0.5 --confidence 0.5 --validation passed`), ensuring **no files are staged**.

### Phase 2: Meta-Cognitive Debugging
1. Verify that the script throws a clear `🛠️ AUTONOMOUS HEALING: No files staged for commit.` error instead of hanging or creating an empty commit.
2. If it hangs or behaves unexpectedly, formulate a hypothesis in a scratch file (`<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`).
3. If it behaved unexpectedly, fix the logic in `commit.ts` to properly detect empty staging.

### Phase 3: Cleanup & Commit (Critical)
1. Delete the mock repository at `<appDataDir>\brain\<conversation-id>\scratch\test-repo-empty` and any other scratch files.
2. If a fix was required to `commit.ts`, stage it in the main repository and commit using `bun C:\Users\chris\Desktop\adamic\.agents\scripts\commit.ts` with valid arguments (`--msg`, `--category Changed`, `--impact 0.5`, `--confidence 0.5`, `--validation passed`).
