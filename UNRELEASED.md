# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v7.2.0...HEAD)

### Added

- Native zero-dependency cleanup utility (`test-server/scripts/cleanup-seed-data.mjs`) for purging testing data while protecting core project entries.
- Metadata filters (tags, entry type, date range) for `team_semantic_search` to match personal search parity.

### Changed

- Standardized `success: true` response field across all read-only tool happy paths.
- Replaced hidden `* 2` vector search multiplier with explicit caller-managed 10x oversampling (min 100) to improve metadata-filtered search quality.
- Centralized `passMetadataFilters` evaluation for consistent usage across personal and team search handlers.

### Fixed

- Schema validation crash in `CreateGitHubIssueWithEntryOutputSchema` when Kanban additions fail or board states are unknown.
- Gap in vector/semantic index filtering where matches bypassing in-memory filter criteria were not properly dropped.
- Poor result variety in `team_search` and `semantic_search` when metadata filters were applied by utilizing dynamic oversampling.
- Layout inconsistency in `memory://github/status` by explicitly returning `{ openCount: 0, items: [] }` when there are no milestones.
- Inconsistent validation error codes by aligning all schema and programmatic failures to emit `VALIDATION_ERROR`.
- Issue where `get_entry_by_id` accepted non-integer floats by applying strict `.int()` schema validation.
- Raw MCP protocol errors thrown by prompt handlers (e.g., missing `TEAM_DB_PATH`) by wrapping them in graceful `try/catch` user-visible messages.
- Edge case where `link_entries` allowed linking to soft-deleted entries by enforcing `db.getEntryById` existence checks.
