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
- **Code Mode**: Validated Phase 26 Admin and Backup & Export tool structures and safe execution boundaries.
- **Code Mode**: Validated Phase 17 API Discoverability (top-level help, groups, aliases, positional arguments).
- **Code Mode**: Validated Phase 20 Core CRUD operations (create, read, update, delete) via `mj_execute_code`.
- **Code Mode**: Validated Phase 25 GitHub Tools (16 tools), covering Kanban, Issue/Milestone lifecycle, and Repo Insights via `mj_execute_code`.
- **Code Mode**: Validated Phase 29 Error Matrix & Zod Sweeps, confirming 100% structured error handling across all 10 `mj.*` API groups without sandbox crashes.
- **Code Mode**: Validated Phase 26 IO & Markdown Interoperability tools via `mj_execute_code`, fully verifying legacy exports, path traversal protection, and sandbox directory mapping.
- **Code Mode**: Validated Phase 23 Cross-Group Orchestration, completely testing token-efficient multi-step pipelines (health, GitHub coverage, tag pipelines, relationship graphs, and create-index-search) via `mj_execute_code`.
- **Code Mode**: Validated Phase 30 Payload Optimization, confirming Kanban throttling (`summary_only`, `item_limit`), issue body truncation (`truncate_body`), global query limits (500), and 100KB sandbox payload caps via `mj_execute_code`.
- **Code Mode**: Validated Phase 24 Relationships & Visualization tools via `mj_execute_code`, fully verifying creation of all 5 connection types, duplicate constraint checking, error path handling, and Mermaid diagram output generation.
- **Code Mode**: Validated Phase 16 Sandbox Basics via `mj_execute_code`, confirming expression evaluations, async/await resolution, runtime metrics, and timeout terminations.
- **Code Mode**: Validated Phase 19 Security Constraints via `mj_execute_code`, fully verifying input validation, detection of blocked patterns, wrapped runtime exceptions, and nulled globals.
- **Code Mode**: Validated Phase 21 Search, Semantics, Analytics, and Vector Index management tools via `mj_execute_code`, fully verifying FTS5 patterns, date-range filters, embedding hints, importance sorting, cross-DB search, and vector stat rebuilding.
- **Code Mode**: Validated Phase 28 Team Admin & Collaboration via `mj_execute_code`, successfully testing team tag merging, analytics grouping, collaboration matrix generation, relationship mapping with diagrams, dataset IO exports, and seamless backups.
- **Code Mode**: Validated Phase 28 Team CRUD & Search via `mj_execute_code`, fully verifying team entry management (CRUD), error paths, date range filtering, tag searching, and explicit/auto-author tracking.
- **Code Mode**: Validated Phase 28 Team Flags via `mj_execute_code`, successfully testing Hush Protocol flag creation, resolution lifecycle, vocabulary constraints, and team tag cleanup operations. 
- **Code Mode**: Validated Phase 28 Team Vector, Insights & Cross-Tool Error Paths via `mj_execute_code`, fully verifying team semantic search, vector rebuilding/adding, cross-project analytics, and ensuring that all 18 tested cross-tool error paths return 100% structured JSON boundaries (not raw throws).
- **Code Mode**: Fixed missing API alias configuration for `passTeamFlag` and `resolveTeamFlag`, aligning the sandbox JavaScript environment with the expected camelCase tool conventions.
