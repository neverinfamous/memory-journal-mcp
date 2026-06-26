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
   - If you or a subagent modifies the codebase, you MUST run the full validation pipeline (`pnpm run check`) locally, and ensure they all pass completely cleanly **BEFORE** committing.
   - **Quality Gates**: Pay strict attention to ESLint and TypeScript compiler outputs. You MUST fix all `pnpm run check` validation issues prior to committing. Do NOT ignore warnings or errors. Follow strict TypeScript guidelines: NEVER use `any` (use `unknown` with type guards), avoid unsafe typecasts, and ensure explicit return types.
   - **WARNING**: Do NOT commit your code and then attempt to use `git commit --amend` to fix a lingering lint or test issue later. Amending a commit rewrites the commit SHA, which will permanently break the changelog tracking workflow.
   - DO NOT perform live server verification. DO NOT wait for a server restart. DO NOT pause or send a message asking the user to refresh the server.
   - The user will verify the live fixes in a completely new run/pass in a separate thread.
4. **Commit**:
   - Once all local tests pass, the subagent MUST commit their codebase changes locally (`git commit -m "..."`). If no modifications were needed, no commit is required.
   - Once the subagent completes, record their final token estimate and metric telemetry, mark the task as done, and move to the next test in the queue.
   - **Tool Availability Warning**: If any tools are unavailable during testing for any reason, the subagent MUST immediately warn the user. We want to actively test the tools, not just their graceful degradation.
5. **Coordinator Progress Reporting**:
   - The Coordinator MUST provide the user with clear, frequent progress reports. After each subagent finishes, emit a message like: "Test pass 4 out of X completed."
   - The Coordinator MUST keep a running tally of how many total issues were fixed by the subagents.

## Test Sequence Queue (Dependency DAG)

1. `test-seed.md` (**MUST PASS FIRST** — Universal Blocker)
2. `test-core-infra.md`
3. `test-core-crud-create.md`
4. `test-core-crud-read.md`
5. `test-core-search-fts.md`
6. `test-core-search-filters.md`
7. `test-core-semantic.md`
8. `test-core-relationships.md`
9. `test-core-io.md`
10. `test-core-admin.md`
11. `test-schemas.md`
12. `test-resources.md`
13. `test-errors.md`
14. `test-integrity.md`
15. `test-github.md`
16. `test-kanban-lifecycle.md`
17. `test-team-crud.md`
18. `test-team-admin.md`
19. `test-team-rbac.md`
20. `test-tool-group-core.md`
21. `test-tool-group-admin.md`
22. `test-tool-group-backup.md`
23. `test-tool-group-search.md`
24. `test-tool-group-github.md`
25. `test-tool-group-team.md`
26. `test-payload-optimization.md`
27. `test-workspace-isolation.md`
28. `test-git.md`

## Telemetry Collection

When the suite finishes, compile the **Total Token Estimate** and resource metrics (e.g., `memory://metrics/summary`) from all subagents into a final report for the user. Also, report the **Total Number of Issues Fixed** during the entire suite.
