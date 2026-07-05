# Usability Test: Strict Commit Validation CLI (CWD Invalid)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse errors sequentially and never mutate git history.

## Objective
Verify that `commit.ts` safely traps invalid paths provided to the `--cwd` flag.

## Instructions

### Phase 1: Adversarial Fuzzing
1. **Setup Mock Repo:** Create a new directory `<appDataDir>\brain\<conversation-id>\scratch\test-repo-cwd-invalid` and initialize an empty git repository in it using `git init`.
2. **Invalid CWD:** Attempt to run `bun C:\Users\chris\Desktop\adamic\.agents\scripts\commit.ts --cwd "C:\Path\That\Absolutely\Does\Not\Exist\12345" --msg "feat(core): invalid cwd" --impact 0.5 --confidence 0.5 --validation passed --no-history`.

### Phase 2: Meta-Cognitive Debugging
1. The script should abort cleanly with a `Commit failed: Directory does not exist or is not a directory` error (or similar).
2. It should NOT create a commit in the current working directory.
3. If it crashes unexpectedly or hangs, formulate a hypothesis in `<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`.
4. Fix `commit.ts` if the error handling for the `cwd` validation is broken.

### Phase 3: Cleanup & Commit (Critical)
1. Delete the mock repository at `<appDataDir>\brain\<conversation-id>\scratch\test-repo-cwd-invalid` and any scratch files.
2. If a fix was required to `commit.ts`, stage and commit it to the main repo using `commit.ts`.
