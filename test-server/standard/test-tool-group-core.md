# Re-Test memory-journal-mcp — Core Tool Group

**Scope:** Deterministic verification of the Core tool group (`create_entry`, `create_entry_minimal`, `get_entry_by_id`, `get_recent_entries`, `get_statistics`) against the strict error handling matrix.

**Prerequisites:**

- Confirm MCP server instructions were auto-received before starting.
- **Use direct MCP tools exclusively.** Do NOT use Code Mode (`mj_execute_code`) for these tests. Code Mode tests are handled separately in the `codemode` track. If you must use a script to supplement a test, use a standard Node/shell script.
- Seed data from `test-seed.md` must be present (S11, S12 for cross-DB; S15–S17 for team cross-project insights). `TEAM_DB_PATH` configured. MCP server instructions auto-injected.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `constants/server-instructions.ts` or this file. **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `codemode.ts`) so future agents succeed automatically.**
2. Use `code-map.md` as a source of truth and ensure fixes comply with the `mcp-builder` skill.
3. If you made code changes/fixes, update `UNRELEASED.md` and commit without pushing. If tests pass cleanly, do NOT update `UNRELEASED.md`. Then, stop so the **USER** can verify with `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run test:e2e`.
4. After user completes verification, re-test fixes with direct MCP calls.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.
6. **Cleanup:** Delete any flags, test artifacts, or test entries created in the journal during this test pass to maintain a clean database state.

---

## 1. Zod Boundary & Type Mismatch Matrix

> ⚠️ **IDE Validation Note**: The Antigravity IDE (Cortex) strictly validates `call_mcp_tool` arguments against the JSON schema _before_ sending the request. You cannot test intentional Zod Type Mismatches (e.g., `content: 123`) using direct MCP calls, as the IDE will block it locally with a `-32602` error. For type mismatches, rely on the E2E test suite (`npm run test:e2e`) to verify the server's interceptor correctly handles malformed requests from raw clients.

For every tool, you must explicitly confirm that Domain Errors return a structured `{success: false}` json object, and **NEVER** surface as raw MCP `-32602` error frames.

| Tool                   | Happy Path          | Domain Error Test              | Zod Empty Param (`{}`)            | Zod Type Mismatch             |
| ---------------------- | ------------------- | ------------------------------ | --------------------------------- | ----------------------------- |
| `create_entry`         | Create normal entry | `entry_type: "invalid"`        | ⚠️ Should return validation error | `content: 123`                |
| `create_entry_minimal` | Create with string  | N/A                            | ⚠️ Should return validation error | N/A (requires 1 string param) |
| `get_entry_by_id`      | Fetch existing      | `entry_id: 999999` (not found) | ⚠️ Should return validation error | `entry_id: "abc"`             |
| `get_recent_entries`   | Fetch recent        | N/A                            | Should succeed (defaults)         | `limit: "abc"`                |
| `get_statistics`       | Fetch stats         | N/A                            | Should succeed (defaults)         | `start_date: 123`             |

### Specific Domain Checks

- **`create_entry`**: Verify `significance_type: "invalid"` returns a structured error.
- **`get_entry_by_id`**: Verify soft-deleted entries return appropriate responses.
- **Numeric Coercion**: Ensure `limit: "abc"` on `get_recent_entries` either coerces silently, defaults, or returns a structured error (but NEVER a raw `-32602`).

## 2. Integrity & Boundary Testing

| Test                | Action                                                                                                                      | Verification                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Round-Trip          | `create_entry(project_number: 5, content: "RT test", entry_type: "planning")` then `get_entry_by_id(project_number: 5, id)` | All fields persist correctly.                                    |
| Boundary Max Length | `node test-server/scripts/test-50k-boundary.mjs`                                                                            | Entry created successfully.                                      |
| Boundary Empty      | `create_entry(project_number: 5, content: "")`                                                                              | Structured validation error.                                     |
| Maximum Limit       | `get_recent_entries(project_number: 5, limit: 500)`                                                                         | Returns 500 or fewer entries.                                    |
| Limit Exceeded      | `get_recent_entries(project_number: 5, limit: 501)`                                                                         | Structured validation error.                                     |
| Filter Ignored Bug  | `get_statistics(start_date: "2099-01-01", end_date: "2099-12-31")`                                                          | ⚠️ SHOULD return 0. If returns all, handler is ignoring filters. |

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- Agent reports the Total Token Estimate in the final summary (using `_meta.tokenEstimate` from responses).
- All tools return structured handler errors.
- No raw MCP exceptions are thrown.
- Boundary conditions behave as specified.
