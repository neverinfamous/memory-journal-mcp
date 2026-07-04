# Usability Test: Strict Commit Validation CLI (Trust Validation Types)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse errors sequentially and never mutate git history. If an accidental commit is created during fuzzing, you must reset it immediately.

## Objective
Verify that the `commit.ts` CLI strictly enforces that `--trust` only accepts numbers, even though it is deprecated.

## Instructions

### Phase 1: Adversarial Fuzzing
1. **Setup Mock Repo:** Create a new directory `<appDataDir>\brain\<conversation-id>\scratch\test-repo-types-trust` and initialize an empty git repository in it using `git init`.
2. **Invalid Type for Trust Flag:** From within the mock repository, create a scratch file `dummy.txt`, stage it with `git add dummy.txt`, and attempt to run `bun C:\Users\chris\Desktop\adamic\.agents\scripts\commit.ts` with `--trust invalidString`. Ensure you provide all other mandatory flags correctly (`--msg`, `--category Changed`, `--impact 0.5`, `--confidence 0.5`, `--validation passed`).

### Phase 2: Meta-Cognitive Debugging
1. For each error encountered, deliberately read the error output. Ensure the script fails cleanly with an explicit Zod validation error indicating that `--trust` must be a number.
2. If it crashes, throws an unhandled exception, or hangs, formulate a hypothesis for the failure in a scratch file (`<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`).
3. If the validation is broken, fix it in `commit.ts` to ensure strict type checking for the `--trust` flag.

### Phase 3: Cleanup & Commit (Critical)
> [!CAUTION]
> Fuzzing commit scripts can accidentally pollute the repository.
1. Delete the mock repository at `<appDataDir>\brain\<conversation-id>\scratch\test-repo-types-trust` and any other scratch files.
2. If a fix was required to `commit.ts`, stage it in the main repository and commit using `bun C:\Users\chris\Desktop\adamic\.agents\scripts\commit.ts` with valid arguments (`--msg`, `--category Changed`, `--impact 0.5`, `--confidence 0.5`, `--validation passed`).
