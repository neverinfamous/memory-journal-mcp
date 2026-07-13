# Re-Test memory-journal-mcp — Core Tool Group

**Scope:** Deterministic verification of the Core tool group (`create_entry`, `get_entry_by_id`, `get_entry_history`, `get_recent_entries`, `list_tags`, `mark_anchors_stale`, `test_error_handling`, `test_simple`, `trigger_progress`) against the strict error handling matrix.

**Prerequisites:**

- **Validation:** Ensure the test agent validates strict mode and boundary limits on newly hardened schemas.
> **Note**: When updating schemas or validation logic, please refer to the `/zod` skill for best practices on Standard Schema and Safe Parsing.
- Confirm MCP server instructions were auto-received before starting.
- **Use direct MCP tools exclusively.** Do NOT use Code Mode (`mj_execute_code`) for these tests. Code Mode tests are handled separately in the `codemode` track. If you must use a script to supplement a test, use a standard Node/shell script.
- Seed data from `test-seed.md` must be present.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `src/constants/server-instructions.ts` or this file. **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `src/filtering/tool-filter.ts`) so future agents succeed automatically.**
2. Use `code-map.md` as a source of truth and ensure fixes comply with the `mcp-builder` skill.
3. **Local Verification**: If you or a subagent modifies the codebase, you MUST run the full validation pipeline (`pnpm run check`) locally and fix any issues BEFORE committing. Pay strict attention to ESLint and TypeScript compiler outputs. You MUST fix all validation issues prior to committing. Do NOT ignore warnings or errors. Follow strict TypeScript guidelines: NEVER use `any` (use `unknown` with type guards), avoid unsafe typecasts, and ensure explicit return types.
4. **Commit**: Immediately commit passing changes using the `bun ./.agents/scripts/commit.ts --msg "type(scope): message" --impact <0.1-1.0> --confidence <0.1-1.0> --validation passed --journal --add <path>` utility. Do NOT use raw `git commit`. DO NOT stop to ask the USER to verify—you must run `pnpm run check` yourself, you are autonomous.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.
---

## 1. Zod Boundary & Type Mismatch Matrix

> ⚠️ **IDE Validation Note**: The Antigravity IDE (Cortex) strictly validates `call_mcp_tool` arguments against the JSON schema _before_ sending the request. You cannot test intentional Zod Type Mismatches (e.g., `content: 123`) using direct MCP calls, as the IDE will block it locally with a `-32602` error. For type mismatches, rely on the E2E test suite (`npm run test:e2e`) to verify the server's interceptor correctly handles malformed requests from raw clients.

For every tool, you must explicitly confirm that Domain Errors return a structured `{success: false}` json object, and **NEVER** surface as raw MCP `-32602` error frames.

| Tool                   | Happy Path          | Domain Error Test              | Zod Empty Param (`{}`)            | Zod Type Mismatch             |
| ---------------------- | ------------------- | ------------------------------ | --------------------------------- | ----------------------------- |
| `create_entry`         | Create normal entry | `entry_type: "invalid"`        | ⚠️ Should return validation error | `content: 123`                |
| `get_entry_by_id`      | Fetch existing      | `entry_id: 999999` (not found) | ⚠️ Should return validation error | `entry_id: "abc"`             |
| `get_recent_entries`   | Fetch recent        | N/A                            | Should succeed (defaults)         | `limit: "abc"`                |
| `get_entry_history`    | Fetch history       | `entry_id: 999999` (not found) | ⚠️ Should return validation error | `entry_id: "abc"`             |
| `list_tags`            | Fetch tags          | N/A                            | Should succeed (defaults)         | `project_number: "abc"`       |
| `test_simple`          | Run test simple     | N/A                            | Should succeed (defaults)         | N/A                           |
| `trigger_progress`     | Trigger progress    | N/A                            | Should succeed (defaults)         | N/A                           |
| `test_error_handling`  | Test errors         | `error_type: "invalid"`        | ⚠️ Should return validation error | `error_type: 123`             |
| `mark_anchors_stale`   | Mark stale          | N/A                            | Should succeed (defaults)         | `project_number: "abc"`       |

### Specific Domain Checks

- **`create_entry`**: Verify `significance_type: "invalid"` returns a structured error.
- **`get_entry_by_id`**: Verify soft-deleted entries return appropriate responses.
- **Numeric Coercion**: Ensure `limit: "abc"` on `get_recent_entries` either coerces silently, defaults, or returns a structured error (but NEVER a raw `-32602`).

## 2. Integrity & Boundary Testing

| Test                | Action                                                                                                                      | Verification                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- Agent reports the Total Token Estimate in the final summary (using `_meta.tokenEstimate` from responses). The tokens tracked should only count the estimated tokens that actually entered the context window.
- Agent reports the Total Token Estimate in the final summary (using `_meta.tokenEstimate` from responses).
- All tools return structured handler errors.
- No raw MCP exceptions are thrown.
- Boundary conditions behave as specified.
