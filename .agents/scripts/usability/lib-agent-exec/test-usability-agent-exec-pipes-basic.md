# Usability Test: Agent-Exec Pipes (Basic Chaining)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must explicitly document your hypotheses before modifying code. You must write an isolated unit test reproducing any failure *before* you apply a fix.

## Objective
Verify that `lib-agent-exec` rigorously intercepts and handles dangerous pipeline operators (`&&`, `||`, `|`, `>`) when an agent attempts to chain commands improperly natively, while simultaneously avoiding false positives in complex string arguments.

## Instructions

### Phase 1: Adversarial Execution
1. **Basic Chaining Attempt:** Try to run `git status && git log` (or similar proxied tools) using PowerShell natively. Because PS 5.1 doesn't support `&&`, verify that the system interceptor correctly blocks it and instructs the agent to either use semicolons (`;`) for simple commands, or use a WSL2 JSON payload for POSIX pipelines.
2. **PowerShell Rules:** Ensure strict execution safety is enforced. Commands should prefer `;` for command separation natively.

### Phase 2: Meta-Cognitive Debugging
If you encounter a false positive (a safe command gets blocked) or a false negative (a dangerous command is not trapped correctly):
1. **Formulate Hypothesis:** Create `<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`.
2. **Reproduce:** Add a failing test case to `.agents/scripts/lib-agent-exec/tests/system-interceptor.test.ts`.
> **CRITICAL**: Read `C:\Users\chris\Desktop\adamic\skills\pattern-matching\SKILL.md`, `C:\Users\chris\Desktop\adamic\skills\powershell\SKILL.md`, and `C:\Users\chris\Desktop\adamic\skills\typescript\SKILL.md` before proceeding.

3. **Fix & Verify:** Modify `system-interceptor.ts`. **You MUST use `ts-pattern`** for parsing states and branching. Do NOT use complex regex chains or nested `if/else` blocks. Run `bun run typecheck` and `bun run lint`.

### Phase 3: Cleanup & Commit
1. Delete any scratch files you created.
2. Run `pnpm run check` to validate.
3. Commit the changes using `commit.ts`.
