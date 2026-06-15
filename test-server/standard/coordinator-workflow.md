# Standard Testing Coordinator Workflow

> **This document is optimized for an autonomous agent acting as a Coordinator.**

This guide instructs the Coordinator agent on how to run the `memory-journal-mcp` Standard test suite using subagents.

## Goal
Systematically execute all Standard tests in `test-server/standard/` to verify direct `callTool` operations via MCP. You will delegate testing to subagents, ensuring high-fidelity results, tracking token estimates, and maintaining codebase stability.

## Workflow Rules

1. **Sequential Execution**: Tests MUST be executed sequentially (one subagent at a time) according to the Dependency DAG below. Parallel execution may cause conflicts or test data interference.
2. **Subagent Delegation**: 
   - Use the `invoke_subagent` tool to spawn a `self` subagent for each test file.
   - Provide the exact path to the test file as the subagent's prompt, along with these execution requirements.
3. **Validation and Server Restart Coordination**:
   - If a subagent modifies the codebase to fix an issue, the subagent MUST validate all changes locally by running `pnpm run check; pnpm run build; pnpm run test; pnpm run test:e2e`. They must ensure these pass completely cleanly BEFORE requesting a server refresh.
   - After passing local CI, the subagent is instructed to pause and message you: *"Please manually refresh the `memory-journal-mcp` server, then say 'ready' so I can verify the fix."*
   - When you receive this message, DO NOT proceed. Surface the message to the user and wait for them to manually refresh the server.
   - Once the user confirms the server is ready, use the `send_message` tool to pass the "ready" signal to the waiting subagent.
4. **Finalization and Commit**:
   - The subagent MUST explicitly verify the fixes work properly after the server is restarted.
   - Once confirmed, the subagent MUST update `UNRELEASED.md` with all changes.
   - The subagent MUST commit all changes locally (`git commit -m "..."`).
   - The subagent MUST then create a session summary journal entry using the `/mcp:memory-journal-mcp:session-summary` prompt.
   - Once the subagent completes, record their final token estimate and metric telemetry, mark the task as done, and move to the next test in the queue.

## Test Sequence Queue (Dependency DAG)

1. `test-seed.md` (**MUST PASS FIRST** — Universal Blocker)
2. `test-core-infra.md`
3. `test-core-crud.md`
4. `test-core-search.md`
5. `test-core-semantic.md`
6. `test-core-relationships.md`
7. `test-core-io.md`
8. `test-core-admin.md`
9. `test-schemas.md`
10. `test-resources.md`
11. `test-errors.md`
12. `test-integrity.md`
13. `test-github.md`
14. `test-kanban-lifecycle.md`
15. `test-team-crud.md`
16. `test-team-admin.md`
17. `test-team-hush.md`
18. `test-team-rbac.md`
19. `test-tool-group-core.md`
20. `test-tool-group-admin.md`
21. `test-tool-group-backup.md`
22. `test-tool-group-search.md`
23. `test-tool-group-github.md`
24. `test-tool-group-team.md`
25. `test-payload-optimization.md`

## Telemetry Collection
When the suite finishes, compile the **Total Token Estimate** and resource metrics (e.g., `memory://metrics/summary`) from all subagents into a final report for the user.
