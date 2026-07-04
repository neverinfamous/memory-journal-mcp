# Usability Test: Agent-Exec PowerShell Enforcement

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must explicitly document your hypotheses before modifying code. You must write an isolated unit test reproducing any failure *before* you apply a fix.

## Objective
Verify that `lib-agent-exec` correctly enforces `-NonInteractive` and `-NoProfile` flags on `pwsh` invocations to prevent hanging or side effects from user profiles.

## Instructions

### Phase 1: PowerShell Enforcement
1. **Profile Bypass:** Attempt to run `pwsh` (or `powershell`) passing a script block that would normally load a profile or run interactively. 
2. **Flag Injection:** Verify that the proxy interceptor automatically injects `-NonInteractive` and `-NoProfile` flags into the execution payload to enforce stateless, non-interactive execution.

### Phase 2: Meta-Cognitive Debugging
1. **Formulate Hypothesis:** If the agent fails to inject the flags and the process loads a profile or hangs, create `<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`.
2. **Reproduce:** Add a test case to the test suite in `.agents/scripts/lib-agent-exec/tests`.
3. **Fix:** Update the interceptor logic for `pwsh` in `system-interceptor.ts`.

### Phase 3: Regression Check & Commit
1. **Regression Check:** Run `bun run typecheck` and `bun run lint`. Ensure valid `pwsh` commands execute successfully with the injected flags.
2. **Cleanup:** Delete any scratch artifacts.
3. **Commit:** Commit your fix using `commit.ts`.


> **CRITICAL**: Leverage the skills /pattern-matching, /powershell, /typescript, /wsl, and /zod where relevant to the code and logic.
