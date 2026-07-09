# Re-Test memory-journal-mcp — Admin Tool Group

**Scope:** Deterministic verification of Admin operations (`update_entry`, `delete_entry`, `restore_entry`, `batch_create_entries`, `batch_update_entries`, `batch_delete_entries`, `rebuild_vector_index`, `add_to_vector_index`, `merge_tags`, `search_audit_log`, `run_auto_prune`, `update_configuration`) against strict error handling constraints.

**Prerequisites:**

- **CRITICAL:** You MUST pass `use_test_db: true` as a top-level parameter in ALL MCP tool calls (including `mj_execute_code`) to ensure tests hit the test database instead of production.
- **Validation:** Ensure the test agent validates strict mode and boundary limits on newly hardened schemas (e.g., Team Tools, Admin Tools).
> **Note**: When updating schemas or validation logic, please refer to the `/zod` skill for best practices on Standard Schema and Safe Parsing.
- **Required Tool Groups:** `admin`, `codemode`, `core`
- Confirm MCP server instructions were auto-received before starting.
- **Use direct MCP tools exclusively.** Do NOT use Code Mode (`mj_execute_code`) for these tests. Code Mode tests are handled separately in the `codemode` track. If you must use a script to supplement a test, use a standard Node/shell script.
- Seed data from `test-seed.md` must be present (S11, S12 for cross-DB; S15–S17 for team cross-project insights). `TEAM_DB_PATH` configured. MCP server instructions auto-injected.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `constants/server-instructions.ts` or this file. **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `codemode.ts`) so future agents succeed automatically.**
2. Use `code-map.md` as a source of truth and ensure fixes comply with the `mcp-builder` skill.
3. If you made code changes/fixes, update `UNRELEASED.md` and commit without pushing. If tests pass cleanly, do NOT update `UNRELEASED.md`. Then, stop so the **USER** can verify with `pnpm run check`.
4. After user completes verification, re-test fixes with direct MCP calls.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.

---

## 1. Zod Boundary & Type Mismatch Matrix

| Tool                  | Happy Path       | Domain Error Test                              | Zod Empty Param (`{}`)            | Zod Type Mismatch |
| --------------------- | ---------------- | ---------------------------------------------- | --------------------------------- | ----------------- |
| `update_entry`        | Valid update     | `entry_id: 999999` (not found)                 | ⚠️ Should return validation error | `entry_id: "abc"` |
| `delete_entry`        | Soft delete      | `entry_id: 999999` (not found)                 | ⚠️ Should return validation error | `entry_id: "abc"` |
| `restore_entry`       | Restore entry    | `entry_id: 999999` (not found)                 | ⚠️ Should return validation error | `entry_id: "abc"` |
| `merge_tags`          | Merge valid tags | `source_tag: "nonexistent", target_tag: "abc"` | ⚠️ Should return validation error | `source_tag: 123` |
| `add_to_vector_index` | Add valid        | `entry_id: 999999`                             | ⚠️ Should return validation error | `entry_id: "abc"` |
| `batch_create_entries`| Valid batch      | `entries: []`                                  | ⚠️ Should return validation error | `entries: "abc"`  |
| `batch_update_entries`| Valid updates    | `updates: []`                                  | ⚠️ Should return validation error | `updates: "abc"`  |
| `batch_delete_entries`| Valid deletes    | `entry_ids: []`                                | ⚠️ Should return validation error | `entry_ids: "abc"`|
| `search_audit_log`    | Valid search     | `limit: -1`                                    | ⚠️ Should return validation error | `limit: "abc"`    |
| `rebuild_vector_index`| Rebuild index    | N/A                                            | Should succeed (defaults)         | N/A               |
| `run_auto_prune`      | Prune entries    | N/A                                            | Should succeed (defaults)         | `project_number: "abc"` |
| `update_configuration`| Update config    | `instruction_level: "invalid"`                 | Should succeed (defaults)         | `briefing_entries: "abc"` |

> **Note:** `registerProject` is an Admin method but is intentionally exposed exclusively via Code Mode API (`mj.admin.registerProject`) to ensure secure file-system validation. It is not tested here via direct MCP calls; it is covered in the `codemode` test track.

### Specific Domain Checks

- **Same-Tag Merging**: Ensure `merge_tags` where `source_tag` == `target_tag` returns a structured error.
- **Unavailable Vector**: Triggering `add_to_vector_index` without an initialized vector db should gracefully reject with `{success: false}`.

## 2. Integrity & Boundary Testing

| Test                  | Action         | Verification                                                            |
| --------------------- | -------------- | ----------------------------------------------------------------------- |
| Merge Integrity       | `merge_tags`   | Ensure source tag is deleted and target tag count equals original sums. |
| Soft Delete Integrity | `delete_entry` | Entry hidden from standard views.                                       |

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- Agent reports the Total Token Estimate in the final summary (using `_meta.tokenEstimate` from responses). The tokens tracked should only count the estimated tokens that actually entered the context window.
- Agent reports the Total Token Estimate in the final summary (using `_meta.tokenEstimate` from responses).
- Administrative mutations correctly block non-existent targets.
- Vector integrations fallback safely without MCP crashes.
