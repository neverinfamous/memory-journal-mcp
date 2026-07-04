# Usability Test: Agent-Exec Payload Webhook - onSuccess

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must explicitly document your hypotheses before modifying code. You must write an isolated unit test reproducing any failure *before* you apply a fix.

## Objective
Verify that `lib-agent-exec` correctly parses and respects the `onSuccess` option.

## Instructions

### Phase 1: Webhook Validation
1. **Webhook OnSuccess:** Create a `command` payload that includes `onSuccess` URLs. Verify that upon completion, the proxy attempts to parse and use these fields without throwing validation errors.

### Phase 2: Meta-Cognitive Debugging
1. If validation or execution fails with these properties:
   - **Formulate Hypothesis:** Create `<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`.
   - **Reproduce:** Add a test case to the test suite in `.agents/scripts/lib-agent-exec/tests`.
   - **Fix:** Update `agent-exec.ts` to correctly handle the schema bounds for these properties.
2. **Regression Check:** Run `bun run typecheck` and `bun run lint`.

### Phase 3: Cleanup & Commit
1. Delete any scratch artifacts.
2. Commit your fix using `commit.ts`.

