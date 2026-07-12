# Re-Test memory-journal-mcp — Analytics Tool Group

**Scope:** Deterministic verification of the Analytics tool group (`get_cross_project_insights`, `get_statistics`) against the strict error handling matrix.

**Prerequisites:**

- **CRITICAL:** You MUST pass `use_test_db: true` as a top-level parameter in ALL MCP tool calls to ensure tests hit the test database instead of production.
- **Validation:** Ensure the test agent validates strict mode and boundary limits on newly hardened schemas.
> **Note**: When updating schemas or validation logic, please refer to the `/zod` skill for best practices on Standard Schema and Safe Parsing.
- Confirm MCP server instructions were auto-received before starting.
- **Use direct MCP tools exclusively.** Do NOT use Code Mode (`mj_execute_code`) for these tests. Code Mode tests are handled separately in the `codemode` track. If you must use a script to supplement a test, use a standard Node/shell script.
- Seed data from `test-seed.md` must be present. MCP server instructions auto-injected.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `constants/server-instructions.ts` or this file. **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `src/filtering/tool-filter.ts`) so future agents succeed automatically.**
2. Use `code-map.md` as a source of truth and ensure fixes comply with the `mcp-builder` skill.
3. **Local Verification**: If you or a subagent modifies the codebase, you MUST run the full validation pipeline (`pnpm run check`) locally and fix any issues BEFORE committing.
4. **Commit**: Immediately commit passing changes using the `bun .\.agents\scripts\commit.ts` utility. Do NOT use raw `git commit`. DO NOT stop to ask the USER to verify with `pnpm run check` yourself—you are autonomous.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.
---

## 1. Zod Boundary & Type Mismatch Matrix

> ⚠️ **IDE Validation Note**: The Antigravity IDE (Cortex) strictly validates `call_mcp_tool` arguments against the JSON schema _before_ sending the request. You cannot test intentional Zod Type Mismatches (e.g., `content: 123`) using direct MCP calls, as the IDE will block it locally with a `-32602` error. For type mismatches, rely on the E2E test suite (`npm run test:e2e`) to verify the server's interceptor correctly handles malformed requests from raw clients.

For every tool, you must explicitly confirm that Domain Errors return a structured `{success: false}` json object, and **NEVER** surface as raw MCP `-32602` error frames.

| Tool                         | Happy Path     | Domain Error Test | Zod Empty Param (`{}`)    | Zod Type Mismatch     |
| ---------------------------- | -------------- | ----------------- | ------------------------- | --------------------- |
| `get_statistics`             | Fetch stats    | N/A               | Should succeed (defaults) | `start_date: 123`     |
| `get_cross_project_insights` | Fetch insights | N/A               | Should succeed (defaults) | `min_entries: "abc"`  |

### Specific Domain Checks

- **Date Ignorance Bug**: Ensure `get_statistics` with invalid dates doesn't silently ignore date limits.

## 2. Integrity & Boundary Testing

| Test               | Action                                                             | Verification                                                     |
| ------------------ | ------------------------------------------------------------------ | ---------------------------------------------------------------- |

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- Agent reports the Total Token Estimate in the final summary (using `_meta.tokenEstimate` from responses). The tokens tracked should only count the estimated tokens that actually entered the context window.
- Agent reports the Total Token Estimate in the final summary (using `_meta.tokenEstimate` from responses).
- All tools return structured handler errors.
- No raw MCP exceptions are thrown.
- Boundary conditions behave as specified.
