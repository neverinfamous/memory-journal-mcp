# Usability Test: Strict Commit Validation CLI (Metadata CWD)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse errors sequentially and never mutate git history.

## Objective
Verify that the `commit.ts` CLI successfully accepts the `--cwd` flag according to the SSoT.

## Instructions

### Phase 1: Adversarial Fuzzing
1. **Setup Mock Repo:** Create a new directory `<appDataDir>\brain\<conversation-id>\scratch\test-repo-metadata-cwd`, change into it, initialize an empty git repository, and create and stage a dummy file.
2. **Commit with CWD Flag:** Switch back to the adamic root directory (outside the mock repository) and attempt a commit passing `--cwd`:
`bun C:\Users\chris\Desktop\adamic\.agents\scripts\commit.ts --cwd <appDataDir>\brain\<conversation-id>\scratch\test-repo-metadata-cwd --msg "feat(core): test cwd flag" --category Added --impact 0.1 --confidence 0.9 --validation passed`.

### Phase 2: Meta-Cognitive Debugging
1. Extract the commit data using `bun C:\Users\chris\Desktop\adamic\.agents\scripts\get-git-history-json.ts --limit 1` within the mock repository.
2. Verify that the output JSON accurately reflects the commit was successfully made in the target CWD.
3. If the commit failed or the CWD flag was ignored, formulate a hypothesis in a scratch file (`<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`).
4. Fix the logic in `commit.ts` if necessary.

### Phase 3: Cleanup & Commit (Critical)
1. Delete the mock repository at `<appDataDir>\brain\<conversation-id>\scratch\test-repo-metadata-cwd` and any other scratch files.
2. If a fix was required to `commit.ts`, stage it in the main repository and commit using `bun C:\Users\chris\Desktop\adamic\.agents\scripts\commit.ts` with valid arguments (`--msg`, `--category Changed`, `--impact 0.5`, `--confidence 0.5`, `--validation passed`).
