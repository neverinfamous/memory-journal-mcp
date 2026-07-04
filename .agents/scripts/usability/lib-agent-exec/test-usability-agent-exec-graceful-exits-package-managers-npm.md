# Usability Test: Agent-Exec Graceful Exits (Package Managers - NPM/PNPM)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must explicitly document your hypotheses before modifying code. You must write an isolated unit test reproducing any failure *before* you apply a fix.

## Objective
Verify that `lib-agent-exec` gracefully handles `exit code 1` for `npm outdated` instead of treating it as a fatal agent error.

## Instructions

### Phase 1: Adversarial Execution
1. **NPM Outdated:** Run `npm outdated`. Exit code 1 indicates outdated packages, not a crash. Verify graceful handling.
2. **True Errors:** Run a command that legitimately fails (e.g. `npm install NON_EXISTENT_PACKAGE_NAME`). Verify it still reports as a standard error properly (not gracefully swallowed).

### Phase 2: Meta-Cognitive Debugging
1. If graceful exit codes are treated as fatal faults, or true faults are ignored:
   - **Formulate Hypothesis:** Create `<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`.
   - **Reproduce:** Add a test case to the test suite in `.agents/scripts/lib-agent-exec/tests`.
   - **Fix:** Update the exit code heuristic in `agent-exec.ts` or relevant interceptor.
2. **Regression Check:** Run `bun run typecheck` and `bun run lint`.

### Phase 3: Cleanup & Commit
1. Delete any scratch artifacts.
2. Commit your fix using `commit.ts`.
