# Usability Test: Agent-Exec Payload Timeout - timeoutMs

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must explicitly document your hypotheses before modifying code. You must write an isolated unit test reproducing any failure *before* you apply a fix.

## Objective
Verify that `lib-agent-exec` correctly parses and respects the `timeoutMs` option.

## Instructions

### Phase 1: Adversarial Execution
1. **Execution Timeout:** Test payload with `timeoutMs` set to 100ms. Run a script or command that sleeps for 1 second. Verify the process is killed and the correct timeout error is reported.
2. **Timeout Bounds:** Pass `timeoutMs` exceeding the maximum safe integer (e.g. `3000000000`) and verify Zod restricts it to the max limit (`2147483647`).

### Phase 2: Meta-Cognitive Debugging
1. If timeouts fail to correctly terminate the processes:
   - **Formulate Hypothesis:** Create `<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`.
   - **Reproduce:** Add a test case to the test suite.
   - **Fix:** Update the timing logic in `agent-exec.ts`.

### Phase 3: Cleanup & Commit
1. Delete any scratch artifacts.
2. Commit your fix using `commit.ts`.
