# Usability Test: Agent-Exec Interactive Bypass (native command)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must explicitly document your hypotheses before modifying code. You must write an isolated unit test reproducing any failure *before* you apply a fix.

## Objective
Verify that `lib-agent-exec` allows interactive bypass using the `native` prefix command.

## Instructions

### Phase 1: Interactive Bypass
1. **Native Command Prefix:** Attempt to run an interactive command by prefixing it with `native` (e.g., `native git log`). Verify that the shell allows the command to run natively bypassing the agent-exec wrapper.

### Phase 2: Meta-Cognitive Debugging
1. **Formulate Hypothesis:** If the command is still intercepted or `native` fails, create `<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`.
2. **Reproduce:** Add a failing test case or check the PowerShell profile setup.
3. **Fix & Verify:** Modify the `native` proxy logic in the PowerShell profile or proxy generator. Re-run tests if applicable.

### Phase 3: Cleanup & Commit
1. Delete any scratch files.
2. Run `pnpm run check` to validate.
3. Commit the changes using `commit.ts`.
