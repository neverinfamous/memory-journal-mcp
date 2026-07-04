# Usability Test: Agent-Exec Cloud CLI Interceptor

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must explicitly document your hypotheses before modifying code. You must write an isolated unit test reproducing any failure *before* you apply a fix.

## Objective
Verify that `lib-agent-exec` correctly intercepts bad `gh` (GitHub CLI) flows via the `cloud-cli-interceptor`.

## Instructions

### Phase 1: Adversarial Execution
1. **Bad GH Flows:** Attempt to run an interactive `gh` command (e.g., `gh auth login`, `gh pr create` without flags).
2. **Interception Check:** Verify the `cloud-cli-interceptor` traps the command and instructs the agent to use `--agent-bypass` or provide proper non-interactive flags/arguments, or forces `--json` where applicable.

### Phase 2: Meta-Cognitive Debugging
If the forbidden `gh` command evades the interceptor or hangs:
1. **Formulate Hypothesis:** Create a file `<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt` explaining *why* the logic in `cloud-cli-interceptor.ts` failed.
2. **Reproduce:** Add a failing test case to `.agents/scripts/lib-agent-exec/tests/cloud-cli-interceptor.test.ts`.
> **CRITICAL**: Before proceeding, read `C:\Users\chris\Desktop\adamic\skills\pattern-matching\SKILL.md`.

3. **Fix & Verify:** Modify the interceptor logic. You MUST use `ts-pattern`. Run `bun run typecheck` and `bun run lint`.

### Phase 3: Cleanup & Commit
1. Delete any scratch files you created.
2. Run `pnpm run check` to validate.
3. Commit the changes using `commit.ts`.
