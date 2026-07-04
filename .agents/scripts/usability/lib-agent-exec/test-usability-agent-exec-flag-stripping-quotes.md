# Usability Test: Agent-Exec Flag Stripping (Quotes)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must explicitly document your hypotheses before modifying code. You must write an isolated unit test reproducing any failure *before* you apply a fix.

## Objective
Verify that `lib-agent-exec` rigorously intercepts and strips spurious quotes around the executable name to prevent "command not found" errors.

## Instructions

### Phase 1: Adversarial Execution
1. **Spurious Quotes:** Attempt to run a command with spurious quotes around the executable name (e.g. `"npm" install` or `'git' status`). Verify the interceptor strips the quotes before attempting to execute it, preventing "command not found" errors.

### Phase 2: Meta-Cognitive Debugging
1. **Formulate Hypothesis:** If the command fails with a "command not found" error, create `<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`.
2. **Reproduce:** Add a failing test case to `.agents/scripts/lib-agent-exec/tests/`.
3. **Fix & Verify:** Modify the interceptor logic to strip these specific quotes. Run `bun run typecheck` and `bun run lint`.

### Phase 3: Cleanup & Commit
1. Delete any scratch files.
2. Run `pnpm run check` to validate.
3. Commit the changes using `commit.ts`.
