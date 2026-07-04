# Usability Test: Agent-Exec Pipes (WSL2 Fallback)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must explicitly document your hypotheses before modifying code. You must write an isolated unit test reproducing any failure *before* you apply a fix.

## Objective
Verify that `lib-agent-exec` correctly allows and routes execution of complex pipelines when explicitly routed through `agent-exec.ts` using the `"target": "wsl2"` payload instead of attempting to run them natively in PowerShell.

## Instructions

### Phase 1: Adversarial Execution
1. **WSL2 Payload Targeting:** Create a command payload JSON file (MUST be saved to `<appDataDir>\\brain\\<conversation-id>\\scratch\\payload.json`) targeting `wsl2` using the `eval` type (since `command` type does not support spaces or shell operators):
   `{"type": "eval", "code": "echo 'start' && echo 'end'", "interpreter": "bash", "target": "wsl2", "cwd": "."}`
2. **Execute and Verify:** Execute via `bun agent-exec.ts <payload.json>`. Verify the pipeline operator (`&&`) executes successfully on the WSL2 target backend without being blocked by the system interceptor.
3. **Complex Edge Cases (WSL2):** Try wrapping operators in subshells (`$(echo start && echo end)`) using the WSL2 payload. Ensure successful execution on the Linux backend.

### Phase 2: Meta-Cognitive Debugging
If the pipeline is improperly blocked even when `"target": "wsl2"` is specified:
1. **Formulate Hypothesis:** Create `<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`.
2. **Reproduce:** Add a failing test case to `.agents/scripts/lib-agent-exec/tests/`.
> **CRITICAL**: Read `C:\Users\chris\Desktop\adamic\skills\pattern-matching\SKILL.md`, `C:\Users\chris\Desktop\adamic\skills\wsl\SKILL.md`, and `C:\Users\chris\Desktop\adamic\skills\typescript\SKILL.md` before proceeding.

3. **Fix & Verify:** Modify the routing logic. Ensure `target` property bypasses native PS operator blocks. **You MUST use `ts-pattern`** for state branching. Run `bun run typecheck` and `bun run lint`.

### Phase 3: Cleanup & Commit
1. Delete any scratch files you created (including `.json` payloads).
2. Run `pnpm run check` to validate.
3. Commit the changes using `commit.ts`.
