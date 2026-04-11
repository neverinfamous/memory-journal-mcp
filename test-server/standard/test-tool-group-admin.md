# Re-Test memory-journal-mcp — Admin Tool Group

**Execution Strategy:** **Use direct MCP tools, NOT Code Mode or scripts!** Code Mode is preferred to scripts if absolutely necessary to supplement direct tool calls.

**Scope:** Deterministic verification of Admin operations (`update_entry`, `delete_entry`, `merge_tags`, `list_tags`, `add_to_vector_index`, `rebuild_vector_index`) against strict error handling constraints.

**Prerequisites:** Seed data from `test-seed.md` must be present (S11, S12 for cross-DB; S15–S17 for team cross-project insights). `TEAM_DB_PATH` configured. MCP server instructions auto-injected.

**Workflow after testing:**

1. Plan fixes (reference `code-map.md` + `mcp-builder` skill).
2. Implement, update `UNRELEASED.md`, commit without push.
3. Then, stop so the **USER** can verify with `npm run lint && npm run typecheck`, `npm run test`, and `npm run test:e2e`.
4. Re-test fixes with direct MCP calls.
5. Brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.

---

## 1. Structured Error Matrix

| Tool                  | Happy Path       | Domain Error Test                              | Zod Empty Param (`{}`)            | Zod Type Mismatch |
| --------------------- | ---------------- | ---------------------------------------------- | --------------------------------- | ----------------- |
| `update_entry`        | Valid update     | `entry_id: 999999` (not found)                 | ⚠️ Should return validation error | `entry_id: "abc"` |
| `delete_entry`        | Soft delete      | `entry_id: 999999` (not found)                 | ⚠️ Should return validation error | `entry_id: "abc"` |
| `merge_tags`          | Merge valid tags | `source_tag: "nonexistent", target_tag: "abc"` | ⚠️ Should return validation error | `source_tag: 123` |
| `add_to_vector_index` | Add valid        | `entry_id: 999999`                             | ⚠️ Should return validation error | `entry_id: "abc"` |

### Specific Domain Checks

- **Same-Tag Merging**: Ensure `merge_tags` where `source_tag` == `target_tag` returns a structured error.
- **Unavailable Vector**: Triggering `add_to_vector_index` without an initialized vector db should gracefully reject with `{success: false}`.

## 2. Integrity & Boundary Testing

| Test                  | Action         | Verification                                                            |
| --------------------- | -------------- | ----------------------------------------------------------------------- |
| Merge Integrity       | `merge_tags`   | Ensure source tag is deleted and target tag count equals original sums. |
| Soft Delete Integrity | `delete_entry` | Entry hidden from standard views.                                       |

## Success Criteria

- [ ] Agent reports the Total Token Estimate in the final summary (using `_meta.tokenEstimate` from responses).
- [ ] Administrative mutations correctly block non-existent targets.
- [ ] Vector integrations fallback safely without MCP crashes.
