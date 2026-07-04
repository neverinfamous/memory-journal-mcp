# Usability Test: Agent-Exec Payload Boolean Flags (bypassInterceptors)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must explicitly document your hypotheses before modifying code. You must write an isolated unit test reproducing any failure *before* you apply a fix.

## Objective
Verify that `agent-exec.ts` respects the `bypassInterceptors` boolean flag in the JSON schema.

## Instructions

### Phase 1: Boolean Flag Validation
1. **bypassInterceptors:** Construct a command payload that triggers a known interceptor (e.g., launching an interactive tool or using a TTY flag), but set `"bypassInterceptors": true`. Verify that the payload is executed directly WITHOUT the interceptor stopping or modifying it.

### Phase 2: Meta-Cognitive Debugging
1. If the boolean flag is ignored or does not apply correctly:
   - **Formulate Hypothesis:** Create `<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`.
   - **Reproduce:** Add a test case to `.agents/scripts/lib-agent-exec/tests/`.
   - **Fix:** Update the execution or cleanup logic in `agent-exec.ts` to properly respect this property.

### Phase 3: Cleanup & Commit
1. Delete any scratch artifacts.
2. Commit your fix using `commit.ts`.
