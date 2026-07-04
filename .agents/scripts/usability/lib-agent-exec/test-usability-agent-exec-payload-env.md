# Usability Test: Agent-Exec Payload (env property)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must explicitly document your hypotheses before modifying code. You must write an isolated unit test reproducing any failure *before* you apply a fix.

## Objective
Verify that `lib-agent-exec` correctly validates and injects the `env` property into the standard execution environment for command payloads (non-WSL2).

## Instructions

### Phase 1: Environment Injection
1. **Env Property:** Construct a JSON payload for a command (e.g., `"command": "pwsh", "args": ["-c", "echo $env:MY_CUSTOM_VAR"]`) and include `"env": {"MY_CUSTOM_VAR": "helloworld"}`. Execute it and verify that the variable is correctly read by the target command.
2. **Schema Validation:** Ensure the `env` property accepts a dictionary of string key-value pairs according to the Zod schema. Test with invalid values (e.g., nested objects) to verify proper rejection.

### Phase 2: Meta-Cognitive Debugging
1. If the environment variable isn't injected or validation fails improperly:
   - **Formulate Hypothesis:** Create `<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`.
   - **Reproduce:** Add a failing test case to `.agents/scripts/lib-agent-exec/tests/`.
   - **Fix & Verify:** Implement the fix in payload evaluation logic or schema. Run `bun run typecheck` and `bun run lint`.

### Phase 3: Cleanup & Commit
1. Delete any scratch files.
2. Commit your fix using `commit.ts`.
