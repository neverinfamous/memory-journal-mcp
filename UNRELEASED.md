# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v8.0.1...HEAD)

### Added

- Code Mode execution enhancements:
  - Alias mappings for parameters/methods to handle agent hallucinations.
  - Added missing `POSITIONAL_PARAM_MAP` and `METHOD_ALIASES`.
  - Cross-group constructor wiring for search and vector indexing.
  - Support for batch operations, timer aliases, and snake_case mapping.
  - Automatic `project_number` injection in `mj_execute_code` and `secureDispatcher`.
  - Automatic `expected_version` injection via `auto_version: true`.
  - URI-aware `readResource` error handler suggesting `mj.*` alternatives.
  - `hasMore` boolean in results for pagination.
  - `mj-mcp-optimize` debugging skill.
  - `get_briefing` tool to surface the `memory://briefing` resource directly inside Code Mode.
- Auto-prune lifecycle management flags (`--archive-older-than-days`, `--prune-dry-run`, etc.).
- Database schema migration framework with composite/partial performance indexes.
- External import tools (`import_external`, `team_import_external`) for Notion/Obsidian/Logseq.
- Scheduled digest report delivery (`--report-interval`).
- Security: `DB_ENCRYPTION_KEY` for SQLCipher, and Team RBAC.
- Configuration: `.json`/`.yaml` support, `update_configuration` hot-reload, and `--dump-config`.
- Metrics: Prometheus `/metrics` export, persistent metrics (`--persist-metrics`), per-tool latency percentiles, and read frequency tracking.
- `search_audit_log` tool for querying server audit logs.
- Optimistic concurrency control for entry updates (`version` and `expected_version`).
- Team Identity Layer with author aliases and management tools.
- GitHub rate limit resource (`memory://github/rate-limit`).
- Search: Levenshtein distance fallback, FTS5 highlight snippets, and dynamic hybrid search weighting.
- Support for swappable vector embedding models (`--embedding-model`).
- `cross_team_search` tool for read-only searches across multiple team databases.
- `resources/subscribe` capability and real-time subscription manager.
- Soft-delete recovery and archiving capabilities.
- O(1) keyset cursor pagination for listing and search tools.
- Batch operation tools in core and team admin groups.
- Entry versioning and history tracking via `get_entry_history`.

### Changed

- Modularized Tier 1 monolith `src/server/mcp-server.ts` into a `src/server/mcp-server/` directory using the barrel export pattern (`core.ts`, `initialization.ts`, `tool-registration.ts`, `types.ts`).
- Modularized Tier 1 monolith `src/database/sqlite-adapter/index.ts` to logical sub-modules with a barrel export.
- Modularized Tier 1 monolith `src/handlers/tools/admin.ts` into a `src/handlers/tools/admin/` directory using the barrel export pattern.
- Modularized Tier 1 monolith `src/handlers/tools/search/index.ts` into a `src/handlers/tools/search/` directory using the barrel export pattern.
- Modularized Tier 2 file `src/database/sqlite-adapter/entries/search.ts` (802 lines) into a `search/` directory with sub-modules (`cursor.ts`, `fts-sanitizer.ts`, `query.ts`) and a barrel `index.ts`.
- Modularized Tier 2 file `src/handlers/tools/team/admin-tools.ts` (652 lines) into an `admin-tools/` directory with sub-modules (`crud.ts`, `batch.ts`) and a barrel `index.ts`.
- Modularized Tier 2 file `src/codemode/api.ts` (728 lines) into an `api/` directory with sub-modules (`types.ts`, `param-normalizer.ts`, `group-factory.ts`, `journal-api.ts`) and a barrel `index.ts`.
- Modularized Tier 2 file `src/codemode/worker-script.ts` (661 lines) by extracting `worker-result-proxy.ts` and `worker-api-proxy.ts` as sibling modules (entry point preserved for tsup bundling).
- Restored strict `project_number` requirement for team mutation handlers.
- Improved GitHub resource routing to safely fall back to `DEFAULT_PROJECT_NUMBER`.
- Enhanced `secureDispatcher` to automatically resolve `repo` from `project_number` (and vice-versa).
- Upgraded token estimation to use content-type-aware ratios.
- Updated CLI configuration loader to aggregate all startup validation errors simultaneously.
- Updated `mj_execute_code` schema to instruct agents to use the `context` parameter for large strings.
- Wired Code Mode `JournalApi` constructor to silently map cross-group operations.
- Normalized `exact_match` ↔ `fuzzy_match` bidirectionally in `secureDispatcher`.

- Refactored `ErrorCategory` enum to a string literal union for optimized runtime footprint.
- Standardized Error Handling: replaced raw generic `Error` throws with structured `ConfigurationError` and `MemoryJournalMcpError` inside `config-resolver.ts` and `maintenance-lock.ts`.

### Fixed
- Fixed internal `TypeError` in `get_briefing` tool where valid string payloads triggered an `'error' in` object check, preventing the tool from surfacing the briefing.
- Intercepted `getBriefing` and `readResource` calls inside the Code Mode Sandbox (`worker-script.ts`) to return explicit, actionable error messages rather than confusing "Operation not found" errors, steering agents to use their native Resource APIs instead.

- Fixed `project_number` validation failures in `mj_execute_code` by widening the outer Zod schema from `z.number()` to `relaxedNumber()`.
- Added `owner/repo` string-splitting fallback to `secureDispatcher` to ensure project IDs like `neverinfamous/memory-journal-mcp` resolve correctly.
- FTS search phrase matching to preserve balanced double-quotes.
- Batch operations failing atomically instead of returning structured partial errors.
- Code Mode execution stability issues:
  - Silent type failures for project methods without an active registry.
  - `TypeError` failures from Array method calls on object results.
  - Generic `ReferenceError` for `fetch()` replaced with `SandboxNetworkError`.
  - Silent failures in `auto-return` transformation for multiline template literals.
  - Validation errors for string repository names in `project_number`.
  - Errors from `read_query` aliases by wrapping `searchEntries`.
  - Missing Code Mode implementations for `getConfig` and `readResource`.
  - Validation error in `mj_execute_code` by making `code` parameter optional.
- Zod schema validation errors during hybrid search for the `isArchived` flag.
- Missing `project_number` validation and fallback logic in team search and flag tools.
- Restrictive `project_number` checks preventing moving team entries across projects.
- `cross_team_search` omitting the primary team database.
- Potential null runtime errors in semantic search and vector indexing.
- Entry revision eviction logic to correctly preserve the 10 newest snapshots.
- Missing cleanup of temporary directories and files after E2E test suites.
- Docker Hub repository description failing to update during deployments.
- `ReferenceError` crash in batch operations due to missing `sendProgress` import.
- `memory://help` generating incorrect tool group summaries.
- `list_deleted_entries` schema validation by allowing optional `limit` and `offset` defaults.
- Windows-specific race condition in `restoreFromFile` from lingering lock directories.
- `ConfigResolver` syntax crash when loading pre-parsed nested objects.
- Missing `project_number` validation in core `batch_create_entries`.
- Test timeout in coverage runs due to dynamic import deadlocks.
- Missing resources and incorrect counts in `test-server/code-map.md`.
- `parseProjectRegistry` not receiving injected `process.env.PROJECT_REGISTRY` from configuration loading.
- Missing project name metadata extraction from GitHub URLs in the `getStatistics` analytics fallback.
- Added `listEntries` to CodeMode `METHOD_ALIASES` to transparently handle agent hallucinations mapping to `searchEntries`.
- Fixed broken `core.getProjects` alias that pointed to non-existent `listProjects` method in the `core` group. Moved project-lookup aliases (`getProjects`, `listProjects`, `projects`) to the `analytics` group where `getCrossProjectInsights` actually lives.
- Type Safety & Boundary Validation fixes: replaced `any` with `unknown` across `member-tools.ts`, `worker-script.ts`, and `type-generator.ts`.
- Replaced `eslint-disable no-control-regex` by using modern Unicode property escapes (`\\p{Cc}`) for author sanitization in `security-utils.ts`.
- Replaced non-compliant `console.log/warn/error` usages with `process.stdout.write` and `process.stderr.write` in `cli.ts`.

### Security

- Gap in `resources/subscribe` where unauthorized clients could bypass scope boundaries.

### Removed

- Deprecated `pnpm` configuration block from `package.json` to eliminate startup warnings.
