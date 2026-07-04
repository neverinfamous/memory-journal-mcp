# Usability Test: Strict Commit Validation CLI (Message Format - Invalid)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse errors sequentially and never mutate git history. If an accidental commit is created during fuzzing, you must reset it immediately.

## Objective
Verify that the `commit.ts` CLI strictly enforces Conventional Commits format for the `--msg` flag.

## Instructions

### Phase 1: Adversarial Fuzzing
1. **Setup Mock Repo:** Create a new directory `<appDataDir>\brain\<conversation-id>\scratch\test-repo-format-invalid` and initialize an empty git repository in it using `git init`.
2. **Invalid Conventional Commit:** From within the mock repository, create a scratch file `dummy.txt`, stage it with `git add dummy.txt`, and attempt to run `bun C:\Users\chris\Desktop\adamic\.agents\scripts\commit.ts` with an invalid commit message format (e.g., `--msg "not a conventional commit"`). Ensure you provide all other mandatory flags correctly (e.g., `--category Changed`, `--impact 0.5`, `--confidence 0.5`, `--validation passed`).

### Phase 2: Meta-Cognitive Debugging
1. Deliberately read the error output. Ensure the script fails cleanly, preventing the commit, and outputs an error about the conventional commit format.
2. If it crashes, throws an unhandled exception, hangs, or allows the commit to succeed, formulate a hypothesis for the failure in a scratch file (`<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`).
3. If the validation is broken, fix it in `commit.ts`.
   > **CRITICAL**: Read the domain skills for `pattern-matching`, `zod`, and `typescript` before proceeding.

### Phase 3: Cleanup & Commit (Critical)
> [!CAUTION]
> Fuzzing commit scripts can accidentally pollute the repository.
1. Check if a commit was accidentally created using `bun C:\Users\chris\Desktop\adamic\.agents\scripts\get-git-history-json.ts --limit 1` in the mock repo.
2. Delete the mock repository at `<appDataDir>\brain\<conversation-id>\scratch\test-repo-format-invalid` and any other scratch files.
3. If a fix was required to `commit.ts`, stage it in the main repository and commit using `bun C:\Users\chris\Desktop\adamic\.agents\scripts\commit.ts` with valid arguments (`--msg`, `--category Changed`, `--impact 0.5`, `--confidence 0.5`, `--validation passed`).
