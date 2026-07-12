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
10. `test-core-admin-system.md`
11. `test-core-admin-backup.md`
12. `test-core-admin-batch.md`
13. `test-core-project-admin.md`
14. `test-schemas.md`
15. `test-resources.md`
16. `test-errors-prompts.md`
17. `test-errors-boundaries.md`
18. `test-integrity-part1.md`
19. `test-integrity-part2.md`
20. `test-github-read.md`
21. `test-github-issue-cycle.md`
22. `test-github-kanban.md`
23. `test-github-milestones.md`
24. `test-kanban-lifecycle.md`
25. `test-team-crud.md`
26. `test-team-mutations.md`
27. `test-team-analytics.md`
28. `test-team-vector.md`
29. `test-team-relationships.md`
30. `test-team-io.md`
31. `test-team-backup.md`
32. `test-team-rbac.md`
33. `test-team-aliases.md`
34. `test-tool-group-core.md`
35. `test-tool-group-analytics.md`
36. `test-tool-group-admin.md`
37. `test-tool-group-backup.md`
38. `test-tool-group-search.md`
39. `test-tool-group-github.md`
40. `test-tool-group-team-part1.md`
41. `test-tool-group-team-part2.md`
42. `test-tool-group-team-part3.md`
43. `test-payload-optimization.md`
44. `test-workspace-isolation.md`
45. `test-tool-group-git.md`
46. `test-tool-group-io.md`
47. `test-tool-group-relationships.md`
48. `test-config-reload.md`

## Telemetry Collection

When the suite finishes, compile the **Total Token Estimate** and resource metrics (e.g., `memory://metrics/summary`) from all subagents into a final report for the user. Also, report the **Total Number of Issues Fixed** during the entire suite.
