# Usability Test: Agent-Exec WSL2 Integration (Paths - Arguments)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must explicitly document your hypotheses before modifying code. You must write an isolated unit test reproducing any failure *before* you apply a fix.

## Objective
Verify that `lib-agent-exec` correctly translates Windows paths to WSL paths for command arguments when targeting `wsl2`.

## Instructions

### Phase 1: Path Translation
1. **Path Mapping (Arguments):** Construct a JSON payload with `"type": "command"`, `"target": "wsl2"`, `"command"`, and `"args"`. Execute via `bun .agents/scripts/agent-exec.ts <path>`. Pass Windows file paths as arguments to a command (e.g., `cat` with `args: ["C:\\path\\to\\file.txt"]`). Verify that argument translation is successful and the file is properly mapped and read in WSL2.

### Phase 2: Meta-Cognitive Debugging
If path translation fails:
1. **Formulate Hypothesis:** Create `<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt` explaining the failure.
2. **Reproduce:** Add a failing test case to `.agents/scripts/lib-agent-exec/tests/`.
3. **Fix & Verify:** Implement the fix, explicitly leveraging path utilities. Run `bun run typecheck` and `bun run lint`.

### Phase 3: Cleanup & Commit
1. Delete any scratch files.
2. Commit your fix using `bun .\.agents\scripts\commit.ts --msg "test(lib-agent-exec): update" --category Changed --impact 0.5 --confidence 1.0 --validation passed --journal --add .agents/scripts/lib-agent-exec/`.