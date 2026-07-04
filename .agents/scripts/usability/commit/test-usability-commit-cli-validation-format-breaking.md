# Usability Test: Strict Commit Validation CLI (Message Format - Breaking Change)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse errors sequentially and never mutate git history. If an accidental commit is created during fuzzing, you must reset it immediately.

## Objective
Verify that the `commit.ts` CLI successfully parses and accepts the breaking change indicator (`!`) in Conventional Commits format for the `--msg` flag, and that the resulting commit history properly flags it as a breaking change.

## Instructions

### Phase 1: Adversarial Fuzzing
1. **Setup Mock Repo:** Create a new directory `<appDataDir>\brain\<conversation-id>\scratch\test-repo-format-breaking` and initialize an empty git repository in it using `git init`.
2. **Breaking Change Message:** From within the mock repository, create a scratch file `dummy.txt`, stage it with `git add dummy.txt`, and attempt to run `bun C:\Users\chris\Desktop\adamic\.agents\scripts\commit.ts` with a breaking change indicator: `--msg "feat(core)!: breaking change subject"`. Ensure you provide all other mandatory flags correctly (e.g., `--category Changed`, `--impact 0.5`, `--confidence 0.5`, `--validation passed`).

### Phase 2: Meta-Cognitive Debugging
1. Deliberately check if the commit succeeded using `bun C:\Users\chris\Desktop\adamic\.agents\scripts\get-git-history-json.ts --limit 1` within the mock repository.
2. Verify that the output JSON accurately reflects `isBreaking: true`.
3. If it crashes, fails validation unexpectedly, hangs, or if `isBreaking` is false, formulate a hypothesis for the failure in a scratch file (`<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`).
4. If the parsing logic or extraction logic is broken, fix it.
   > **CRITICAL**: Read the domain skills for `pattern-matching`, `zod`, and `typescript` before proceeding.

### Phase 3: Cleanup & Commit (Critical)
> [!CAUTION]
> Fuzzing commit scripts can accidentally pollute the repository.
1. Delete the mock repository at `<appDataDir>\brain\<conversation-id>\scratch\test-repo-format-breaking` and any other scratch files.
2. If a fix was required to `commit.ts` or `get-git-history-json.ts`, stage it in the main repository and commit using `bun C:\Users\chris\Desktop\adamic\.agents\scripts\commit.ts` with valid arguments (`--msg "fix(commit): parse breaking change indicator"`, `--category Changed`, `--impact 0.5`, `--confidence 0.5`, `--validation passed`).
