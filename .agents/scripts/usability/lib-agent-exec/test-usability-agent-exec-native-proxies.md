# Usability Test: Agent-Exec Native PowerShell Proxies

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must explicitly document your hypotheses before modifying code. You must write an isolated unit test reproducing any failure *before* you apply a fix.

## Objective
Verify that the PowerShell environment automatically intercepts native CLI tools (`docker`, `bun`, `npm`, `pnpm`, `npx`, `bunx`, `gh`, `node`, `python`, etc.) via proxy functions and routes them through `lib-agent-exec`.

## Instructions

### Phase 1: Proxy Verification
1. **Execution Test:** Run native CLI tools directly via `run_command` (e.g., `git status`, `bun --version`, `docker --version`, `python --version`, `node --version`, `npm --version`, `pnpm --version`, `npx --version`, `bunx --version`).
2. **Interception Check:** Verify that these commands do not execute as raw shell commands, but are intercepted by the PowerShell proxy functions and securely routed through the `agent-exec` bridge under the hood. The output should indicate it ran through `lib-agent-exec`.

### Phase 2: Meta-Cognitive Debugging
1. If any of these tools are NOT intercepted and run purely natively (bypassing `lib-agent-exec`):
   - **Formulate Hypothesis:** Create `<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`.
   - **Reproduce:** Add a test case/check.
   - **Fix:** Update the PowerShell profile or the script that generates the proxy wrappers to ensure all required native CLI tools are properly proxied.

### Phase 3: Cleanup & Commit
1. Delete any scratch artifacts.
2. Commit your fix using `commit.ts`.
