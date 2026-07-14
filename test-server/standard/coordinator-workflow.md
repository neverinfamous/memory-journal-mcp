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
   - If you or a subagent modifies the codebase, you MUST run the linter and typechecker (`pnpm run lint` and `npx tsc --noEmit`) locally, and ensure they all pass completely cleanly **BEFORE** committing.
   - **Quality Gates**: Pay strict attention to ESLint and TypeScript compiler outputs. You MUST fix all `pnpm run lint` and `npx tsc --noEmit` validation issues prior to committing. Do NOT ignore warnings or errors. Follow strict TypeScript guidelines: NEVER use `any` (use `unknown` with type guards), avoid unsafe typecasts, and ensure explicit return types.
   - **WARNING**: Do NOT commit your code and then attempt to use `git commit --amend` to fix a lingering lint or test issue later. Amending a commit rewrites the commit SHA, which will permanently break the changelog tracking workflow.
   - DO NOT perform live server verification. DO NOT wait for a server restart. DO NOT pause or send a message asking the user to refresh the server.
   - The user will verify the live fixes in a completely new run/pass in a separate thread.
4. **Commit**:
   - Once all local tests pass, the subagent MUST commit their codebase changes locally using the `bun ./.agents/scripts/commit.ts` wrapper. If no modifications were needed, no commit is required. Do NOT use raw `git commit`.
   - Once the subagent completes, record their final token estimate and metric telemetry, mark the task as done, and move to the next test in the queue.
   - **Tool Availability Warning**: If any tools are unavailable during testing for any reason, the subagent MUST immediately warn the user. We want to actively test the tools, not just their graceful degradation.
5. **Coordinator Progress Reporting**:
   - The Coordinator MUST provide the user with clear, frequent progress reports. After each subagent finishes, emit a message like: "Test pass 4 out of X completed."
   - The Coordinator MUST keep a running tally of how many total issues were fixed by the subagents.

## Test Sequence Queue (Dependency DAG)

1. `test-seed.md`
2. `test-config-reload.md`
3. `test-core-admin-backup.md`
4. `test-core-admin-batch.md`
5. `test-core-admin-system.md`
6. `test-core-crud-create.md`
7. `test-core-crud-read.md`
8. `test-core-infra.md`
9. `test-core-io.md`
10. `test-core-project-admin.md`
11. `test-core-relationships.md`
12. `test-core-search-filters.md`
13. `test-core-search-fts.md`
14. `test-core-semantic.md`
15. `test-errors-boundaries.md`
16. `test-errors-prompts.md`
17. `test-github-issue-cycle.md`
18. `test-github-kanban.md`
19. `test-github-milestones.md`
20. `test-github-read.md`
21. `test-integrity-part1.md`
22. `test-integrity-part2.md`
23. `test-kanban-lifecycle.md`
24. `test-resources-static.md`
25. `test-resources-template.md`
26. `test-schemas.md`
27. `test-team-aliases.md`
28. `test-team-analytics.md`
29. `test-team-backup.md`
30. `test-team-crud.md`
31. `test-team-io.md`
32. `test-team-mutations.md`
33. `test-team-rbac.md`
34. `test-team-relationships.md`
35. `test-team-vector.md`
36. `test-workspace-isolation.md`
37. `test-tool-group-admin-part1.md`
38. `test-tool-group-admin-part2.md`
39. `test-tool-group-admin-part3.md`
40. `test-tool-group-admin-part4.md`
41. `test-tool-group-analytics-part1.md`
42. `test-tool-group-analytics-part2.md`
43. `test-tool-group-backup-part1.md`
44. `test-tool-group-backup-part2.md`
45. `test-tool-group-core-part1.md`
46. `test-tool-group-core-part2.md`
47. `test-tool-group-git-part1.md`
48. `test-tool-group-git-part2.md`
49. `test-tool-group-github-part1.md`
50. `test-tool-group-github-part2.md`
51. `test-tool-group-io-part1.md`
52. `test-tool-group-io-part2.md`
53. `test-tool-group-relationships-part1.md`
54. `test-tool-group-relationships-part2.md`
55. `test-tool-group-search-part1.md`
56. `test-tool-group-search-part2.md`
57. `test-tool-group-team-part1.md`
58. `test-tool-group-team-part2.md`
59. `test-tool-group-team-part3.md`
60. `test-tool-group-team-part4.md`
61. `test-payload-optimization-body.md`
62. `test-payload-optimization-codemode.md`
63. `test-payload-optimization-kanban.md`
64. `test-payload-optimization-limits.md`

## Telemetry Collection

When the suite finishes, compile the **Total Token Estimate** and resource metrics (e.g., `memory://metrics/summary`) from all subagents into a final report for the user. Also, report the **Total Number of Issues Fixed** during the entire suite.
