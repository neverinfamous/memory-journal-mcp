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
  - Bumped `typescript-eslint` from 8.58.1 to 8.58.2
  - Bumped `diff` from 8.0.4 to 9.0.0 (docker bundle optimization)
  - Bumped `trufflesecurity/trufflehog` to 3.94.3
  - Bumped `hashgraph-online/skill-publish` to 1.0.13
  - Bumped `github/gh-aw-actions` (c7a6a831 to 0048fdad)
  - Bumped `docker/login-action` to 4.1.0
  - Bumped `actions/upload-artifact` to 7.0.1
- **Briefing**: Renamed the ambiguous `Matrix Density` insight label to `Relationship density`.

### Fixed

- **Types**: Added missing `importanceScore` property to `JournalEntry` interface.
- **Search**: Fixed early `.slice()` truncation that dropped high-relevance results prior to importance sorting.
- **Analytics**: Fixed SQLite `%Y-Q` quarterly grouping calculation by explicitly deriving months.
- **Constraints**: Fixed raw limit evaluation by strictly enforcing `MAX_QUERY_LIMIT` (500) across Team Searches.
- **Consistency**: Hardened `teamCollaborationResource` return payload structure.
- **Hush Protocol**: Fixed SQLite mapping bug inadvertently casting `autoContext` JSON strings to booleans.
- **Analytics**: Fixed an issue in `get_statistics` where the date range filter was inadvertently ignored for causal relationship metrics.
- **Transport**: Resolved an E2E testing timeout in `session-advanced.spec.ts` caused by dangling MCP SDK Server transports preventing sequential reconnections. `server.close()` is now wrapped in a `Promise.race` to forcefully detach SDK transport state and unblock the event loop.
