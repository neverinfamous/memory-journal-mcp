# Usability Test: Strict Commit Validation CLI (Merge State Check)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse errors sequentially and never mutate git history.

## Objective
Verify that `commit.ts` rejects commits when the repository is in an active merge or rebase state (e.g. `MERGE_HEAD` exists).

## Instructions

### Phase 1: Adversarial Fuzzing
1. **Setup Mock Repo:** Create a new directory `<appDataDir>\brain\<conversation-id>\scratch\test-repo-merge-state` and initialize an empty git repository in it using `git init`.
2. **Simulate Merge State:** From within the mock repository, create the mock file `.git/MERGE_HEAD` to spoof an active merge conflict state.
3. **Attempt Commit:** Stage a mock change (`echo "test" > dummy.txt && git add dummy.txt`) and run `bun C:\Users\chris\Desktop\adamic\.agents\scripts\commit.ts --msg "feat(core): test merge state" --category Changed --impact 0.5 --confidence 0.5 --validation passed --no-history`.

### Phase 2: Meta-Cognitive Debugging
1. The script should instantly abort with `❌ Repository is in a merge/rebase state. Resolve conflicts first.`
2. If the commit miraculously succeeds, or throws an unhandled exception, formulate a hypothesis in `<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`.
3. If the script fails to detect the merge state, fix `commit.ts`.

### Phase 3: Cleanup & Commit (Critical)
1. Delete the mock repository at `<appDataDir>\brain\<conversation-id>\scratch\test-repo-merge-state` and any scratch files.
2. If a fix was required to `commit.ts`, stage and commit it to the main repo using `commit.ts`.
