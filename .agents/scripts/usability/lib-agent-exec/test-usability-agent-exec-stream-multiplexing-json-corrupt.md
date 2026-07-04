# Usability Test: Agent-Exec Stream Multiplexing (JSON Corrupt)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must explicitly document your hypotheses before modifying code. You must write an isolated unit test reproducing any failure *before* you apply a fix.

## Objective
Verify that `lib-agent-exec` correctly extracts the JSON envelope even if trailing spaces exist, preventing `\\s` bug in regex.

## Instructions

1. **Reproduce:** Add a test case using `bun test` in `.agents/scripts/lib-agent-exec/tests/stream-multiplexing-json-corrupt.test.ts`.
2. **Fix & Verify:** Implement the fix in `io-controller.ts`.
3. **Commit:** Commit your fix.
