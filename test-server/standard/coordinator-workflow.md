# memory-journal-mcp Standard Testing Coordinator Workflow

> **This document is optimized for an autonomous agent acting as a Coordinator.**

This guide instructs the Coordinator agent on how to run the `memory-journal-mcp` Standard test suite using subagents.

## Goal

Systematically execute all Standard tests in `test-server/standard/` to verify direct `callTool` operations via MCP. You will delegate testing to subagents, ensuring high-fidelity results, tracking token estimates, and maintaining codebase stability.

## Workflow Rules

1. **Sequential Execution**: Tests MUST be executed sequentially (one subagent at a time) according to the Dependency DAG below. Parallel execution may cause conflicts or test data interference.
2. **Subagent Delegation**:
   - Use the `invoke_subagent` tool to spawn a `self` subagent for each test file.
   - Provide the exact path to the test file as the subagent's prompt, along with these execution requirements.
3. **Local Verification**:
   - If a subagent modifies the codebase, they MUST run `pnpm run check`, `pnpm run build`, `pnpm run test`, and `pnpm run test:e2e` locally, and ensure they all pass completely cleanly.
   - **Quality Gates**: Pay strict attention to ESLint and TypeScript compiler outputs. Do NOT ignore warnings or errors. Follow strict TypeScript guidelines: NEVER use `any` (use `unknown` with type guards), avoid unsafe typecasts, and ensure explicit return types.
   - DO NOT perform live server verification. DO NOT wait for a server restart. DO NOT pause or send a message asking the user to refresh the server.
   - The user will verify the live fixes in a completely new run/pass in a separate thread.
4. **Commit**:
   - Once all local tests pass, the subagent MUST commit their codebase changes locally (`git commit -m "..."`). If no modifications were needed, no commit is required.
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
