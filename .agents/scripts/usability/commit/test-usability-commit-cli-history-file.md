# Usability Test: Strict Commit Validation CLI (History File Flag)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse errors sequentially and never mutate git history.

## Objective
Verify that the `commit.ts` CLI successfully accepts the `--history-file` flag according to the SSoT.

## Instructions

### Phase 1: Adversarial Fuzzing
1. **Setup Mock Repo:** Create a new directory `<appDataDir>\brain\<conversation-id>\scratch\test-repo-history-file` and initialize an empty git repository in it using `git init`.
2. **Commit with History File:** From within the mock repository, create a scratch file `dummy-history2.txt` and stage it using `git add dummy-history2.txt`. Create a file containing history text `history.txt`, and attempt a commit using the history-file flag: `bun C:\Users\chris\Desktop\adamic\.agents\scripts\commit.ts --history-file history.txt --msg "feat(core): test history-file flag" --category Added --impact 0.1 --confidence 0.9 --validation passed`.

### Phase 2: Meta-Cognitive Debugging
1. Extract the commit data using `bun C:\Users\chris\Desktop\adamic\.agents\scripts\get-git-history-json.ts --limit 1` within the mock repository.
2. Verify that the output JSON accurately reflects the provided history narrative from the file.
3. If the history is missing, incorrectly parsed, or errors occur, formulate a hypothesis in a scratch file (`<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`).
4. Fix the logic in `commit.ts` if necessary.

### Phase 3: Cleanup & Commit (Critical)
1. Delete the mock repository at `<appDataDir>\brain\<conversation-id>\scratch\test-repo-history-file` and any other scratch files.
2. If a fix was required to `commit.ts`, stage it in the main repository and commit using `bun C:\Users\chris\Desktop\adamic\.agents\scripts\commit.ts` with valid arguments (`--msg`, `--category Changed`, `--impact 0.5`, `--confidence 0.5`, `--validation passed`).
