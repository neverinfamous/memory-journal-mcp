# Usability Test: Agent-Exec CLI Args - --help

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must explicitly document your hypotheses before modifying code. You must write an isolated unit test reproducing any failure *before* you apply a fix.

## Objective
Verify that `lib-agent-exec` correctly parses and respects the `--help` option.

## Instructions

### Phase 1: CLI Arguments Validation
1. **Help Flag:** Run `bun agent-exec.ts --help` and `bun agent-exec.ts -h`. Verify both output usage information and exit gracefully.

### Phase 2: Meta-Cognitive Debugging
1. If the CLI fails to recognize the flags:
   - **Formulate Hypothesis:** Create `<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`.
   - **Reproduce:** Add a test case to the test suite in `.agents/scripts/lib-agent-exec/tests`.
   - **Fix:** Update argument parsing logic in `agent-exec.ts`.
2. **Regression Check:** Run `bun run typecheck` and `bun run lint`.

### Phase 3: Cleanup & Commit
1. Delete any scratch artifacts.
2. Commit your fix using `commit.ts`.
