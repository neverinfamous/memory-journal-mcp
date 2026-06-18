# memory-journal-mcp Code Mode Testing Coordinator Workflow

> **This document is optimized for an autonomous agent acting as a Coordinator.**

This guide instructs the Coordinator agent on how to run the `memory-journal-mcp` Code Mode test suite using subagents.

## Goal

Systematically execute all Code Mode tests in `test-server/codemode/` to verify sandbox isolation, workflow orchestration, payload optimization, and error handling. You will delegate testing to subagents, ensuring high-fidelity results and structured error handling, while compiling telemetry.

## Workflow Rules

1. **Sequential Execution**: Tests MUST be executed sequentially (one subagent at a time) according to the Dependency DAG below. Parallel execution may cause conflicts or server instability.
2. **Subagent Delegation**:
   - Use the `invoke_subagent` tool to spawn a `self` subagent for each test file.
   - Provide the exact path to the test file as the subagent's prompt, along with these execution requirements.
3. **Local Verification**:
   - If you or a subagent modifies the codebase, you MUST run the full validation pipeline (`pnpm run check`, `pnpm run build`, `pnpm run test`, and `pnpm run test:e2e`) locally, and ensure they all pass completely cleanly **BEFORE** committing.
   - **Quality Gates**: Pay strict attention to ESLint and TypeScript compiler outputs. You MUST fix all lint, typecheck, vitest, and playwright issues prior to committing. Do NOT ignore warnings or errors. Follow strict TypeScript guidelines: NEVER use `any` (use `unknown` with type guards), avoid unsafe typecasts, and ensure explicit return types.
   - **WARNING**: Do NOT commit your code and then attempt to use `git commit --amend` to fix a lingering lint or test issue later. Amending a commit rewrites the commit SHA, which will permanently break the changelog tracking workflow.
   - DO NOT perform live server verification. DO NOT wait for a server restart. DO NOT pause or send a message asking the user to refresh the server.
   - The user will verify the live fixes in a completely new run/pass in a separate thread.
4. **Commit**:
   - Once all local tests pass, the subagent MUST commit their codebase changes locally (`git commit -m "..."`). If no modifications were needed, no commit is required.
   - Once the subagent completes, record their final token estimate and metric telemetry, mark the task as done, and move to the next test in the queue.
5. **Code Mode Constraints (P401)**:
   - Ensure subagents explicitly check that Code Mode scripts do NOT leak raw MCP exceptions, returning `{ success: false }` for domain errors.
   - **Tool Availability Warning**: If any tools are unavailable during testing for any reason, the subagent MUST immediately warn the user. We want to actively test the tools, not just their graceful degradation.
6. **Coordinator Progress Reporting**:
   - The Coordinator MUST provide the user with clear, frequent progress reports. After each subagent finishes, emit a message like: "Test pass 4 out of X completed."
   - The Coordinator MUST keep a running tally of how many total issues were fixed by the subagents.

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

When the suite finishes, compile the **Total Token Estimate** and resource metrics (e.g., `memory://metrics/summary`) from all subagents into a final report for the user. Also, report the **Total Number of Issues Fixed** during the entire suite.
