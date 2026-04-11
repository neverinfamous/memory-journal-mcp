# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v7.4.0...HEAD)

### Fixed
- **Types**: Added `importanceScore` formally to `JournalEntry` interface for stronger bounds ranking sorting.
- **Search**: Fixed early `.slice()` truncation executing before semantic importance `.sort()`, dropping high-relevance low-semantic edge cases.
- **Analytics**: Fixed SQLite `%Y-Q` grouping calculation bug by injecting explicit month-derivation syntax.
- **Constraints**: Enforced `MAX_QUERY_LIMIT` cap (500) against over-fetching from tag-broadened Team Searches instead of relying on a 1000 literal.
- **Consistency**: Hardened `teamCollaborationResource` returning `{ success: true, matrix: <object> }` rigidly. 
- **Briefings**: Rebranded the ambiguous `Matrix Density` insight label to `Relationship density`.
