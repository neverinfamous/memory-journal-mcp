# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v7.3.0...HEAD)

### Added
- Added `sort_by` parameter (`'timestamp'` | `'importance'`) to `search_entries`, `search_by_date_range`, `get_recent_entries`, and all team parity tools (`team_search`, `team_search_by_date_range`, `team_get_recent`). Defaults to `'timestamp'` (zero overhead). When set to `'importance'`, results are sorted by a composite importance score (0.0–1.0) computed inline via SQL, and each entry includes an `importanceScore` field.
- Added `buildImportanceSqlExpression()` function in `importance.ts` that translates the existing `calculateImportance()` formula into inline SQL for single-query importance sorting (avoids N+1).
- Exported importance weight constants (`IMPORTANCE_WEIGHTS`, `MAX_RELATIONSHIP_SCORE_AT`, `MAX_CAUSAL_SCORE_AT`, `RECENCY_WINDOW_DAYS`) as SSoT shared between the per-entry function and the SQL expression builder.
- Added `importanceScore` optional field to `EntryOutputSchema` — only present when `sort_by: 'importance'` is used.
- Post-fetch importance re-sorting for semantic and hybrid search modes, where SQL-level sorting is not available.

### Fixed
- Fixed ESLint AST caching bug causing `@typescript-eslint/no-unsafe-argument` inference errors on `MAX_QUERY_LIMIT` bounds testing across ESM imports by bypassing inference with explicit `Number()` evaluated assignment.
- Resolved TypeScript compilation errors (`TS2304`, `TS2345`, `TS2353`) by explicitly typing `ISearchFilters` limits in the filter payloads.
- Fixed `ftsSearch()` not forwarding `sortBy` to underlying `db.searchEntries()` and `db.getRecentEntries()` calls.
