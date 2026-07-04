# Usability Test: Agent-Exec Auto-Healing Hints

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must explicitly document your hypotheses before modifying code. You must write an isolated unit test reproducing any failure *before* you apply a fix.

## Objective
Verify that `lib-agent-exec` outputs "Auto-Healing" hints when it gracefully catches common misuses (e.g. `rg` without files).

## Instructions

### Phase 1: Auto-Healing Output Validation
1. **Trigger Hint:** Run a command that is known to hang when used incorrectly, but which is caught by interceptors (for example, `grep` or `rg` with no file arguments and no piped input). 
2. **Verify Output:** Verify that the proxy gracefully exits and includes a specific "Auto-Healing" or "AGENT HINT" message in the stderr or stdout, instructing the agent to fix the command parameters autonomously rather than asking the user for help.

### Phase 2: Meta-Cognitive Debugging
1. If the proxy hangs instead of producing a hint, or lacks the healing language:
   - **Formulate Hypothesis:** Create `<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`.
   - **Reproduce:** Add a test case to the test suite in `.agents/scripts/lib-agent-exec/tests`.
   - **Fix:** Update `agent-exec.ts` to correctly identify the condition and print the hint.
2. **Regression Check:** Run `bun run typecheck` and `bun run lint`.

### Phase 3: Cleanup & Commit
1. Delete any scratch artifacts.
2. Commit your fix using `commit.ts`.
