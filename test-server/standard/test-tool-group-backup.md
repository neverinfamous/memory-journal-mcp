# Test memory-journal-mcp — Backup & Export Tool Group

**Execution Strategy:** **Use direct MCP tools, NOT Code Mode or scripts!** Code Mode is preferred to scripts if absolutely necessary to supplement direct tool calls.

**Scope:** Deterministic verification of Backup/Export tools (`backup_journal`, `restore_backup`, `export_entries`, `cleanup_backups`) against the strict error handling constraints.

**Prerequisites:** Seed data from `test-seed.md` must be present (S11, S12 for cross-DB; S15–S17 for team cross-project insights). `TEAM_DB_PATH` configured. MCP server instructions auto-injected.

**Workflow after testing:**

1. Plan fixes (reference `code-map.md` + `mcp-builder` skill).
2. Implement, update `UNRELEASED.md`, commit without push.
3. **USER** verifies: `npm run lint && npm run typecheck`, `npm run test`, `npm run test:e2e`.
4. Re-test fixes with direct MCP calls.
5. Brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total tokens used by this test pass.

---

## 1. Structured Error Matrix

| Tool              | Domain Error Test                           | Zod Empty Param (`{}`)       | Zod Type Mismatch   |
| ----------------- | ------------------------------------------- | ---------------------------- | ------------------- |
| `restore_backup`  | `filename: "nonexistent.db"`                | ⚠️ Validation error required | N/A                 |
| `backup_journal`  | `name: "../../etc/passwd"` (Path traversal) | ⚠️ Validation error required | N/A                 |
| `export_entries`  | N/A                                         | N/A                          | `limit: "abc"`      |
| `cleanup_backups` | N/A                                         | N/A                          | `keep_count: "abc"` |

### Specific Domain Checks

- **Silent Filter Bug check**: `export_entries(format: "json", tags: ["xyz"], limit: 100)`. If output lacks filter enforcement (returns completely unfiltered rows), mark as ⚠️.
- **Date Ignorance Bug**: `export_entries(start_date: "2099-01-01")`. Should return 0 results. If results exist, handler is ignoring filters.
- **Cleanup Count Limitation**: `cleanup_backups(keep_count: 0)`. Verify structural error block due to Zod min limit (should be min 1).

## Success Criteria

- [ ] Agent reports the Total Token Estimate in the final summary (using `_meta.tokenEstimate` from responses).
- [ ] Restricting malicious or absent file paths in Backup tools.
- [ ] Filter boundaries strictly enforced without silent omissions.
