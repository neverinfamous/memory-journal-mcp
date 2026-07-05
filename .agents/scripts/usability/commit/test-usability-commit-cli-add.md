# Usability Test: Strict Commit Validation CLI (Add Flag)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse errors sequentially and never mutate git history.

## Objective
Verify that the `commit.ts` CLI successfully accepts the `--add` flag to stage specific files and rejects wildcard staging (`git add .`).

## Instructions

### Phase 1: Adversarial Fuzzing
1. **Setup Mock Repo:** Create a new directory `<appDataDir>\brain\<conversation-id>\scratch\test-repo-add` and initialize an empty git repository in it using `git init`.
2. **Commit with Add Flag:** From within the mock repository, create two scratch files `dummy-add1.txt` and `dummy-add2.txt`. Do NOT run `git add`. Attempt a commit using the `--add` flag to stage only one file: `bun C:\Users\chris\Desktop\adamic\.agents\scripts\commit.ts --add dummy-add1.txt --msg "feat(core): test add flag" --category Added --impact 0.1 --confidence 0.9 --validation passed --no-history`.

### Phase 2: Meta-Cognitive Debugging
1. Extract the commit data using `bun C:\Users\chris\Desktop\adamic\.agents\scripts\get-git-history-json.ts --limit 1` within the mock repository.
2. Verify that only `dummy-add1.txt` was committed and `dummy-add2.txt` remains untracked.
3. If both files were committed, or if the commit failed due to empty staging, formulate a hypothesis in a scratch file (`<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`).
4. Fix the staging logic in `commit.ts` if necessary.

### Phase 3: Cleanup & Commit (Critical)
1. Delete the mock repository at `<appDataDir>\brain\<conversation-id>\scratch\test-repo-add` and any other scratch files.
2. If a fix was required to `commit.ts`, stage it in the main repository and commit using `bun C:\Users\chris\Desktop\adamic\.agents\scripts\commit.ts` with valid arguments (`--msg`, `--category Changed`, `--impact 0.5`, `--confidence 0.5`, `--validation passed`).
