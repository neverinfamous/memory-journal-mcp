# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v7.3.0...HEAD)

### Fixed
- Fixed ESLint AST caching bug causing `@typescript-eslint/no-unsafe-argument` inference errors on `MAX_QUERY_LIMIT` bounds testing across ESM imports by bypassing inference with explicit `Number()` evaluated assignment.
- Resolved TypeScript compilation errors (`TS2304`, `TS2345`, `TS2353`) by explicitly typing `ISearchFilters` limits in the filter payloads.
