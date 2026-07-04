# Usability Test: Agent-Exec Payload Schema Bounds - cwd (string validation)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must explicitly document your hypotheses before modifying code. You must write an isolated unit test reproducing any failure *before* you apply a fix.

## Objective
Verify that `lib-agent-exec` correctly parses and respects the `cwd (string validation)` option.

## Instructions

### Phase 1: Boundary Validation
1. **Cwd Validation:** Pass an invalid or unsafe string to `cwd` (e.g. object, number) and verify it is rejected via Zod validation errors.

### Phase 2: Meta-Cognitive Debugging
1. If limit enforcement fails (e.g., process crashes instead of rejecting payload cleanly):
   - **Formulate Hypothesis:** Create `<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`.
   - **Reproduce:** Add a test case to the test suite in `.agents/scripts/lib-agent-exec/tests`.
   - **Fix:** Update `schema.ts` to enforce the limits via Zod.
2. **Regression Check:** Run `bun run typecheck` and `bun run lint`.

### Phase 3: Cleanup & Commit
1. Delete any scratch artifacts.
2. Commit your fix using `commit.ts`.
