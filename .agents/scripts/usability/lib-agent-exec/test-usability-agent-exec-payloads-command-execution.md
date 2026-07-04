# Usability Test: Agent-Exec Payloads (Command Execution)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must explicitly document your hypotheses before modifying code. You must write an isolated unit test reproducing any failure *before* you apply a fix.

## Objective
Verify that `lib-agent-exec` correctly parses and handles the `.json` payload type `command`, and correctly supports `"expectJsonEnvelope": true` for smart exit codes.

## Instructions

### Phase 1: Adversarial Execution
1. **Command Payload:** Create a JSON payload (MUST be saved to `<appDataDir>\\brain\\<conversation-id>\\scratch\\payload.json`) for `command` (e.g. `{"type": "command", "command": "git", "args": ["status"], "cwd": ".", "expectJsonEnvelope": true}`). Execute via `bun agent-exec.ts <payload.json>`. Verify smart exit code handling (JSON envelope returned instead of standard exit). Ensure `args` are passed as an array, as per the SSoT schema.

### Phase 2: Meta-Cognitive Debugging
1. If payload parsing fails or JSON envelope doesn't return correctly:
   - **Formulate Hypothesis:** Create `<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`.
   - **Reproduce:** Add a test case to the schema or parsing test suite.
   - **Fix:** Update payload schema and execution branching. You MUST use `ts-pattern` for handling different payload types.
2. **Regression Check:** Run `bun run typecheck` and `bun run lint`.

### Phase 3: Cleanup & Commit
1. Delete any scratch artifacts (including JSON payloads).
2. Commit your fix using `commit.ts`.
