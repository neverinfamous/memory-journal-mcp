# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v8.0.1...HEAD)

### Added
- Code Mode execution enhancements:
  - Alias mappings for parameters and methods to gracefully handle agent hallucinations (e.g., `user` -> `target_user`, `msg` -> `message`, `exact_match: true` -> `fuzzy_match: false`).
  - Missing `POSITIONAL_PARAM_MAP` and `METHOD_ALIASES` for newer tools and team management.
  - Cross-group constructor wiring for search and vector indexing tools.
  - Support for batch operations, `sleep(ms)`/`setTimeout` aliases, and `snake_case` to `camelCase` mapping.
  - `project_number` wrapper in `mj_execute_code` schema to automatically inject it into sandbox mutations.
  - `hasMore` convenience boolean in result objects for easier pagination checking.
  - URI-aware `readResource` error handler suggesting specific `mj.*` alternatives.
  - Automatic `expected_version` injection via `auto_version: true` to prevent silent overwrites.
  - Automatic `project_number` injection in single-project environments via `secureDispatcher`.
  - `mj-mcp-optimize` skill for debugging the execution pipeline.
- Data lifecycle management flags for auto-archiving, hard deletion, and dry runs (`--archive-older-than-days`, `--prune-dry-run`, etc.).
- Database schema migration framework and composite/partial performance indexes.
- Import tools (`import_external`, `team_import_external`) for Notion, Obsidian, and Logseq ingestion.
- Scheduled digest report delivery via `--report-interval` (`memory://insights/reports`).
- Security features including `DB_ENCRYPTION_KEY` for SQLCipher, and Team Role-Based Access Control (RBAC).
- Configuration features: file support for `.json` and `.yaml`, `update_configuration` tool with hot-reload, and `--dump-config` for safe inspection.
- Metrics and observability: Prometheus `/metrics` export, persistent metrics (`--persist-metrics`), per-tool latency percentiles, and read frequency tracking.
- `search_audit_log` tool for querying server audit logs.
- Optimistic concurrency control for entry updates (`version` and `expected_version`).
- Team Identity Layer with author aliases and management tools.
- GitHub rate limit resource (`memory://github/rate-limit`).
- Search enhancements: Levenshtein distance fuzzy search fallback, FTS5 highlight snippets, and dynamic hybrid search weighting (`fts_weight`, `semantic_weight`).
- Support for swappable vector embedding models via `--embedding-model`.
- `cross_team_search` tool for read-only searches across multiple team databases.
- `resources/subscribe` capability and real-time subscription manager.
- Soft-delete recovery (`restore_entry`, `list_deleted_entries`) and archiving (`is_archived`, `include_archived`).
- O(1) keyset cursor pagination for listing and search tools.
- Batch operation tools in core and team admin groups (`batch_create_entries`, `batch_update_entries`, `batch_delete_entries`).
- Entry versioning and history tracking via `get_entry_history`.

### Changed
- Documentation: Synchronized resource counts (55 total) and undocumented configuration variables (including auto-prune lifecycle flags) across `README.md`, `DOCKER_README.md`, `.env.example`, and `mcp-config-example.json`.
- Wiki Documentation: Added documentation for missing tools (`search_audit_log`, `cross_team_search`) and updated team tool counts.
- Restored strict `project_number` requirement for team mutation handlers to maintain project boundaries.
- Improved GitHub resource routing to safely fall back to `DEFAULT_PROJECT_NUMBER` when `{repo}` is omitted.
- Enhanced `secureDispatcher` to automatically resolve `repo` from `project_number` (and vice-versa).
- Upgraded token estimation to use content-type-aware ratios for better accuracy.
- Updated CLI configuration loader to aggregate and report all startup validation errors simultaneously.
- Updated `mj_execute_code` schema to explicitly instruct agents to use the `context` parameter for large strings, preventing template escaping bugs.
- Wired Code Mode `JournalApi` constructor to silently map hallucinated cross-group operations.
- Modified `exact_match` ↔ `fuzzy_match` normalization in `secureDispatcher` to be bidirectionally consistent.

### Fixed
- FTS search phrase matching to properly preserve balanced double-quotes.
- Regression causing batch operations to fail atomically instead of returning structured partial errors.
- Code Mode execution stability issues:
  - Silent type failures for project methods without an active registry.
  - `TypeError` failures from hallucinated Array method calls on object results.
  - Generic `ReferenceError` for `fetch()` replaced with descriptive `SandboxNetworkError`.
  - Silent failures in `auto-return` transformation for multiline template literals.
  - Validation errors for string repository names in `project_number`.
  - Errors from `read_query` aliases by wrapping `searchEntries`.
  - Missing Code Mode implementations for `getConfig` and `readResource`.
  - Validation error in `mj_execute_code` by making `code` parameter optional.
- Zod schema validation errors during hybrid search for the `isArchived` flag.
- Missing or inconsistent `project_number` validation and fallback logic in team search and flag tools.
- Restrictive `project_number` checks preventing moving team entries across projects.
- `cross_team_search` omitting the primary team database.
- Potential null runtime errors in semantic search and vector indexing.
- Entry revision eviction logic to correctly preserve the 10 newest snapshots.
- Missing cleanup of temporary directories and files after End-to-End test suites.
- Docker Hub repository description failing to update during deployments.
- `ReferenceError` crash in batch operations due to missing `sendProgress` import.
- `memory://help` generating incorrect tool group summaries.
- `list_deleted_entries` schema validation by allowing optional `limit` and `offset` defaults.
- Windows-specific race condition in `restoreFromFile` from lingering lock directories.
- `ConfigResolver` syntax crash when loading pre-parsed nested objects.
- Missing `project_number` validation in core `batch_create_entries`.
- Test timeout in coverage runs due to dynamic import deadlocks.

### Security
- Gap in `resources/subscribe` where unauthorized clients could bypass scope boundaries to receive real-time notifications for restricted resources.

### Removed
- Deprecated `pnpm` configuration block from `package.json` to eliminate startup warnings.
