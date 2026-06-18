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
   - If you or a subagent modifies the codebase, you MUST run the full validation pipeline (`pnpm run check`, `pnpm run build`, `pnpm run test`, and `pnpm run test:e2e`) locally, and ensure they all pass completely cleanly **BEFORE** committing.
   - **Quality Gates**: Pay strict attention to ESLint and TypeScript compiler outputs. You MUST fix all lint, typecheck, vitest, and playwright issues prior to committing. Do NOT ignore warnings or errors. Follow strict TypeScript guidelines: NEVER use `any` (use `unknown` with type guards), avoid unsafe typecasts, and ensure explicit return types.
   - **WARNING**: Do NOT commit your code and then attempt to use `git commit --amend` to fix a lingering lint or test issue later. Amending a commit rewrites the commit SHA, which will permanently break the changelog tracking workflow.
   - DO NOT perform live server verification. DO NOT wait for a server restart. DO NOT pause or send a message asking the user to refresh the server.
   - The user will verify the live fixes in a completely new run/pass in a separate thread.
4. **Commit**:
   - Once all local tests pass, the subagent will commit the code (`git commit -m "Optimize [group] tool usage"`), summarize findings, and exit. If no modifications were needed, no commit is required.
   - Once the subagent completes, mark the task as done and move to the next test in the queue.
5. **Code Mode Error Testing Protocol**:
   - Subagents executing Code Mode test matrices must anticipate structured `VALIDATION_ERROR` payloads with `{ success: false }` for type mismatches, rather than expecting sandbox crashes or thrown `ZodError` messages.
   - **Tool Availability Warning**: If any tools are unavailable during testing for any reason, the subagent MUST immediately warn the user. We want to actively test the tools, not just their graceful degradation.
6. **Coordinator Progress Reporting**:
   - The Coordinator MUST provide the user with clear, frequent progress reports. After each subagent finishes, emit a message like: "Test pass 4 out of X completed."
   - The Coordinator MUST keep a running tally of how many total issues were fixed by the subagents.

## Test Sequence Queue

1. `test-usability-codemode.md`
2. `test-usability-crud-mutations.md`
3. `test-usability-core.md`
4. `test-usability-search.md`
5. `test-usability-analytics.md`
6. `test-usability-relationships.md`
7. `test-usability-io.md`
8. `test-usability-admin.md`
9. `test-usability-github-issues.md`
10. `test-usability-github-projects.md`
11. `test-usability-backup.md`
12. `test-usability-team-core.md`
13. `test-usability-team-search-analytics.md`
14. `test-usability-team-io-admin.md`
15. `test-usability-team-flags.md`
16. `test-usability-team-rbac.md`
17. `test-usability-workspace-isolation.md`

## Finalization

Once all subagents have completed their tests, run `pnpm run check` to ensure no type errors or formatting issues were introduced by the optimization layers.
