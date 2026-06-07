# Re-Test memory-journal-mcp — Admin & Backup

**Scope:** Tag management, entry export, and backup/restore operations.

**Prerequisites:**

- Confirm MCP server instructions were auto-received before starting.
- **Use direct MCP tools exclusively.** Do NOT use Code Mode (`mj_execute_code`) for these tests. Code Mode tests are handled separately in the `codemode` track. If you must use a script to supplement a test, use a standard Node/shell script.
- Seed data from `test-seed.md` must be present. MCP server instructions auto-injected.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `constants/server-instructions.ts` or this file. **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `codemode.ts`) so future agents succeed automatically.**
2. Use `code-map.md` as a source of truth and ensure fixes comply with the `mcp-builder` skill.
3. If you made code changes/fixes, update `UNRELEASED.md` and commit without pushing. If tests pass cleanly, do NOT update `UNRELEASED.md`. Then, stop so the **USER** can verify with `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run test:e2e`.
4. After user completes verification, re-test fixes with direct MCP calls.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.

---

## Phase 7: Admin & Backup Tools

### 5.1 Tags

| Test              | Command/Action                                                                   | Expected Result                                                             |
| ----------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| List tags         | `list_tags`                                                                      | Returns all tags with counts                                                |
| Create source tag | `create_entry(project_number: 5, content: "Test tag merge", tags: ["test-old"])` | Creates "test-old" tag (pre-req)                                            |
| Merge tags        | `merge_tags(source_tag: "test-old", target_tag: "test-new")`                     | Merges source into target, deletes source                                   |
| Verify merge      | `list_tags` + `search_entries(project_number: 5, query: "Test tag merge")`       | "test-old" gone, "test-new" exists, entry now has "test-new" tag            |
| Merge same tag    | `merge_tags(source_tag: "test-new", target_tag: "test-new")`                     | Structured error: `{ success: false, error: "..." }` (source equals target) |
| Merge nonexistent | `merge_tags(source_tag: "nonexistent-xyz", target_tag: "x")`                     | Structured error: `{ success: false, error: "Source tag not found: ..." }`  |

> [!NOTE]
> If `restore_backup` is tested after `merge_tags`, the restored backup will revert the merge. This is expected behavior. Verify merge worked immediately after calling `merge_tags`, before any backup restoration.

### 5.2 Backup & Restore

| Test                  | Command/Action                                              | Expected Result                                                                  |
| --------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Create backup         | `backup_journal(name: "test-backup")`                       | Backup file created with `success`, `filename`, `path`, `sizeBytes`              |
| Auto-named backup     | `backup_journal`                                            | Backup created with auto-generated timestamped name                              |
| List backups          | `list_backups`                                              | Shows backup files with metadata including `path` field                          |
| Cleanup backups       | `cleanup_backups(keep_count: 5)`                            | Deletes old backups, keeps N most recent                                         |
| Backup path traversal | `backup_journal(name: "../../etc/passwd")`                  | Structured error: `{ success: false, error: "..." }` with path traversal message |
| Restore backup        | `restore_backup(filename: "test-backup.db", confirm: true)` | Restores + `revertedChanges` field with details                                  |
| Restore nonexistent   | `restore_backup(filename: "nonexistent.db", confirm: true)` | Structured error: `{ success: false, error: "Backup file not found: ..." }`      |

### 5.3 Batch Operations

| Test                  | Command/Action                                              | Expected Result                                                                  |
| --------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Batch Create          | `batch_create_entries(entries: [{ project_number: 5, content: "B1" }, { project_number: 5, content: "B2" }])` | Array of two entry IDs returned |
| Batch Create Limit    | `batch_create_entries(entries: [51 items])`                 | Structured error: `{ success: false, error: "..." }` exceeding 50 limit          |
| Batch Update          | `batch_update_entries(updates: [{ entry_id: <id1>, content: "U1" }, { entry_id: <id2>, content: "U2" }])` | `success: true` and array of IDs       |
| Batch Delete          | `batch_delete_entries(entry_ids: [<id1>, <id2>])`           | `success: true` and count of deleted entries                                     |

### 5.4 Audit Telemetry

| Test                  | Command/Action                                              | Expected Result                                                                  |
| --------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Search audit by tool  | `search_audit_log(tool_name: "batch_create_entries", limit: 5)` | Returns array of recent matching audit entries for that tool                     |
| Search audit by user  | `search_audit_log(user: "system")`                          | Returns audit logs filtered by user identity (if applicable)                     |
| Search with limits    | `search_audit_log(limit: 1)`                                | Returns exactly 1 recent log entry                                               |

---

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- `merge_tags` consolidates duplicate tags correctly — verified via `list_tags` and entry re-check
- `merge_tags` returns structured error when source equals target or source tag nonexistent
- `backup_journal` rejects names containing path traversal characters (`../`) with structured errors
- `restore_backup` with nonexistent filename returns structured error
- `batch_create_entries` enforces max 50 limit with structured error
- `batch_delete_entries` soft-deletes multiple entries atomically
- `search_audit_log` successfully returns filtered audit logs
