# Usability Test: Agent-Exec Stream Multiplexing (Truncation Limits)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must explicitly document your hypotheses before modifying code. You must write an isolated unit test reproducing any failure *before* you apply a fix.

## Objective
Verify that `lib-agent-exec` respects stream truncation limits and `stdoutFile` capabilities.

## Instructions

### Phase 1: Truncation Limits
1. **Default Cap:** Flood stdout/stderr concurrently to exceed limits. Construct a JSON payload with `"type": "command"`, `"target": "windows"`, `"maxBuffer": 1024`, and `"truncateOutputLength": 512`. Execute via `bun .agents/scripts/agent-exec.ts <path>` and verify that the output is gracefully truncated without crashing when it hits the custom limits.

### Phase 2: Meta-Cognitive Debugging
1. **Formulate Hypothesis:** If truncation fails, create `<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`.
2. **Reproduce:** Add a test case in `.agents/scripts/lib-agent-exec/tests/`, and run `bun run typecheck` and `bun run lint`.
> **CRITICAL**: Read `C:\Users\chris\Desktop\adamic\skills\typescript\SKILL.md` before proceeding.

3. **Fix & Verify:** Implement the fix.

### Phase 3: Cleanup & Commit
1. Delete any scratch files.
2. Commit your fix using `bun .\.agents\scripts\commit.ts --msg "test(lib-agent-exec): update" --category Changed --impact 0.5 --confidence 1.0 --validation passed --journal --add .agents/scripts/lib-agent-exec/`.