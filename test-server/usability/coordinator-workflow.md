# Usability Testing Coordinator Workflow

> **This document is optimized for an autonomous agent acting as a Coordinator.**

This guide instructs the Coordinator agent on how to run the `memory-journal-mcp` usability test suite using subagents. 

## Goal
Execute all usability tests in `test-server/usability/` to fuzz the `memory-journal-mcp` tools and explicitly trigger agent hallucinations. Harden the codebase against these hallucinations via the `mj-mcp-optimize` skill.

## Workflow Rules

1. **Sequential Execution**: Tests MUST be executed sequentially (one subagent at a time). The server schemas, proxies, and `server-instructions.ts` are central files, and parallel mutation will cause git conflicts and require overlapping server restarts.
2. **Subagent Delegation**: 
   - Use the `invoke_subagent` tool to spawn a `self` subagent for each test file.
   - Provide the exact path to the test file as the subagent's prompt.
3. **Server Restart Coordination**:
   - The subagent MUST run `pnpm run check`, `pnpm run build`, `pnpm run test`, and `pnpm run test:e2e` locally, and ensure they all pass completely cleanly BEFORE they send the pause message asking to refresh the server.
   - The subagent is instructed to pause and message you: *"Please manually refresh the `memory-journal-mcp` server, then say 'ready' so I can verify the fix."*
   - When you receive this message, DO NOT proceed. Surface the message to the user and wait for them to manually refresh the server.
   - Once the user confirms the server is ready, use the `send_message` tool to pass the "ready" signal to the waiting subagent.
4. **Verification and Commit**:
   - The subagent MUST explicitly re-verify the fix using `mj_execute_code` (Code Mode) after the server is restarted to ensure the proxy changes are live and effective.
   - The subagent will verify the fix, commit the code (`git commit -m "Optimize [group] tool usage"`), and exit.
   - Once the subagent completes, mark the task as done and move to the next test in the queue.
5. **Code Mode Error Testing Protocol**:
   - Subagents executing Code Mode test matrices must anticipate structured `VALIDATION_ERROR` payloads with `{ success: false }` for type mismatches, rather than expecting sandbox crashes or thrown `ZodError` messages.

## Test Sequence Queue

1. `test-usability-codemode.md`
2. `test-usability-core.md`
3. `test-usability-search.md`
4. `test-usability-analytics.md`
5. `test-usability-relationships.md`
6. `test-usability-io.md`
7. `test-usability-admin.md`
8. `test-usability-github.md`
9. `test-usability-backup.md`
10. `test-usability-team.md`

## Finalization
Once all subagents have completed their tests, run `pnpm run check` to ensure no type errors or formatting issues were introduced by the optimization layers.
