# Usability Test: Agent-Exec Hanging (TUIs)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must explicitly document your hypotheses before modifying code. You must write an isolated unit test reproducing any failure *before* you apply a fix.

## Objective
Verify that `lib-agent-exec` rigorously detects and aborts TUI editors that would hang an agent indefinitely (`vim`, `nano`, `less`).

## Instructions

### Phase 1: Adversarial Execution
1. **Raw TUI:** Attempt to run `vim`, `nano`, or `less`. Verify the agent blocks execution immediately with an `AGENT HINT` (or `AUTONOMOUS HEALING:`).

### Phase 2: Meta-Cognitive Debugging
If a command successfully hangs the agent or creates a zombie process:
1. **Formulate Hypothesis:** Create a file `<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`.
2. **Reproduce:** Add a failing test case to `.agents/scripts/lib-agent-exec/tests/`.
> **CRITICAL**: Before proceeding, read `C:\Users\chris\Desktop\adamic\skills\pattern-matching\SKILL.md`.

3. **Fix & Verify:** Modify the interceptor logic. You MUST use `ts-pattern`. Run `bun run typecheck` and `bun run lint`.

### Phase 3: Cleanup & Commit
1. Delete any scratch files you created.
2. Run `pnpm run check` to validate.
3. Commit the changes using `commit.ts`.
