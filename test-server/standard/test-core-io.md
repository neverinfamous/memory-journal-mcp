# Test memory-journal-mcp — IO & Markdown Interoperability

**Scope:** Exporting entries, Markdown filesystem roundtripping (import/export), and path validation.

**Execution Strategy:** **Use direct MCP tools, NOT Code Mode or scripts!** Code Mode is preferred to scripts if absolutely necessary to supplement direct tool calls.

**Prerequisites:** Seed data from `test-seed.md` must be present. MCP server instructions auto-injected.

**Workflow after testing:**

1. Plan fixes (reference `code-map.md` + `mcp-builder` skill).
2. Implement, update `UNRELEASED.md`, commit without push.
3. **USER** verifies: `npm run lint && npm run typecheck`, `npm run test`, `npm run test:e2e`.
4. Re-test fixes with **direct MCP calls**, not codemode.
5. Brief final summary.
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

- [] `export_markdown` reliably targets OS local directories and generates correctly named files.
- [] `import_markdown` gracefully executes dry run detection parsing.
- [] IO tooling throws structured path traversal errors `..` on local directory injections.
