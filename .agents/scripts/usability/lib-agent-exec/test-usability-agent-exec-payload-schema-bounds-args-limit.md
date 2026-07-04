# Usability Test: Agent-Exec Payload Schema Bounds - args (max items)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must explicitly document your hypotheses before modifying code. You must write an isolated unit test reproducing any failure *before* you apply a fix.

## Objective
Verify that `lib-agent-exec` correctly parses and respects the `args (max items)` option.

## Instructions

### Phase 1: Boundary Validation
1. **Args Limit:** Construct a `command` payload with an `args` array containing 1001 elements. Verify that execution is rejected via Zod validation errors (max 1000 limit).

### Phase 2: Meta-Cognitive Debugging
1. If limit enforcement fails (e.g., process crashes instead of rejecting payload cleanly):
   - **Formulate Hypothesis:** Create `<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`.
   - **Reproduce:** Add a test case to the test suite in `.agents/scripts/lib-agent-exec/tests`.
   - **Fix:** Update `schema.ts` to enforce the limits via Zod.
2. **Regression Check:** Run `bun run typecheck` and `bun run lint`.

### Phase 3: Cleanup & Commit
1. Delete any scratch artifacts.
2. Commit your fix using `commit.ts`.
