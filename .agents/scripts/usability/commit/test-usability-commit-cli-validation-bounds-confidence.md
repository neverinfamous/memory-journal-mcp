# Usability Test: Strict Commit Validation CLI (Validation Bounds - Confidence)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse errors sequentially and never mutate git history. If an accidental commit is created during fuzzing, you must reset it immediately.

## Objective
Verify that the `commit.ts` CLI strictly enforces Zod validation bounds for the `--confidence` numeric metadata flag (must be 0.0 to 1.0).

## Instructions

### Phase 1: Adversarial Fuzzing
1. **Setup Mock Repo:** Create a new directory `<appDataDir>\brain\<conversation-id>\scratch\test-repo-bounds-confidence` and initialize an empty git repository in it using `git init`.
2. **Out-of-Bounds Values:** From within the mock repository, create a scratch file `dummy.txt`, stage it with `git add dummy.txt`, and attempt to run `bun C:\Users\chris\Desktop\adamic\.agents\scripts\commit.ts` with an out-of-bounds `--confidence` (e.g., `--confidence 1.1`, `--confidence -0.1`). Ensure all other mandatory flags are provided (e.g., `--msg "type(scope): message" --category Changed --impact 0.5 --validation passed`).

### Phase 2: Meta-Cognitive Debugging
1. For each error encountered, deliberately read the error output. Ensure the script fails cleanly with the exact message `🛠️ AUTONOMOUS HEALING: Invalid CLI arguments provided to commit.ts` and clear Zod validation errors about the bounded values.
2. If it crashes, throws an unhandled exception, or hangs, formulate a hypothesis for the failure in a scratch file (`<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`).
3. If the validation is broken, fix it in `commit.ts` using `ts-pattern` to cleanly parse and match Zod validation error states.
   > **CRITICAL**: Read the domain skills for `pattern-matching`, `zod`, and `typescript` before proceeding.

### Phase 3: Cleanup & Commit (Critical)
> [!CAUTION]
> Fuzzing commit scripts can accidentally pollute the repository.
1. Delete the mock repository at `<appDataDir>\brain\<conversation-id>\scratch\test-repo-bounds-confidence` and any other scratch files.
2. If a fix was required to `commit.ts`, stage it in the main repository and commit using `bun C:\Users\chris\Desktop\adamic\.agents\scripts\commit.ts` with valid arguments (`--msg "fix(commit): update bounds for confidence"`, `--category Changed`, `--impact 0.5`, `--confidence 0.5`, `--validation passed`).
