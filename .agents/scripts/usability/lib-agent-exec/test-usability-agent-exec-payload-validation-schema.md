# Usability Test: Agent-Exec Payload Validation (Schema & Types)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must explicitly document your hypotheses before modifying code. You must write an isolated unit test reproducing any failure *before* you apply a fix.

## Objective
Verify that `lib-agent-exec` correctly validates `.json` payloads for `command`, `script`, and `eval` schemas, enforcing correct types and required fields.

## Instructions

### Phase 1: Schema Validation
1. **Malformed Payloads:** Pass string arguments when an array is required, or omit required fields (like `command` for a `command` payload). Verify the runtime gracefully rejects the payload with a descriptive error.
2. **Schema Types:** Test successful parsing of `command`, `script`, and `eval` payload schemas.
3. **Invalid Fields:** Include unsupported arbitrary keys in the JSON payload and ensure strict Zod schemas either strip them or reject them properly.

### Phase 2: Meta-Cognitive Debugging
1. **Formulate Hypothesis:** If malformed payloads crash the proxy, create `<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`.
2. **Reproduce:** Add a test case in `.agents/scripts/lib-agent-exec/tests/`, and run `bun run typecheck` and `bun run lint`.
3. **Fix & Verify:** Implement the fix utilizing `zod` for strict schema validation.

### Phase 3: Cleanup & Commit
1. Delete any scratch files.
2. Commit your fix using `.agents/scripts/commit.ts`.
