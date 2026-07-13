# Re-Test memory-journal-mcp — Data Integrity & Boundary Testing (Part 2)

**Scope:** Data round-trip fidelity, boundary value behavior, Unicode handling, concurrent-like operations, and implementation bug detection.

**Prerequisites:**

- **Validation:** Ensure the test agent validates strict mode and boundary limits on newly hardened schemas.
> **Note**: When updating schemas or validation logic, please refer to the `/zod` skill for best practices on Standard Schema and Safe Parsing.
- Confirm MCP server instructions were auto-received before starting.
- **Use direct MCP tools exclusively.** Do NOT use Code Mode (`mj_execute_code`) for these tests. Code Mode tests are handled separately in the `codemode` track. If you must use a script to supplement a test, use a standard Node/shell script.
- Seed data from `test-seed.md` must be present.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `src/constants/server-instructions.ts` or this file. **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `src/filtering/tool-filter.ts`) so future agents succeed automatically.**
2. Use `code-map.md` as a source of truth and ensure fixes comply with the `mcp-builder` skill.
3. **Local Verification**: If you or a subagent modifies the codebase, you MUST run the full validation pipeline (`pnpm run check`) locally and fix any issues BEFORE committing. Pay strict attention to ESLint and TypeScript compiler outputs. You MUST fix all validation issues prior to committing. Do NOT ignore warnings or errors. Follow strict TypeScript guidelines: NEVER use `any` (use `unknown` with type guards), avoid unsafe typecasts, and ensure explicit return types.
4. **Commit**: Immediately commit passing changes using the `bun ./.agents/scripts/commit.ts --msg "type(scope): message" --impact <0.1-1.0> --confidence <0.1-1.0> --validation passed --journal --add <path>` utility. Do NOT use raw `git commit`. DO NOT stop to ask the USER to verify—you must run `pnpm run check` yourself, you are autonomous.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.
---

## Phase 12.2: Data Integrity Verification (Part 2)

### 12.2.1 Relationship Integrity

| Test                        | Command/Action                                                                                  | Expected Result                                         |
| --------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Link persists after re-read | `link_entries(from: A, to: B, type: "references")` then `get_entry_by_id(workspace_id: "test-ws", A)` | Relationships array includes the link                   |
| Duplicate link detection    | Link A→B twice with same type                                                                   | Second call returns `duplicate: true`                   |
| Reverse link allowed        | Link B→A after A→B exists                                                                       | Succeeds — reverse direction is a separate relationship |
| Link to soft-deleted entry  | Soft-delete B, then `link_entries(from: A, to: B)`                                              | Structured error — target entry not found or hidden     |
| All relationship types      | Create links with each type: `references`, `implements`, `blocked_by`, `resolved`, `caused`     | All succeed                                             |

### 12.2.2 Search Isolation After Delete

| Test                       | Command/Action                                                                 | Expected Result                                     |
| -------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------- |
| FTS5 isolation             | Create entry with unique term, delete it (soft), search for term               | Deleted entry does NOT appear in results            |
| Semantic isolation         | Create entry, add to vector index, soft-delete, then `semantic_search`         | Deleted entry does NOT appear in semantic results   |
| Date range isolation       | Create entry in known date, soft-delete, then `search_by_date_range` over date | Deleted entry does NOT appear in date range results |
| Permanent delete isolation | Create entry, permanently delete, then search                                  | Entry completely absent from all search methods     |

### 12.2.3 Filter Enforcement (Implementation Bug Detection)

> [!CAUTION]
> These tests detect **silent filter ignored** bugs — where a handler accepts filter params but ignores them.

| Test                                 | Command/Action                                                                                 | Expected Result                                                         |
| ------------------------------------ | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `get_statistics` date filter         | `get_statistics(start_date: "2099-01-01", end_date: "2099-12-31")`                             | ⚠️ Should return 0 entries. If returns all, handler ignores date filter |
| `export_entries` tag filter          | `export_entries(format: "json", tags: ["nonexistent-tag-xyz"], limit: 100)`                    | Should return 0 entries. If returns all, filter is ignored              |
| `export_entries` date filter         | `export_entries(format: "json", start_date: "2099-01-01", limit: 100)`                         | Should return 0 entries. If returns all, date filter is ignored         |
| `search_by_date_range` with filters  | `search_by_date_range(workspace_id: "test-ws", ..., entry_type: "nonexistent_type")`                 | Structured validation error rejecting the invalid enum value            |
| `get_recent_entries` personal filter | `get_recent_entries(workspace_id: "test-ws", limit: 100, is_personal: true)` vs `is_personal: false` | Results should be mutually exclusive                                    |

---

## Cleanup

After testing, permanently delete all entries created during Phase 12.2. Since no automated cleanup script exists, you MUST manually call `delete_entry(permanent: true)` via direct MCP tool calls for every entry ID generated during this test phase.

| Cleanup Step       | Command/Action                                                     |
| ------------------ | ------------------------------------------------------------------ |
| Purge test entries | Call `delete_entry(entry_id: N, permanent: true)` for all test IDs |

---

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- Agent reports the Total Token Estimate in the final summary.
- Soft-deleted entries excluded from FTS5, semantic, and date range search results
- Permanently deleted entries completely absent from all search methods
- Filter enforcement validated — no silent filter ignored bugs
- All relationship types persist and are queryable
