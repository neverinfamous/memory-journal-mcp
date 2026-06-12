# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v8.0.1...HEAD)

### Added
- External import tools (`import_external`, `team_import_external`) for Notion/Obsidian/Logseq integrations.
- Auto-prune lifecycle management flags (`--archive-older-than-days`, `--prune-dry-run`).
- Database schema migration framework with composite/partial performance indexes.
- Scheduled digest report delivery via `--report-interval`.
- Security enhancements including `DB_ENCRYPTION_KEY` for SQLCipher and Team RBAC.
- Native `.json`/`.yaml` configuration support with hot-reload via `update_configuration`.
- Persistent Prometheus `/metrics` export with latency percentiles and read tracking.
- `search_audit_log` tool for querying server audit logs.
- Optimistic concurrency control for entry updates (`version` and `expected_version`).
- Team Identity Layer with author aliases and cross-team search via `cross_team_search`.
- GitHub rate limit introspection resource (`memory://github/rate-limit`).
- Advanced Search: Levenshtein distance fallback, FTS5 highlight snippets, and dynamic hybrid search weighting.
- Support for swappable vector embedding models via `--embedding-model`.
- Real-time subscription manager (`resources/subscribe`).
- Soft-delete recovery and archiving capabilities.
- Keyset cursor pagination for listing and search tools.
- Entry versioning and history tracking via `get_entry_history`.
- Content templates instruction file (`memory://help/templates`) with per-entry-type markdown scaffolding.
- Added context bloat warning to server initialization when registering more than 50 tools without a tool filter, suggesting token-saving strategies like `--tool-filter codemode`.

### Changed
- Removed mandatory journaling requirement from the `adversarial-performance` skill to support purely analytical runs.
- Updated dependencies (`actions/checkout`, `trufflesecurity/trufflehog`, `@types/node`, `typescript-eslint`).
- Improved throughput for batch operations by wrapping them in a single database transaction.
- Modularized core files and handlers into logical sub-directories to improve maintainability.
- Enforced dynamic read-only constraints for mutation protection in Code Mode, and automatically injected `project_number` and `expected_version`.
- Resolved missing alias errors in Code Mode by injecting dynamic method aliases into the Sandbox group bindings.
- Improved GitHub resource routing to safely fall back to `DEFAULT_PROJECT_NUMBER`.
- Upgraded token estimation to use content-type-aware ratios.
- Updated CLI configuration loader to aggregate all startup validation errors simultaneously.
- Replaced raw generic errors with structured `ConfigurationError` and `MemoryJournalMcpError`.
- Enriched schema descriptions, prompts, and documentation with explicit templates to reduce agent hallucinations.
- Added numeric project IDs alongside repository names in the Briefing Config row.
- Removed deprecated `pnpm` configuration block from `package.json` to eliminate startup warnings.
- Replaced disabled lint rules with modern Unicode property escapes in security utilities.

### Fixed
- Fixed `restore_backup` tool throwing `INTERNAL_ERROR` when used in environments with encryption (`DB_ENCRYPTION_KEY`) by correctly passing the key to the `better-sqlite3` instance during `PRAGMA integrity_check`.
- Fixed `entryIds` and `deletedIds` destructuring hallucination in Code Mode by adding proxy fallbacks to gracefully convert `entries` and `updated`/`deleted` arrays to match expected signatures.
- Fixed `search_audit_log` returning validation errors when called in environments where audit logging is not configured (e.g., Code Mode tests), instead returning a graceful empty result.
- Fixed multiple `project_number` validation and resolution issues in the Code Mode dispatcher, including numeric coercion, repository name lookups, and more actionable errors.
- Fixed Code Mode stability issues related to async/await handling, cross-context error serialization, and `fetch()` references.
- Fixed code quality findings by removing unsafe types, using centralized loggers, and hardening schemas.
- Fixed Code Mode sandbox mutability guard to correctly protect all admin/team structural and mutation tools.
- Fixed deep camelCase hallucinations in Code Mode batch payloads via recursive normalization.
- Intercepted `getBriefing` and `readResource` calls inside the Code Mode Sandbox to return actionable error messages.
- Fixed `dry_run` and simulation early returns in `secureDispatcher` to execute **after** param normalization (camelCase→snake_case, project_number resolution, numeric coercion), so simulated responses show correctly resolved parameters instead of raw hallucinated strings.
- Fixed unhelpful Zod errors when agents hallucinate a string `project_number` (e.g., `"P154"`) by intercepting unresolved strings in `secureDispatcher` and returning a highly actionable custom error instructing them to omit the field for auto-injection.
- Fixed agents failing when calling tools from the wrong API group (e.g. `mj.core.searchEntries`) by adding a cross-group search fallback to the sandbox proxy that throws a highly specific error directing them to the correct group (e.g. `mj.search.searchEntries`).
- Fixed `project_number` hallucination loop by appending the numeric ID directly to the repository name in the Briefing's `Workspaces` table row (e.g., `mysql-mcp (#14): ...`). This prevents IDs from being hidden when the `Config` row truncates at 3 repos.
- Fixed `ConfigResolver` syntax crash when loading pre-parsed nested objects.
- Fixed markdown table alignment in `README.md` and `DOCKER_README.md`.
- Fixed `worker-script.js` resolution during `vitest` execution by dynamically pointing `WorkerSandbox` to the `dist/` directory when running tests from `src/codemode`.

### Security
- Patched scope boundary bypass vulnerability in `resources/subscribe` where unauthorized clients could connect.
- Resolved critical supply-chain gap by fully migrating CI/CD workflows and Dockerfile to use `pnpm` lockfile guarantees.
