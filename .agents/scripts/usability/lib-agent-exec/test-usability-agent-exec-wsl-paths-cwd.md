# Usability Test: Agent-Exec WSL2 Integration (Paths - CWD)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must explicitly document your hypotheses before modifying code. You must write an isolated unit test reproducing any failure *before* you apply a fix.

## Objective
Verify that `lib-agent-exec` correctly translates Windows paths to WSL paths for CWD when targeting `wsl2`.

## Instructions

### Phase 1: Path Translation
1. **Path Mapping (CWD):** Construct a JSON payload with `"type": "command"`, `"target": "wsl2"`, and `"cwd"`. Provide a Windows native path (e.g., `C:\Users\chris\Desktop\adamic`) as the `cwd` in the payload. Execute via `bun .agents/scripts/agent-exec.ts <path>` and verify that `agent-exec` correctly translates this to the equivalent WSL path (e.g., `/mnt/c/Users/chris/Desktop/adamic`) before execution.

### Phase 2: Meta-Cognitive Debugging
If path translation fails:
1. **Formulate Hypothesis:** Create `<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt` explaining the failure.
2. **Reproduce:** Add a failing test case to `.agents/scripts/lib-agent-exec/tests/`.
3. **Fix & Verify:** Implement the fix, explicitly leveraging path utilities. Run `bun run typecheck` and `bun run lint`.

### Phase 3: Cleanup & Commit
1. Delete any scratch files.
2. Commit your fix using `bun .\.agents\scripts\commit.ts --msg "test(lib-agent-exec): update" --category Changed --impact 0.5 --confidence 1.0 --validation passed --journal --add .agents/scripts/lib-agent-exec/`.