# memory-journal-mcp Usability Testing Coordinator Workflow

> **This document is optimized for an autonomous agent acting as a Coordinator.**

This guide instructs the Coordinator agent on how to run the `memory-journal-mcp` usability test suite using subagents.

## Goal

Execute all usability tests in `test-server/usability/` to fuzz the `memory-journal-mcp` tools and explicitly trigger agent hallucinations. Harden the codebase against these hallucinations via the `mj-mcp-heal` skill.

## Workflow Rules

1. **Sequential Execution**: Tests MUST be executed sequentially (one subagent at a time). The server schemas, proxies, and `server-instructions.ts` are central files, and parallel mutation will cause git conflicts and require overlapping server restarts.
2. **Subagent Delegation**:
   - Use the `invoke_subagent` tool to spawn a `self` subagent for each test file.
   - Provide the exact path to the test file as the subagent's prompt.
3. **Local Verification**:
   - If a subagent modifies the codebase, they MUST run `pnpm run check`, `pnpm run build`, `pnpm run test`, and `pnpm run test:e2e` locally, and ensure they all pass completely cleanly.
   - **Quality Gates**: Pay strict attention to ESLint and TypeScript compiler outputs. Do NOT ignore warnings or errors. Follow strict TypeScript guidelines: NEVER use `any` (use `unknown` with type guards), avoid unsafe typecasts, and ensure explicit return types.
   - DO NOT perform live server verification. DO NOT wait for a server restart. DO NOT pause or send a message asking the user to refresh the server.
   - The user will verify the live fixes in a completely new run/pass in a separate thread.
4. **Commit**:
   - Once all local tests pass, the subagent will commit the code (`git commit -m "Optimize [group] tool usage"`), summarize findings, and exit. If no modifications were needed, no commit is required.
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
8. `test-usability-github-issues.md`
9. `test-usability-github-projects.md`
10. `test-usability-backup.md`
11. `test-usability-team-core.md`
12. `test-usability-team-search-analytics.md`
13. `test-usability-team-io-admin.md`
14. `test-usability-team-flags.md`
15. `test-usability-team-rbac.md`

## Finalization

Once all subagents have completed their tests, run `pnpm run check` to ensure no type errors or formatting issues were introduced by the optimization layers.
