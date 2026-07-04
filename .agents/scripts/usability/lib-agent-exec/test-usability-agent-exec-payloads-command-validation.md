# Usability Test: Agent-Exec Payloads (Command Validation)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must explicitly document your hypotheses before modifying code. You must write an isolated unit test reproducing any failure *before* you apply a fix.

## Objective
Verify that `lib-agent-exec` correctly validates `.json` payload type `command` limits and errors out on invalid formats.

## Instructions

### Phase 1: Adversarial Execution
1. **Empty Validation:** Construct a payload where the `command` field is empty (`"command": ""`). Verify that Zod validation rejects it, enforcing the `min(1)` constraint.
2. **Malformed Payloads:** Send invalid JSON or missing fields. Ensure graceful rejection.

### Phase 2: Meta-Cognitive Debugging
1. If validation passes when it should fail:
   - **Formulate Hypothesis:** Create `<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`.
   - **Reproduce:** Add a test case to the schema or parsing test suite.
   - **Fix:** Update payload schema and execution branching. You MUST use `ts-pattern` for handling different payload types.
2. **Regression Check:** Run `bun run typecheck` and `bun run lint`.

### Phase 3: Cleanup & Commit
1. Delete any scratch artifacts (including JSON payloads).
2. Commit your fix using `commit.ts`.
