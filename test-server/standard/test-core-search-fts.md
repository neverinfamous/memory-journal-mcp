# Re-Test memory-journal-mcp — Text Search

**Scope:** FTS5 search, phrase/prefix/boolean operators, LIKE fallback, hybrid auto-mode, date range, cross-DB merging, and filter parameters.

**Prerequisites:**

- **Validation:** Ensure the test agent validates strict mode and boundary limits on newly hardened schemas.
> **Note**: When updating schemas or validation logic, please refer to the `/zod` skill for best practices on Standard Schema and Safe Parsing.
- Confirm MCP server instructions were auto-received before starting.
- **Use direct MCP tools exclusively.** Do NOT use Code Mode (`mj_execute_code`) for these tests. Code Mode tests are handled separately in the `codemode` track. If you must use a script to supplement a test, use a standard Node/shell script.
- Seed data from `test-seed.md` must be present.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `src/constants/server-instructions.ts`. **Do NOT edit this test prompt file directly.** **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `src/filtering/tool-filter.ts`) so future agents succeed automatically.**
2. Use `code-map.md` as a source of truth and ensure fixes comply with the `mcp-builder` skill.
3. **Local Verification**: If you or a subagent modifies the codebase, you MUST run the full validation pipeline (`pnpm run check`) locally and fix any issues BEFORE committing. Pay strict attention to ESLint and TypeScript compiler outputs. You MUST fix all validation issues prior to committing. Do NOT ignore warnings or errors. Follow strict TypeScript guidelines: NEVER use `any` (use `unknown` with type guards), avoid unsafe typecasts, and ensure explicit return types.
4. **Commit**: Immediately commit passing changes using the `bun .\.agents\scripts\commit.ts --msg "type(scope): message" --impact <0.1-1.0> --confidence <0.1-1.0> --validation passed --journal --add <path>` utility. Do NOT use raw `git commit`. WARNING: Do NOT commit your code and then attempt to use `git commit --amend` to fix a lingering lint or test issue later. Amending a commit rewrites the commit SHA, which will permanently break the changelog tracking workflow. DO NOT stop to ask the USER to verify—you must run `pnpm run check` yourself, you are autonomous.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.
---

## Phase 3: Text Search

| Test                  | Command/Action                                                                                                      | Expected Result                                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FTS5 search           | `search_entries(workspace_id: "test-ws", query: "architecture")`                                                          | ≥ 1 result — S1 and S11 both indexed; BM25 may rank team entry first; use `search_entries(workspace_id: "test-ws", query: "authentication architecture")` to target S1 specifically                 |
| FTS5 phrase           | `search_entries(workspace_id: "test-ws", query: "\"error handling\"")`                                                    | ≥ 1 result (S2) — exact phrase match only; the query param value must contain the literal quotes as part of the string: `"error handling"` (not JSON escape sequences)                        |
| FTS5 prefix           | `search_entries(workspace_id: "test-ws", query: "auth*")`                                                                 | ≥ 2 results (S1, S8) — matches "authentication", "authorization", etc.                                                                                                                        |
| FTS5 boolean NOT      | `search_entries(workspace_id: "test-ws", query: "deploy NOT staging", mode: "fts")`                                       | Returns S3, S11 but NOT S5 (S5 contains "staging")                                                                                                                                            |
| FTS5 boolean OR       | `search_entries(workspace_id: "test-ws", query: "deploy OR release", mode: "fts")`                                        | ≥ 2 results (S3, S4, S5 expected)                                                                                                                                                             |
| FTS5 fallback         | `search_entries(workspace_id: "test-ws", query: "test's", mode: "fts")`                                                   | ≥ 1 result (S6) — LIKE fallback, single quotes are FTS5-unsafe                                                                                                                                |
| FTS5 special chars    | `search_entries(workspace_id: "test-ws", query: "100%", mode: "fts")`                                                     | ≥ 1 result (S6) — LIKE fallback, `%` is FTS5-unsafe                                                                                                                                           |
| 2.6 Exact Match True  | `search_entries(workspace_id: "test-ws", query: "architeqture", exact_match: true)`                                       | 0 results (alias maps to `fuzzy_match: false`)                                                                                                                                                |
| 2.7 Exact Match False | `search_entries(workspace_id: "test-ws", query: "architeqture", exact_match: false)`                                      | ≥1 results (bidirectional alias maps to `fuzzy_match: true`)                                                                                                                                  |
| Hybrid auto-mode      | `search_entries(workspace_id: "test-ws", query: "how did we fix performance")`                                            | Auto-mode heuristics trigger RRF hybrid bridging FTS+Vector, expected to return S7                                                                                                            |
| Forced semantic mod   | `search_entries(workspace_id: "test-ws", query: "improving performance", mode: "semantic")`                               | Bypasses FTS5, running pure vector similarity, expects S7/S10                                                                                                                                 |
| Date range            | `search_by_date_range(workspace_id: "test-ws", start_date: "2026-01-01", end_date: "2026-01-31")`                         | Returns `structuredContent` array                                                                                                                                                             |
| Cross-DB search       | `search_entries(workspace_id: "test-ws", query: "test")`                                                                  | Results include `source: 'personal' \| 'team'` marker on each entry                                                                                                                           |
| Cross-DB date         | `search_by_date_range(workspace_id: "test-ws", start_date: "2026-01-01", end_date: "2026-12-31")`                         | Results include `source` marker merging personal + team entries                                                                                                                               |
| Invalid date fmt      | `search_by_date_range(workspace_id: "test-ws", start_date: "Jan 1", end_date: "Jan 31")`                                  | Structured error: `{ success: false, error: "..." }` with YYYY-MM-DD hint                                                                                                                     |


---
## Success Criteria
- Agent reports the Total Token Estimate in the final summary.
- search_entries with mode: 'auto' correctly identifies conversational prompts and bridges keyword + semantic via Reciprocal Rank Fusion
- search_entries mode: 'fts' phrase, prefix, and boolean operators work correctly
- search_entries gracefully falls back to LIKE for FTS5-unsafe queries (single quotes, %)
- search_entries gracefully falls back to fuzzy Levenshtein matching when uzzy_match is true and FTS yields zero results

