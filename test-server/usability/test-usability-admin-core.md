# memory-journal-mcp Usability & Hallucination Test: Admin Core

> **This test is optimized for an autonomous agent.**
>
> **CRITICAL:** You MUST pass `use_test_db: true` as a top-level parameter in ALL MCP tool calls (including `mj_execute_code`) to ensure tests hit the test database instead of production.

This prompt instructs you to organically test the `admin` tool group using Code Mode (`mj_execute_code`), intentionally fuzzing the inputs to discover agent hallucinations, and permanently hardening the codebase against them.

## 1. Fuzz Phase

Use the `mj_execute_code` tool to interact with the following tools in the `admin` group:
`update_entry`, `delete_entry`, `restore_entry`, `batch_create_entries`, `batch_update_entries`, `batch_delete_entries`

**Instructions:**

- Do not perfectly structure your initial calls. Act intuitively as an agent.
- Try natural, ambiguous scripting (e.g., guessing property names, forgetting `await`, assuming incorrect return types like arrays instead of objects).
- Explicitly test top-level flat tool calls (e.g., `mj.update_configuration(...)` instead of `mj.admin.update_configuration(...)`) to verify cross-group routing.
- Explicitly test aliases across groups (e.g., `mj.config(...)`) to ensure proper resolution.
- Explicitly test passing primitives (like `true` or `"string"`) to parameter-less functions (like `rebuild_vector_index`) to ensure the proxy correctly maps them to empty objects instead of causing Zod strict failures.
- Explicitly test the newly added alias mappings (e.g., passing `keep`, `path`, `q`, `mode`, `text`, `message`, or `description` as arguments) to see if they resolve to the correct property.
- Explicitly test missing array operations on returned objects (e.g., `.push()`, `.filter()`) and verify they give actionable feedback.
- Explicitly test hallucinating LLM context parameters in `update_configuration` (e.g., passing `maxTokens`, `temperature`, or `max_tokens`) to verify they are intercepted with actionable guidance rather than generic Zod strict failures.
- Verify token consumption tracking limits and ensure explicit error paths correctly reject invalid operations or overages.
- Do not try to bypass the sandbox, simply test the API surface.
- Note any errors, exceptions, or unexpected behavior.

## 2. Heal Phase

If you encounter any failures, errors, or hallucinations:

1. STOP. Do not just work around the issue in your script.
2. Read the hardening guidelines in `skills/mj-mcp-heal/SKILL.md`.
3. Locate the appropriate file in the codebase (e.g., schemas in `src/handlers/tools/admin/schemas.ts`, proxies in `src/codemode/worker-api-proxy.ts`, or aliases in `src/codemode/api-constants.ts`).
4. **Important**: Remember that Code Mode's `secureDispatcher` directly calls `tool.handler()`. This bypasses the MCP `inputSchema` (e.g. `UpdateEntrySchemaMcp`). If you are hardening schemas against hallucinations, you **MUST** apply `.strict()` to the internal schemas used inside the handler (e.g., `UpdateEntrySchema`) as well as the external MCP schemas.

> **Note**: When updating schemas or validation logic, please refer to the `/zod` skill for best practices on Standard Schema and Safe Parsing.
5. Apply the permanent fix.

## 3. Local Verification & Commit

If you made any codebase changes in the Heal Phase:

1. Run `pnpm run check` locally to verify that all validation passes (linting, tests, types).
2. DO NOT perform live server verification. DO NOT pause or wait for a server restart.
3. Run `git add .` and `git commit -m "Optimize admin tool usage"` to save your changes locally.
4. Conclude the test and report your findings.

## 4. Continuous Improvement

If during this test you discover a blind spot, a new hallucination vector, or a way to make this very testing prompt more effective, you are encouraged to edit this markdown file directly to permanently improve the testing apparatus. Commit any prompt improvements alongside your codebase fixes.
