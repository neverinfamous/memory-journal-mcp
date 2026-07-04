# Usability Test: Strict Commit Validation CLI (Duplicate Message Aliases)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse errors sequentially and never mutate git history.

## Objective
Verify that the `commit.ts` CLI successfully rejects the command when multiple commit messages are provided (e.g., using both `--msg` and `--message`).

## Instructions

### Phase 1: Adversarial Fuzzing
1. **Setup Mock Repo:** Create a new directory `<appDataDir>\brain\<conversation-id>\scratch\test-repo-msg-alias-duplicate` and initialize an empty git repository in it using `git init`.
2. **Commit with Duplicate Messages:** From within the mock repository, create a scratch file `dummy1.txt` and stage it using `git add dummy1.txt`. Attempt a commit using both `--msg` and `--message` flags: `bun C:\Users\chris\Desktop\adamic\.agents\scripts\commit.ts --msg "feat(core): first message" --message "feat(core): second message" --category Added --impact 0.1 --confidence 0.9 --validation passed`.

### Phase 2: Meta-Cognitive Debugging
1. Verify that the commit was **rejected** with an error about multiple commit messages provided.
2. If the commit is mistakenly accepted (e.g. one message silently overrides the other), formulate a hypothesis in a scratch file (`<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`).
3. Fix the alias logic in `commit.ts` to strictly reject duplicate message inputs.

### Phase 3: Cleanup & Commit (Critical)
1. Delete the mock repository at `<appDataDir>\brain\<conversation-id>\scratch\test-repo-msg-alias-duplicate` and any other scratch files.
2. If a fix was required to `commit.ts`, stage it in the main repository and commit using `bun C:\Users\chris\Desktop\adamic\.agents\scripts\commit.ts` with valid arguments.
