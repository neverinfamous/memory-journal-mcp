# Usability Test: Strict Commit Validation CLI (ParseArgs Errors)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse errors sequentially and never mutate git history.

## Objective
Verify that `commit.ts` safely traps and formats errors thrown by node's `util.parseArgs` (e.g. unknown options or invalid types).

## Instructions

### Phase 1: Adversarial Fuzzing
1. **Setup Mock Repo:** Create a new directory `<appDataDir>\brain\<conversation-id>\scratch\test-repo-parseargs` and initialize an empty git repository in it using `git init`.
2. **Unknown Option:** Stage a mock change (`echo "test" > dummy.txt && git add dummy.txt`).
3. Attempt to run `bun C:\Users\chris\Desktop\adamic\.agents\scripts\commit.ts --unknown-flag-123 --msg "feat: test" --impact 0.5 --confidence 0.5 --validation passed`.
4. **Invalid Boolean Value:** Attempt to run `bun C:\Users\chris\Desktop\adamic\.agents\scripts\commit.ts --journal=invalidstring --msg "feat: test" --impact 0.5 --confidence 0.5 --validation passed`.

### Phase 2: Meta-Cognitive Debugging
1. The script should instantly abort with clear error messages about CLI arguments:
   - "Error: Unknown CLI argument."
   - "Error parsing CLI arguments:"
2. If it hangs, crashes with a raw stack trace, or ignores the flags, formulate a hypothesis in `<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`.
3. Fix the `try/catch` in `commit.ts` around `parseArgs` if it's not working correctly.

### Phase 3: Cleanup & Commit (Critical)
1. Delete the mock repository at `<appDataDir>\brain\<conversation-id>\scratch\test-repo-parseargs` and any scratch files.
2. If a fix was required to `commit.ts`, stage and commit it to the main repo using `commit.ts`.
