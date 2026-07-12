
# Re-Test memory-journal-mcp — Team IO & Export

**Scope:** Team administration, analytics, relationships, vector search, backup, and IO operations.

**Prerequisites:**

- **CRITICAL:** You MUST pass `use_test_db: true` as a top-level parameter in ALL MCP tool calls to ensure tests hit the test database instead of production.
- **Validation:** Ensure the test agent validates strict mode and boundary limits on newly hardened schemas.
> **Note**: When updating schemas or validation logic, please refer to the `/zod` skill for best practices on Standard Schema and Safe Parsing.
- Confirm MCP server instructions were auto-received before starting.
- **Use direct MCP tools exclusively.** Do NOT use Code Mode (`mj_execute_code`) for these tests. Code Mode tests are handled separately in the `codemode` track. If you must use a script to supplement a test, use a standard Node/shell script.
- Seed data from `test-seed.md` must be present. MCP server instructions auto-injected.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `constants/server-instructions.ts` or this file. **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `codemode.ts`) so future agents succeed automatically.**
2. Use `code-map.md` as a source of truth and ensure fixes comply with the `mcp-builder` skill.
3. **Local Verification**: If you or a subagent modifies the codebase, you MUST run the full validation pipeline (`pnpm run check`) locally and fix any issues BEFORE committing.
4. **Commit**: Immediately commit passing changes using the `bun .\.agents\scripts\commit.ts` utility. Do NOT use raw `git commit`. DO NOT stop to ask the USER to verify with `pnpm run check` yourself—you are autonomous.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.
---


### 14.12 Team IO & Export

| Test               | Command/Action                                                                      | Expected Result                           |
| ------------------ | ----------------------------------------------------------------------------------- | ----------------------------------------- |
| Export JSON        | `team_export_entries(project_number: 5, format: "json", limit: 5)`                  | `format: "json"`, `data` string, `count`  |
| Export markdown    | `team_export_entries(project_number: 5, format: "markdown", limit: 5)`              | `format: "markdown"`, `data` string       |
| IO Export markdown | `team_export_markdown(project_number: 5, output_dir: "tmp_team_md", limit: 5)`      | Generates local `.md` files in target dir |
| IO Import external | `team_import_external(project_number: 5, markdown_content: "...", dry_run: true)` | Parses external wiki format |
| IO Import dry run  | `team_import_markdown(project_number: 5, source_dir: "tmp_team_md", dry_run: true)` | Returns mock counts, resolves `author`    |

---

