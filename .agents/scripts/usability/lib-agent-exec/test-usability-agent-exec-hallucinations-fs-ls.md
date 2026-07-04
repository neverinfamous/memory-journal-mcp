# Usability Test: Agent-Exec Hallucinations (FS Aliases)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must explicitly document your hypotheses before modifying code. You must write an isolated unit test reproducing any failure *before* you apply a fix.

## Objective
Verify that `lib-agent-exec` correctly intercepts the PowerShell alias `ls` when used in a command payload and throws an anti-hallucination error.

## Instructions

### Phase 1: Adversarial Execution
1. **FS Alias Hallucinations:** Attempt to run `ls` as a raw command payload.
2. **Interception Check:** Verify the interceptor traps `ls` and throws a specific anti-hallucination error instructing the agent to NOT use this or its PowerShell cmdlet equivalent (`Get-ChildItem`). Instead, the error MUST instruct the agent to use the agent-native tools (`list_dir`).

### Phase 2: Meta-Cognitive Debugging
If the command evades the interceptor or errors vaguely:
1. **Formulate Hypothesis:** Create a file `<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`.
2. **Reproduce:** Add a failing test case to `.agents/scripts/lib-agent-exec/tests/`.
3. **Fix & Verify:** Modify the interceptor logic (using `ts-pattern`). Run `bun run typecheck` and `bun run lint`.

### Phase 3: Cleanup & Commit
1. Delete any scratch files you created.
2. Run `pnpm run check` to validate.
3. Commit the changes using `commit.ts`.
