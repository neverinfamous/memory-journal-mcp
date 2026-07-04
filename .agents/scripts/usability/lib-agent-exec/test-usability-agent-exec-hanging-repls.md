# Usability Test: Agent-Exec Hanging (REPLs)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must explicitly document your hypotheses before modifying code. You must write an isolated unit test reproducing any failure *before* you apply a fix.

## Objective
Verify that `lib-agent-exec` rigorously detects and aborts REPL applications that would hang an agent indefinitely (`python`, `node`, `bash`).

## Instructions

### Phase 1: Adversarial Execution
1. **Raw REPL:** Attempt to run raw `python`, `node`, or `bash` with no arguments. Verify the agent blocks execution immediately with an `AGENT HINT` (or `AUTONOMOUS HEALING:`).

### Phase 2: Meta-Cognitive Debugging
If a command successfully hangs the agent or creates a zombie process:
1. **Formulate Hypothesis:** Create a file `<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt` explaining *why* the logic in `repl-tui-interceptor.ts` failed.
2. **Reproduce:** Add a failing test case to `.agents/scripts/lib-agent-exec/tests/repl-tui-interceptor.test.ts`.
> **CRITICAL**: Before proceeding, read `C:\Users\chris\Desktop\adamic\skills\pattern-matching\SKILL.md`.

3. **Fix & Verify:** Modify the interceptor logic. You MUST use `ts-pattern`. Run `bun run typecheck` and `bun run lint`.

### Phase 3: Regression Verification
> [!WARNING]
> Ensure valid long-running non-interactive commands are not incorrectly flagged!
1. After fixing any logic, verify that a valid non-interactive command (e.g. `node script.js`) is NOT blocked.

### Phase 4: Cleanup & Commit
1. Delete any scratch files you created.
2. Run `pnpm run check` to validate.
3. Commit the changes using `commit.ts`.
