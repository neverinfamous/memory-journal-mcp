# Usability Test: Strict Commit Validation CLI (Category Validation)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse errors sequentially and never mutate git history. If an accidental commit is created during fuzzing, you must reset it immediately.

## Objective
Verify that the `commit.ts` CLI strictly enforces valid categories and provides actionable Zod validation errors for invalid category inputs.

## Instructions

### Phase 1: Adversarial Fuzzing
1. **Setup Mock Repo:** Create a new directory `<appDataDir>\brain\<conversation-id>\scratch\test-repo-category` and initialize an empty git repository in it using `git init`.
2. **Invalid Category:** From within the mock repository, create a scratch file `dummy.txt`, stage it with `git add dummy.txt`, and attempt to run `bun C:\Users\chris\Desktop\adamic\.agents\scripts\commit.ts` with an invalid category (e.g., `--category InvalidCategory`). Ensure you provide all other mandatory flags correctly (e.g. `--msg "test(cli): fuzzer test"`, `--impact 0.5`, `--confidence 0.5`, `--validation passed`).

### Phase 2: Meta-Cognitive Debugging
1. For each error encountered, deliberately read the error output. Ensure the script fails cleanly with an explicit error about the invalid category (e.g., `- --category: Invalid explicit category 'InvalidCategory'. Must be one of:`).
2. If it crashes, throws an unhandled exception, or hangs, formulate a hypothesis for the failure in a scratch file (`<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`).
3. If the validation is broken, fix the custom validation logic in `commit.ts`. Note that `--category` is validated in Zod via `z.enum()`, but uses a preprocessor for fallback derivations.

### Phase 3: Cleanup & Commit (Critical)
> [!CAUTION]
> Fuzzing commit scripts can accidentally pollute the repository.
1. Delete the mock repository at `<appDataDir>\brain\<conversation-id>\scratch\test-repo-category` and any other scratch files.
2. If a fix was required to `commit.ts`, stage it in the main repository and commit using `bun C:\Users\chris\Desktop\adamic\.agents\scripts\commit.ts` with valid arguments (`--msg`, `--category Changed`, `--impact 0.5`, `--confidence 0.5`, `--validation passed`). If no fix was required, you may update this test file with your findings and commit it instead.

## Findings
- Fuzzing executed successfully on `commit.ts` with `--category InvalidCategory`.
- The CLI script successfully intercepted the Zod validation failure (`invalid_value` in Zod 4).
- The script correctly exited with a clear error: `- --category: Invalid explicit category 'InvalidCategory'. Must be one of: Added, Changed, Fixed, Removed, Security, Deprecated`.
- The `z.enum(VALID_CATEGORIES)` fallback and custom `ts-pattern` error handling in `commit.ts` works precisely as intended. No code fixes were required.
