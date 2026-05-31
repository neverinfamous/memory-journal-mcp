# Re-Test memory-journal-mcp — IO & Markdown Interoperability

**Scope:** Exporting entries, Markdown filesystem roundtripping (import/export), and path validation.

**Prerequisites:**

- Confirm MCP server instructions were auto-received before starting.
- **Use direct MCP tools exclusively.** Do NOT use Code Mode (`mj_execute_code`) for these tests. Code Mode tests are handled separately in the `codemode` track. If you must use a script to supplement a test, use a standard Node/shell script.
- Seed data from `test-seed.md` must be present. MCP server instructions auto-injected.
- Ensure `ALLOWED_IO_ROOTS` is configured in the environment to permit access to the mock directory.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `constants/server-instructions.ts` or this file. **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `codemode.ts`) so future agents succeed automatically.**
2. Use `code-map.md` as a source of truth and ensure fixes comply with the `mcp-builder` skill.
3. If you made code changes/fixes, update `UNRELEASED.md` and commit without pushing. If tests pass cleanly, do NOT update `UNRELEASED.md`. Then, stop so the **USER** can verify with `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run test:e2e`.
4. After user completes verification, re-test fixes with direct MCP calls.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.
6. Clean up any testing artifacts created in `C:\Users\chris\Desktop\memory-journal-mcp\test-server\standard\test_export` by deleting the directory after testing is complete.

---

## Phase 6: IO Tools

### 1. Legacy Export (`export_entries`)

| Test            | Command/Action                                                         | Expected Result                                                       |
| --------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Export JSON     | `export_entries(format: "json", limit: 5)`                             | JSON export with `entries` array                                      |
| Export JSON Lrg | `export_entries(format: "json", limit: 5000)`                          | JSON export with `truncated: true` flag set (if 5MB payload exceeded) |
| Export markdown | `export_entries(format: "markdown", limit: 5)`                         | Markdown export with `content` string                                 |
| Export with tag | `export_entries(format: "json", tags: ["architecture"], limit: 10)`    | Only entries with "architecture" tag returned                         |
| Export future   | `export_entries(format: "json", start_date: "2099-01-01", limit: 100)` | Returns 0 entries (date filter enforced)                              |

### 2. Markdown File Orchestration (`export_markdown` & `import_markdown`)

| Test                   | Command/Action                                                                                                             | Expected Result                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Setup temp dir         | Use run_command or write_to_file to ensure a temp test folder exists (`test_export`)                                       | Temporary directory is ready           |
| Basic Export Map       | `export_markdown(output_dir: "C:\Users\chris\Desktop\memory-journal-mcp\test-server\standard\test_export", limit: 5)`      | Outputs `exported_count` matches limit |
| View Exported Node     | `run_command` (cat/get-content) on one of the exported files in `test_export`                                              | Validates JSON frontmatter generated   |
| Import Dry Run         | `import_markdown(source_dir: "C:\Users\chris\Desktop\memory-journal-mcp\test-server\standard\test_export", dry_run: true)` | Returns structured count of items      |
| Path Traversal Defense | `export_markdown(output_dir: "../../etc/passwd")`                                                                          | Structured error rejecting `..` paths  |

---

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- `export_markdown` reliably targets OS local directories and generates correctly named files.
- `import_markdown` gracefully executes dry run detection parsing.
- IO tooling throws structured path traversal errors `..` on local directory injections or when missing `ALLOWED_IO_ROOTS`.
- Large JSON exports return `truncated: true` to prevent memory exhaustion when the payload exceeds 5MB.
