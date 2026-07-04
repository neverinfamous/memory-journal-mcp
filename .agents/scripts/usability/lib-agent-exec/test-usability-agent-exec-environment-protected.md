# Usability Test: Agent-Exec Environment Immutability (Protected Variables)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must explicitly document your hypotheses before modifying code. You must write an isolated unit test reproducing any failure *before* you apply a fix.

## Objective
Verify that `lib-agent-exec` correctly maintains environment immutability for intercepted commands by protecting critical variables.

## Instructions

### Phase 1: Environment Immutability
1. **Protected Variables:** Attempt to override critical immutable environment variables (e.g., `$env:CI="0"`, `$env:NO_COLOR="0"`, `$env:EDITOR="vim"`, `$env:GIT_ASKPASS="prompt"`) before running an intercepted command (like `git`). Verify that the system forces these variables back to their secure/expected defaults (e.g., `CI=1`, `NO_COLOR=1`, `EDITOR=true`, `PAGER` disabled, `GIT_ASKPASS=agent-exec-blocked`) for the executed process.

### Phase 2: Meta-Cognitive Debugging
If environment locks fail:
1. **Formulate Hypothesis:** Create `<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt` explaining the failure.
2. **Reproduce:** Add a failing test case to `.agents/scripts/lib-agent-exec/tests/`.
3. **Fix & Verify:** Implement the fix in the environment lock logic. Run `bun run typecheck` and `bun run lint`.

### Phase 3: Cleanup & Commit
1. Delete any scratch files.
2. Once passing, commit using `commit.ts`.

> **CRITICAL**: Leverage the skills /pattern-matching, /powershell, /typescript, /wsl, and /zod where relevant to the code and logic.
