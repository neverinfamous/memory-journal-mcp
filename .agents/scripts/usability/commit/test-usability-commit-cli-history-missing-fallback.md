# Usability Test: Strict Commit Validation CLI (History Missing Fallback)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse errors sequentially and never mutate git history.

## Objective
Verify that `commit.ts` automatically falls back to `--no-history` and logs an autonomous healing warning when no history flags (`--history`, `--history-file`, `--no-history`) are provided.

## Instructions

### Phase 1: Adversarial Fuzzing
1. **Setup Mock Repo:** Create a new directory `<appDataDir>\brain\<conversation-id>\scratch\test-repo-history-fallback` and initialize an empty git repository in it using `git init`.
2. **Missing History Flags:** Stage a mock change (`echo "test" > dummy.txt && git add dummy.txt`).
3. Attempt to run `bun C:\Users\chris\Desktop\adamic\.agents\scripts\commit.ts --msg "feat(core): subject" --category Changed --impact 0.5 --confidence 0.5 --validation passed` from within the mock repo. Note that NO history flags are provided.

### Phase 2: Meta-Cognitive Debugging
1. The script should emit the warning `⚠️ AUTONOMOUS HEALING: Missing history flag detected. Defaulting to --no-history.` and succeed.
2. Verify using `bun C:\Users\chris\Desktop\adamic\.agents\scripts\get-git-history-json.ts --limit 1` that the commit was successfully created without history entries (only Category, Impact, Confidence, Validation).
3. If the script fails, aborts, or requires history instead of falling back, formulate a hypothesis in `<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`.
4. Fix the fallback logic in `commit.ts` if broken.

### Phase 3: Cleanup & Commit (Critical)
1. Delete the mock repository at `<appDataDir>\brain\<conversation-id>\scratch\test-repo-history-fallback` and any scratch files.
2. If a fix was required to `commit.ts`, stage and commit it to the main repo using `commit.ts`.
