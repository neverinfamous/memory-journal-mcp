# Usability Test: Agent-Exec Graceful Exits (Filters - Grep)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must explicitly document your hypotheses before modifying code. You must write an isolated unit test reproducing any failure *before* you apply a fix.

## Objective
Verify that `lib-agent-exec` gracefully handles `exit code 1` for specific CLI filter tools (`grep`, `rg`) instead of treating them as fatal agent errors, while also noting that native `grep` aliases might be trapped as hallucinations.

## Instructions

### Phase 1: Adversarial Execution
1. **Grep/Egrep/Rg Empty Match:** Attempt to execute a `grep`, `egrep`, or `rg` command that returns exit code 1 (e.g., via WSL or wrapped script so it bypasses alias hallucination traps). Verify `agent-exec` handles code 1 as success (0) for graceful filters.
2. **True Errors:** Run a command that legitimately fails (e.g. `ls NON_EXISTENT_DIR`). Verify it still reports as a standard error properly (not gracefully swallowed).

### Phase 2: Meta-Cognitive Debugging
1. If graceful exit codes are treated as fatal faults, or true faults are ignored:
   - **Formulate Hypothesis:** Create `<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`.
   - **Reproduce:** Add a test case to the test suite in `.agents/scripts/lib-agent-exec/tests`.
   - **Fix:** Update the exit code heuristic in `agent-exec.ts` or relevant interceptor.
2. **Regression Check:** Run `bun run typecheck` and `bun run lint`.

### Phase 3: Cleanup & Commit
1. Delete any scratch artifacts (like dummy diff files).
2. Commit your fix using `commit.ts`.
