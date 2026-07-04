# Usability Test: Agent-Exec Interactive Bypass (--agent-bypass)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must explicitly document your hypotheses before modifying code. You must write an isolated unit test reproducing any failure *before* you apply a fix.

## Objective
Verify that `lib-agent-exec` allows interactive bypass using the `--agent-bypass` flag.

## Instructions

### Phase 1: Interactive Bypass
1. **Agent Bypass Flag:** Attempt to run an interactive command (e.g., `git log --agent-bypass`). Verify that the proxy interceptor detects the flag and allows the command to run natively bypassing the agent-exec wrapper.

### Phase 2: Meta-Cognitive Debugging
1. **Formulate Hypothesis:** If the flag is ignored and the command is still intercepted, create `<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`.
2. **Reproduce:** Add a failing test case to the PowerShell proxy generator tests.
3. **Fix & Verify:** Modify the proxy function generation to respect `--agent-bypass`. Run `bun run typecheck` and `bun run lint`.

### Phase 3: Cleanup & Commit
1. Delete any scratch files.
2. Run `pnpm run check` to validate.
3. Commit the changes using `commit.ts`.
