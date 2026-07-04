# Usability Test: Strict Commit Validation CLI (Help Flag)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse errors sequentially and never mutate git history.

## Objective
Verify that the `commit.ts` CLI successfully outputs help information when `--help` is provided, without executing a commit.

## Instructions

### Phase 1: Adversarial Fuzzing
1. **Setup Mock Repo:** Create a new directory `<appDataDir>\brain\<conversation-id>\scratch\test-repo-help` and initialize an empty git repository in it using `git init`.
2. **Help Flag Execution:** From within the mock repository, run: `bun C:\Users\chris\Desktop\adamic\.agents\scripts\commit.ts --help`.

### Phase 2: Meta-Cognitive Debugging
1. Verify that the script outputs usage instructions detailing the available flags (e.g., `--msg`, `--impact`, `--category`).
2. Verify that it exited cleanly and did NOT create a commit.
3. If it failed to output help or crashed, formulate a hypothesis in a scratch file (`<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`).
4. Fix the help logic in `commit.ts` if necessary.

### Phase 3: Cleanup
1. Delete the mock repository at `<appDataDir>\brain\<conversation-id>\scratch\test-repo-help`.
