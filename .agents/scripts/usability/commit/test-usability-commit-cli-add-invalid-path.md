# Usability Test: Strict Commit Validation CLI (Add Flag - Invalid Path)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse errors sequentially and never mutate git history. If an accidental commit is created during fuzzing, you must reset it immediately.

## Objective
Verify that the `commit.ts` CLI appropriately fails or warns when the `--add` flag is passed a file path that does not exist or is invalid.

## Instructions

### Phase 1: Adversarial Fuzzing
1. **Setup Mock Repo:** Create a new directory `<appDataDir>\brain\<conversation-id>\scratch\test-repo-add-invalid` and initialize an empty git repository in it using `git init`.
2. **Commit with Invalid Add Path:** From within the mock repository, run the commit wrapper and attempt to stage a non-existent file using the `--add` flag: `bun C:\Users\chris\Desktop\adamic\.agents\scripts\commit.ts --add non-existent-file.txt --msg "feat(core): test add invalid path" --category Added --impact 0.1 --confidence 0.9 --validation passed`.

### Phase 2: Meta-Cognitive Debugging
1. Deliberately read the error output. Ensure the script fails cleanly, preventing the commit, and outputs an error about the file not existing or `git add` failing.
2. If it crashes, throws an unhandled exception, hangs, or allows the commit to succeed without adding anything (resulting in an empty commit error), formulate a hypothesis for the failure in a scratch file (`<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`).
3. If the error handling for `git add` is broken, fix it in `commit.ts`.

### Phase 3: Cleanup & Commit (Critical)
> [!CAUTION]
> Fuzzing commit scripts can accidentally pollute the repository.
1. Check if a commit was accidentally created using `bun C:\Users\chris\Desktop\adamic\.agents\scripts\get-git-history-json.ts --limit 1` in the mock repo.
2. Delete the mock repository at `<appDataDir>\brain\<conversation-id>\scratch\test-repo-add-invalid` and any other scratch files.
3. If a fix was required to `commit.ts`, stage it in the main repository and commit using `bun C:\Users\chris\Desktop\adamic\.agents\scripts\commit.ts` with valid arguments (`--msg "fix(commit): handle git add invalid path error"`, `--category Changed`, `--impact 0.5`, `--confidence 0.5`, `--validation passed`).
