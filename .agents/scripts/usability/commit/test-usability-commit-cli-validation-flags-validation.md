# Usability Test: Strict Commit Validation CLI (Missing Validation Flag)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse errors sequentially and never mutate git history. If an accidental commit is created during fuzzing, you must reset it immediately.

## Objective
Verify that the `commit.ts` CLI strictly enforces the requirement of the `--validation` flag and provides an actionable Zod validation error when it is missing.

## Instructions

### Phase 1: Adversarial Fuzzing
1. **Setup Mock Repo:** Create a new directory `<appDataDir>\brain\<conversation-id>\scratch\test-repo-missing-validation` and initialize an empty git repository in it using `git init`.
2. **Missing Validation Flag:** From within the mock repository, create a scratch file `dummy.txt`, stage it with `git add dummy.txt`, and attempt to run `bun C:\Users\chris\Desktop\adamic\.agents\scripts\commit.ts` without the `--validation` flag. Ensure you provide all other mandatory flags correctly (`--msg`, `--category Changed`, `--impact 0.5`, `--confidence 0.5`).

### Phase 2: Meta-Cognitive Debugging
1. For each error encountered, deliberately read the error output. Ensure the script fails cleanly with an explicit error indicating that `--validation` is a required flag.
2. If it crashes, throws an unhandled exception, or hangs, formulate a hypothesis for the failure in a scratch file (`<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`).
3. If the validation is broken, fix it in `commit.ts` to ensure `--validation` is marked as mandatory.

### Phase 3: Cleanup & Commit (Critical)
> [!CAUTION]
> Fuzzing commit scripts can accidentally pollute the repository.
1. Delete the mock repository at `<appDataDir>\brain\<conversation-id>\scratch\test-repo-missing-validation` and any other scratch files.
2. If a fix was required to `commit.ts`, stage it in the main repository and commit using `bun C:\Users\chris\Desktop\adamic\.agents\scripts\commit.ts` with valid arguments (`--msg`, `--category Changed`, `--impact 0.5`, `--confidence 0.5`, `--validation passed`).
