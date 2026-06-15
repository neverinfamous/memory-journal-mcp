# Code Mode Testing Coordinator Workflow

> **This document is optimized for an autonomous agent acting as a Coordinator.**

This guide instructs the Coordinator agent on how to run the `memory-journal-mcp` Code Mode test suite using subagents.

## Goal
Systematically execute all Code Mode tests in `test-server/codemode/` to verify sandbox isolation, workflow orchestration, payload optimization, and error handling. You will delegate testing to subagents, ensuring high-fidelity results and structured error handling, while compiling telemetry.

## Workflow Rules

1. **Sequential Execution**: Tests MUST be executed sequentially (one subagent at a time) according to the Dependency DAG below. Parallel execution may cause conflicts or server instability.
2. **Subagent Delegation**: 
   - Use the `invoke_subagent` tool to spawn a `self` subagent for each test file.
   - Provide the exact path to the test file as the subagent's prompt, along with these execution requirements.
3. **Validation and Server Restart Coordination**:
   - If a subagent modifies the codebase to fix an issue, the subagent MUST validate all changes locally by running `pnpm run check; pnpm run build; pnpm run test; pnpm run test:e2e`. They must ensure these pass completely cleanly BEFORE requesting a server refresh.
   - After passing local CI, the subagent is instructed to pause and message you: *"Please manually refresh the `memory-journal-mcp` server, then say 'ready' so I can verify the fix."*
   - When you receive this message, DO NOT proceed. Surface the message to the user and wait for them to manually refresh the server.
   - Once the user confirms the server is ready, use the `send_message` tool to pass the "ready" signal to the waiting subagent.
4. **Finalization and Commit**:
   - The subagent MUST explicitly verify the fixes work properly after the server is restarted (e.g. by re-executing `mj_execute_code`).
   - Once confirmed, the subagent MUST update `UNRELEASED.md` with all changes.
   - The subagent MUST commit all changes locally (`git commit -m "..."`).
   - The subagent MUST then create a session summary journal entry using the `/mcp:memory-journal-mcp:session-summary` prompt.
   - Once the subagent completes, record their final token estimate and metric telemetry, mark the task as done, and move to the next test in the queue.
5. **Code Mode Constraints (P401)**:
   - Ensure subagents explicitly check that Code Mode scripts do NOT leak raw MCP exceptions, returning `{ success: false }` for domain errors.

## Test Sequence Queue (Dependency DAG)

1. `test-cm-sandbox-basics.md` (**MUST PASS FIRST**)
2. `test-cm-api-discovery.md`
3. `test-cm-readonly.md`
4. `test-cm-security.md`
5. `test-cm-crud.md`
6. `test-cm-crud-advanced.md`
7. `test-cm-search.md`
8. `test-cm-search-advanced.md`
9. `test-cm-workflows.md`
10. `test-cm-orchestration.md`
11. `test-cm-relationships.md` (Includes cleanup for 9-11)
12. `test-cm-github.md`
13. `test-cm-kanban-lifecycle.md`
14. `test-cm-io.md`
15. `test-cm-admin-backup.md`
16. `test-cm-team-crud.md`
17. `test-cm-team-admin.md`
18. `test-cm-team-vector-errors.md` (Includes cleanup)
19. `test-cm-team-flags-core.md`
20. `test-cm-team-flags-advanced.md`
21. `test-cm-team-flags-analytics.md`
22. `test-cm-team-rbac.md`
23. `test-cm-error-matrix.md`
24. `test-cm-error-matrix-2.md`
25. `test-cm-payload-optimization.md`
26. `test-cm-hallucination-smoothing.md`

## Telemetry Collection
When the suite finishes, compile the **Total Token Estimate** and resource metrics (e.g., `memory://metrics/summary`) from all subagents into a final report for the user.
