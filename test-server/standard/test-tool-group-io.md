# Re-Test memory-journal-mcp — IO Tool Group

**Scope:** Deterministic verification of the IO tool group (`export_entries`, `export_markdown`, `import_markdown`, `import_external`) against the strict error handling matrix.

**Prerequisites:**

- **CRITICAL:** You MUST pass `use_test_db: true` as a top-level parameter in ALL MCP tool calls.
- **Validation:** Ensure the test agent validates strict mode and boundary limits on newly hardened schemas.
> **Note**: When updating schemas or validation logic, please refer to the `/zod` skill for best practices on Standard Schema and Safe Parsing.
- **Required Tool Groups:** `codemode`, `io`
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

| Tool                   | Happy Path         | Domain Error Test                                                       | Zod Empty Param (`{}`)            | Zod Type Mismatch             |
| ---------------------- | ------------------ | ----------------------------------------------------------------------- | --------------------------------- | ----------------------------- |
| `export_entries`       | Export valid       | N/A                                                                     | Should succeed (defaults)         | `limit: "abc"`                |
| `export_markdown`      | Export valid dir   | `output_dir: "../../etc"` (Path traversal)                              | ⚠️ Should return validation error | `limit: "abc"`                |
| `import_markdown`      | Import valid dir   | `source_dir: "../../etc"` (Path traversal)                              | ⚠️ Should return validation error | `dry_run: "abc"`              |
| `import_external`      | Import valid dir   | `source_dir: "../../etc"` (Path traversal)                              | ⚠️ Should return validation error | `source_format: 123`          |

### Specific Domain Checks

- **Silent Filter Bug check**: `export_entries(format: "json", tags: ["xyz"], limit: 100)`. If output lacks filter enforcement (returns completely unfiltered rows), mark as ⚠️.
- **Date Ignorance Bug**: `export_entries(start_date: "2099-01-01")`. Should return 0 results. If results exist, handler is ignoring filters.
- **Path Traversal Defense**: Ensure `export_markdown`, `import_markdown`, and `import_external` correctly reject paths containing `..` or paths outside `ALLOWED_IO_ROOTS`.

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- Agent reports the Total Token Estimate in the final summary (using `_meta.tokenEstimate` from responses). The tokens tracked should only count the estimated tokens that actually entered the context window.
- Path traversal correctly triggers Domain/Validation errors.
- Export filters correctly applied.
- Zod bounds correctly enforced.
