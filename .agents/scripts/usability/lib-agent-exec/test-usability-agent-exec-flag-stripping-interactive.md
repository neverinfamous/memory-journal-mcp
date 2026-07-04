# Usability Test: Agent-Exec Flag Stripping (Interactive)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must explicitly document your hypotheses before modifying code. You must write an isolated unit test reproducing any failure *before* you apply a fix.

## Objective
Verify that `lib-agent-exec` rigorously intercepts and strips specific interactive flags (`-t`, `--tty`, `-i`) from native CLI tools to prevent terminal hanging.

## Instructions

### Phase 1: Adversarial Execution
1. **Docker Interactive Flags:** Attempt to run a command like `docker run -it ubuntu bash` or `docker exec -i container_name sh`. Verify the interceptor successfully strips `-i`, `-t`, and `--tty`, allowing the process to execute without hanging on a TTY prompt, OR properly blocks it if it becomes an interactive REPL.

### Phase 2: Meta-Cognitive Debugging
1. **Formulate Hypothesis:** If the command hangs indefinitely waiting for input or logs, create `<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`.
2. **Reproduce:** Add a failing test case to `.agents/scripts/lib-agent-exec/tests/`.
3. **Fix & Verify:** Modify the interceptor logic to strip these specific flags. Run `bun run typecheck` and `bun run lint`.

### Phase 3: Cleanup & Commit
1. Delete any scratch files.
2. Run `pnpm run check` to validate.
3. Commit the changes using `commit.ts`.
