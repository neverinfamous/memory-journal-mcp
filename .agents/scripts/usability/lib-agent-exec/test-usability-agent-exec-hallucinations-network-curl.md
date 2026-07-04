# Usability Test: Agent-Exec Hallucinations (Network Aliases)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must explicitly document your hypotheses before modifying code. You must write an isolated unit test reproducing any failure *before* you apply a fix.

## Objective
Verify that `lib-agent-exec` correctly intercepts and rejects PowerShell alias `curl` as a hallucination, instructing the agent to use the native `read_url_content` tool instead.

## Instructions

### Phase 1: Adversarial Execution
1. **Network Hallucination:** Attempt to run `curl https://example.com`.
2. **Interception Check:** Verify the interceptor traps the command and throws a specific anti-hallucination error instructing the agent to use `read_url_content` or natively invoke `curl.exe` to bypass the alias.

### Phase 2: Meta-Cognitive Debugging
If the alias evades the interceptor or errors vaguely:
1. **Formulate Hypothesis:** Create a file `<appDataDir>\brain\<conversation-id>\scratch\hypothesis.txt`.
2. **Reproduce:** Add a failing test case to `.agents/scripts/lib-agent-exec/tests/`.
3. **Fix & Verify:** Modify the interceptor logic (using `ts-pattern`). Run `bun run typecheck` and `bun run lint`.

### Phase 3: Cleanup & Commit
1. Delete any scratch files you created.
2. Run `pnpm run check` to validate.
3. Commit the changes using `commit.ts`.
