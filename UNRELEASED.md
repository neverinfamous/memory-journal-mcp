# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v7.3.0...HEAD)

### Added
- `sort_by` parameter (`'timestamp'` | `'importance'`) to core and team search tools.
- `importanceScore` metadata field in search results when importance sorting is active.
- Post-fetch fallback importance sorting for semantic and hybrid searches.
- `team_get_collaboration_matrix` tool to analyze author activity density and cross-collaboration patterns.
- Proactive Data Analytics tasks for automated background repository health snapshotting.
- `memory://insights/digest` and `memory://insights/team-collaboration` resources for analytics snapshots.
- `--digest-interval` CLI argument to specify snapshot generation frequency.
- Injected analytics metrics (`relationshipDensity`, `activityTrend`, `significanceSpike`) into `memory://briefing` payloads.

### Fixed
- Missing `sortBy` forwarding to underlying fetches during `ftsSearch()` delegations.
- Strict typing and ESLint caching errors regarding filter limits and significance metric validations.
- Missing `export` tool group namespace (`mj.export.*`) in the Code Mode instruction documentation table, ensuring all 10 API discoverability groups are correctly documented for LLM context.

### Security
- Verified Admin tag management, export filters, and Backup/Restore lifecycle through the Code Mode sandbox. All tools strictly return structured `{ success: false }` bounds errors.
