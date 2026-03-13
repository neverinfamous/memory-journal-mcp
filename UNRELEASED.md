### Changed

- **Code Quality Audit Fixes (Round 2)**
  - Extracted `ToolRegistration` interface for typed `getTools()` return, eliminating ~10 unsafe `as` casts in `mcp-server.ts` tool registration
  - Added typed `pragma(command: string)` method to `IDatabaseAdapter` and `IDatabaseConnection` interfaces, eliminating unsafe `getRawDb() as { pragma/run }` casts in `scheduler.ts` and `backup.ts`
  - Typed `getStatistics()` return from `unknown` to `Record<string, unknown>` on `IDatabaseAdapter`
  - Added `queryRow()` / `queryRows()` typed query helpers to entries shared module
  - Extracted `autoIndexEntry()` helper into `utils/vector-index-helpers.ts`, removing 3-way fire-and-forget vector indexing duplication across `core.ts` and `admin.ts`
  - Extracted `handleResourceRead()` helper in `mcp-server.ts`, removing ~30 lines of duplicated resource response formatting between template and static resource registration
  - Replaced magic numbers with named constants: `MAX_RELATIONSHIP_SCORE_AT`, `MAX_CAUSAL_SCORE_AT`, `RECENCY_WINDOW_DAYS` in `importance.ts`; `MAX_PERIOD_ROWS` in `statistics.ts`; `MAX_BACKUP_NAME_LENGTH` in `backup.ts`
  - Removed no-op `await Promise.resolve()` calls in `scheduler.ts` (`runBackup`, `runVacuumOptimize`)
  - Added debug-level logging to previously silent WAL checkpoint error catch block in `backup.ts`

- **Code Quality Audit Fixes (Round 1)**
  - Renamed 7 `PascalCase` files to kebab-case to match workspace standards (`sqlite-adapter.ts`, `tool-filter.ts`, `github-integration.ts`, `mcp-server.ts`, `mcp-logger.ts`, `vector-search-manager.ts`, `server-instructions.ts`, `scheduler.ts`) and updated 27 import references across the codebase
  - Converted 13 bare `throw new Error(...)` statements to typed error classes (`ConfigurationError`, `ResourceNotFoundError`, `ConnectionError`, `QueryError`, `ValidationError`) for consistent error handling and standard structured error responses (`vector-search-manager.ts`, `sqlite-adapter.ts`, `handlers/resources/index.ts`, `handlers/prompts/index.ts`, `authorization-server-discovery.ts`, `sandbox-factory.ts`)
  - Renamed `src/types/sql.js.d.ts` to `sql-js.d.ts` to ensure strict compliance with kebab-case naming standard
  - Eliminated `eslint-disable-next-line` pragmas where possible (e.g. `no-control-regex` solved natively in `security-utils.ts`, `no-explicit-any` removed in `backup.ts`)
  - Strictified `z.object({})` Zod schemas by appending `.strict()` for safer payload validation on empty schemas (`admin.ts`, `backup.ts`, `core.ts`, `search.ts`, `read-tools.ts`)
  - Consolidated duplicated `resolveAuthor` / `resolveTeamAuthor` logic from `core.ts` and `team.ts` into shared `resolveAuthor()` in `security-utils.ts`
  - Removed `as unknown as Record<string, unknown>` type cast in `crud.ts` by adding `timestamp?: string` to `CreateEntryInput` interface
  - Removed deprecated `SERVER_INSTRUCTIONS` constant from `server-instructions.ts` (zero consumers)
  - Split 603-line `briefing.ts` into `briefing/` directory: `github-section.ts`, `context-section.ts`, `user-message.ts`, `index.ts` (all under 260 lines)
  - Replaced N+1 author queries in `team.ts` with single batch `SELECT ... WHERE id IN (...)` via `batchFetchAuthors()` helper
  - Replaced N+1 per-project tag queries in `analytics.ts` with single batch query grouped by `project_number`

### Fixed

- Resolved Zod `4.3.6` dependency resolution conflict with OpenAI SDK via explicit `package.json` overrides.
- Replaced `as unknown` type assertions with strict types where appropriate (`wasm-connection.ts`, `backup.ts`) and auth test mocks with properly mapped `QueryResult` types and `Object.create(Type.prototype)` mock instantiation.
- Resolved native driver (better-sqlite3) `datatype mismatch` and `more than one statement` exceptions by strictly enforcing `IDatabaseConnection`'s `exec` implementation in analytical routes.
- Abstracted `rawDb.exec` within the `relationships` tool group to an integrated adapter `executeRawQuery` to prevent query injection bypasses.
- Secured native snapshot backups by switching from blocked in-memory blob exports to transactional file-system copies with `wal_checkpoint(TRUNCATE)`.
- Fixed empty-array query result assertions across analytics, team, prompts, and resource handlers caused by SQLite native driver mismatching original `sql.js` row-wrapping (`rawDb.exec()`) structures natively by safely standardizing `executeRawQuery` mapping.

### Added

- **WASM SQLite Fallback Removed** — Removed the `sql.js` WASM fallback adapter to simplify the architecture, test matrix, and dependency footprint. The server now runs exclusively on the high-performance native `better-sqlite3` driver. `--sqlite-native` and `--sqlite-wasm` flags have been removed.
- **Harmonized Error Types (`error-types.ts`)** — New `ErrorCategory` enum (9 categories: validation, connection, query, permission, config, resource, authentication, authorization, internal), `ErrorResponse` interface, and `ErrorContext` interface. Part of the harmonized error handling standard across db-mcp, postgres-mcp, mysql-mcp, and memory-journal-mcp
- **`MemoryJournalMcpError` Base Class (`errors.ts`)** — Enriched base error class with `category`, `code`, `suggestion`, `recoverable`, `details`, and `cause` properties. Includes `toResponse()` method returning structured `ErrorResponse`. 6 subclasses: `ConnectionError`, `QueryError`, `ValidationError`, `ResourceNotFoundError`, `ConfigurationError`, `PermissionError`
- **`OAuthError` Extends `MemoryJournalMcpError`** — OAuth errors now inherit full error handling infrastructure (category, suggestion, toResponse()). Auto-categorizes as AUTHENTICATION (401) or AUTHORIZATION (403) based on httpStatus. Deprecated standalone `getWWWAuthenticateHeader()` utility; removed from barrel export
- **`SecurityError` Extends `MemoryJournalMcpError`** — Security validation errors (`InvalidDateFormatError`, `PathTraversalError`) now participate in the enriched error hierarchy with VALIDATION category
- **`formatHandlerErrorResponse()` Function** — New enriched error formatter in `error-helpers.ts` returning full `ErrorResponse` objects with code, category, suggestion, and recoverable fields. Handles `MemoryJournalMcpError`, `ZodError`, and raw errors. Existing `formatHandlerError()` preserved for backward compatibility

- **Configurable Briefing (`memory://briefing`)** — 5 new env vars / CLI flags to customize the session briefing
  - `BRIEFING_ENTRY_COUNT` / `--briefing-entries` — Number of journal entries (default: 3)
  - `BRIEFING_INCLUDE_TEAM` / `--briefing-include-team` — Include team DB entries in briefing
  - `BRIEFING_ISSUE_COUNT` / `--briefing-issues` — Number of issues to list with titles (0 = count only)
  - `BRIEFING_PR_COUNT` / `--briefing-prs` — Number of PRs to list with titles (0 = count only)
  - `BRIEFING_PR_STATUS` / `--briefing-pr-status` — Show PR status breakdown (open/merged/closed)
  - Issues and PRs row now always displayed in the `userMessage` table when GitHub is available
  - `RULES_FILE_PATH` / `--rules-file` — Path to user rules file; shown in briefing with size and last-modified age
  - `SKILLS_DIR_PATH` / `--skills-dir` — Path to skills directory; shown in briefing with skill count
  - Expanded `## Rule & Skill Suggestions` in server instructions with guidance for adding, updating, and refining rules and skills
  - `BRIEFING_WORKFLOW_COUNT` / `--briefing-workflows` — Number of recent workflow runs to list with names and status icons
  - `BRIEFING_WORKFLOW_STATUS` / `--briefing-workflow-status` — Show workflow run status breakdown (passing/failing/pending/cancelled)
  - CI Status row in briefing enhanced to show named runs (✅ build · ❌ deploy) or aggregated counts
  - `get_copilot_reviews` tool — Fetch Copilot's code review findings for any PR (state, file-level comments with paths/lines)
  - `BRIEFING_COPILOT_REVIEWS` / `--briefing-copilot` — Aggregate Copilot review state across recent PRs in briefing
  - Copilot review patterns in server instructions (learn from reviews, pre-emptive checking, `copilot-finding` tag)

- **OAuth 2.1 Authentication Module** — Full RFC-compliant OAuth 2.0 authentication and authorization for the HTTP transport
  - 10 new files in `src/auth/`: types, errors, scopes, token-validator, oauth-resource-server, authorization-server-discovery, scope-map, auth-context, middleware, barrel
  - RFC 9728 Protected Resource Metadata endpoint (`/.well-known/oauth-protected-resource`)
  - RFC 8414 Authorization Server Metadata discovery with caching
  - JWT validation via `jose` library with JWKS caching and issuer/audience verification
  - 10 tool groups mapped to 3 OAuth scopes: `read` (core, search, analytics, relationships, export), `write` (github, team), `admin` (admin, backup, codemode)
  - `AsyncLocalStorage`-based per-request auth context threading
  - Express middleware for token extraction, validation, and scope enforcement
  - Transport-agnostic utilities: `createAuthenticatedContext`, `validateAuth`, `formatOAuthError`
  - 5 new CLI flags: `--oauth-enabled`, `--oauth-issuer`, `--oauth-audience`, `--oauth-jwks-uri`, `--oauth-clock-tolerance`
  - Environment variable support: `OAUTH_ENABLED`, `OAUTH_ISSUER`, `OAUTH_AUDIENCE`, `OAUTH_JWKS_URI`

- **Code Mode (`mj_execute_code`)** — Sandboxed JavaScript execution for multi-step workflows with 70-90% token reduction
  - 9 new files in `src/codemode/`: types, security manager, VM sandbox, worker-thread sandbox, worker script, sandbox factory, API bridge, API constants, barrel
  - `src/handlers/tools/codemode.ts` — Tool handler with security validation, rate limiting, and API bridge construction
  - `mj.*` namespaced API exposes all 44 tools across 10 groups (core, search, analytics, relationships, export, admin, github, backup, team, codemode)
  - Positional argument support, method aliases, per-group `help()` for discoverability
  - Production sandbox: `node:worker_threads` with V8 isolate boundary, `node:vm` secondary isolation, MessagePort RPC bridge
  - Resource limits: code length (50KB), execution timeout (30s), memory (128MB), rate limiting (60 executions/min), result size (10MB)
  - `--sandbox-mode <mode>` CLI flag: `worker` (production, default) or `vm` (lightweight)
  - Tool count: 42 → 44 tools, tool groups: 9 → 10

### Changed

- **Performance Optimization (I/O)** — Refactored blocking synchronous file system operations (`fs.writeFileSync`, `fs.readFileSync`, `fs.mkdirSync`, `fs.copyFileSync`, `fs.statSync`) in `BackupManager` to asynchronous `fs.promises` equivalents to prevent freezing the Node.js event pool during journal backups.
- **Performance Optimization (I/O)** — Refactored synchronous `fs.mkdirSync` and `fs.rmSync` in `VectorSearchManager` to asynchronous `fs.promises` equivalents for non-blocking directory operations during index initialization and rebuilding.
- **Performance Optimization (Build)** — Disabled generating `.map` source maps in production build (disabled `sourceMap` in `tsconfig.json`), saving approx 1-2MB in the final compiled bundle.
- **Performance Optimization (Memory)** — Refactored unbounded `SELECT * FROM memory_journal` queries across core handlers (`entries.ts`, `templates.ts`, `github.ts`, `core.ts`, `stats.ts`, `graph.ts`, `workflow.ts`) to use explicit `ENTRY_COLUMNS` projections, reducing I/O latency and WASM memory overhead.
- **Performance Optimization (Bundle)** — `WasmSqliteAdapter` initialization is now strictly loaded via a dynamic `await import` block inside `DatabaseAdapterFactory.create`. This keeps the heavy WASM binaries fully isolated from the top-level bundle payload on native platforms. 
- **Performance Optimization (Database)** — Unbounded `SELECT * FROM relationships` wildcard lookups have been restricted to strict `id, from_entry_id, to_entry_id, relationship_type, description, created_at` column mappings.
- **Performance Optimization (Sandbox)** — Capped Code Mode Result serialization using strict buffer tracking logic to prevent `JSON.stringify` from creating maximum V8 strings that blow through native application memory.
- **GitHub API Caching** — Implemented a bounded (max 100 items), TTL-aware LRU cache strategy in `GitHubClient` to prevent memory leaks on long-running instances.
- **Core Handlers Modularized**:
  - **SQLite Adapter** — Split monolithic `src/database/sqlite-adapter.ts` (1640 lines) into `src/database/sqlite-adapter/` containing `connection.ts`, `tags.ts`, `entries.ts`, `relationships.ts`, `backup.ts`, and `index.ts`.
  - **GitHub Integration** — Split monolithic `src/github/github-integration.ts` (1707 lines) into `src/github/github-integration/` containing focused modules (`auth.ts`, `repos.ts`, `issues.ts`, `pull-requests.ts`, `search.ts`, `copilot.ts`, `index.ts`).
  - **Core Resources** — Split monolithic `src/handlers/resources/core.ts` (823 lines) into `src/handlers/resources/core/` containing `briefing.ts`, `instructions.ts`, `stats.ts`, and `index.ts`.
  - **Briefing Resource** — Split monolithic `src/handlers/resources/core/briefing.ts` (603 lines) into `src/handlers/resources/core/briefing/` containing focused builders (`github-section.ts`, `context-section.ts`, `user-message.ts`) and `index.ts`.
- **Test Directory Renamed** — Renamed `src/auth/__tests__` to `src/auth/tests` to comply with the project's strict kebab-case naming standard.
- **HTTP Transport Modularized** — Continued splitting `src/transports/http.ts` and `src/transports/http/server.ts` into a fully modularized directory:
  - `types.ts` — Configuration interface (`HttpTransportConfig`), constants, rate limiting types
  - `security.ts` — Client IP extraction, built-in rate limiting, CORS (wildcard subdomain support), security headers
  - `handlers.ts` — Health check, root info, bearer token auth middleware
  - `server/` — Split `server.ts` into `stateless.ts`, `stateful.ts`, `legacy-sse.ts`, and `index.ts`
  - `index.ts` — Barrel re-export
- **CORS Configuration** — `corsOrigin: string` changed to `corsOrigins: string[]` for multi-origin support. CLI `--cors-origin` accepts comma-separated values. Wildcard subdomain patterns supported (e.g., `*.example.com`).
- **HSTS Configuration** — HSTS is now config-driven via `enableHSTS: true` instead of auto-detecting from `X-Forwarded-Proto` header.
- **Cache-Control Header** — Strengthened from `no-store` to `no-store, no-cache, must-revalidate`.

### Fixed

- **Code Mode `timeout` Parameter Ignored** — The `timeout` parameter on `mj_execute_code` was parsed by the Zod schema but never forwarded to the sandbox pool. All executions used the default 30s timeout regardless of the user-specified value. Added per-call `timeoutMs` override to `ISandbox`, `ISandboxPool`, and all sandbox/pool implementations (`WorkerSandbox`, `WorkerSandboxPool`, `CodeModeSandbox`, `SandboxPool`). Handler now destructures `timeout` and passes it to `pool.execute()`.

### Security

- **Built-in Rate Limiting** — Replaced `express-rate-limit` dependency with zero-dependency implementation. Health endpoint bypass, `Retry-After` header on 429, periodic cleanup with `.unref()`.
- **Server Timeouts** — Added HTTP request (120s), keep-alive (65s), and headers (66s) timeouts to mitigate DoS attacks.
- **CORS Enhancements** — `Access-Control-Max-Age: 86400`, `Vary: Origin` for specific origin matching, `corsAllowCredentials` option.
- **Trust Proxy** — `trustProxy` config option for correct `X-Forwarded-For` client IP extraction behind reverse proxies.
- **Max Body Size** — Configurable `maxBodySize` (default: 1MB) to prevent large request body attacks.

### Removed

- **`express-rate-limit` Dependency** — Replaced by built-in rate limiter.
