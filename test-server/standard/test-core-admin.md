# Test memory-journal-mcp — Admin & Backup

**Scope:** Tag management, entry export, and backup/restore operations.

**Execution Strategy:** **Use direct MCP tools, NOT Code Mode or scripts!** Code Mode is preferred to scripts if absolutely necessary to supplement direct tool calls.

**Prerequisites:** Seed data from `test-seed.md` must be present. MCP server instructions auto-injected.

**Workflow after testing:**

1. Plan fixes (reference `code-map.md` + `mcp-builder` skill).
2. Implement, update `UNRELEASED.md`, commit without push.
3. **USER** verifies: `npm run lint && npm run typecheck`, `npm run test`, `npm run test:e2e`.
4. Re-test fixes with **direct MCP calls**, not codemode.
5. Brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total tokens used by this test pass.

---

## Phase 5: Admin & Backup Tools

### 5.1 Tags

| Test              | Command/Action                                                | Expected Result                                                             |
| ----------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------- |
| List tags         | `list_tags`                                                   | Returns all tags with counts                                                |
| Create source tag | `create_entry(content: "Test tag merge", tags: ["test-old"])` | Creates "test-old" tag (pre-req)                                            |
| Merge tags        | `merge_tags(source_tag: "test-old", target_tag: "test-new")`  | Merges source into target, deletes source                                   |
| Verify merge      | `list_tags` + `search_entries(query: "Test tag merge")`       | "test-old" gone, "test-new" exists, entry now has "test-new" tag            |
| Merge same tag    | `merge_tags(source_tag: "test-new", target_tag: "test-new")`  | Structured error: `{ success: false, error: "..." }` (source equals target) |
| Merge nonexistent | `merge_tags(source_tag: "nonexistent-xyz", target_tag: "x")`  | Structured error: `{ success: false, error: "Source tag not found: ..." }`  |

> [!NOTE]
> If `restore_backup` is tested after `merge_tags`, the restored backup will revert the merge. This is expected behavior. Verify merge worked immediately after calling `merge_tags`, before any backup restoration.

### 5.2 Export

| Test                    | Command/Action                                                                     | Expected Result                          |
| ----------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------- |
| Export JSON             | `export_entries(format: "json", limit: 5)`                                         | JSON export with `entries` array         |
| Export markdown         | `export_entries(format: "markdown", limit: 5)`                                     | Markdown export with `content` string    |
| Export with tags        | `export_entries(format: "json", tags: ["test"], limit: 10)`                        | Only entries with matching tags returned |
| Export with dates       | `export_entries(format: "json", start_date: "2026-01-01", end_date: "2026-03-01")` | Only entries within date range returned  |
| Export with entry_types | `export_entries(format: "json", entry_types: ["planning"], limit: 10)`             | Only entries of specified type returned  |

### 5.3 Backup & Restore

| Test                  | Command/Action                                              | Expected Result                                                                  |
| --------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Create backup         | `backup_journal(name: "test-backup")`                       | Backup file created with `success`, `filename`, `path`, `sizeBytes`              |
| Auto-named backup     | `backup_journal`                                            | Backup created with auto-generated timestamped name                              |
| List backups          | `list_backups`                                              | Shows backup files with metadata including `path` field                          |
| Cleanup backups       | `cleanup_backups(keep_count: 5)`                            | Deletes old backups, keeps N most recent                                         |
| Backup path traversal | `backup_journal(name: "../../etc/passwd")`                  | Structured error: `{ success: false, error: "..." }` with path traversal message |
| Restore backup        | `restore_backup(filename: "test-backup.db", confirm: true)` | Restores + `revertedChanges` field with details                                  |
| Restore nonexistent   | `restore_backup(filename: "nonexistent.db", confirm: true)` | Structured error: `{ success: false, error: "Backup file not found: ..." }`      |

---

## Success Criteria

- [ ] `merge_tags` consolidates duplicate tags correctly — verified via `list_tags` and entry re-check
- [ ] `merge_tags` returns structured error when source equals target or source tag nonexistent
- [ ] `backup_journal` rejects names containing path traversal characters (`../`) with structured errors
- [ ] `restore_backup` with nonexistent filename returns structured error
