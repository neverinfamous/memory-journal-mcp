# Usability Test: Agent-Exec Payloads (Target Verification)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must explicitly document your hypotheses before modifying code. You must write an isolated unit test reproducing any failure *before* you apply a fix.

## Objective
Verify that `lib-agent-exec` correctly validates and routes `.json` payload based on the `target` enum (`windows` vs `wsl2`).

## Instructions

### Phase 1: Adversarial Execution
1. **Target Validation:** Construct a payload where the `target` field is set to an invalid enum (e.g., `linux` or `mac`). Verify that Zod validation rejects it.
2. **Target Windows:** Construct a payload where `target` is `windows`. Verify it executes natively on PowerShell.
3. **Target WSL2:** Construct a payload where `target` is `wsl2`. Verify it executes inside WSL2.

### Phase 2: Meta-Cognitive Debugging
1. If validation or routing fails:
   - **Formulate Hypothesis:** Create `<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`.
   - **Reproduce:** Add a test case to the schema or parsing test suite.
   - **Fix:** Update payload schema and execution branching.
2. **Regression Check:** Run `bun run typecheck` and `bun run lint`.

### Phase 3: Cleanup & Commit
1. Delete any scratch artifacts (including JSON payloads).
2. Commit your fix using `commit.ts`.
