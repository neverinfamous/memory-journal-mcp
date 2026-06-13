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
- **Codemode Security Scanner:** Fixed a false-positive mitigation in the static security scanner where stripping all string literals inadvertently bypassed validation for bracket-notation AST escapes (like `x["constructor"]`). The scanner now correctly strips only template literals (`` ` ``) to safely allow Markdown prose while enforcing strict policies on single and double quotes.
- **Codemode Paradox:** Fixed an issue where running `--tool-filter codemode` inadvertently disabled all mutating tool proxy bindings inside the codemode sandbox by misidentifying the server state as "readonly". Code mode sandboxes now correctly expose all tool bindings unless `--tool-filter readonly` is explicitly passed.
- Fixed `codemode-restore.test.ts` polluting the project root with a `test-db` directory by relocating it to `.test-output` and adding automatic teardown.
- Fixed `create_entry` missing auto-population of GitHub `issueUrl` when `issue_number` is provided.
- Fixed `get_entry_by_id` missing `relationships`, `importance`, and `importanceBreakdown` in the return object, and added `include_relationships` to its schema.
- Fixed `deletedCount` proxy hallucination in Code Mode to map correctly to `count` for batch operations.
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
- Fixed Code Mode agents attempting to dynamically probe `mj_execute_code` by intercepting empty payloads (`{}`) and throwing a highly descriptive schema error instead of triggering a hard security failure (`"Code cannot be empty"`).
- Fixed `project_number` hallucination loop by appending the numeric ID directly to the repository name in the Briefing's `Workspaces` table row (e.g., `mysql-mcp (#14): ...`). This prevents IDs from being hidden when the `Config` row truncates at 3 repos.
- Fixed `ConfigResolver` syntax crash when loading pre-parsed nested objects.
- Fixed markdown table alignment in `README.md` and `DOCKER_README.md`.
- Fixed Code Mode `mj.help()` returning incomplete group lists, and method names in `snake_case` instead of `camelCase`, by properly using `createJournalApi` in the `mj_execute_code` handler instead of a manually constructed bindings object.
- Fixed `mj.*` positional argument processing (e.g. `mj.core.recent(2)`) and empty parameter invocations (e.g. `mj.analytics.stats()`) throwing errors in Code Mode due to the manual bindings object bypassing `normalizeParams`.
- Fixed `worker-script.js` resolution during `vitest` execution by dynamically pointing `WorkerSandbox` to the `dist/` directory when running tests from `src/codemode`.
- Fixed Code Mode `get_recent_entries` and `get_entry_history` API signature mismatches that broke cursor-based pagination and parameter validation.
- Added `issue_url` and `pr_url` auto-population in Code Mode proxy when GitHub context is available and `issue_number`/`pr_number` is provided.
- Fixed `createEntryMinimal` hallucination in Code Mode aliases.
- Fixed Code Mode sandbox execution failing to map test authors on environments missing `TEAM_AUTHOR` by adding a fallback to the local system username in `resolveAuthor`.
- Fixed Code Mode proxy hallucination where agents requested `revisions` instead of `history` on `mj.core.getEntryHistory` by adding a proxy alias fallback.
- Fixed `search_audit_log` schema allowing negative limits, which bypassed early warning boundaries.
- Fixed `cross_team_search` handler throwing raw Zod errors instead of returning structured `{ success: false, error: ... }` responses.
- Fixed Code Mode sandbox mapping `comment` to `resolution_comment` instead of `resolution` for `resolve_team_flag`, and added missing `readQuery` search aliases.
- Fixed `getConfig()` and `readResource()` global built-ins returning invalid types or failing to throw informative errors when accessed directly from the sandbox.
- Fixed Code Mode non-array proxy error message string mismatch in `worker-result-proxy.ts` to improve test compliance.
- Fixed Code Mode alias smoothing failure for `mj.team.setRole` by mapping hallucinated `target_user` to `author` and coercing hallucinated `contributor` role to `member` in `param-normalizer.ts`.
- Fixed Code Mode test failures for `mj.team.aliases` by adding `success: true` to the `teamListAuthorAliases` output schema and response payload.
- Relaxed the Code Mode `context` schema to `z.any()` to allow agents to pass non-object values like strings or arrays without triggering Zod validation failures.
- Fixed Code Mode `semanticSearch` returning zero results when vector latency occurs or thresholds mismatch by wrapping it to gracefully fall back to full-text search (`searchEntries`).
- Intercepted hallucinated `exact_match` parameter for search tools in Code Mode, mapping it gracefully to `fuzzy_match` so future agents succeed automatically.
- Intercepted hallucinated `script` parameter in `mj_execute_code` Code Mode execution, mapping it gracefully to `code` so future agents succeed automatically.
- Fixed Code Mode sandbox not enforcing global `readonly` server mode and added `readonly` schema parameter to dynamically restrict execution to read-only tools.
- Fixed `fetch` explicitly returning an error in Code Mode; now properly `undefined` for secure sandbox evaluation.
- Fixed missing `metrics` object in Code Mode responses by correctly propagating wall-time and CPU statistics from the sandbox worker.
- Mapped undocumented `timeout` alias for `mj_execute_code` schema to respect agent execution limits.
- Fixed Code Mode Phase 16 Sandbox Basics schema verification failure by exposing internal `_execute_raw_query_unsafe` tool for database introspection.
- Intercepted hallucinated string parameter for `_executeRawQueryUnsafe` in Code Mode, mapping it gracefully to `{ query: ... }` so future agents succeed automatically.
- Fixed hallucinated test code in `test-cm-sandbox-basics.md` by awaiting the raw query Promise and indexing the `result` property.
- Fixed FTS5 search bug where `include_archived` flag was ignored during query options passing.
- Fixed Semantic/Auto search bug where `include_archived` flag was ignored during post-fetch metadata filtering, preventing archived entries from being correctly excluded.
### Security
- Patched scope boundary bypass vulnerability in `resources/subscribe` where unauthorized clients could connect.
- Resolved critical supply-chain gap by fully migrating CI/CD workflows and Dockerfile to use `pnpm` lockfile guarantees.
