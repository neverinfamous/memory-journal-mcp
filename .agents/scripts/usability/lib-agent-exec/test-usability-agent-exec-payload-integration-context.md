# Usability Test: Agent-Exec Payload Integration Context

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must explicitly document your hypotheses before modifying code. You must write an isolated unit test reproducing any failure *before* you apply a fix.

## Objective
Verify that `lib-agent-exec` correctly supports template string substitution (e.g., `{{integrationContext.var}}`) using the `integrationContext` object in `args`, `env`, and `templateOverride` fields.

## Instructions

### Phase 1: Integration Context Validation
1. **Pass Context:** Construct a `command` payload that provides an `integrationContext` object (e.g. `{"var": "my-value"}`).
2. **Template Substitution:** Use `{{integrationContext.var}}` in the command's `args`, an `env` variable, and `templateOverride`. 
3. **Verify Execution:** Execute the payload and verify that the placeholder was properly substituted with `"my-value"` in the arguments and environment when the command runs.

### Phase 2: Meta-Cognitive Debugging
1. If the integration context is dropped or causes a schema validation error:
   - **Formulate Hypothesis:** Create `<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`.
   - **Reproduce:** Add a test case to the test suite in `.agents/scripts/lib-agent-exec/tests`.
   - **Fix:** Update `schema.ts` and `agent-exec.ts` to correctly type and pass the `integrationContext`.
2. **Regression Check:** Run `bun run typecheck` and `bun run lint`.

### Phase 3: Cleanup & Commit
1. Delete any scratch artifacts.
2. Commit your fix using `commit.ts`.
