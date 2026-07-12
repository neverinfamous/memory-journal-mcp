# Re-Test memory-journal-mcp — Relationships Tool Group

**Scope:** Deterministic verification of the Relationships tool group (`link_entries`, `visualize_relationships`) against the strict error handling matrix.

**Prerequisites:**

- **CRITICAL:** You MUST pass `use_test_db: true` as a top-level parameter in ALL MCP tool calls (including `mj_execute_code`) to ensure tests hit the test database instead of production.
- **Validation:** Ensure the test agent validates strict mode and boundary limits on newly hardened schemas (e.g., Team Tools, Admin Tools).
> **Note**: When updating schemas or validation logic, please refer to the `/zod` skill for best practices on Standard Schema and Safe Parsing.
- **Required Tool Groups:** `admin`, `codemode`, `core`, `github`
- Confirm MCP server instructions were auto-received before starting.
- **Use direct MCP tools exclusively.** Do NOT use Code Mode (`mj_execute_code`) for these tests. Code Mode tests are handled separately in the `codemode` track. If you must use a script to supplement a test, use a standard Node/shell script.
- Seed data from `test-seed.md` must be present. MCP server instructions auto-injected.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `constants/server-instructions.ts` or this file. **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `codemode.ts`) so future agents succeed automatically.**
2. Use `code-map.md` as a source of truth and ensure fixes comply with the `mcp-builder` skill.
3. If you made code changes/fixes, update `UNRELEASED.md` and commit without pushing. If tests pass cleanly, do NOT update `UNRELEASED.md`. Then, stop so the **USER** can verify with `pnpm run check`.
4. After user completes verification, re-test fixes with direct MCP calls.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.
---

## 1. Zod Boundary & Type Mismatch Matrix

| Tool                      | Happy Path         | Domain Error Test                                                       | Zod Empty Param (`{}`)            | Zod Type Mismatch             |
| ------------------------- | ------------------ | ----------------------------------------------------------------------- | --------------------------------- | ----------------------------- |
| `link_entries`            | Link valid entries | `from_entry_id: 999999` (not found)                                     | ⚠️ Should return validation error | `from_entry_id: "abc"`        |
| `visualize_relationships` | Visualize entry    | `entry_id: 999999` (not found)                                          | Should succeed (defaults)         | `entry_id: "abc"`             |

### Specific Domain Checks

- **Duplicate Links**: Ensure calling `link_entries` with exactly the same parameters twice correctly returns `duplicate: true`.
- **Visualize Tags**: Ensure `visualize_relationships` gracefully handles valid queries using tags instead of entry IDs.

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- Agent reports the Total Token Estimate in the final summary (using `_meta.tokenEstimate` from responses). The tokens tracked should only count the estimated tokens that actually entered the context window.
- Unknown entries gracefully rejected without raw `-32602` crashes.
- Duplicate detection triggers reliably.
