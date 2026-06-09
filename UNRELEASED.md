# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v8.0.1...HEAD)

### Added
- Added `exact_match: true` alias to automatically translate to `fuzzy_match: false` in Code Mode, improving typo tolerance discoverability.
- Added new parameter aliases (`user`/`assignee` -> `target_user`, `msg` -> `message`, `repo_name` -> `repo`) to Code Mode to gracefully handle common agent hallucinations.
- Added `import_external` and `team_import_external` tools to support ingestion of knowledge management exports (Notion, Obsidian, Logseq) with automated normalization.
- Added scheduled digest report delivery via `--report-interval` and related webhook flags, accessible via `memory://insights/reports` resource.
- Added `DB_ENCRYPTION_KEY` environment variable and `db-encrypt` migration script to support SQLCipher-encrypted databases at rest.
- Added `--dump-config` CLI flag to print the fully resolved configuration payload with automatically redacted secrets.
- Added configuration file support (`--config <path>`) for `.yaml` and `.json` configs to streamline setups.
- Added `update_configuration` tool and hot-reload functionality for runtime configuration changes without server restarts.
- Added graduated data lifecycle management, including `--archive-older-than-days` and `--hard-delete-older-than-days` flags for automatic archiving and permanent deletion of aged entries.
- Added `--prune-dry-run` and `--prune-exclude-tags` flags to preview and filter auto-prune candidates.
- Added Prometheus metrics export via `/metrics` endpoint (`--metrics-export prometheus` flag).
- Added metrics persistence across server restarts using `--persist-metrics` and `--metrics-path`.
- Added observability enhancements: per-tool latency percentiles (p50/p95/p99) and resource read frequency tracking via MCP resources.
- Added `search_audit_log` tool for querying server audit logs with filters.
- Added `mj-mcp-optimize` skill for debugging Code Mode execution pipeline.
- Added optimistic concurrency control for entry updates using `version` and `expected_version`.
- Added Team Role-Based Access Control (RBAC) with `admin`, `member`, and `viewer` roles, including configuration fallbacks and member management tools.
- Added Team Identity Layer with author aliases and management tools (`team_add_author_alias`, etc.).
- Added GitHub rate limit resource (`memory://github/rate-limit`) with passive rate limit header capture from API responses.
- Added fuzzy search fallback for search queries (typo tolerance) using Levenshtein distance on entry tags and types.
- Added support for swappable vector embedding models via `--embedding-model`.
- Added `cross_team_search` tool to perform read-only searches across multiple team databases simultaneously.
- Added `resources/subscribe` capability and real-time subscription manager for targeted notifications.
- Added FTS5 highlight snippets and faceted search capabilities to FTS search and hybrid search.
- Added dynamic weighting (`fts_weight`, `semantic_weight`) and explicit `mode` parameter for hybrid search strategies.
- Added database schema migration framework with sequential migrations.
- Added composite and partial performance indexes to optimize active entries and recent page queries.
- Added soft-delete recovery via `restore_entry` tools, and `list_deleted_entries` for discovery prior to permanent deletion.
- Added archiving capabilities with `is_archived` status and `include_archived` filter options to exclude historical entries from default search results.
- Added O(1) keyset cursor pagination to listing and search tools.
- Added batch operation tools to the core and team admin groups (`batch_create_entries`, `batch_update_entries`, `batch_delete_entries`).
- Added entry versioning/history tracking in an `entry_revisions` table, accessible via `get_entry_history`.
- Added Code Mode API enhancements: support for all batch operations, missing team aliases, project insight fallbacks, `sleep(ms)`/`setTimeout` global aliases, and `snake_case` to `camelCase` parameter mapping.
- Added a Capacity Planning Guide to the documentation.

### Changed
- Improved GitHub resource routing in multi-project environments by safely falling back to the configured `DEFAULT_PROJECT_NUMBER` when `{repo}` is omitted from the resource URI.
- Enhanced the `secureDispatcher` to automatically resolve `repo` from `project_number` (and vice-versa), eliminating the strict requirement for agents to pass both arguments in multi-project setups.
- Updated `github.md` and `gotchas.md` server instructions to reflect the new auto-resolution capabilities and reduced operational friction.
- Upgraded token estimation from a flat heuristic to content-type-aware ratios for improved accuracy across structured data, code snippets, and natural language.
- Updated CLI configuration loader to aggregate all startup validation errors and report them simultaneously, rather than crashing on the first invalid parameter.
- Updated server instructions, wiki documentation, testing prompts, and configuration templates to comprehensively reflect new features, capabilities, and correct tool counts.
- Updated `mj_execute_code` schema description and internal Code Mode catch blocks to explicitly instruct agents to use the `context` parameter for Markdown and large strings, preventing Tagged Template Literal escaping bugs.

### Fixed
- Fixed documentation typos in `test-server/code-map.md` regarding Kanban tools and missing markdown directory.
- Fixed a security gap where `resources/subscribe` requests bypassed scope boundaries, allowing unauthorized clients to receive real-time notifications for restricted resources.
- Fixed FTS search phrase matching to preserve balanced double-quotes for exact phrase matches.
- Fixed regression where batch database operations failed atomically by returning structured `errors` arrays for partial successes and aggregating them using `AggregateMcpError`.
- Fixed silent type failures in Code Mode where agents calling project methods without an active registry received an un-iterable `stats` object instead of an array.
- Fixed silent and confusing `TypeError` failures in Code Mode by proxying successful non-array object results to explicitly intercept hallucinated Array method calls.
- Fixed generic `ReferenceError` for `fetch()` in Code Mode sandboxes by injecting a descriptive `SandboxNetworkError` interceptor.
- Fixed silent failure in Code Mode's `auto-return` transformation parsing of multiline template literals.
- Fixed validation error for string repository names in Code Mode `project_number` arguments by auto-resolving to numeric IDs.
- Fixed validation error in `mj_execute_code` by making the `code` parameter optional.
- Fixed Code Mode execution errors for `read_query` alias by wrapping `searchEntries`.
- Fixed `ConfigResolver` crashing with a JSON Syntax Error when loading pre-parsed nested objects from `.json` configuration files.
- Fixed Windows-specific race condition in `restoreFromFile` where lingering empty lock directories caused restores to abort.
- Fixed Zod schema validation error during hybrid search by correctly casting the internal `isArchived` flag.
- Fixed missing or inconsistent `project_number` validation and fallback logic in team search and team flag tools.
- Fixed restrictive `project_number` checks to allow moving team entries to different projects.
- Fixed team admin tools failing to check the `codemodeInternalFullAccess` configuration flag.
- Fixed `cross_team_search` incorrectly omitting the primary team database when executing cross-database searches.
- Fixed duplicated token estimation logic in the audit interceptor that bypassed the centralized `estimateTokens()` function.
- Fixed potential null runtime errors in semantic search and vector indexing.
- Fixed entry revision eviction logic to correctly preserve the 10 newest snapshots.
- Fixed an issue where temporary backup test directories, encrypted test databases, and `.sqlite` files generated by the End-to-End test suite were not properly cleaned up after execution.
- Fixed Docker Hub repository description not updating during deployments.
- Fixed `ReferenceError` crash in batch operations by importing `sendProgress`.

### Removed
- Removed deprecated `pnpm` configuration block from `package.json` to eliminate startup warnings.
