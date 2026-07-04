# Usability Test: Strict Commit Validation CLI (Message Alias --message)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse errors sequentially and never mutate git history.

## Objective
Verify that the `commit.ts` CLI successfully accepts the conventional commit message via its alias `--message`.

## Instructions

### Phase 1: Adversarial Fuzzing
1. **Setup Mock Repo:** Create a new directory `<appDataDir>\brain\<conversation-id>\scratch\test-repo-msg-alias-message` and initialize an empty git repository in it using `git init`.
2. **Commit with `--message` Alias:** From within the mock repository, create a scratch file `dummy1.txt` and stage it using `git add dummy1.txt`. Attempt a commit using the `--message` flag: `bun C:\Users\chris\Desktop\adamic\.agents\scripts\commit.ts --message "feat(core): test message alias" --category Added --impact 0.1 --confidence 0.9 --validation passed`.

### Phase 2: Meta-Cognitive Debugging
1. Extract the commit data for the commit using `bun C:\Users\chris\Desktop\adamic\.agents\scripts\get-git-history-json.ts --limit 1` within the mock repository.
2. Verify that the commit was successfully created and that its `subject` matches the provided message.
3. If the commit fails or the message is not parsed correctly, formulate a hypothesis in a scratch file (`<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`).
4. Fix the alias logic in `commit.ts` if necessary.

### Phase 3: Cleanup & Commit (Critical)
1. Delete the mock repository at `<appDataDir>\brain\<conversation-id>\scratch\test-repo-msg-alias-message` and any other scratch files.
2. If a fix was required to `commit.ts`, stage it in the main repository and commit using `bun C:\Users\chris\Desktop\adamic\.agents\scripts\commit.ts` with valid arguments (`--msg`, `--category Changed`, `--impact 0.5`, `--confidence 0.5`, `--validation passed`).
