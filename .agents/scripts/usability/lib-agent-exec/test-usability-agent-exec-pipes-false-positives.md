# Usability Test: Agent-Exec Pipes (False Positives)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must explicitly document your hypotheses before modifying code. You must write an isolated unit test reproducing any failure *before* you apply a fix.

## Objective
Verify that `lib-agent-exec` avoids false positives in complex string arguments when parsing pipeline operators natively.

## Instructions

### Phase 1: Adversarial Execution
1. **False Positives (String Arguments):** Run a command containing operators safely inside a string to ensure the interceptor is smart and does not block it.
   - Example 1: `git commit -m "This string has && and | and > inside it"`
   - Example 2 (JSON): `echo '{"query": "[.[] | select(.id == 1)]"}'`
2. **PowerShell Rules:** Ensure strict execution safety is enforced. Commands should use single quotes (`'string'`) for literal strings.

### Phase 2: Meta-Cognitive Debugging
If you encounter a false positive (a safe command gets blocked):
1. **Formulate Hypothesis:** Create `<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`.
2. **Reproduce:** Add a failing test case to `.agents/scripts/lib-agent-exec/tests/system-interceptor.test.ts`.
> **CRITICAL**: Read `C:\Users\chris\Desktop\adamic\skills\pattern-matching\SKILL.md`, `C:\Users\chris\Desktop\adamic\skills\powershell\SKILL.md`, and `C:\Users\chris\Desktop\adamic\skills\typescript\SKILL.md` before proceeding.

3. **Fix & Verify:** Modify `system-interceptor.ts`. **You MUST use `ts-pattern`** for parsing states and branching. Do NOT use complex regex chains or nested `if/else` blocks. Run `bun run typecheck` and `bun run lint`.

### Phase 3: Cleanup & Commit
1. Delete any scratch files you created.
2. Run `pnpm run check` to validate.
3. Commit the changes using `commit.ts`.
