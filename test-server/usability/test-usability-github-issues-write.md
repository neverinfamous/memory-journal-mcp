# memory-journal-mcp Usability & Hallucination Test: Github Issues

> **This test is optimized for an autonomous agent.**
>
> **CRITICAL:** You MUST pass `use_test_db: true` as a top-level parameter in ALL MCP tool calls (including `mj_execute_code`) to ensure tests hit the test database instead of production.

This prompt instructs you to organically test the `github` issues/repo tool group using Code Mode (`mj_execute_code`), intentionally fuzzing the inputs to discover agent hallucinations, and permanently hardening the codebase against them.

## 1. Fuzz Phase

Use the `mj_execute_code` tool to interact with the following tools in the `github` group:
`create_github_issue_with_entry`, `close_github_issue_with_entry`, `get_repo_insights`, `get_copilot_reviews`

**Instructions:**

- Do not perfectly structure your initial calls. Act intuitively as an agent.
- Try natural, ambiguous scripting (e.g., guessing property names, forgetting `await`, assuming incorrect return types like arrays instead of objects).
- Explicitly test the newly added alias mappings (e.g., passing `keep`, `path`, `q`, `mode`, `text`, `message`, or `description` as arguments) to see if they resolve to the correct property.
- Explicitly test missing array operations on returned objects (e.g., `.push()`, `.filter()`) and verify they give actionable feedback.
- Verify token consumption tracking limits and ensure explicit error paths correctly reject invalid operations or overages.
- Do not try to bypass the sandbox, simply test the API surface.
- Note any errors, exceptions, or unexpected behavior.

## 2. Heal Phase

If you encounter any failures, errors, or hallucinations:

1. STOP. Do not just work around the issue in your script.
2. Read the hardening guidelines in `skills/mj-mcp-heal/SKILL.md`.
3. Locate the appropriate file in the codebase (e.g., schemas in `src/handlers/tools/github/schemas.ts`, proxies in `src/codemode/worker-api-proxy.ts`, or aliases in `src/codemode/api-constants.ts`).
> **Note**: When updating schemas or validation logic, please refer to the `/zod` skill for best practices on Standard Schema and Safe Parsing.
4. Apply the permanent fix.

## 3. Local Verification & Commit

If you made any codebase changes in the Heal Phase:

1. Run `pnpm run check` locally to verify that all validation passes (linting, tests, types).
2. DO NOT perform live server verification. DO NOT pause or wait for a server restart.
3. Run `git add .` and `git commit -m "Optimize github issues tool usage"` to save your changes locally.
4. Conclude the test and report your findings.

## 4. Continuous Improvement

If during this test you discover a blind spot, a new hallucination vector, or a way to make this very testing prompt more effective, you are encouraged to edit this markdown file directly to permanently improve the testing apparatus. Commit any prompt improvements alongside your codebase fixes.
