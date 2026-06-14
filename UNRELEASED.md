# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v8.0.1...HEAD)

### Added
- External import tools (`import_external`, `team_import_external`) for Notion, Obsidian, and Logseq integrations.
- Auto-prune lifecycle management flags (`--archive-older-than-days`, `--prune-dry-run`).
- Database schema migration framework with composite and partial performance indexes.
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
- Auto-population of `issue_url` and `pr_url` in Code Mode proxy when GitHub context is available.
- `test-sdk-boundaries.mjs` integration test script to validate strict MCP SDK boundaries.
- `scripts/README.md` containing an agent-optimized script inventory and execution guidelines.

### Changed
- Updated `mj-mcp-optimize` developer skill document to focus on anti-hallucination guardrails and native optimization.
- Consolidated dependency updates.
- Removed mandatory journaling requirement from `adversarial-performance` skill to support analytical runs.
- Wrapped batch operations in a single database transaction for improved throughput.
- Modularized core files and handlers into logical sub-directories.
- Enforced dynamic read-only constraints for Code Mode mutation protection.
- Injected dynamic method aliases into Sandbox group bindings to resolve alias errors.
- Improved GitHub resource routing to safely fall back to `DEFAULT_PROJECT_NUMBER`.
- Upgraded token estimation to use content-type-aware ratios.
- Aggregated all startup validation errors simultaneously in the CLI configuration loader.
- Replaced raw generic errors with structured `ConfigurationError` and `MemoryJournalMcpError`.
- Enriched schema descriptions, prompts, and documentation with explicit templates.
- Replaced disabled lint rules with modern Unicode property escapes in security utilities.
- Relaxed the Code Mode `context` schema to allow non-object values without validation failures.
- Promoted parameter normalization and coercion to the top-level SDK proxy to prevent validation failures from hallucinated keys.
- Converted `scripts/check-orphans.ts` to a portable, zero-configuration `scripts/check-orphans.mjs` Node script.

### Removed
- `pnpm` configuration block from `package.json` to eliminate startup warnings.

### Fixed
- Zod validation errors in test suite caused by strict enforcement of `project_number`.
- Stale `create_entry_minimal` entry in `TOOL_GROUPS` causing test failures in Code Mode validation.
- `_execute_raw_query_unsafe` returning validation errors in the MCP client.
- Native MCP tools failing to auto-resolve hallucinated repository or project string parameters.
- Code Mode sandbox explicitly exposing `setTimeout` and `getConfig` globals.
- `semanticSearch` returning artificially low similarity scores.
- False-positive in the static security scanner regarding bracket-notation AST escapes.
- `--tool-filter codemode` inadvertently disabling mutating tool bindings.
- Test pollution in `codemode-restore.test.ts`.
- `create_entry` missing auto-population of GitHub URLs when `issue_number` is provided.
- `get_entry_by_id` missing relationships and importance breakdown in response.
- `restore_backup` tool failing in environments with database encryption.
- `search_audit_log` returning validation errors in environments without audit logging.
- Multiple `project_number` validation and resolution issues in the Code Mode dispatcher.
- Code Mode stability issues related to async/await handling, error serialization, and `fetch()`.
- Various code quality and type safety issues across handlers and schemas.
- Code Mode sandbox mutability guard failing to protect admin/team structural tools.
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
- Intercepted parameter hallucinations (`id` to `entry_id` and `ids` to `entry_ids`) across all standard Admin MCP schemas and the Code Mode handler to automatically self-heal common agent validation failures.
- Schema extraction in `memory://help` failing on Zod pipelines.
- `dry_run` early returns executing before parameter normalization.
- `mj.*` positional argument processing and empty parameter invocations throwing errors in Code Mode.
- Incorrect `idempotentHint` values for destructive tools.
- `project_number` hallucination loop by appending numeric IDs to repository names in the Briefing rows.
- Markdown table alignment in `README.md` and `DOCKER_README.md`.
- Code Mode `mj.help()` returning incomplete group lists and snake_case method names.
- `worker-script.js` resolution during Vitest execution.
- Code Mode API signature mismatches breaking pagination for `get_recent_entries` and `get_entry_history`.
- Code Mode sandbox failing to map test authors in environments missing `TEAM_AUTHOR`.
- `search_audit_log` schema allowing negative limits.
- `cross_team_search` handler throwing raw Zod errors instead of formatted responses.
- Code Mode proxy error messages and test assertions silently failing or missing error codes.
- Code Mode `semanticSearch` returning zero results during vector latency by falling back to FTS.
- Code Mode transparent cross-group routing discarding security validation errors.
- Code Mode sandbox not enforcing global `readonly` server mode.
- Missing `metrics` object in Code Mode responses.
- Undocumented `timeout` alias for `mj_execute_code` schema.
- Exposed `_execute_raw_query_unsafe` in Code Mode Phase 16 Sandbox Basics.
- Hallucinated test code in `test-cm-sandbox-basics.md`.
- FTS5 and Semantic/Auto search ignoring the `include_archived` flag.
- `teamAddMember` inappropriately performing upserts on duplicate authors.
- `update_configuration` failing to persist changes to disk due to missing `configFilePath`.
- `instructionLevel` in `memory://briefing` returning a hardcoded value instead of configuration.
- `get_entry_history` returning raw database objects instead of the expected output schema.
- Code Mode's `mj.reportProgress()` failing to trigger system-wide MCP notifications.
- Stale 99 tools documentation references across the repository to reflect the new 100-tool inventory.
- `team_batch_create_entries` incorrectly setting `isPersonal: true`.
- Handlers failing to wrap Zod validation errors as structured `VALIDATION_ERROR`s.
- Strict `TEAM_AUTHOR` requirement causing permission errors on local environments without OAuth.
- Various schema validation issues including missing constraints, strict enum violations, and overly strict required fields blocking optimizations.
- Batch tools returning success instead of structured aggregate errors when entries are not found.
- Intercepted `create_entry_minimal` parameter hallucination at the SDK routing layer to prevent context window bloat while gracefully self-healing agent errors.
- Fixed `test-50k-boundary.mjs` executing the wrong entry point (`index.js` instead of `cli.js`) causing false negatives in boundary validation.
- Fixed Search Isolation Bypass in `team_search` and `team_search_by_date_range` to correctly return `VALIDATION_ERROR` when `project_number` is omitted and the query contains non-flag targets.
- Fixed `test-metrics-persistence.mjs` test command in `test-core-infra.md` to use `npx tsx` instead of `node`.
- Fixed parameter hallucination and missing filtering in `semantic_search` and `team_semantic_search` by adding schema support for `project_number`, `issue_number`, `pr_number`, and `workflow_run_id`.

### Security
- Arbitrary file read and missing binary integrity vulnerabilities in development server by pinning `esbuild` to 0.28.1.
- Scope boundary bypass vulnerability in `resources/subscribe` where unauthorized clients could connect.
- Critical supply-chain gap by fully migrating CI/CD workflows and Dockerfile to use `pnpm` lockfile guarantees.
