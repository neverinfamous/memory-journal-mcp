# Re-Test memory-journal-mcp — IO & Markdown Interoperability

**Scope:** Exporting entries, Markdown filesystem roundtripping (import/export), and path validation.

**Prerequisites:**

- Confirm MCP server instructions were auto-received before starting.
- **Use direct MCP tools whenever possible.** Code Mode is preferred to scripts if absolutely necessary to supplement direct tool calls.
- Seed data from `test-seed.md` must be present. MCP server instructions auto-injected.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `server-instructions.md`/`server-instructions.ts` or this file.
2. Use `code-map.md` as a source of truth and ensure fixes comply with `C:\Users\chris\Desktop\adamic\skills\mcp-builder`.
3. If you made code changes/fixes, update `UNRELEASED.md` and commit without pushing. If tests pass cleanly, do NOT update `UNRELEASED.md`. Then, stop so the **USER** can verify with `npm run lint && npm run typecheck`, `npm run test`, and `npm run test:e2e`.
4. After user completes verification, re-test fixes with direct MCP calls.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.

---

## Phase: IO Tools

### 1. Legacy Export (`export_entries`)

| Test            | Command/Action                                                         | Expected Result                               |
| --------------- | ---------------------------------------------------------------------- | --------------------------------------------- |
| Export JSON     | `export_entries(format: "json", limit: 5)`                             | JSON export with `entries` array              |
| Export markdown | `export_entries(format: "markdown", limit: 5)`                         | Markdown export with `content` string         |
| Export with tag | `export_entries(format: "json", tags: ["architecture"], limit: 10)`    | Only entries with "architecture" tag returned |
| Export future   | `export_entries(format: "json", start_date: "2099-01-01", limit: 100)` | Returns 0 entries (date filter enforced)      |

### 2. Markdown File Orchestration (`export_markdown` & `import_markdown`)

| Test                   | Command/Action                                                                                                             | Expected Result                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Setup temp dir         | Use run_command or write_to_file to ensure a temp test folder exists (`test_export`)                                       | Temporary directory is ready           |
| Basic Export Map       | `export_markdown(output_dir: "C:\Users\chris\Desktop\memory-journal-mcp\test-server\standard\test_export", limit: 5)`      | Outputs `exported_count` matches limit |
| View Exported Node     | `run_command` (cat/get-content) on one of the exported files in `test_export`                                              | Validates YAML frontmatter generated   |
| Import Dry Run         | `import_markdown(source_dir: "C:\Users\chris\Desktop\memory-journal-mcp\test-server\standard\test_export", dry_run: true)` | Returns structured count of items      |
| Path Traversal Defense | `export_markdown(output_dir: "../../etc/passwd")`                                                                          | Structured error rejecting `..` paths  |

---

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- `export_markdown` reliably targets OS local directories and generates correctly named files.
- `import_markdown` gracefully executes dry run detection parsing.
- IO tooling throws structured path traversal errors `..` on local directory injections.
