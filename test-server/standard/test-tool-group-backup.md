# Test memory-journal-mcp — Backup & Export Tool Group

**Scope:** Deterministic verification of Backup/Export tools (`backup_journal`, `restore_backup`, `export_entries`, `cleanup_backups`) against the strict error handling constraints.

## 1. Structured Error Matrix

| Tool | Domain Error Test | Zod Empty Param (`{}`) | Zod Type Mismatch |
|---|---|---|---|
| `restore_backup` | `filename: "nonexistent.db"` | ⚠️ Validation error required | N/A |
| `backup_journal` | `name: "../../etc/passwd"` (Path traversal) | ⚠️ Validation error required | N/A |
| `export_entries` | N/A | N/A | `limit: "abc"` |
| `cleanup_backups` | N/A | N/A | `keep_count: "abc"` |

### Specific Domain Checks

- **Silent Filter Bug check**: `export_entries(format: "json", tags: ["xyz"], limit: 100)`. If output lacks filter enforcement (returns completely unfiltered rows), mark as ⚠️.
- **Date Ignorance Bug**: `export_entries(start_date: "2099-01-01")`. Should return 0 results. If results exist, handler is ignoring filters.
- **Cleanup Count Limitation**: `cleanup_backups(keep_count: 0)`. Verify structural error block due to Zod min limit (should be min 1).

## Success Criteria
- [ ] Agent reports the Total Token Estimate in the final summary (using `_meta.tokenEstimate` from responses).
- [ ] Restricting malicious or absent file paths in Backup tools.
- [ ] Filter boundaries strictly enforced without silent omissions.
