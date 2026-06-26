# memory-journal-mcp Usability & Hallucination Test: Team Core Read

> **This test is optimized for an autonomous agent.**
>
> **CRITICAL:** You MUST pass `use_test_db: true` as a top-level parameter in ALL MCP tool calls (including `mj_execute_code`) to ensure tests hit the test database instead of production.

This prompt instructs you to organically test the structural boundaries, data integrity, and hallucination vectors of Team Core Read operations using Code Mode (`mj_execute_code`). The goal is to explicitly fuzz data schemas and permanently harden the codebase against destructive agent behavior.

## 1. Fuzz Phase

Use the `mj_execute_code` tool to interact with the following tools in this test pass:
`team_get_entry_by_id`, `team_get_recent`, `team_list_tags`

**Instructions:**

- Do not perfectly structure your initial calls. Act intuitively as an agent.
- Try natural, ambiguous scripting (e.g., guessing property names, forgetting `await`, assuming incorrect return types like arrays instead of objects).
- Explicitly test alias mappings if applicable (e.g., passing `keep`, `path`, `q`, `mode`, `text`, `message`, or `description`).
- Try to execute MCP Prompts as if they were tools to verify that the server heals this.
- For mutation/destructive tools, call them without expected constraints (like omitting `expected_version` or `permanent: true`) to test optimistic concurrency and explicit traps.
- Do not try to bypass the sandbox, simply test the API surface.
- Note any errors, exceptions, or unexpected behavior.

## 2. Heal Phase

If you encounter any failures, data corruption, or lack of actionable error messages:

1. STOP. Do not just work around the issue in your script.
2. Read the hardening guidelines in `skills/mj-mcp-heal/SKILL.md`.
3. Locate the appropriate file in the codebase (e.g., schemas in `src/handlers/tools/[group]/schemas.ts`, proxies in `src/codemode/worker-api-proxy.ts`, or dispatch logic).
4. Apply the permanent fix. Ensure that both strict validation schemas and MCP relaxed schemas are appropriately hardened.

> **Note**: When updating schemas or validation logic, please refer to the `/zod` skill for best practices on Standard Schema and Safe Parsing.

## 3. Local Verification & Commit

If you made any codebase changes in the Heal Phase:

1. Run `pnpm run check` locally to verify that all validation passes (linting, tests, types).
2. DO NOT perform live server verification. DO NOT pause or wait for a server restart.
3. Run `git add .` and `git commit -m "Optimize team core read tool usage"` to save your changes locally.
4. Conclude the test and report your findings.

## 4. Continuous Improvement

If during this test you discover a blind spot, a new hallucination vector, or a way to make this very testing prompt more effective, you are encouraged to edit this markdown file directly to permanently improve the testing apparatus. Commit any prompt improvements alongside your codebase fixes.
