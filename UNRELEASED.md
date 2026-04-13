# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v7.4.0...HEAD)

### Added

- **Skills**: Integrated `github-copilot-cli` skill for interactive, terminal-native code reviews.
- **Workflows**: Added `copilot-audit` pre-push review loop for evaluating uncommitted changes via Copilot.
- **Hush Protocol**: Introduced a machine-actionable team communication system:
  - Tools: Added `pass_team_flag` and `resolve_team_flag`.
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
