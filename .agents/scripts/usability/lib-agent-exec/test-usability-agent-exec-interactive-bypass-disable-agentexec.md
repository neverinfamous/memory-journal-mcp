# Usability Test: Agent-Exec Interactive Bypass (Disable-AgentExec)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must explicitly document your hypotheses before modifying code. You must write an isolated unit test reproducing any failure *before* you apply a fix.

## Objective
Verify that `lib-agent-exec` allows toggling interception off via the `Disable-AgentExec` PowerShell command.

## Instructions

### Phase 1: Interactive Bypass
1. **Disable-AgentExec Command:** Run `Disable-AgentExec` in the terminal, then run a proxied command (e.g., `git log`). Verify that the command is no longer intercepted.
2. **Re-enable:** Run `Enable-AgentExec` and verify interception is restored.

### Phase 2: Meta-Cognitive Debugging
1. **Formulate Hypothesis:** If the commands do not toggle the proxy state correctly, create `<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`.
2. **Reproduce:** Investigate the proxy toggle implementation.
3. **Fix & Verify:** Modify the toggle logic in the PowerShell profile or proxy generator. Re-run tests if applicable.

### Phase 3: Cleanup & Commit
1. Delete any scratch files.
2. Run `pnpm run check` to validate.
3. Commit the changes using `commit.ts`.
