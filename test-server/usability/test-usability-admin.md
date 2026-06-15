# memory-journal-mcp Usability & Hallucination Test: Admin

> **This test is optimized for an autonomous agent.**

This prompt instructs you to organically test the `admin` tool group using Code Mode (`mj_execute_code`), intentionally fuzzing the inputs to discover agent hallucinations, and permanently hardening the codebase against them.

## 1. Fuzz Phase

Use the `mj_execute_code` tool to interact with the following tools in the `admin` group:
`update_configuration`, `update_entry`, `delete_entry`, `restore_entry`, `merge_tags`, `rebuild_vector_index`, `add_to_vector_index`, `batch_create_entries`, `batch_update_entries`, `batch_delete_entries`, `search_audit_log`

**Instructions:**

- Do not perfectly structure your initial calls. Act intuitively as an agent.
- Try natural, ambiguous scripting (e.g., guessing property names, forgetting `await`, assuming incorrect return types like arrays instead of objects).
- Explicitly test top-level flat tool calls (e.g., `mj.update_configuration(...)` instead of `mj.admin.update_configuration(...)`) to verify cross-group routing.
- Explicitly test aliases across groups (e.g., `mj.config(...)`) to ensure proper resolution.
- Explicitly test passing primitives (like `true` or `"string"`) to parameter-less functions (like `rebuild_vector_index`) to ensure the proxy correctly maps them to empty objects instead of causing Zod strict failures.
- Explicitly test the newly added alias mappings (e.g., passing `keep`, `path`, `q`, `mode`, `text`, `message`, or `description` as arguments) to see if they resolve to the correct property.
- Explicitly test missing array operations on returned objects (e.g., `.push()`, `.filter()`) and verify they give actionable feedback.
- Verify token consumption tracking limits and ensure explicit error paths correctly reject invalid operations or overages.
- Do not try to bypass the sandbox, simply test the API surface.
- Note any errors, exceptions, or unexpected behavior.

## 2. Heal Phase

If you encounter any failures, errors, or hallucinations:

1. STOP. Do not just work around the issue in your script.
2. Read the hardening guidelines in `skills/mj-mcp-optimize/SKILL.md`.
3. Locate the appropriate file in the codebase (e.g., schemas in `src/handlers/tools/admin/schemas.ts`, proxies in `src/codemode/worker-api-proxy.ts`, or aliases in `src/codemode/api-constants.ts`).
4. **Important**: Remember that Code Mode's `secureDispatcher` directly calls `tool.handler()`. This bypasses the MCP `inputSchema` (e.g. `UpdateEntrySchemaMcp`). If you are hardening schemas against hallucinations, you **MUST** apply `.strict()` to the internal schemas used inside the handler (e.g., `UpdateEntrySchema`) as well as the external MCP schemas.
5. Apply the permanent fix.

## 3. Refresh Checkpoint (CRITICAL)

If you made any codebase changes in the Heal Phase, the changes will not take effect until the server is restarted.
**You cannot restart the server yourself.**

Output the following message to the user:

> "Please manually refresh the `memory-journal-mcp` server, then say 'ready' so I can verify the fix."

**DO NOT PROCEED** to the verification phase until the user confirms the server has been refreshed.

## 4. Verification & Commit

Once the server is refreshed (or if no codebase changes were needed):

1. Re-run your Code Mode script to verify that the guardrail successfully intercepts the hallucination and provides actionable feedback (or seamlessly heals it).
2. If successful, run `git add .` and `git commit -m "Optimize admin tool usage"` to save your changes locally.
3. Conclude the test and report your findings.

## 5. Continuous Improvement

If during this test you discover a blind spot, a new hallucination vector, or a way to make this very testing prompt more effective, you are encouraged to edit this markdown file directly to permanently improve the testing apparatus. Commit any prompt improvements alongside your codebase fixes.
