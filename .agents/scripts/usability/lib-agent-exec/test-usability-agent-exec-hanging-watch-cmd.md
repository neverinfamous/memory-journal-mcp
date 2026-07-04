# Usability Test: Agent-Exec Hanging (Watch Command)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must explicitly document your hypotheses before modifying code. You must write an isolated unit test reproducing any failure *before* you apply a fix.

## Objective
Verify that `lib-agent-exec` rigorously detects and aborts the `watch` command which would otherwise hang the agent indefinitely.

## Instructions

### Phase 1: Adversarial Execution
1. **Indefinite Commands:** Attempt to run `watch ls`, `watch df -h`, `tail -f filename`, or `docker logs -f container_name`. Verify the execution is safely blocked and an `AGENT HINT` is provided indicating that continuous processes are not allowed.

### Phase 2: Meta-Cognitive Debugging
If the command successfully hangs the agent or creates a zombie process:
1. **Formulate Hypothesis:** Create a file `<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`.
2. **Reproduce:** Add a failing test case to `.agents/scripts/lib-agent-exec/tests/repl-tui-interceptor.test.ts`.
3. **Fix & Verify:** Modify the interceptor logic. You MUST use `ts-pattern`. Run `bun run typecheck` and `bun run lint`.

### Phase 3: Cleanup & Commit
1. Delete any scratch files you created.
2. Run `pnpm run check` to validate.
3. Commit the changes using `commit.ts`.
