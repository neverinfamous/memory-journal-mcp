# Usability Test: Agent-Exec Stream Multiplexing (Formatting & Flushing)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must explicitly document your hypotheses before modifying code. You must write an isolated unit test reproducing any failure *before* you apply a fix.

## Objective
Verify that `lib-agent-exec` correctly handles ANSI/CRLF stripping and flushes streams in real-time.

## Instructions

### Phase 1: Output Formatting & Flushing
1. **ANSI Stripping:** Generate output with heavy ANSI color codes. Construct a JSON payload with `"type": "command"`, `"command": "<your-command>"`, and `"target": "windows"`. Execute `bun .agents/scripts/agent-exec.ts <path>` and verify it correctly strips ANSI codes.

### Phase 2: Meta-Cognitive Debugging
1. **Formulate Hypothesis:** If output is garbled or delayed, create `<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`.
2. **Reproduce:** Add a test case in `.agents/scripts/lib-agent-exec/tests/`, and run `bun run typecheck` and `bun run lint`.
> **CRITICAL**: Read `C:\Users\chris\Desktop\adamic\skills\typescript\SKILL.md` before proceeding.

3. **Fix & Verify:** Implement the fix.

### Phase 3: Cleanup & Commit
1. Delete any scratch files.
2. Commit your fix using `bun .\.agents\scripts\commit.ts --msg "test(lib-agent-exec): update" --category Changed --impact 0.5 --confidence 1.0 --validation passed --journal --add .agents/scripts/lib-agent-exec/`.