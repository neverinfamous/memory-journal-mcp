# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v7.4.0...HEAD)

### Added

- **Skills**: Integrated `github-copilot-cli` skill for interactive, terminal-native code reviews.
- **Workflows**: Added `copilot-audit` pre-push review loop for evaluating uncommitted changes via Copilot.
- **Hush Protocol**: Introduced a machine-actionable team communication system:
  - Tools: Added `team_pass_flag` and `team_resolve_flag`.
  - Resources: Added `memory://flags` dashboard and `memory://flags/vocabulary`.
  - Config: Added `--flag-vocabulary` CLI argument and `FLAG_VOCABULARY` env var.
  - Core: Added `'flag'` entry type, `ICON_FLAG`, and behavioral instructions.
- **Briefing**: Integrated active flags summary and added `localTime` for chronological grounding.

### Changed

- **Dependency Updates**:
  - Bumped `better-sqlite3` to v12.9.0
  - Bumped `globals` to v17.5.0
  - Bumped `simple-git` to v3.36.0
- **Briefing**: Renamed the ambiguous `Matrix Density` insight label to `Relationship density`.

### Fixed

- **Types**: Added missing `importanceScore` property to `JournalEntry` interface.
- **Search**: Fixed early `.slice()` truncation that dropped high-relevance results prior to importance sorting.
- **Analytics**: Fixed SQLite `%Y-Q` quarterly grouping calculation by explicitly deriving months.
- **Constraints**: Fixed raw limit evaluation by strictly enforcing `MAX_QUERY_LIMIT` (500) across Team Searches.
- **Consistency**: Hardened `teamCollaborationResource` return payload structure.
- **Hush Protocol**: Fixed SQLite mapping bug inadvertently casting `autoContext` JSON strings to booleans.

### Validation

- **Integrity**: Completed Phase 12 Data Integrity Verification mapping round-trip fidelity, strict search/soft-delete isolations, unicode edge cases, FTS/semantic bounds, and native relationship boundaries utilizing direct MCP routines without logical fault or SQL leak.
- **Kanban**: Completed End-to-End Lifecycle Verification encompassing `add_kanban_item`, `move_kanban_item`, `delete_kanban_item`, and optimized `get_kanban_board` payload structures matching architectural assertions.
- **Optimization**: Completed Payload Optimization Verification confirming Kanban throttling (`summary_only`, `item_limit`), Issue/PR body truncation (default 800 chars), `MAX_QUERY_LIMIT` validation hooks (≤500), and Code Mode execution boundaries (≤100KB) across all test vectors seamlessly emitting structured `VALIDATION_ERROR` objects as intended.
