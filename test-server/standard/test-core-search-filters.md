# Re-Test memory-journal-mcp - Text Search Filters & Metadata

**Scope:** Search filters, date range, cross-DB merging, and pagination.

**Prerequisites:**

- **Validation:** Ensure the test agent validates strict mode and boundary limits on newly hardened schemas.
> **Note**: When updating schemas or validation logic, please refer to the `/zod` skill for best practices on Standard Schema and Safe Parsing.
- Confirm MCP server instructions were auto-received before starting.
- **Use direct MCP tools exclusively.** Do NOT use Code Mode (`mj_execute_code`) for these tests. Code Mode tests are handled separately in the `codemode` track. If you must use a script to supplement a test, use a standard Node/shell script.
- Seed data from `test-seed.md` must be present.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `src/constants/server-instructions.ts`. **Do NOT edit this test prompt file directly.** **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `src/filtering/tool-filter.ts`) so future agents succeed automatically.**
2. Use `test-server/tool-reference.md` and `test-server/scripts/tool-map.json` as sources of truth and ensure fixes comply with the `mcp-builder` skill.
3. **Local Verification**: If you or a subagent modifies the codebase, you MUST run the linter and typechecker (`pnpm run lint` and `npx tsc --noEmit`) locally and fix any issues BEFORE committing. Pay strict attention to ESLint and TypeScript compiler outputs. You MUST fix all validation issues prior to committing. Do NOT ignore warnings or errors. Follow strict TypeScript guidelines: NEVER use `any` (use `unknown` with type guards), avoid unsafe typecasts, and ensure explicit return types.
4. **Commit**: Immediately commit passing changes using the `bun ./.agents/scripts/commit.ts --msg "type(scope): message" --impact <0.1-1.0> --confidence <0.1-1.0> --validation passed --journal --add <path>` utility. Do NOT use raw `git commit`. WARNING: Do NOT commit your code and then attempt to use `git commit --amend` to fix a lingering lint or test issue later. Amending a commit rewrites the commit SHA, which will permanently break the changelog tracking workflow. DO NOT stop to ask the USER to verify—you must run `pnpm run lint` and `npx tsc --noEmit` yourself, you are autonomous.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.
---
 Filters

| Test                  | Command/Action                                                                                                      | Expected Result                                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Filter by issue       | `search_entries(workspace_id: "test-ws", issueNumber: 44)`                                                               | Returns entries linked to issue #44                                                                                                                                                           |
| Filter by PR status   | `search_entries(workspace_id: "test-ws", prStatus: "merged")`                                                            | Returns entries with `prStatus: "merged"`                                                                                                                                                     |
| Filter by workflow    | `search_entries(workspace_id: "test-ws", workflowRunId: <N>)`                                                           | Returns entries linked to workflow run                                                                                                                                                        |
| Filter by project     | `search_entries(workspace_id: "test-ws")`                                                                                 | Returns entries linked to workspace test-ws                                                                                                                                                          |
| Filter by isPersonal | `search_entries(workspace_id: "test-ws", query: "test", isPersonal: true)`                                               | Only personal entries returned                                                                                                                                                                |
| Filter by tags        | `search_entries(workspace_id: "test-ws", tags: ["testing"])`                                                              | Only entries with "testing" tag returned (S6, S9)                                                                                                                                             |
| Filter by type  | `search_entries(workspace_id: "test-ws", type: "planning")`                                                         | Only entries with type "planning" returned (S6, S13)                                                                                                                                    |
| Filter by date        | `search_entries(workspace_id: "test-ws", fromDate: "2026-01-01", toDate: "2026-12-31")`                               | Results constrained to the specified date range                                                                                                                                               |
| Date range + type     | `search_by_date_range(workspace_id: "test-ws", fromDate: "2026-01-01", toDate: "2026-12-31", type: "planning")` | Only "planning" entries in date range                                                                                                                                                         |
| Date range + tags     | `search_by_date_range(workspace_id: "test-ws", fromDate: "2026-01-01", toDate: "2026-12-31", tags: ["test"])`         | Only entries with "test" tag in date range                                                                                                                                                    |
| Date range + personal | `search_by_date_range(workspace_id: "test-ws", fromDate: "2026-01-01", toDate: "2026-12-31", isPersonal: true)`      | Only personal entries in date range                                                                                                                                                         |
| Date range + project  | `search_by_date_range(fromDate: "2026-01-01", toDate: "2026-12-31")`                         | Only workspace test-ws entries in date range                                                                                                                                                         |
| Inverted date range   | `search_by_date_range(workspace_id: "test-ws", fromDate: "2026-12-31", toDate: "2026-01-01")`                         | Returns `{ success: false, error: "Invalid date range: fromDate (...) is after toDate (...)", code: "VALIDATION_ERROR", suggestion: "Ensure fromDate is before or equal to toDate" }` |
| Query too long        | `search_entries(workspace_id: "test-ws", query: "a".repeat(300))`                                                         | Returns `{ success: false, error: "..." }` with Zod validation hint                                                                                                                           |
| Importance sort       | `search_entries(workspace_id: "test-ws", query: "architecture", sortBy: "importance")`                                   | Results sorted by `importanceScore` DESC with `importanceScore` field on every entry                                                                                                          |
| Importance sort rcnt  | `get_recent_entries(workspace_id: "test-ws", limit: 5, sortBy: "importance")`                                            | Results sorted by `importanceScore` DESC with `importanceScore` field on every entry                                                                                                          |
| Importance sort date  | `search_by_date_range(workspace_id: "test-ws", fromDate: "2026-01-01", toDate: "2026-12-31", sortBy: "importance")`  | Results sorted by `importanceScore` DESC with `importanceScore` field on every entry                                                                                                          |
| Default no overhead   | `search_entries(workspace_id: "test-ws", query: "architecture")`                                                          | No `importanceScore` field present on entries (default `sortBy: 'timestamp'`)                                                                                                                |
| Search (archived off) | `search_entries(workspace_id: "test-ws", query: "test", includeArchived: false)` (or omit)                              | Excludes archived entries from FTS/semantic results                                                                             |
| Search (archived on)  | `search_entries(workspace_id: "test-ws", query: "test", includeArchived: true)`                                              | Returns archived entries alongside active entries in results                                                                   |
| Search date range arch | `search_by_date_range(workspace_id: "test-ws", fromDate: "2026-01-01", toDate: "2026-12-31", includeArchived: true)` | Returns archived entries matching date range                                                                                  |
| Search cursor pag.     | `search_entries(workspace_id: "test-ws", query: "test", limit: 2)`                                                        | Returns 2 matching entries and a non-empty `nextCursor` string                                                                 |
| Search cursor pag. rd  | `search_entries(workspace_id: "test-ws", query: "test", limit: 2, cursor: "<nextCursor>")`                               | Returns next page of matching results sequentially                                                                              |
| Search highlights      | `search_entries(workspace_id: "test-ws", query: "architecture", include_highlights: true)`                                | Results include `highlights` snippet array for FTS match                                                                        |
| Search facets          | `search_entries(workspace_id: "test-ws", query: "architecture", include_facets: true)`                                    | Results include `facets` object with `tags` and `entryTypes` distributions                                                      |
| Hybrid search weights  | `search_entries(workspace_id: "test-ws", query: "architecture", mode: "hybrid", ftsWeight: 2.0, semanticWeight: 0.5)`   | Executes successfully without validation errors and returns results                                                             |
| True phrase quotes     | `search_entries(workspace_id: "test-ws", query: "\"exact match\" \"other phrase\"", mode: "fts")`                         | Executes successfully without SQLite syntax errors (balanced quotes preserved)                                                  |

> [!NOTE]
> **Cross-DB Search Behavior:** When a team DB is present, per-DB queries fetch `limit × 2` (capped at 500) to prevent BM25 ranking in one DB from silently dropping entries before the cross-DB merge. The user's requested `limit` is applied after merging.

---

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- Agent reports the Total Token Estimate in the final summary (using `_meta.tokenEstimate` from responses). The tokens tracked should only count the estimated tokens that actually entered the context window.
- `search_entries` with `mode: 'auto'` correctly identifies conversational prompts and bridges keyword + semantic via Reciprocal Rank Fusion
- `search_entries` `mode: 'fts'` phrase, prefix, and boolean operators work correctly
- `search_entries` gracefully falls back to LIKE for FTS5-unsafe queries (single quotes, `%`)
- `search_entries` gracefully falls back to fuzzy Levenshtein matching when `fuzzyMatch` is true and FTS yields zero results
- `search_entries` filters work: `issueNumber`, `prStatus`, `workflowRunId`, `workspace_id`, `isPersonal`, `tags`, `type`, `fromDate`, `toDate`
- `search_by_date_range` filters work: `type`, `tags`, `isPersonal`, `workspace_id`
- `search_by_date_range` rejects non-YYYY-MM-DD date strings with structured errors
- `search_entries` rejects queries exceeding 250 characters with structured Zod errors
- Cross-DB merging includes `source: 'personal' | 'team'` marker
- `search_entries` with `sortBy: 'importance'` returns entries with `importanceScore` field sorted descending
- `get_recent_entries` with `sortBy: 'importance'` returns entries with `importanceScore` field sorted descending
- `search_by_date_range` with `sortBy: 'importance'` returns entries with `importanceScore` field sorted descending
- Default `sortBy` (timestamp) produces zero overhead — no `importanceScore` field present
- `search_entries` and `search_by_date_range` correctly respect the `includeArchived` filter
- Keyset cursor pagination (`cursor` & `nextCursor`) works reliably across FTS, semantic, and date range search modes
- `search_entries` with `include_highlights: true` returns snippets with FTS query terms highlighted
- `search_entries` with `include_facets: true` returns aggregate tag and entry-type distribution counts
- Hybrid mode properly supports `ftsWeight` and `semanticWeight` dynamic biasing multipliers
- FTS query parser safely preserves balanced double-quotes for true phrase matching without crashing
- `exact_match: true` successfully maps to `fuzzyMatch: false` resulting in exact matching
- `exact_match: false` successfully maps to `fuzzyMatch: true` resulting in Levenshtein matching

