# Usability Test: Strict Commit Validation CLI (Multiple Add Flags)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse errors sequentially and never mutate git history.

## Objective
Verify that the `commit.ts` CLI successfully accepts multiple `--add` flags to stage multiple specific files simultaneously.

## Instructions

### Phase 1: Adversarial Fuzzing
1. **Setup Mock Repo:** Create a new directory `<appDataDir>\brain\<conversation-id>\scratch\test-repo-add-multiple` and initialize an empty git repository in it using `git init`.
2. **Commit with Multiple Add Flags:** From within the mock repository, create three scratch files `dummy-add1.txt`, `dummy-add2.txt`, and `dummy-add3.txt`. Do NOT run `git add`. Attempt a commit using multiple `--add` flags to stage only two of the files: `bun C:\Users\chris\Desktop\adamic\.agents\scripts\commit.ts --add dummy-add1.txt --add dummy-add2.txt --msg "feat(core): test multiple add flags" --category Added --impact 0.1 --confidence 0.9 --validation passed`.

### Phase 2: Meta-Cognitive Debugging
1. Extract the commit data using `bun C:\Users\chris\Desktop\adamic\.agents\scripts\get-git-history-json.ts --limit 1` within the mock repository.
2. Verify that `dummy-add1.txt` and `dummy-add2.txt` were committed, and `dummy-add3.txt` remains untracked.
3. If not all specified files were committed, or if all three were committed, or if the CLI failed to parse multiple `--add` flags, formulate a hypothesis in a scratch file (`<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`).
4. Fix the array parsing logic for the `--add` flag in `commit.ts` if necessary.

### Phase 3: Cleanup & Commit (Critical)
1. Delete the mock repository at `<appDataDir>\brain\<conversation-id>\scratch\test-repo-add-multiple` and any other scratch files.
2. If a fix was required to `commit.ts`, stage it in the main repository and commit using `bun C:\Users\chris\Desktop\adamic\.agents\scripts\commit.ts` with valid arguments (`--msg`, `--category Changed`, `--impact 0.5`, `--confidence 0.5`, `--validation passed`).
