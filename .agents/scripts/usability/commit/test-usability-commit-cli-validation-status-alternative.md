# Usability Test: Strict Commit Validation CLI (Alternative Valid Statuses)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse errors sequentially and never mutate git history. If an accidental commit is created during fuzzing, you must reset it immediately.

## Objective
Verify that the `commit.ts` CLI successfully accepts alternative valid `--validation` enum statuses (`none` and `failed`).

## Instructions

### Phase 1: Adversarial Fuzzing
1. **Setup Mock Repo:** Create a new directory `<appDataDir>\brain\<conversation-id>\scratch\test-repo-status-alternative` and initialize an empty git repository in it using `git init`.
2. **Failed Status:** From within the mock repository, create a scratch file `dummy1.txt`, stage it with `git add dummy1.txt`, and run `bun C:\Users\chris\Desktop\adamic\.agents\scripts\commit.ts --validation failed --msg "fix(core): test failed validation" --category Changed --impact 0.5 --confidence 0.5`.
3. **None Status:** Modify `dummy1.txt`, stage it, and run `bun C:\Users\chris\Desktop\adamic\.agents\scripts\commit.ts --validation none --msg "docs: test none validation" --category Changed --impact 0.1 --confidence 0.9`.

### Phase 2: Meta-Cognitive Debugging
1. Verify both commits were created successfully using `bun C:\Users\chris\Desktop\adamic\.agents\scripts\get-git-history-json.ts --limit 2`. Check that the metadata contains the correct validation statuses.
2. If either command crashes or rejects the valid status, formulate a hypothesis for the failure in a scratch file (`<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`).
3. If the validation is broken, fix it in `commit.ts` by updating the Zod schema or validation logic.

### Phase 3: Cleanup & Commit (Critical)
> [!CAUTION]
> Fuzzing commit scripts can accidentally pollute the repository.
1. Delete the mock repository at `<appDataDir>\brain\<conversation-id>\scratch\test-repo-status-alternative` and any other scratch files.
2. If a fix was required to `commit.ts`, stage it in the main repository and commit using `bun C:\Users\chris\Desktop\adamic\.agents\scripts\commit.ts` with valid arguments (`--msg "fix(commit): accept alternative validation statuses"`, `--category Changed`, `--impact 0.5`, `--confidence 0.5`, `--validation passed`).
