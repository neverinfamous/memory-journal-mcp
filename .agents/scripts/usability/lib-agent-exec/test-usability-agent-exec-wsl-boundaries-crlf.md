# Usability Test: Agent-Exec WSL2 Integration (Boundaries - CRLF)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must explicitly document your hypotheses before modifying code. You must write an isolated unit test reproducing any failure *before* you apply a fix.

## Objective
Verify that `lib-agent-exec` maintains strict boundary fidelity regarding CRLF line endings when crossing into WSL2.

## Instructions

### Phase 1: Boundary Fidelity
1. **CRLF Handling:** Construct a JSON payload with `"type": "command"` and `"target": "wsl2"`. Execute via `bun .agents/scripts/agent-exec.ts <path>`. Ensure that commands relying on specific line endings (like `grep` or `diff`) function predictably when interacting with Windows-native files mounted in WSL, specifically testing Windows `\r\n` line endings.

### Phase 2: Meta-Cognitive Debugging
If CRLF fails:
1. **Formulate Hypothesis:** Create `<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt` explaining the failure.
2. **Reproduce:** Add a failing test case to `.agents/scripts/lib-agent-exec/tests/`.
3. **Fix & Verify:** Implement the fix. Run `bun run typecheck` and `bun run lint`.

### Phase 3: Cleanup & Commit
1. Delete any scratch files.
2. Commit your fix using `bun .\.agents\scripts\commit.ts --msg "test(lib-agent-exec): update" --category Changed --impact 0.5 --confidence 1.0 --validation passed --journal --add .agents/scripts/lib-agent-exec/`.