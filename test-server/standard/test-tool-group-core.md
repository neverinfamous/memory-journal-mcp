# Test memory-journal-mcp — Core Tool Group

**Scope:** Deterministic verification of the Core tool group (`create_entry`, `create_entry_minimal`, `get_entry_by_id`, `get_recent_entries`, `get_statistics`) against the strict error handling matrix.

**Execution Strategy:** The agent is to use direct MCP tools whenever possible rather than Code Mode or scripts. Code Mode is preferred to scripts.

**Prerequisites:** 
- Seed data from `test-seed.md` must be active.
- Server running via Code Mode or direct MCP client.

## 1. Structured Error Matrix

For every tool, you must explicitly confirm that Zod validation errors and Domain Errors return a structured `{success: false}` json object, and **NEVER** surface as raw MCP `-32602` error frames.

| Tool | Happy Path | Domain Error Test | Zod Empty Param (`{}`) | Zod Type Mismatch |
|---|---|---|---|---|
| `create_entry` | Create normal entry | `entry_type: "invalid"` | ⚠️ Should return validation error | `content: 123` |
| `create_entry_minimal` | Create with string | N/A | ⚠️ Should return validation error | N/A (requires 1 string param) |
| `get_entry_by_id` | Fetch existing | `entry_id: 999999` (not found) | ⚠️ Should return validation error | `entry_id: "abc"` |
| `get_recent_entries` | Fetch recent | N/A | Should succeed (defaults) | `limit: "abc"` |
| `get_statistics` | Fetch stats | N/A | Should succeed (defaults) | `start_date: 123` |

### Specific Domain Checks

- **`create_entry`**: Verify `significance_type: "invalid"` returns a structured error.
- **`get_entry_by_id`**: Verify soft-deleted entries return appropriate responses.
- **Numeric Coercion**: Ensure `limit: "abc"` on `get_recent_entries` either coerces silently, defaults, or returns a structured error (but NEVER a raw `-32602`).

## 2. Integrity & Boundary Testing

| Test | Action | Verification |
|---|---|---|
| Round-Trip | `create_entry(content: "RT test", entry_type: "planning")` then `get_entry_by_id(id)` | All fields persist correctly. |
| Boundary Max Length | `create_entry(content: <50k chars>)` | Entry created successfully. |
| Boundary Empty | `create_entry(content: "")` | Structured validation error. |
| Maximum Limit | `get_recent_entries(limit: 500)` | Returns 500 or fewer entries. |
| Limit Exceeded | `get_recent_entries(limit: 501)` | Structured validation error. |
| Filter Ignored Bug | `get_statistics(start_date: "2099-01-01", end_date: "2099-12-31")` | ⚠️ SHOULD return 0. If returns all, handler is ignoring filters. |

## Success Criteria
- [ ] Agent reports the Total Token Estimate in the final summary (using `_meta.tokenEstimate` from responses).
- [ ] All tools return structured handler errors.
- [ ] No raw MCP exceptions are thrown.
- [ ] Boundary conditions behave as specified.
