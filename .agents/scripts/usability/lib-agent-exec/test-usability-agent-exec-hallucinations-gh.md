# Usability Test: Agent-Exec Hallucinations (GH Run)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must explicitly document your hypotheses before modifying code. You must write an isolated unit test reproducing any failure *before* you apply a fix.

## Objective
Verify that `lib-agent-exec` correctly intercepts `gh run view --log` and warns the agent about the exit code 1 behavior when still running, recommending the `schedule` tool.

## Instructions

### Phase 1: Adversarial Execution
1. **GH Run Hallucination:** Attempt to run `gh run view --log`.
2. **Interception Check:** Verify the interceptor traps the command and throws a specific anti-hallucination hint regarding exit code 1 and polling.

### Phase 2: Meta-Cognitive Debugging
If the command evades the interceptor:
1. **Formulate Hypothesis:** Create a file `<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`.
2. **Reproduce:** Add a failing test case to `.agents/scripts/lib-agent-exec/tests/`.
3. **Fix & Verify:** Modify the interceptor logic (using `ts-pattern`). Run `bun run typecheck` and `bun run lint`.

### Phase 3: Cleanup & Commit
1. Delete any scratch files you created.
2. Run `pnpm run check` to validate.
3. Commit the changes using `commit.ts`.
