# Usability Test: Agent-Exec Payload Validation (Envelopes)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must explicitly document your hypotheses before modifying code. You must write an isolated unit test reproducing any failure *before* you apply a fix.

## Objective
Verify that `lib-agent-exec` correctly handles the `expectJsonEnvelope` configuration in payload options to parse smart exit codes and metadata.

## Instructions

### Phase 1: Envelope Check
1. **Valid Envelope:** Test a payload with `"expectJsonEnvelope": true`. Have the target script/command output a final JSON line like `{"status": "success", "data": {}, "exit_code": 0}`. Verify the agent-exec intercepts this, overrides the native process exit code based on the envelope status, and does not leak the envelope itself into the standard output stream.
2. **Malformed Envelope:** Test the behavior when `"expectJsonEnvelope": true` but the final line is not valid JSON. Ensure graceful degradation or error reporting.

### Phase 2: Meta-Cognitive Debugging
1. **Formulate Hypothesis:** Create `<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt` if parsing fails.
2. **Reproduce:** Add a test case in `.agents/scripts/lib-agent-exec/tests/`, and run `bun run typecheck` and `bun run lint`.
3. **Fix & Verify:** Implement the fix.

### Phase 3: Cleanup & Commit
1. Delete any scratch files.
2. Commit your fix using `.agents/scripts/commit.ts`.
