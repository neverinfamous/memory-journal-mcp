# Test memory-journal-mcp — Text Search

**Scope:** FTS5 search, phrase/prefix/boolean operators, LIKE fallback, hybrid auto-mode, date range, cross-DB merging, and filter parameters.

**Prerequisites:** Seed data from `test-seed.md` must be present. MCP server instructions auto-injected.

**Workflow after testing:**

1. Plan fixes (reference `code-map.md` + `mcp-builder` skill).
2. Implement, update `UNRELEASED.md`, commit without push.
3. User verifies: `npm run lint && npm run typecheck`, `npm run test`, `npm run test:e2e`.
4. Re-test fixes with direct MCP calls.
5. Brief final summary.

---

## Phase 3: Text Search

| Test                  | Command/Action                                                                                   | Expected Result                                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FTS5 search           | `search_entries(query: "architecture")`                                                          | ≥ 1 result — S1 and S11 both indexed; BM25 may rank team entry first; use `search_entries(query: "authentication architecture")` to target S1 specifically                                    |
| FTS5 phrase           | `search_entries(query: "\"error handling\"")`                                                    | ≥ 1 result (S2) — exact phrase match only; the query param value must contain the literal quotes as part of the string: `"error handling"` (not JSON escape sequences)                        |
| FTS5 prefix           | `search_entries(query: "auth*")`                                                                 | ≥ 2 results (S1, S8) — matches "authentication", "authorization", etc.                                                                                                                        |
| FTS5 boolean NOT      | `search_entries(query: "deploy NOT staging", mode: "fts")`                                       | Returns S3, S11 but NOT S5 (S5 contains "staging")                                                                                                                                            |
| FTS5 boolean OR       | `search_entries(query: "deploy OR release", mode: "fts")`                                        | ≥ 2 results (S3, S4, S5 expected)                                                                                                                                                             |
| FTS5 fallback         | `search_entries(query: "test's", mode: "fts")`                                                   | ≥ 1 result (S6) — LIKE fallback, single quotes are FTS5-unsafe                                                                                                                                |
| FTS5 special chars    | `search_entries(query: "100%", mode: "fts")`                                                     | ≥ 1 result (S6) — LIKE fallback, `%` is FTS5-unsafe                                                                                                                                           |
| Hybrid auto-mode      | `search_entries(query: "how did we fix performance")`                                            | Auto-mode heuristics trigger RRF hybrid bridging FTS+Vector, expected to return S7                                                                                                            |
| Forced semantic mod   | `search_entries(query: "improving performance", mode: "semantic")`                               | Bypasses FTS5, running pure vector similarity, expects S7/S10                                                                                                                                 |
| Date range            | `search_by_date_range(start_date: "2026-01-01", end_date: "2026-01-31")`                         | Returns `structuredContent` array                                                                                                                                                             |
| Cross-DB search       | `search_entries(query: "test")`                                                                  | Results include `source: 'personal' \| 'team'` marker on each entry                                                                                                                           |
| Cross-DB date         | `search_by_date_range(start_date: "2026-01-01", end_date: "2026-12-31")`                         | Results include `source` marker merging personal + team entries                                                                                                                               |
| Invalid date fmt      | `search_by_date_range(start_date: "Jan 1", end_date: "Jan 31")`                                  | Structured error: `{ success: false, error: "..." }` with YYYY-MM-DD hint                                                                                                                     |
| Filter by issue       | `search_entries(issue_number: 44)`                                                               | Returns entries linked to issue #44                                                                                                                                                           |
| Filter by PR status   | `search_entries(pr_status: "merged")`                                                            | Returns entries with `prStatus: "merged"`                                                                                                                                                     |
| Filter by workflow    | `search_entries(workflow_run_id: <N>)`                                                           | Returns entries linked to workflow run                                                                                                                                                        |
| Filter by project     | `search_entries(project_number: 5)`                                                              | Returns entries linked to project #5                                                                                                                                                          |
| Filter by is_personal | `search_entries(query: "test", is_personal: true)`                                               | Only personal entries returned                                                                                                                                                                |
| Filter by tags        | `search_entries(tags: ["testing"])`                                                              | Only entries with "testing" tag returned (S6, S9)                                                                                                                                             |
| Filter by entry_type  | `search_entries(entry_type: "planning")`                                                         | Only entries with entry_type "planning" returned (S6, S13)                                                                                                                                    |
| Filter by date        | `search_entries(start_date: "2026-01-01", end_date: "2026-12-31")`                               | Results constrained to the specified date range                                                                                                                                               |
| Date range + type     | `search_by_date_range(start_date: "2026-01-01", end_date: "2026-12-31", entry_type: "planning")` | Only "planning" entries in date range                                                                                                                                                         |
| Date range + tags     | `search_by_date_range(start_date: "2026-01-01", end_date: "2026-12-31", tags: ["test"])`         | Only entries with "test" tag in date range                                                                                                                                                    |
| Date range + personal | `search_by_date_range(start_date: "2026-01-01", end_date: "2026-12-31", is_personal: true)`      | Only personal entries in date range                                                                                                                                                           |
| Date range + project  | `search_by_date_range(start_date: "2026-01-01", end_date: "2026-12-31", project_number: 5)`      | Only project #5 entries in date range                                                                                                                                                         |
| Inverted date range   | `search_by_date_range(start_date: "2026-12-31", end_date: "2026-01-01")`                         | Returns `{ success: false, error: "Invalid date range: start_date (...) is after end_date (...)", code: "VALIDATION_ERROR", suggestion: "Ensure start_date is before or equal to end_date" }` |

> [!NOTE]
> **Cross-DB Search Behavior:** When a team DB is present, per-DB queries fetch `limit × 2` (capped at 500) to prevent BM25 ranking in one DB from silently dropping entries before the cross-DB merge. The user's requested `limit` is applied after merging.
>
> **Code Mode API Group Structure:** When testing `mj_execute_code`, methods are bound to specific groups. Key mapping: `listTags` → `mj.core`, `mergeTags` → `mj.admin`, `getStatistics` → `mj.analytics`. Use `mj.help()` or `mj.<group>.help()` to discover available methods per group.

---

## Success Criteria

- [ ] `search_entries` with `mode: 'auto'` correctly identifies conversational prompts and bridges keyword + semantic via Reciprocal Rank Fusion
- [ ] `search_entries` `mode: 'fts'` phrase, prefix, and boolean operators work correctly
- [ ] `search_entries` gracefully falls back to LIKE for FTS5-unsafe queries (single quotes, `%`)
- [ ] `search_entries` filters work: `issue_number`, `pr_status`, `workflow_run_id`, `project_number`, `is_personal`, `tags`, `entry_type`, `start_date`, `end_date`
- [ ] `search_by_date_range` filters work: `entry_type`, `tags`, `is_personal`, `project_number`
- [ ] `search_by_date_range` rejects non-YYYY-MM-DD date strings with structured errors
- [ ] Cross-DB merging includes `source: 'personal' | 'team'` marker
