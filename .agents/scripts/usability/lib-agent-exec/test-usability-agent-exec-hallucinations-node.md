# Usability Test: Agent-Exec Hallucinations (Node Eval)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must explicitly document your hypotheses before modifying code. You must write an isolated unit test reproducing any failure *before* you apply a fix.

## Objective
Verify that `lib-agent-exec` correctly intercepts and rejects `node -e` as a hallucination prone to quoting bugs, instructing the agent to use an 'eval' payload.

## Instructions

### Phase 1: Adversarial Execution
1. **Node Hallucination:** Attempt to run `node -e "console.log('test')"`.
2. **Interception Check:** Verify the interceptor traps the command and throws a specific anti-hallucination error instructing the agent to use an eval payload with `interpreter: node`.

### Phase 2: Meta-Cognitive Debugging
If the command evades the interceptor:
1. **Formulate Hypothesis:** Create a file `<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`.
2. **Reproduce:** Add a failing test case to `.agents/scripts/lib-agent-exec/tests/`.
3. **Fix & Verify:** Modify the interceptor logic (using `ts-pattern`). Run `bun run typecheck` and `bun run lint`.

### Phase 3: Cleanup & Commit
1. Delete any scratch files you created.
2. Run `pnpm run check` to validate.
3. Commit the changes using `commit.ts`.
