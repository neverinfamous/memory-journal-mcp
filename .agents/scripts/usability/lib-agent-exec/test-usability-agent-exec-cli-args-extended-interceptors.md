# Usability Test: Agent-Exec CLI Args - --interceptors

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must explicitly document your hypotheses before modifying code. You must write an isolated unit test reproducing any failure *before* you apply a fix.

## Objective
Verify that `lib-agent-exec` correctly parses and respects the `--interceptors` option.

## Instructions

### Phase 1: CLI Arguments Validation
1. **Interceptors Extension:** Create a dummy interceptor file (`my-interceptor.ts`). Construct a `command` payload. Run `bun agent-exec.ts --interceptors "./my-interceptor.ts" <payload.json>`. Verify that the CLI successfully parses the list and registers the custom interceptor without throwing errors.

### Phase 2: Meta-Cognitive Debugging
1. If the CLI fails to recognize the flags:
   - **Formulate Hypothesis:** Create `<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`.
   - **Reproduce:** Add a test case to the test suite in `.agents/scripts/lib-agent-exec/tests`.
   - **Fix:** Update argument parsing logic in `agent-exec.ts`.
2. **Regression Check:** Run `bun run typecheck` and `bun run lint`.

### Phase 3: Cleanup & Commit
1. Delete any scratch artifacts.
2. Commit your fix using `commit.ts`.
