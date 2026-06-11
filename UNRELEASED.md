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
- Content templates instruction file (`memory://help/templates`) with per-entry-type markdown scaffolding for session summaries, feature implementations, bug fixes, planning, and technical notes.

### Changed
- **Dependency Updates**:
  - Bump `actions/checkout` from `6.0.2` to `6.0.3` in CI workflows.
  - Bump `trufflesecurity/trufflehog` from `3.95.3` to `3.95.5` in secrets-scanning workflow.
  - Bump `@types/node` from `25.9.1` to `25.9.2`.
  - Bump `typescript-eslint` from `8.60.1` to `8.61.0`.
- **Performance**: Resolved Critical N+1 SQLite Transaction bottleneck in Batch CRU operations (`src/database/sqlite-adapter/entries/crud.ts`). Refactored batch operations to wrap inner singular operations within a single top-level `db.transaction`, leveraging `better-sqlite3` nested savepoints to completely eliminate sequential `fsync` I/O stalls and drastically improve throughput.
- Modularized Tier 1-3 monolithic files (`src/server/mcp-server.ts`, `src/database/sqlite-adapter/index.ts`, `src/handlers/tools/admin.ts`, `src/handlers/tools/search/index.ts`, `src/codemode/api.ts`, `src/codemode/worker-script.ts`) into logical sub-directories with a barrel export pattern to improve codebase maintainability.
- Code Mode execution enhancements: implemented dynamic read-only constraint enforcement for mutation protection, and automatically injected `project_number` and `expected_version` requirements.
- Replaced legacy hardcoded alias intercepts inside the Code Mode proxy with dynamic `METHOD_ALIASES` injection into the Sandbox group bindings, permanently resolving missing alias errors (e.g., `mj.analytics.getProjects`).
- Improved GitHub resource routing to safely fall back to `DEFAULT_PROJECT_NUMBER`.
- Upgraded token estimation to use content-type-aware ratios.
- Updated CLI configuration loader to aggregate all startup validation errors simultaneously.
- Standardized Error Handling: replaced raw generic `Error` throws with structured `ConfigurationError` and `MemoryJournalMcpError`.
- Enriched `create_entry`, `update_entry`, `team_create_entry`, and `team_update_entry` tool descriptions and Zod schema `.describe()` strings with inline structural templates and anti-hallucination guidance for entry content, type, and tags.
- Hardened `session-summary` and `team-session-summary` prompts with exact required template structure and explicit anti-hallucination rules (no extra sections, no omissions).
- Expanded `overview.md` Session Summaries section with inline code-block template and explicit structural constraints.
- Briefing Config row now displays numeric project IDs alongside repo names (e.g., `registry: adamic (#1), mysql-mcp (#14)`).
- Updated `mj_execute_code` and `create_entry` schema descriptions to clarify `project_number` format and where to find numeric IDs.
- Expanded `overview.md` Strict Validation guidance with `project_number` format requirements and Code Mode auto-resolution note.

### Fixed
- Fixed `project_number` string-to-number resolution in Code Mode `secureDispatcher` to apply to **all** tools, not just team operations. Previously, `create_entry` with `project_number: "mysql-mcp"` would fail with a Zod validation error.
- Added numeric-string coercion in `secureDispatcher` (e.g., `"14"` → `14`) as a fallback after registry lookup.
- Fixed `owner/repo` splitting heuristic in `secureDispatcher` to perform a registry lookup on the extracted repo name instead of passing the raw string through.
- Fixed outer `projectId` in `mj_execute_code` handler to resolve string project names (e.g., `"mysql-mcp"` → `14`) before auto-injection into tool calls, so response `project_id` and all auto-injected values are numeric.
- Fixed `dry_run` and simulation early returns in `secureDispatcher` to execute **after** param normalization (camelCase→snake_case, project_number resolution, numeric coercion), so simulated responses show correctly resolved parameters instead of raw hallucinated strings.
- Fixed `project_number` hallucination loop by appending the numeric ID directly to the repository name in the Briefing's `Workspaces` table row (e.g., `mysql-mcp (#14): ...`). This prevents IDs from being hidden when the `Config` row truncates at 3 repos.
- Fixed Code Quality Audit findings: Removed stale `as any` comment in kanban tools, fixed raw `console.error` usage in Code Mode sandbox by replacing it with centralized logger, and hardened empty `z.object({})` schemas in core tools with `.strict()` modifier.
- Fixed `get_entry_history` schema expectations in E2E tests and handler output payloads.
- Fixed `project_number` validation failures in `mj_execute_code` by widening the outer Zod schema from `z.number()` to `relaxedNumber()`.
- Fixed Code Mode sandbox mutability guard to correctly protect all admin/team structural and mutation tools via dynamic `tool.annotations.readOnlyHint` checks.
- Intercepted `getBriefing` and `readResource` calls inside the Code Mode Sandbox to return actionable error messages instead of generic sandbox errors.
- Fixed `project_number` string-splitting fallback in `secureDispatcher` to resolve standard IDs correctly.
- Added balanced double-quotes preservation to FTS search phrase matching.
- Fixed batch operations to fail atomically instead of returning structured partial errors.
- Fixed Code Mode execution stability issues including `ReferenceError` for `fetch()`, array method failures, and `read_query` aliases.
- Fixed Code Mode async/await hallucinations by wrapping Promise returns in a Proxy that intercepts synchronous property accesses and throws clear instructional errors instead of generating silent downstream `undefined.map` failures.
- Fixed cross-context IPC error serialization in Code Mode sandbox by implementing explicit `ownKeys` and `getOwnPropertyDescriptor` enumerability traps on `wrapResult` proxies, preventing `Error: {}` outputs.
- Fixed deep camelCase hallucinations in Code Mode batch payloads (e.g., `projectNumber` to `project_number`) via a recursive `deepCamelToSnake` normalizer in the secure dispatcher.
- Fixed Zod schema validation errors during hybrid search for the `isArchived` flag.
- Fixed eviction logic to correctly preserve the 10 newest snapshot revisions.
- Fixed `ConfigResolver` syntax crash when loading pre-parsed nested objects.
- Removed deprecated `pnpm` configuration block from `package.json` to eliminate startup warnings.
- Fixed Type Safety & Boundary Validation fixes: replaced `any` with `unknown` across multiple modules.
- Replaced `eslint-disable no-control-regex` by using modern Unicode property escapes in security utils.

### Security
- Patched scope boundary bypass vulnerability in `resources/subscribe` where unauthorized clients could connect.
- Resolved critical supply-chain gap by fully migrating CI/CD workflows and Dockerfile to use `pnpm`, properly enforcing lockfile guarantees (`pnpm-lock.yaml`) and preventing silent dependency drift caused by legacy `npm ci` calls.
