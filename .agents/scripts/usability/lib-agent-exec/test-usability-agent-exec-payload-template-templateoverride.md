# Usability Test: Agent-Exec Payload Template - templateOverride

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must explicitly document your hypotheses before modifying code. You must write an isolated unit test reproducing any failure *before* you apply a fix.

## Objective
Verify that `lib-agent-exec` correctly parses and respects the `templateOverride` option.

## Instructions

### Phase 1: Payload Template Validation
1. **Template Override:** Create a `command` payload with `"templateOverride": "custom-template"`. Verify that execution does not throw a validation error for this string field.

### Phase 2: Meta-Cognitive Debugging
1. If validation or execution fails with these properties:
   - **Formulate Hypothesis:** Create `<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`.
   - **Reproduce:** Add a test case to the test suite in `.agents/scripts/lib-agent-exec/tests`.
   - **Fix:** Update `schema.ts` to enforce the correct limits.
2. **Regression Check:** Run `bun run typecheck` and `bun run lint`.

### Phase 3: Cleanup & Commit
1. Delete any scratch artifacts.
2. Commit your fix using `commit.ts`.
