# Usability Test: Agent-Exec Hallucinations (Inline Shell)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must explicitly document your hypotheses before modifying code. You must write an isolated unit test reproducing any failure *before* you apply a fix.

## Objective
Verify that `lib-agent-exec` correctly intercepts and rejects inline shell wrappers (`pwsh -c "git log"`, `bash -c "ls"`) as hallucinations, instructing the agent to use proper execution payloads (`command`, `eval`, or `script`) or native tools.

## Instructions

### Phase 1: Adversarial Execution
1. **Inline Shell Hallucination (pwsh):** Attempt to run `pwsh -c "git log"` and `pwsh -Command "echo test"`.
2. **Interception Check:** Verify the interceptor traps these commands and throws a specific anti-hallucination error instructing the agent to use the proper native payloads instead of attempting to wrap commands in shell executables.

### Phase 2: Meta-Cognitive Debugging
If the command evades the interceptor or errors vaguely:
1. **Formulate Hypothesis:** Create a file `<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`.
2. **Reproduce:** Add a failing test case to `.agents/scripts/lib-agent-exec/tests/`.
3. **Fix & Verify:** Modify the interceptor logic (using `ts-pattern`). Run `bun run typecheck` and `bun run lint`.

### Phase 3: Cleanup & Commit
1. Delete any scratch files you created.
2. Run `pnpm run check` to validate.
3. Commit the changes using `commit.ts`.
