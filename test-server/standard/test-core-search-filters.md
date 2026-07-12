# Re-Test memory-journal-mcp - Text Search Filters & Metadata

**Scope:** Search filters, date range, cross-DB merging, and pagination.

**Prerequisites:**

- **CRITICAL:** You MUST pass `use_test_db: true` as a top-level parameter in ALL MCP tool calls (including `mj_execute_code`) to ensure tests hit the test database instead of production.
- **Validation:** Ensure the test agent validates strict mode and boundary limits on newly hardened schemas (e.g., Team Tools, Admin Tools).
> **Note**: When updating schemas or validation logic, please refer to the `/zod` skill for best practices on Standard Schema and Safe Parsing.
- **Required Tool Groups:** `admin`, `codemode`, `core`, `github`
- Confirm MCP server instructions were auto-received before starting.
- **Use direct MCP tools exclusively.** Do NOT use Code Mode (`mj_execute_code`) for these tests. Code Mode tests are handled separately in the `codemode` track. If you must use a script to supplement a test, use a standard Node/shell script.
- Seed data from `test-seed.md` must be present. MCP server instructions auto-injected.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `constants/server-instructions.ts` or this file. **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `codemode.ts`) so future agents succeed automatically.**
2. Use `code-map.md` as a source of truth and ensure fixes comply with the `mcp-builder` skill.
3. If you made code changes/fixes, update `UNRELEASED.md` and commit without pushing. If tests pass cleanly, do NOT update `UNRELEASED.md`. Then, stop so the **USER** can verify with `pnpm run check`.
4. After user completes verification, re-test fixes with direct MCP calls.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.
---
 Filters

| Test                  | Command/Action                                                                                                      | Expected Result                                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Filter by issue       | `search_entries(project_number: 5, issue_number: 44)`                                                               | Returns entries linked to issue #44                                                                                                                                                           |
| Filter by PR status   | `search_entries(project_number: 5, pr_status: "merged")`                                                            | Returns entries with `prStatus: "merged"`                                                                                                                                                     |
| Filter by workflow    | `search_entries(project_number: 5, workflow_run_id: <N>)`                                                           | Returns entries linked to workflow run                                                                                                                                                        |
| Filter by project     | `search_entries(project_number: 5)`                                                                                 | Returns entries linked to project #5                                                                                                                                                          |
| Filter by is_personal | `search_entries(project_number: 5, query: "test", is_personal: true)`                                               | Only personal entries returned                                                                                                                                                                |
| Filter by tags        | `search_entries(project_number: 5, tags: ["testing"])`                                                              | Only entries with "testing" tag returned (S6, S9)                                                                                                                                             |
| Filter by entry_type  | `search_entries(project_number: 5, entry_type: "planning")`                                                         | Only entries with entry_type "planning" returned (S6, S13)                                                                                                                                    |
| Filter by date        | `search_entries(project_number: 5, start_date: "2026-01-01", end_date: "2026-12-31")`                               | Results constrained to the specified date range                                                                                                                                               |
| Date range + type     | `search_by_date_range(project_number: 5, start_date: "2026-01-01", end_date: "2026-12-31", entry_type: "planning")` | Only "planning" entries in date range                                                                                                                                                         |
| Date range + tags     | `search_by_date_range(project_number: 5, start_date: "2026-01-01", end_date: "2026-12-31", tags: ["test"])`         | Only entries with "test" tag in date range                                                                                                                                                    |
| Date range + personal | `search_by_date_range(project_number: 5, start_date: "2026-01-01", end_date: "2026-12-31", is_personal: true)`      | Only personal entries in date range                                                                                                                                                         |
| Date range + project  | `search_by_date_range(start_date: "2026-01-01", end_date: "2026-12-31", project_number: 5)`                         | Only project #5 entries in date range                                                                                                                                                         |
| Inverted date range   | `search_by_date_range(project_number: 5, start_date: "2026-12-31", end_date: "2026-01-01")`                         | Returns `{ success: false, error: "Invalid date range: start_date (...) is after end_date (...)", code: "VALIDATION_ERROR", suggestion: "Ensure start_date is before or equal to end_date" }` |
| Query too long        | `search_entries(project_number: 5, query: "a".repeat(300))`                                                         | Returns `{ success: false, error: "..." }` with Zod validation hint                                                                                                                           |
| Importance sort       | `search_entries(project_number: 5, query: "architecture", sort_by: "importance")`                                   | Results sorted by `importanceScore` DESC with `importanceScore` field on every entry                                                                                                          |
| Importance sort rcnt  | `get_recent_entries(project_number: 5, limit: 5, sort_by: "importance")`                                            | Results sorted by `importanceScore` DESC with `importanceScore` field on every entry                                                                                                          |
| Importance sort date  | `search_by_date_range(project_number: 5, start_date: "2026-01-01", end_date: "2026-12-31", sort_by: "importance")`  | Results sorted by `importanceScore` DESC with `importanceScore` field on every entry                                                                                                          |
| Default no overhead   | `search_entries(project_number: 5, query: "architecture")`                                                          | No `importanceScore` field present on entries (default `sort_by: 'timestamp'`)                                                                                                                |
| Search (archived off) | `search_entries(project_number: 5, query: "test", include_archived: false)` (or omit)                              | Excludes archived entries from FTS/semantic results                                                                             |
| Search (archived on)  | `search_entries(project_number: 5, query: "test", include_archived: true)`                                              | Returns archived entries alongside active entries in results                                                                   |
| Search date range arch | `search_by_date_range(project_number: 5, start_date: "2026-01-01", end_date: "2026-12-31", include_archived: true)` | Returns archived entries matching date range                                                                                  |
| Search cursor pag.     | `search_entries(project_number: 5, query: "test", limit: 2)`                                                        | Returns 2 matching entries and a non-empty `next_cursor` string                                                                 |
| Search cursor pag. rd  | `search_entries(project_number: 5, query: "test", limit: 2, cursor: "<next_cursor>")`                               | Returns next page of matching results sequentially                                                                              |
| Search highlights      | `search_entries(project_number: 5, query: "architecture", include_highlights: true)`                                | Results include `highlights` snippet array for FTS match                                                                        |
| Search facets          | `search_entries(project_number: 5, query: "architecture", include_facets: true)`                                    | Results include `facets` object with `tags` and `entryTypes` distributions                                                      |
| Hybrid search weights  | `search_entries(project_number: 5, query: "architecture", mode: "hybrid", fts_weight: 2.0, semantic_weight: 0.5)`   | Executes successfully without validation errors and returns results                                                             |
| True phrase quotes     | `search_entries(project_number: 5, query: "\"exact match\" \"other phrase\"", mode: "fts")`                         | Executes successfully without SQLite syntax errors (balanced quotes preserved)                                                  |

> [!NOTE]
> **Cross-DB Search Behavior:** When a team DB is present, per-DB queries fetch `limit × 2` (capped at 500) to prevent BM25 ranking in one DB from silently dropping entries before the cross-DB merge. The user's requested `limit` is applied after merging.

---

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- Agent reports the Total Token Estimate in the final summary (using `_meta.tokenEstimate` from responses). The tokens tracked should only count the estimated tokens that actually entered the context window.
- `search_entries` with `mode: 'auto'` correctly identifies conversational prompts and bridges keyword + semantic via Reciprocal Rank Fusion
- `search_entries` `mode: 'fts'` phrase, prefix, and boolean operators work correctly
- `search_entries` gracefully falls back to LIKE for FTS5-unsafe queries (single quotes, `%`)
- `search_entries` gracefully falls back to fuzzy Levenshtein matching when `fuzzy_match` is true and FTS yields zero results
- `search_entries` filters work: `issue_number`, `pr_status`, `workflow_run_id`, `project_number`, `is_personal`, `tags`, `entry_type`, `start_date`, `end_date`
- `search_by_date_range` filters work: `entry_type`, `tags`, `is_personal`, `project_number`
- `search_by_date_range` rejects non-YYYY-MM-DD date strings with structured errors
- `search_entries` rejects queries exceeding 250 characters with structured Zod errors
- Cross-DB merging includes `source: 'personal' | 'team'` marker
- `search_entries` with `sort_by: 'importance'` returns entries with `importanceScore` field sorted descending
- `get_recent_entries` with `sort_by: 'importance'` returns entries with `importanceScore` field sorted descending
- `search_by_date_range` with `sort_by: 'importance'` returns entries with `importanceScore` field sorted descending
- Default `sort_by` (timestamp) produces zero overhead — no `importanceScore` field present
- `search_entries` and `search_by_date_range` correctly respect the `include_archived` filter
- Keyset cursor pagination (`cursor` & `next_cursor`) works reliably across FTS, semantic, and date range search modes
- `search_entries` with `include_highlights: true` returns snippets with FTS query terms highlighted
- `search_entries` with `include_facets: true` returns aggregate tag and entry-type distribution counts
- Hybrid mode properly supports `fts_weight` and `semantic_weight` dynamic biasing multipliers
- FTS query parser safely preserves balanced double-quotes for true phrase matching without crashing
- `exact_match: true` successfully maps to `fuzzy_match: false` resulting in exact matching
- `exact_match: false` successfully maps to `fuzzy_match: true` resulting in Levenshtein matching

