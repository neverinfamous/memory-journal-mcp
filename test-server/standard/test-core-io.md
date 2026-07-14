# Re-Test memory-journal-mcp — IO & Markdown Interoperability

**Scope:** Exporting entries, Markdown filesystem roundtripping (import/export), and path validation.

**Prerequisites:**

- **Validation:** Ensure the test agent validates strict mode and boundary limits on newly hardened schemas.
> **Note**: When updating schemas or validation logic, please refer to the `/zod` skill for best practices on Standard Schema and Safe Parsing.
- Confirm MCP server instructions were auto-received before starting.
- **Use direct MCP tools exclusively.** Do NOT use Code Mode (`mj_execute_code`) for these tests. Code Mode tests are handled separately in the `codemode` track. If you must use a script to supplement a test, use a standard Node/shell script.
- Seed data from `test-seed.md` must be present.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `src/constants/server-instructions.ts`. **Do NOT edit this test prompt file directly.** **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `src/filtering/tool-filter.ts`) so future agents succeed automatically.**
2. Use `test-server/tool-reference.md` and `test-server/scripts/tool-map.json` as sources of truth and ensure fixes comply with the `mcp-builder` skill.
3. **Local Verification**: If you or a subagent modifies the codebase, you MUST run the linter and typechecker (`pnpm run lint` and `npx tsc --noEmit`) locally and fix any issues BEFORE committing. Pay strict attention to ESLint and TypeScript compiler outputs. You MUST fix all validation issues prior to committing. Do NOT ignore warnings or errors. Follow strict TypeScript guidelines: NEVER use `any` (use `unknown` with type guards), avoid unsafe typecasts, and ensure explicit return types.
4. **Commit**: Immediately commit passing changes using the `bun ./.agents/scripts/commit.ts --msg "type(scope): message" --impact <0.1-1.0> --confidence <0.1-1.0> --validation passed --journal --add <path>` utility. Do NOT use raw `git commit`. WARNING: Do NOT commit your code and then attempt to use `git commit --amend` to fix a lingering lint or test issue later. Amending a commit rewrites the commit SHA, which will permanently break the changelog tracking workflow. DO NOT stop to ask the USER to verify—you must run `pnpm run lint` and `npx tsc --noEmit` yourself, you are autonomous.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.
---

## Phase 6: IO Tools

### 1. Legacy Export (`export_entries`)

| Test            | Command/Action                                                         | Expected Result                                                       |
| --------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Export JSON     | `export_entries(format: "json", limit: 5)`                             | JSON export with `entries` array                                      |
| Export JSON Lrg | `export_entries(format: "json", limit: 5000)`                          | JSON export with `truncated: true` flag set (if 5MB payload exceeded) |
| Export markdown | `export_entries(format: "markdown", limit: 5)`                         | Markdown export with `content` string                                 |
| Export with tag | `export_entries(format: "json", tags: ["architecture"], limit: 10)`    | Only entries with "architecture" tag returned                         |
| Export future   | `export_entries(format: "json", fromDate: "2099-01-01", limit: 100)` | Returns 0 entries (date filter enforced)                              |

### 2. Markdown File Orchestration (`export_markdown` & `import_markdown`)

| Test                   | Command/Action                                                                                                             | Expected Result                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Setup temp dir         | Use run_command or write_to_file to ensure a temp test folder exists (`test_export`)                                       | Temporary directory is ready           |
| Basic Export Map       | `export_markdown(output_dir: "C:\Users\chris\Desktop\memory-journal-mcp\test-server\standard\test_export", limit: 5)`      | Outputs `exportedCount` matches limit |
| View Exported Node     | `run_command` (cat/get-content) on one of the exported files in `test_export`                                              | Validates JSON frontmatter generated   |
| Import Dry Run         | `import_markdown(source_dir: "C:\Users\chris\Desktop\memory-journal-mcp\test-server\standard\test_export", dry_run: true)` | Returns structured count of items      |
| Create Invalid File    | Use `write_to_file` to create `invalid.md` in `test_export` with `type: "invalid_type"` in its YAML frontmatter.     | File created successfully              |
| Import Aggregated Error| `import_markdown(source_dir: "C:\Users\chris\Desktop\memory-journal-mcp\test-server\standard\test_export", dry_run: false)`| Returns structured ErrorResponse with `code: AGGREGATE_ERROR` and an `aggregatedErrors` array of objects (containing `message` and optionally `name`) for each item failure |
| Path Traversal Defense | `export_markdown(output_dir: "../../etc/passwd")`                                                                          | Structured error rejecting `..` paths  |

### 3. External Tool Orchestration (`import_external`)

| Test                   | Command/Action                                                                                                             | Expected Result                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Import External Notion | `import_external(source_dir: "C:\Users\chris\Desktop\memory-journal-mcp\test-server\standard\test_export", source_format: "notion", dry_run: true)` | Returns structured count of items      |
| Import External Obsidian| `import_external(source_dir: "C:\Users\chris\Desktop\memory-journal-mcp\test-server\standard\test_export", source_format: "obsidian", dry_run: true)` | Returns structured count of items      |
| Import External Logseq | `import_external(source_dir: "C:\Users\chris\Desktop\memory-journal-mcp\test-server\standard\test_export", source_format: "logseq", dry_run: true)` | Returns structured count of items      |

---

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- Agent reports the Total Token Estimate in the final summary (using `_meta.tokenEstimate` from responses). The tokens tracked should only count the estimated tokens that actually entered the context window.
- `export_markdown` reliably targets OS local directories and generates correctly named files.
- `import_markdown` gracefully executes dry run detection parsing.
- `import_external` gracefully handles Notion, Obsidian, and Logseq formats parsing and dry runs.
- `import_markdown` successfully aggregates partial failures (e.g., `invalid.md`) into a structured `AGGREGATE_ERROR` response with an `aggregatedErrors` array of specific item failures (e.g., `[{ "message": "..." }]`).
- IO tooling throws structured path traversal errors `..` on local directory injections or when missing `ALLOWED_IO_ROOTS`.
- Large JSON exports return `truncated: true` to prevent memory exhaustion when the payload exceeds 5MB.
