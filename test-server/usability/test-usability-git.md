# memory-journal-mcp Usability & Hallucination Test: Git

> **This test is optimized for an autonomous agent.**
>
> **CRITICAL:** You MUST pass `use_test_db: true` as a top-level parameter in ALL MCP tool calls (including `mj_execute_code`) to ensure tests hit the test database instead of production.

This prompt instructs you to organically test the `git` tool group using Code Mode (`mj_execute_code`), intentionally fuzzing the inputs to discover agent hallucinations, and permanently hardening the codebase against them.

## 1. Fuzz Phase

Use the `mj_execute_code` tool to interact with the following tools in the `git` group:
`get_commit_history`, `search_commits`, `get_release_info`, `get_unreleased_commits`, `analyze_commit_patterns`, `check_entry_staleness`

**Instructions:**

- Do not perfectly structure your initial calls. Act intuitively as an agent.
- Evaluate the developer experience (DX) and heuristic fallbacks for Git tools.
- **Schema Nuance**: Ensure `search_commits` handles missing parameters gracefully and errors are descriptive.
- **Path sanitization**: Ensure `simple-git` never leaks absolute paths in error messages or responses. Pass an invalid or extremely long path for `repo` to trigger an error and inspect the response payload. No absolute paths should be leaked from `simple-git` operations.

## 2. Heal Phase

If you encounter any failures, errors, or hallucinations:

1. STOP. Do not just work around the issue in your script.
2. Read the hardening guidelines in `skills/mj-mcp-heal/SKILL.md`.
3. Locate the appropriate file in the codebase.
4. Apply the permanent fix.

## 3. Local Verification & Commit

If you made any codebase changes in the Heal Phase:

1. Run `pnpm run check` locally to verify that all validation passes (linting, tests, types).
2. DO NOT perform live server verification. DO NOT pause or wait for a server restart.
3. Run `git add .` and `git commit -m "Optimize git tool usage"` to save your changes locally.
4. Conclude the test and report your findings.

## 4. Continuous Improvement

If during this test you discover a blind spot, a new hallucination vector, or a way to make this very testing prompt more effective, you are encouraged to edit this markdown file directly to permanently improve the testing apparatus. Commit any prompt improvements alongside your codebase fixes.
