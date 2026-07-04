# Usability Test: Strict Commit Validation CLI (Category Type Validation)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse errors sequentially and never mutate git history. If an accidental commit is created during fuzzing, you must reset it immediately.

## Objective
Verify that the `commit.ts` CLI safely handles incorrect data types (e.g., numbers, booleans) passed to the `--category` flag.

## Instructions

### Phase 1: Adversarial Fuzzing
1. **Setup Mock Repo:** Create a new directory `<appDataDir>\brain\<conversation-id>\scratch\test-repo-types-category` and initialize an empty git repository in it using `git init`.
2. **Invalid Type for Category:** From within the mock repository, create a scratch file `dummy.txt`, stage it with `git add dummy.txt`, and attempt to run `bun C:\Users\chris\Desktop\adamic\.agents\scripts\commit.ts` with an invalid data type for `--category` (e.g., passing a number without string formatting if possible, or fuzzing via script).
`bun C:\Users\chris\Desktop\adamic\.agents\scripts\commit.ts --msg "feat(core): category type test" --category 123 --impact 0.5 --confidence 0.5 --validation passed`

### Phase 2: Meta-Cognitive Debugging
1. Deliberately read the error output. Ensure the script fails cleanly and prevents the commit, either because `123` is not a valid category enum string, or due to type coercion/validation rules.
2. If it crashes, throws an unhandled exception, or hangs, formulate a hypothesis for the failure in a scratch file (`<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`).
3. If the validation is broken, fix it in `commit.ts`.

### Phase 3: Cleanup & Commit (Critical)
> [!CAUTION]
> Fuzzing commit scripts can accidentally pollute the repository.
1. Delete the mock repository at `<appDataDir>\brain\<conversation-id>\scratch\test-repo-types-category` and any other scratch files.
2. If a fix was required to `commit.ts`, stage it in the main repository and commit using `bun C:\Users\chris\Desktop\adamic\.agents\scripts\commit.ts` with valid arguments (`--msg "fix(commit): handle invalid category data types"`, `--category Changed`, `--impact 0.5`, `--confidence 0.5`, `--validation passed`).
