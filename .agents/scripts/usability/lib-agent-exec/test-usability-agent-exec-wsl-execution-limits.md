# Usability Test: Agent-Exec WSL2 Integration (Execution Limits)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must explicitly document your hypotheses before modifying code. You must write an isolated unit test reproducing any failure *before* you apply a fix.

## Objective
Verify that `lib-agent-exec` respects stream truncation limits and `stdoutFile` capabilities specifically when crossing the WSL2 boundary, ensuring that the inter-process communication bridge does not fail under heavy loads.

## Instructions

### Phase 1: Truncation Limits in WSL
1. **Default Cap (WSL):** Flood stdout/stderr concurrently from within a WSL process to exceed limits. Construct a JSON payload with `"type": "command"`, `"target": "wsl2"`, `"maxBuffer": 1024`, and `"truncateOutputLength": 512`. Execute via `bun .agents/scripts/agent-exec.ts <path>` and verify that the output is gracefully truncated at the custom limits without crashing the WSL bridge.
2. **File Redirect (WSL):** Test the `stdoutFile` and `stderrFile` payload capabilities for WSL2 executions. Verify it successfully routes up to 1GB of output to disk without breaking memory constraints or locking the WSL proxy process.

### Phase 2: Meta-Cognitive Debugging
If truncation or redirection fails across the WSL boundary:
1. **Formulate Hypothesis:** Create `<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`.
2. **Reproduce:** Add a failing test case in `.agents/scripts/lib-agent-exec/tests/`, and run `bun run typecheck` and `bun run lint`.
3. **Fix & Verify:** Implement the fix, paying close attention to buffer streams in the `wsl bash -c` invocation wrapper. Run `bun run typecheck` and `bun run lint`.

### Phase 3: Cleanup & Commit
1. Delete any scratch files.
2. Commit your fix using `bun .\.agents\scripts\commit.ts --msg "test(lib-agent-exec): update" --category Changed --impact 0.5 --confidence 1.0 --validation passed --journal --add .agents/scripts/lib-agent-exec/`.