# Usability Test: Agent-Exec Git Interceptor

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must explicitly document your hypotheses before modifying code. You must write an isolated unit test reproducing any failure *before* you apply a fix.

## Objective
Verify that `lib-agent-exec` correctly intercepts forbidden `git` flows via the `git-interceptor`.

## Instructions

### Phase 1: Adversarial Execution
1. **Bad Git Flows:** Attempt to run `git log`, `git shortlog`, or `git show` directly in the shell.
2. **Interception Check:** Verify the `git-interceptor` traps the command and instructs the agent to use `bun .\.agents\scripts\get-git-history-json.ts` instead, gracefully exiting rather than hanging or outputting unparsable history text.

### Phase 2: Meta-Cognitive Debugging
If the forbidden git command evades the interceptor:
1. **Formulate Hypothesis:** Create a file `<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt` explaining *why* the logic in `git-interceptor.ts` failed.
2. **Reproduce:** Add a failing test case to `.agents/scripts/lib-agent-exec/tests/git-interceptor.test.ts`.
> **CRITICAL**: Before proceeding, read `C:\Users\chris\Desktop\adamic\skills\pattern-matching\SKILL.md`.

3. **Fix & Verify:** Modify the interceptor logic. You MUST use `ts-pattern`. Run `bun run typecheck` and `bun run lint`.

### Phase 3: Cleanup & Commit
1. Delete any scratch files you created.
2. Run `pnpm run check` to validate.
3. Commit the changes using `commit.ts`.
