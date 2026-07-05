# Usability Test: Strict Commit Validation CLI (Escaping Edge Cases)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse errors sequentially and never mutate git history.

## Objective
Verify that the `commit.ts` CLI safely handles weird symbols and unescaped quotes in the commit message.

## Instructions

### Phase 1: Adversarial Fuzzing
1. **Setup Mock Repo:** Create a new directory `<appDataDir>\brain\<conversation-id>\scratch\test-repo-escaping` and initialize an empty git repository in it using `git init`.
2. **Escaping Edge Cases:** In the mock repository, create a scratch file `dummy-escape.txt` and stage it using `git add dummy-escape.txt`. Then attempt a commit message with unescaped quotes or weird symbols from within the mock repo: `bun C:\Users\chris\Desktop\adamic\.agents\scripts\commit.ts --msg "fix(scope): adding 'quotes' and \weird\ characters" --category Changed --impact 0.5 --confidence 0.5 --validation passed --no-history`.

### Phase 2: Meta-Cognitive Debugging
1. Check if the commit succeeds cleanly without shell syntax errors or JSON corruption.
2. If it crashes or corrupts the commit message, write a hypothesis in a scratch file (`<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`).
3. If it crashed or corrupted the message, fix the parsing/escaping logic in `commit.ts`.

### Phase 3: Cleanup & Commit (Critical)
1. In the mock repo, check the latest commit using `bun C:\Users\chris\Desktop\adamic\.agents\scripts\get-git-history-json.ts --limit 1` to ensure it looks correct.
2. Delete the mock repository at `<appDataDir>\brain\<conversation-id>\scratch\test-repo-escaping` and any other scratch files.
3. If a fix was required to `commit.ts`, stage it in the main repository and commit using `bun C:\Users\chris\Desktop\adamic\.agents\scripts\commit.ts` with valid arguments (`--msg`, `--category Changed`, `--impact 0.5`, `--confidence 0.5`, `--validation passed`, `--journal`).
