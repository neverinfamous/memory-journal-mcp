# Usability Test: Strict Commit Validation (Bypassing Interceptors)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must explicitly document your hypotheses before modifying code. You must write an isolated unit test reproducing any failure *before* you apply a fix.

## Objective
Verify that `lib-agent-exec` correctly intercepts attempts to bypass the `commit.ts` wrapper by running `git commit` directly in the shell.

## Instructions

### Phase 1: Adversarial Execution
1. **Setup Mock Repo:** Create a new directory `<appDataDir>\brain\<conversation-id>\scratch\test-repo-bypass` and initialize an empty git repository in it using `git init`.
2. **Stage a File:** Create a scratch file `dummy.txt` and stage it using `git add dummy.txt`.
3. **Bypass Attempt:** Attempt to commit directly via the shell by running `git commit -m "chore: bypass commit wrapper"` using `run_command`.
4. **Interception Check:** Verify the `git-interceptor` traps the command, prevents the commit, and outputs an error instructing the agent to use `bun .\.agents\scripts\commit.ts` instead.

### Phase 2: Meta-Cognitive Debugging
If the raw `git commit` succeeds (evades the interceptor):
1. **Formulate Hypothesis:** Create a file `<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt` explaining *why* the logic in `.agents/scripts/lib-agent-exec/interceptors/git-interceptor.ts` failed to block a non-interactive `git commit` that has a `-m` flag.
2. **Reproduce:** Add a failing test case to `.agents/scripts/lib-agent-exec/tests/git-interceptor.test.ts`.
> **CRITICAL**: Before proceeding, read `C:\Users\chris\Desktop\adamic\skills\pattern-matching\SKILL.md`.

3. **Fix & Verify:** Modify the interceptor logic in `git-interceptor.ts` to block `git commit` completely (as it should ONLY be run via the `commit.ts` wrapper, which uses `execFileSync` natively and bypasses the shell interceptor). Make sure you don't break anything. Run `bun run typecheck` and `bun run lint`.

### Phase 3: Cleanup & Commit
1. Verify the commit history in the mock repo to ensure no commit was created.
2. Delete the mock repository at `<appDataDir>\brain\<conversation-id>\scratch\test-repo-bypass` and any other scratch files.
3. Run `pnpm run check` to validate.
4. Commit the changes using `bun C:\Users\chris\Desktop\adamic\.agents\scripts\commit.ts` with valid arguments (`--msg`, `--category Changed`, `--impact 0.5`, `--confidence 0.5`, `--validation passed`).
