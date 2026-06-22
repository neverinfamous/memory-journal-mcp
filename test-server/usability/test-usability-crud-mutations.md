# memory-journal-mcp Usability & Hallucination Test: CRUD Mutations

> **This test is optimized for an autonomous agent.**
>
> **CRITICAL:** You MUST pass `use_test_db: true` as a top-level parameter in ALL MCP tool calls (including `mj_execute_code`) to ensure tests hit the test database instead of production.

This prompt instructs you to organically test the structural boundaries, data integrity, and hallucination vectors of core CRUD operations using Code Mode (`mj_execute_code`). The goal is to explicitly fuzz data schemas and permanently harden the codebase against destructive agent behavior.

## 1. Fuzz Phase

Use the `mj_execute_code` tool to interact with the following tools across the standard and team groups:
`create_entry`, `update_entry`, `delete_entry`, `team_create_entry`, `team_update_entry`, `team_delete_entry`

**Instructions:**

- Do not perfectly structure your initial calls. Act intuitively as an agent.
- **Session Summary Structural Strictness**: Attempt to create a `retrospective` entry with the `session-summary` tag, but intentionally hallucinate the section headers (e.g., use `## Summary` instead of `## Accomplished`, `## Unfinished / Blocked`, `## Context for Next Session`). Intentionally malform or misspell the `auto_context` payload. Verify that the server strictly enforces correct structures or heals the input.
- **Update Overwrite Traps**: 
  - Call update endpoints passing `id` instead of `entry_id`, or an array `ids`. Verify if it heals silently or fails gracefully.
  - Attempt a partial update of a session summary by *only* sending an appended `## Context for Next Session` block. Check if this inadvertently blows away the rest of the file content, and if so, heal the system to provide actionable guardrails against partial updates.
  - Attempt to update an entry using `title`, `name`, `text`, or `description` instead of `content`.
- **Deletion Safety**: 
  - Call delete endpoints without `expected_version` (to test optimistic concurrency gaps).
  - Attempt hard-deletes without explicitly passing `permanent: true`.
  - Pass arrays or malformed IDs to destructive endpoints.
- **Prompt/Tool Confusion**: Try to execute MCP Prompts as if they were tools (e.g., calling `mj_session_summary` or `session_summary` directly via tool call instead of using `get_prompt`). Verify the server explicitly heals this and directs you to the correct prompt retrieval method, rather than returning a generic 'Tool not found' or validation error.
- Do not try to bypass the sandbox, simply test the API surface.
- Note any errors, exceptions, or unexpected behavior.

## 2. Heal Phase

If you encounter any failures, data corruption, or lack of actionable error messages:

1. STOP. Do not just work around the issue in your script.
2. Read the hardening guidelines in `skills/mj-mcp-heal/SKILL.md`.
3. Locate the appropriate file in the codebase (e.g., schemas in `src/handlers/tools/core/schemas.ts`, proxies in `src/codemode/worker-api-proxy.ts`, or dispatch logic).
4. Apply the permanent fix. Ensure that both `UpdateEntrySchema` and `UpdateEntrySchemaMcp` layers are appropriately hardened using `.strict()`.

## 3. Refresh Checkpoint (CRITICAL)

If you made any codebase changes in the Heal Phase, the changes will not take effect until the server is restarted.
**You cannot restart the server yourself.**

Output the following message to the user:

> "Please manually refresh the `memory-journal-mcp` server, then say 'ready' so I can verify the fix."

**DO NOT PROCEED** to the verification phase until the user confirms the server has been refreshed.

## 4. Verification & Commit

Once the server is refreshed (or if no codebase changes were needed):

1. Re-run your Code Mode script to verify that the guardrail successfully intercepts the hallucination and provides actionable feedback (or seamlessly heals it).
2. If successful, run `git add .` and `git commit -m "Optimize CRUD mutation tool usage"` to save your changes locally.
3. Conclude the test and report your findings.

## 5. Continuous Improvement

If during this test you discover a blind spot, a new hallucination vector, or a way to make this very testing prompt more effective, you are encouraged to edit this markdown file directly to permanently improve the testing apparatus. Commit any prompt improvements alongside your codebase fixes.
