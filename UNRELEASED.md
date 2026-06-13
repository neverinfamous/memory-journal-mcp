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
- Context bloat warning during initialization when registering >50 tools without filters.
- `issue_url` and `pr_url` auto-population in Code Mode proxy when GitHub context is available.
- `test-sdk-boundaries.mjs` integration test script to validate strict MCP SDK protocol-layer validation boundaries (Zod rejections) and environment dependencies (e.g. `TEAM_AUTHOR`).

### Changed
- Rewrote the `mj-mcp-optimize` developer skill document to strictly focus on anti-hallucination guardrails and instructing agents on how to optimize the server codebase instead of using technical workarounds.
- Consolidated dependency updates (`@types/node`, `tsup`, `actions/checkout`, `trufflesecurity/trufflehog`, `typescript-eslint`).
- Removed mandatory journaling requirement from `adversarial-performance` skill to support purely analytical runs.
- Wrapped batch operations in a single database transaction for improved throughput.
- Modularized core files and handlers into logical sub-directories.
- Enforced dynamic read-only constraints for Code Mode mutation protection, with auto-injected `project_number` and `expected_version`.
- Injected dynamic method aliases into Sandbox group bindings to resolve Code Mode alias errors.
- Improved GitHub resource routing to safely fall back to `DEFAULT_PROJECT_NUMBER`.
- Upgraded token estimation to use content-type-aware ratios.
- Aggregated all startup validation errors simultaneously in the CLI configuration loader.
- Replaced raw generic errors with structured `ConfigurationError` and `MemoryJournalMcpError`.
- Enriched schema descriptions, prompts, and documentation with explicit templates.
- Added numeric project IDs alongside repository names in the Briefing Config row.
- Replaced disabled lint rules with modern Unicode property escapes in security utilities.
- Relaxed the Code Mode `context` schema to `z.any()` to allow non-object values without validation failures.
- Promoted string-to-number coercion, repo name resolution, and `deepCamelToSnake` payload normalization globally to the top-level SDK proxy, optimizing native MCP calls to completely prevent validation failures from hallucinated camelCase keys.

### Removed
- Deprecated `pnpm` configuration block from `package.json` to eliminate startup warnings.

### Fixed
- `_execute_raw_query_unsafe` failing with a Zod error in the MCP client due to the use of `z.any()` in its output schema.
- Native MCP tools failing to auto-resolve hallucinated `repo` or `project` string parameters to numeric `project_number`s.
- Code Mode sandbox explicitly exposing the `setTimeout` and `getConfig` globals.
- `semanticSearch` returning artificially low similarity scores by converting L2 distance to Cosine Similarity.
- False-positive in the static security scanner where stripping string literals bypassed bracket-notation AST escapes validation.
- Issue where `--tool-filter codemode` inadvertently disabled mutating tool bindings.
- Test pollution from `codemode-restore.test.ts` by relocating `test-db` to `.test-output` with automatic teardown.
- `create_entry` missing auto-population of GitHub `issueUrl` when `issue_number` is provided.
- `get_entry_by_id` missing `relationships`, `importance`, and `importanceBreakdown` in response, and added `include_relationships` to its schema.
- `restore_backup` tool throwing `INTERNAL_ERROR` in environments with encryption (`DB_ENCRYPTION_KEY`).
- `search_audit_log` returning validation errors in environments without audit logging.
- Multiple `project_number` validation and resolution issues in the Code Mode dispatcher.
- Code Mode stability issues related to async/await handling, cross-context error serialization, and `fetch()` references.
- Code quality findings by removing unsafe types, using centralized loggers, and hardening schemas.
- Code Mode sandbox mutability guard failing to protect admin/team structural tools.
- Deep camelCase hallucinations in Code Mode batch payloads via recursive normalization.
- `dry_run` early returns executing before parameter normalization.
- Code Mode `mj.*` positional argument processing and empty parameter invocations throwing errors in Code Mode.
- `idempotentHint` values for `_execute_raw_query_unsafe`, `team_consolidate_authors`, and `team_remove_author_alias` tools not reflecting their actual destructiveness.
- `project_number` hallucination loop by appending numeric IDs to repository names in the Briefing `Workspaces` row.
- Markdown table alignment in `README.md` and `DOCKER_README.md`.
- Code Mode `mj.help()` returning incomplete group lists and snake_case method names.
- `mj.*` positional argument processing and empty parameter invocations throwing errors in Code Mode.
- `worker-script.js` resolution during `vitest` execution.
- Code Mode `get_recent_entries` and `get_entry_history` API signature mismatches breaking pagination.
- Code Mode sandbox failing to map test authors on environments missing `TEAM_AUTHOR`.
- `search_audit_log` schema allowing negative limits.
- `cross_team_search` handler throwing raw Zod errors.
- `getConfig()` and `readResource()` global built-ins returning invalid types.
- Code Mode non-array proxy error message string mismatch in `worker-result-proxy.ts`.
- Code Mode test failures for `mj.team.aliases` missing `success: true` in response.
- Code Mode `semanticSearch` returning zero results during vector latency by falling back to full-text search.
- Code Mode transparent cross-group routing discarding security validation errors.
- Code Mode sandbox not enforcing global `readonly` server mode.
- `fetch` explicitly returning an error in Code Mode; now properly `undefined`.
- Missing `metrics` object in Code Mode responses.
- Undocumented `timeout` alias for `mj_execute_code` schema.
- Code Mode Phase 16 Sandbox Basics schema verification failure by exposing internal `_execute_raw_query_unsafe`.
- Hallucinated test code in `test-cm-sandbox-basics.md`.
- FTS5 and Semantic/Auto search bug ignoring `include_archived` flag.
- Code Mode proxy agent hallucinations by adding interception aliases for:
  - `start_date` without `end_date` (maps to today).
  - `deletedCount` (maps to `count`).
  - `entryIds` and `deletedIds` destructuring.
  - missing `project_number` in batch operations.
  - unresolved string `project_number` (e.g. `"P154"`).
  - calling tools from the wrong API group.
  - dynamically probing `mj_execute_code` with empty payloads.
  - `createEntryMinimal`.
  - `revisions` (maps to `history`).
  - `comment` (maps to `resolution` for `resolve_team_flag`).
  - `target_user` (maps to `author`) and `contributor` (maps to `member`) for `setRole`.
  - `exact_match` (maps to `fuzzy_match`).
  - `script` (maps to `code` for `mj_execute_code`).
  - string parameter for `_executeRawQueryUnsafe`.
  - camelCase method aliases.
- Intercepted `exact_match` hallucinated parameter in `search_entries` schemas to map it correctly to `fuzzy_match` for exact matching control.
- `teamAddMember` inappropriately performing upserts on duplicate authors instead of failing with a `QueryError`.
- `Code Mode` RBAC and Alias test assertions silently failing to catch `success: false` proxies by forcing property access evaluation.
- `Code Mode` proxy error masking where test assertions expecting specific error string contents failed due to missing error codes.
- `update_configuration` failing to persist changes to disk because `ConfigManager` was instantiated without `configFilePath` in `buildServerOptions`.
- `instructionLevel` in `memory://briefing` returning a hardcoded `'standard'` value instead of the runtime configuration value.
- `create_entry` and `team_create_entry` natively bypassing `defaultProjectNumber` auto-injection, causing entries to save with `null` project numbers.
- `get_entry_history` returning raw `EntryRevision` database objects instead of mapping to the expected `GetEntryHistoryOutputSchema` shape.
- E2E testing suite lacking `DEFAULT_PROJECT_NUMBER` environment injection, preventing full tool coverage.
- Code Mode's `mj.reportProgress()` failing to trigger system-wide MCP `notifications/progress` events due to missing progress context in sandbox bindings.
- Stale "99 tools" documentation references across README, code-map, copilot-instructions, and tool-filter.ts, accurately syncing them to reflect the 100-tool inventory.

- Handlers failing to wrap `-32602` Zod validation errors as structured `VALIDATION_ERROR`s due to strict MCP SDK input schemas violating the `.optional()` relaxed schema pattern.
- `get_entry_by_id` and `get_entry_history` strict schemas missing `.int()` constraints on `entry_id`, allowing floats to bypass initial validation.
- `TeamExportMarkdownSchemaMcp`, `TeamImportMarkdownSchemaMcp`, `ImportExternalSchemaMcp`, and `ExportMarkdownSchemaMcp` strict enum and non-optional violations.
- `get_recent_entries` output schema blocking validation errors due to strict required fields `entries` and `count`.
- `batch_update_entries` and `batch_delete_entries` (along with team equivalents) returning `success: true` instead of structured `AGGREGATE_ERROR` when entries are not found.

### Security
- Arbitrary file read and missing binary integrity vulnerabilities in development server by pinning `esbuild` to 0.28.1.
- Scope boundary bypass vulnerability in `resources/subscribe` where unauthorized clients could connect.
- Critical supply-chain gap by fully migrating CI/CD workflows and Dockerfile to use `pnpm` lockfile guarantees.
