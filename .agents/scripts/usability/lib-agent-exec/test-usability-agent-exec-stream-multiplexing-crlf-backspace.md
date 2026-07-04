# Usability Test: Agent-Exec Stream Multiplexing (CRLF & Backspace Resolution)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must explicitly document your hypotheses before modifying code. You must write an isolated unit test reproducing any failure *before* you apply a fix.

## Objective
Verify that `lib-agent-exec` correctly handles backspace and carriage return linear resolution.

## Instructions

### Phase 1: Output Formatting
1. **Backspace & Carriage Returns:** Generate output with backspaces (`\b`) and carriage returns (`\r`) intended to overwrite lines using `"target": "windows"`. Verify the final output resolution accurately reflects the terminal state via linear resolution.

### Phase 2: Meta-Cognitive Debugging
1. **Formulate Hypothesis:** If output is garbled or delayed, create `<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`.
2. **Reproduce:** Add a test case in `.agents/scripts/lib-agent-exec/tests/`, and run `bun run typecheck` and `bun run lint`.
> **CRITICAL**: Read `C:\Users\chris\Desktop\adamic\skills\typescript\SKILL.md` before proceeding.
3. **Fix & Verify:** Implement the fix.

### Phase 3: Cleanup & Commit
1. Delete any scratch files.
2. Commit your fix using `bun .\.agents\scripts\commit.ts --msg "test(lib-agent-exec): update" --category Changed --impact 0.5 --confidence 1.0 --validation passed --journal --add .agents/scripts/lib-agent-exec/`.
