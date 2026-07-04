# Usability Test: Agent-Exec WSL2 Integration (Core - Evaluation)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must explicitly document your hypotheses before modifying code. You must write an isolated unit test reproducing any failure *before* you apply a fix.

## Objective
Verify that `lib-agent-exec` correctly maps and executes basic commands within the Windows Subsystem for Linux (WSL2) when explicitly requested via the payload target.

## Instructions

### Phase 1: WSL2 Execution
1. **Target Evaluation:** Create a JSON payload (MUST be saved to `<appDataDir>\\brain\\<conversation-id>\\scratch\\payload.json`) with `"type": "eval"`, `"target": "wsl2"`, `"code"`, and optionally `"interpreter"`. Execute via `bun .agents/scripts/agent-exec.ts <path>`. Attempt to execute a basic Linux shell command (e.g., `uname -a`). Verify that the output confirms execution inside WSL2.

### Phase 2: Meta-Cognitive Debugging
1. **Formulate Hypothesis:** Create `<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt` explaining any failures.
2. **Reproduce:** Add a failing test case to `.agents/scripts/lib-agent-exec/tests/`.
3. **Fix & Verify:** Implement the fix. Run `bun run typecheck` and `bun run lint`.

### Phase 3: Cleanup & Commit
1. Delete any scratch files.
2. Commit your fix using `bun .\.agents\scripts\commit.ts --msg "test(lib-agent-exec): update" --category Changed --impact 0.5 --confidence 1.0 --validation passed --journal --add .agents/scripts/lib-agent-exec/`.